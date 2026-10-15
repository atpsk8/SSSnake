import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './scores.js';

/** Minimal in-memory stand-in for Upstash's REST pipeline. */
function fakeUpstash() {
  const zsets = new Map();
  const counters = new Map();
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

  it('stores scores and returns them ranked', async () => {
    const a = await post({ board: 'arcade', name: 'Ann', score: 900, level: 3, timeMs: 120000, cls: 'racer' });
    expect((await a.json()).rank).toBe(1);
    const b = await post({ board: 'arcade', name: 'Bob', score: 1500, level: 4, timeMs: 150000, cls: 'viper' });
    expect((await b.json()).rank).toBe(1);
    const res = await GET(new Request('https://x/api/scores?board=arcade'));
    const body = await res.json();
    expect(body.scores.map((s) => s.name)).toEqual(['Bob', 'Ann']);
    expect(body.scores[0]).toMatchObject({ score: 1500, level: 4, cls: 'viper' });
  });

  it('rejects bad input and rate-limits', async () => {
    const bad = await post({ board: 'arcade', name: 'Eve', score: 999999, level: 1, timeMs: 2000, cls: 'racer' });
    expect(bad.status).toBe(400);
    for (let i = 0; i < 10; i++) await post({ board: 'arcade', name: 'Spam', score: 10, level: 1, timeMs: 5000, cls: 'racer' }, '9.9.9.9');
    const limited = await post({ board: 'arcade', name: 'Spam', score: 10, level: 1, timeMs: 5000, cls: 'racer' }, '9.9.9.9');
    expect(limited.status).toBe(429);
    const badBoard = await GET(new Request('https://x/api/scores?board=zen'));
    expect(badBoard.status).toBe(400);
  });
});
