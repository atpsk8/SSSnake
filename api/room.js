// Online Versus matchmaking by invite code. The host posts a WebRTC offer and gets a short
// code; the guest fetches the offer by code and posts an answer; the host polls for it.
// After that the two browsers talk directly and this endpoint is no longer involved.
// Rooms expire after 10 minutes. Uses the same Upstash store as the leaderboard.
import { clientIp, json, redis, redisConfig } from './_lib.js';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const ROOM_TTL = 600;
const MAX_SDP = 20000;

const validSdp = (s) => typeof s === 'string' && s.length > 10 && s.length <= MAX_SDP && s.startsWith('v=0');

export function makeCode(rand = Math.random) {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return c;
}

export async function GET(request) {
  const cfg = redisConfig(process.env);
  if (!cfg) return json({ configured: false }, 503);
  const code = (new URL(request.url).searchParams.get('code') || '').toUpperCase();
  if (!CODE_RE.test(code)) return json({ error: 'bad_code' }, 400);
  try {
    const [raw] = await redis(cfg, [['GET', `room:${code}`]]);
    if (!raw) return json({ error: 'not_found' }, 404);
    const room = JSON.parse(raw);
    return json({ configured: true, offer: room.offer, answer: room.answer ?? null });
  } catch {
    return json({ error: 'store_error' }, 502);
  }
}

export async function POST(request) {
  const cfg = redisConfig(process.env);
  if (!cfg) return json({ configured: false }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_body' }, 400);
  }
  const ip = clientIp(request);
  try {
    const [count] = await redis(cfg, [
      ['INCR', `rr:${ip}`],
      ['EXPIRE', `rr:${ip}`, 60, 'NX'],
    ]);
    if (count > 30) return json({ error: 'rate_limited' }, 429);

    if (body?.action === 'create') {
      if (!validSdp(body.offer)) return json({ error: 'bad_offer' }, 400);
      for (let tries = 0; tries < 8; tries++) {
        const code = makeCode();
        const [ok] = await redis(cfg, [['SET', `room:${code}`, JSON.stringify({ offer: body.offer }), 'EX', ROOM_TTL, 'NX']]);
        if (ok) return json({ configured: true, code });
      }
      return json({ error: 'busy' }, 503);
    }

    const code = String(body?.code || '').toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: 'bad_code' }, 400);
    const key = `room:${code}`;

    if (body.action === 'answer') {
      if (!validSdp(body.answer)) return json({ error: 'bad_answer' }, 400);
      const [raw] = await redis(cfg, [['GET', key]]);
      if (!raw) return json({ error: 'not_found' }, 404);
      const room = JSON.parse(raw);
      if (room.answer) return json({ error: 'taken' }, 409);
      await redis(cfg, [['SET', key, JSON.stringify({ ...room, answer: body.answer }), 'EX', ROOM_TTL]]);
      return json({ configured: true, ok: true });
    }

    if (body.action === 'close') {
      await redis(cfg, [['DEL', key]]);
      return json({ configured: true, ok: true });
    }
    return json({ error: 'bad_action' }, 400);
  } catch {
    return json({ error: 'store_error' }, 502);
  }
}
