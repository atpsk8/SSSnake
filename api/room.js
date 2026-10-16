// Online Versus matchmaking. Two ways in:
//  - invite code: the host posts a WebRTC offer and gets a short code; the guest fetches the
//    offer by code and posts an answer; the host polls for it. For up to 4 players the host
//    then posts a fresh offer ("reoffer", bumping `seq`) for the next friend, using the room's
//    secret token so nobody else can replace it.
//  - quick match: a public queue. If someone is waiting you get their offer (guest); otherwise
//    your offer becomes a room in the queue (host).
// After that the two browsers talk directly and this endpoint is no longer involved.
// Rooms expire after 10 minutes. Uses the same Upstash store as the leaderboard.
import { clientIp, json, redis, redisConfig } from './_lib.js';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const ROOM_TTL = 600;
const MAX_SDP = 20000;
const QUEUE = 'queue:quick';

const validSdp = (s) => typeof s === 'string' && s.length > 10 && s.length <= MAX_SDP && s.startsWith('v=0');

export function makeCode(rand = Math.random) {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return c;
}

async function createRoom(cfg, offer, quick) {
  const token = crypto.randomUUID();
  for (let tries = 0; tries < 8; tries++) {
    const code = makeCode();
    const [ok] = await redis(cfg, [['SET', `room:${code}`, JSON.stringify({ offer, quick, seq: 0, token }), 'EX', ROOM_TTL, 'NX']]);
    if (ok) return { code, token };
  }
  return null;
}

export async function GET(request) {
  const cfg = redisConfig(process.env);
  if (!cfg) return json({ configured: false }, 503);
  const params = new URL(request.url).searchParams;
  try {
    if (params.has('stats')) {
      const [waiting] = await redis(cfg, [['LLEN', QUEUE]]);
      return json({ configured: true, waiting: Number(waiting) || 0 });
    }
    const code = (params.get('code') || '').toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: 'bad_code' }, 400);
    const [raw] = await redis(cfg, [['GET', `room:${code}`]]);
    if (!raw) return json({ error: 'not_found' }, 404);
    const room = JSON.parse(raw);
    return json({ configured: true, offer: room.offer, answer: room.answer ?? null, seq: room.seq ?? 0 });
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
      const made = await createRoom(cfg, body.offer, false);
      return made ? json({ configured: true, ...made }) : json({ error: 'busy' }, 503);
    }

    if (body?.action === 'quick') {
      if (!validSdp(body.offer)) return json({ error: 'bad_offer' }, 400);
      // Pair with someone already waiting; skip rooms that expired or were taken.
      for (let i = 0; i < 6; i++) {
        const [code] = await redis(cfg, [['LPOP', QUEUE]]);
        if (!code) break;
        const [raw] = await redis(cfg, [['GET', `room:${code}`]]);
        if (!raw) continue;
        const room = JSON.parse(raw);
        if (room.answer) continue;
        return json({ configured: true, role: 'guest', code, offer: room.offer });
      }
      const made = await createRoom(cfg, body.offer, true);
      if (!made) return json({ error: 'busy' }, 503);
      await redis(cfg, [
        ['RPUSH', QUEUE, made.code],
        ['EXPIRE', QUEUE, ROOM_TTL],
      ]);
      return json({ configured: true, role: 'host', ...made });
    }

    const code = String(body?.code || '').toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: 'bad_code' }, 400);
    const key = `room:${code}`;

    if (body.action === 'answer') {
      if (!validSdp(body.answer)) return json({ error: 'bad_answer' }, 400);
      const [raw] = await redis(cfg, [['GET', key]]);
      if (!raw) return json({ error: 'not_found' }, 404);
      const room = JSON.parse(raw);
      const seq = room.seq ?? 0;
      // Answering an offer the host has already replaced: fetch the room again.
      if (body.seq !== undefined && Number(body.seq) !== seq) return json({ error: 'stale' }, 409);
      if (room.answer) return json({ error: 'taken' }, 409);
      // Two friends can read the same offer; only the first answer to claim it counts.
      const [claimed] = await redis(cfg, [['SET', `ans:${code}:${seq}`, '1', 'EX', ROOM_TTL, 'NX']]);
      if (!claimed) return json({ error: 'taken' }, 409);
      await redis(cfg, [['SET', key, JSON.stringify({ ...room, answer: body.answer }), 'EX', ROOM_TTL]]);
      return json({ configured: true, ok: true });
    }

    if (body.action === 'reoffer') {
      if (!validSdp(body.offer)) return json({ error: 'bad_offer' }, 400);
      const [raw] = await redis(cfg, [['GET', key]]);
      if (!raw) return json({ error: 'not_found' }, 404);
      const room = JSON.parse(raw);
      if (!room.token || body.token !== room.token) return json({ error: 'forbidden' }, 403);
      const seq = (room.seq ?? 0) + 1;
      await redis(cfg, [['SET', key, JSON.stringify({ ...room, offer: body.offer, answer: null, seq }), 'EX', ROOM_TTL]]);
      return json({ configured: true, ok: true, seq });
    }

    if (body.action === 'close') {
      // Only the host (who holds the token) may close a room.
      const [raw] = await redis(cfg, [['GET', key]]);
      if (raw) {
        const room = JSON.parse(raw);
        if (room.token && body.token !== room.token) return json({ error: 'forbidden' }, 403);
      }
      await redis(cfg, [
        ['DEL', key],
        ['LREM', QUEUE, 0, code],
      ]);
      return json({ configured: true, ok: true });
    }
    return json({ error: 'bad_action' }, 400);
  } catch {
    return json({ error: 'store_error' }, 502);
  }
}
