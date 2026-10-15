// Global leaderboard. Works once an Upstash Redis store is connected to the Vercel project
// (it provides UPSTASH_REDIS_REST_URL / _TOKEN or KV_REST_API_URL / _TOKEN). Without it,
// both methods answer 503 { configured: false } and the game shows local scores only.
//
// Every submission carries the run's replay. The server re-runs it with the same engine the
// game uses (api/_engine.js) and only records the score the simulation actually produces, so
// edited scores are rejected. Replays are kept for 30 days so players can watch top runs.
import { verifyRun } from './_engine.js';
import { KEEP_N, TOP_N, clientIp, json, parseRange, redis, redisConfig, validBoard, validateSubmission } from './_lib.js';

const REPLAY_TTL = 30 * 86400;

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

  const verified = verifyRun(body.replay, e.board, e.score);
  if (!verified.ok) return json({ error: verified.error }, 400);

  const ip = clientIp(request);
  const id = Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  const key = `lb:${e.board}`;
  const member = JSON.stringify({ n: e.name, l: verified.level, c: verified.cls, d: e.date, r: id });
  try {
    const [count] = await redis(cfg, [
      ['INCR', `rl:${ip}`],
      ['EXPIRE', `rl:${ip}`, 60, 'NX'],
    ]);
    if (count > 10) return json({ error: 'rate_limited' }, 429);
    const cmds = [
      ['ZADD', key, verified.score, member],
      ['ZREMRANGEBYRANK', key, 0, -(KEEP_N + 1)],
      ['ZREVRANK', key, member],
      ['SET', `rp:${id}`, body.replay, 'EX', REPLAY_TTL],
    ];
    if (e.board.startsWith('daily:')) cmds.push(['EXPIRE', key, 3 * 86400]);
    const out = await redis(cfg, cmds);
    const rank = out[2];
    return json({ configured: true, rank: rank === null || rank === undefined ? null : rank + 1, id });
  } catch {
    return json({ error: 'store_error' }, 502);
  }
}
