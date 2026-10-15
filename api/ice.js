// ICE servers for online Versus. STUN alone lets most players connect directly; a TURN relay
// is the fallback for strict networks (offices, schools, some mobile carriers).
//
// Configure one of these in the Vercel project (Settings -> Environment Variables):
//   Cloudflare TURN:  CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_KEY_API_TOKEN
//                     (short-lived credentials are generated per request; the token never
//                     reaches the browser)
//   Any TURN server:  TURN_URLS (comma-separated) + TURN_USERNAME + TURN_CREDENTIAL
import { json } from './_lib.js';

const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };

/** Cloudflare returns either { iceServers: [...] } or { iceServers: {...} } depending on endpoint. */
export function normalizeIce(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .filter((s) => s && s.urls)
    .map((s) => {
      // Browsers time out on port 53, so drop those URLs.
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === 'string' && !/:53(\?|$)/.test(u));
      return s.username ? { urls, username: s.username, credential: s.credential } : { urls };
    })
    .filter((s) => s.urls.length);
}

export async function iceServersFor(env, fetchImpl = fetch) {
  if (env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_KEY_API_TOKEN) {
    try {
      const res = await fetchImpl(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 7200 }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        const servers = normalizeIce(data.iceServers);
        if (servers.some((s) => s.username)) return { iceServers: [STUN, ...servers.filter((s) => s.username)], relay: 'cloudflare' };
      }
    } catch {
      /* fall through to the next option */
    }
  }
  if (env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    const urls = env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length) return { iceServers: [STUN, { urls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }], relay: 'custom' };
  }
  return { iceServers: [STUN], relay: null };
}

export async function GET() {
  const out = await iceServersFor(process.env);
  return json(out);
}
