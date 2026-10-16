import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/game/engine.ts';
import { DIRS, DIR_LIST, OPPOSITE, add, eq, inBounds } from '../src/game/types.ts';
import { encodeReplay } from '../src/replay.ts';
import { Runner } from '../src/runner.ts';
import { GET, POST } from './scores.js';
import { GET as GET_REPLAY } from './replay.js';

/** An honest finished arcade run: chase food, then curl up and bite its own body. */
function honestRun(seed) {
  const g = new Game({ mode: 'arcade', seed, classes: ['racer'] });
  const r = new Runner(g);
  for (let t = 0; t < 120000 && g.status !== 'over'; t += 16) {
    if (g.status === 'draft') r.input({ p: 0, t: 'draft', i: 0 });
    const me = g.p0;
    const food = g.pickups.find((p) => p.kind === 'food');
    if (food && g.score < 30) {
      const free = (d) => {
        const c = add(me.body[0], DIRS[d]);
        return inBounds(c) && !g.solid[c.y * 24 + c.x] && !me.body.some((b) => eq(b, c));
      };
      const opts = DIR_LIST.filter((d) => d !== OPPOSITE[me.dir] && free(d));
      const best = opts.sort((a, b) => {
        const da = add(me.body[0], DIRS[a]);
        const db = add(me.body[0], DIRS[b]);
        return Math.abs(da.x - food.pos.x) + Math.abs(da.y - food.pos.y) - (Math.abs(db.x - food.pos.x) + Math.abs(db.y - food.pos.y));
      })[0];
      if (best && best !== me.dir) r.input({ p: 0, t: 'turn', d: best });
    } else if (food && !me.queue.length) {
      // Walls don't kill, so turn clockwise every step until the snake runs into itself.
      const cw = { up: 'right', right: 'down', down: 'left', left: 'up' };
      r.input({ p: 0, t: 'turn', d: cw[me.dir] });
    }
    r.tick(16);
  }
  return { score: g.score, level: g.level, timeMs: g.time, replay: encodeReplay(r.replay({ mode: 'arcade', seed, classes: ['racer'] })) };
}

/** Minimal in-memory stand-in for Upstash's REST pipeline. */
function fakeUpstash() {
  const zsets = new Map();
  const counters = new Map();
  const strings = new Map();
  const run = ([cmd, key, ...args]) => {
    switch (cmd) {
      case 'INCR':
        counters.set(key, (counters.get(key) ?? 0) + 1);
        return counters.get(key);
      case 'EXPIRE':
        return 1;
      case 'ZADD': {
        const z = zsets.get(key) ?? [];
        z.push({ score: Number(args[0]), member: args[1] });
        zsets.set(key, z);
        return 1;
      }
      case 'ZREMRANGEBYRANK':
        return 0;
      case 'SET':
        strings.set(key, args[0]);
        return 'OK';
      case 'GET':
        return strings.get(key) ?? null;
      case 'ZREVRANK': {
        const z = [...(zsets.get(key) ?? [])].sort((a, b) => b.score - a.score);
        const i = z.findIndex((e) => e.member === args[0]);
        return i < 0 ? null : i;
      }
      case 'ZRANGE': {
        const z = [...(zsets.get(key) ?? [])].sort((a, b) => b.score - a.score).slice(Number(args[0]), Number(args[1]) + 1);
        return z.flatMap((e) => [e.member, String(e.score)]);
      }
      default:
        throw new Error(`unexpected ${cmd}`);
    }
  };
  return vi.fn(async (_url, init) => {
    const cmds = JSON.parse(init.body);
    return new Response(JSON.stringify(cmds.map((c) => ({ result: run(c) }))), { status: 200 });
  });
}

const post = (body, ip = '1.2.3.4') =>
  POST(new Request('https://x/api/scores', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': ip } }));

describe('/api/scores', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    vi.stubGlobal('fetch', fakeUpstash());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('answers 503 when no store is connected', async () => {
    vi.unstubAllEnvs();
    const res = await GET(new Request('https://x/api/scores?board=arcade'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ configured: false });
  });

  it('verifies replays, stores scores ranked, and serves the replays', async () => {
    const runA = honestRun(2);
    let runB = honestRun(3);
    for (let seed = 4; runB.score === runA.score && seed < 30; seed++) runB = honestRun(seed);
    expect(runA.score).toBeGreaterThan(0);
    expect(runB.score).toBeGreaterThan(0);
    const [low, high] = runA.score <= runB.score ? [runA, runB] : [runB, runA];
    const a = await post({ board: 'arcade', name: 'Ann', score: low.score, level: low.level, timeMs: Math.round(low.timeMs), cls: 'racer', replay: low.replay });
    expect(a.status).toBe(200);
    const b = await post({ board: 'arcade', name: 'Bob', score: high.score, level: high.level, timeMs: Math.round(high.timeMs), cls: 'racer', replay: high.replay });
    const bBody = await b.json();
    expect(bBody.rank).toBe(1);
    const res = await GET(new Request('https://x/api/scores?board=arcade'));
    const body = await res.json();
    expect(body.scores.map((s) => s.name)[0]).toBe('Bob');
    expect(body.scores[0]).toMatchObject({ score: high.score, cls: 'racer', id: bBody.id });
    const rp = await (await GET_REPLAY(new Request(`https://x/api/replay?id=${bBody.id}`))).json();
    expect(rp.replay).toBe(high.replay);
  });

  it('rejects edited scores and missing replays', async () => {
    const run = honestRun(2);
    const cheat = await post({ board: 'arcade', name: 'Eve', score: run.score + 100, level: 1, timeMs: Math.round(run.timeMs), cls: 'racer', replay: run.replay });
    expect(cheat.status).toBe(400);
    expect((await cheat.json()).error).toBe('score_mismatch');
    const none = await post({ board: 'arcade', name: 'Eve', score: 50, level: 1, timeMs: 60000, cls: 'racer' });
    expect((await none.json()).error).toBe('bad_replay');
    const daily = await post({ board: 'daily:2026-10-15', name: 'Eve', score: run.score, level: 1, timeMs: Math.round(run.timeMs), cls: 'racer', replay: run.replay });
    expect(daily.status).toBe(400);
  });

  it('rate-limits and validates boards', async () => {
    const run = honestRun(2);
    for (let i = 0; i < 10; i++) await post({ board: 'arcade', name: 'Spam', score: run.score, level: 1, timeMs: Math.round(run.timeMs), cls: 'racer', replay: run.replay }, '9.9.9.9');
    const limited = await post({ board: 'arcade', name: 'Spam', score: run.score, level: 1, timeMs: Math.round(run.timeMs), cls: 'racer', replay: run.replay }, '9.9.9.9');
    expect(limited.status).toBe(429);
    const badBoard = await GET(new Request('https://x/api/scores?board=zen'));
    expect(badBoard.status).toBe(400);
  });
});
