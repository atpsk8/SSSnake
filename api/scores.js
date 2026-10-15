// Global leaderboard. Works once an Upstash Redis store is connected to the Vercel project
// (it provides UPSTASH_REDIS_REST_URL / _TOKEN or KV_REST_API_URL / _TOKEN). Without it,
// both methods answer 503 { configured: false } and the game shows local scores only.
import { KEEP_N, TOP_N, json, parseRange, redis, redisConfig, validBoard, validateSubmission } from './_lib.js';

export async function GET(request) {
  const cfg = redisConfig(process.env);
  if (!cfg) return json({ configured: false }, 503);
  const board = new URL(request.url).searchParams.get('board');
  if (!validBoard(board)) return json({ error: 'bad_board' }, 400);
  try {
    const [flat] = await redis(cfg, [['ZRANGE', `lb:${board}`, 0, TOP_N - 1, 'REV', 'WITHSCORES']]);
    return json({ configured: true, scores: parseRange(flat ?? []) });
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
  const check = validateSubmission(body);
  if (!check.ok) return json({ error: check.error }, 400);
  const e = check.entry;

  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const key = `lb:${e.board}`;
  const member = JSON.stringify({ n: e.name, l: e.level, c: e.cls, d: e.date, r: Math.random().toString(36).slice(2, 8) });
  try {
    const [count] = await redis(cfg, [
      ['INCR', `rl:${ip}`],
      ['EXPIRE', `rl:${ip}`, 60, 'NX'],
    ]);
    if (count > 10) return json({ error: 'rate_limited' }, 429);
    const cmds = [
      ['ZADD', key, e.score, member],
      ['ZREMRANGEBYRANK', key, 0, -(KEEP_N + 1)],
      ['ZREVRANK', key, member],
    ];
    if (e.board.startsWith('daily:')) cmds.push(['EXPIRE', key, 3 * 86400]);
    const out = await redis(cfg, cmds);
    const rank = out[2];
    return json({ configured: true, rank: rank === null || rank === undefined ? null : rank + 1 });
  } catch {
    return json({ error: 'store_error' }, 502);
  }
}
