import { describe, expect, it } from 'vitest';
import { Game } from './game/engine';
import { dailySeed } from './game/rng';
import { DIRS, DIR_LIST, OPPOSITE, add, eq, inBounds, type Dir, type ModeId, type SnakeClass } from './game/types';
import { hashGame } from './net/lockstep';
import { FRAME_MS, decodeReplay, encodeReplay, simulate, verifyRun, type Input } from './replay';
import { Runner } from './runner';

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}

/** Play a run through the Runner with a steering bot and uneven frame times. */
function play(mode: ModeId, seed: number, cls: SnakeClass, ms = 60_000) {
  const g = new Game({ mode, seed, classes: [cls, 'racer'] });
  const r = new Runner(g, { keyframes: true });
  const rnd = rng(seed * 31);
  for (let t = 0; t < ms && g.status !== 'over'; t += 16) {
    if (g.status === 'draft') r.input({ p: 0, t: 'draft', i: Math.floor(rnd() * 3) });
    const me = g.p0;
    const free = (d: Dir) => {
      const c = add(me.body[0], DIRS[d]);
      return (g.wraps || inBounds(c)) && !(inBounds(c) && g.solid[c.y * 24 + c.x]) && !me.body.some((s) => eq(s, c));
    };
    if (!free(me.dir) || rnd() < 0.03) {
      const opts = DIR_LIST.filter((d) => d !== OPPOSITE[me.dir] && free(d));
      if (opts.length) r.input({ p: 0, t: 'turn', d: opts[Math.floor(rnd() * opts.length)] });
    }
    if (rnd() < 0.01) r.input({ p: 0, t: 'shed' });
    if (rnd() < 0.02) r.input({ p: 0, t: 'hold', on: rnd() < 0.5 } as Input);
    r.tick(8 + rnd() * 25);
  }
  return { g, r };
}

describe('replays', () => {
  it('encode/decode round-trips', () => {
    const { g, r } = play('arcade', 3, 'viper', 20_000);
    const rep = r.replay({ mode: 'arcade', seed: g.seed, classes: ['viper'] });
    const back = decodeReplay(encodeReplay(rep))!;
    expect(back).toEqual({ ...rep, level: undefined });
  });

  for (const mode of ['classic', 'arcade', 'daily', 'rhythm', 'zen'] as ModeId[]) {
    it(`${mode}: a replay reproduces the run exactly`, () => {
      for (const [seed, cls] of [
        [11, 'racer'],
        [12, 'viper'],
        [13, 'cobra'],
        [14, 'python'],
      ] as [number, SnakeClass][]) {
        const { g, r } = play(mode, seed, cls);
        const rep = decodeReplay(encodeReplay(r.replay({ mode, seed, classes: [cls] })))!;
        const out = simulate(rep)!;
        expect(out).not.toBeNull();
        expect(out.score).toBe(g.score);
        expect(out.level).toBe(g.level);
        expect(hashGame(out)).toBe(hashGame(g));
      }
    });
  }

  it('instant replay from a keyframe lands on the same state', () => {
    const { g, r } = play('arcade', 21, 'racer', 30_000);
    const point = r.rewindPoint(3)!;
    const pb = new Runner(point.g, { script: r.log, startFrame: point.f });
    for (let i = 0; i < 100_000 && pb.frame < r.frame && pb.game.status !== 'over'; i++) pb.tick(FRAME_MS, r.frame);
    expect(hashGame(pb.game)).toBe(hashGame(g));
  });

  it('rejects junk', () => {
    expect(decodeReplay('nope')).toBeNull();
    expect(decodeReplay('v1|arcade|1|racer|999999999||')).toBeNull();
    expect(decodeReplay('v1|arcade|1|dragon|10||')).toBeNull();
    expect(decodeReplay('v1|arcade|1|racer|10||5Q')).toBeNull();
  });
});

describe('server verification', () => {
  it('accepts an honest finished run and rejects tampering', () => {
    let found = false;
    for (let seed = 1; seed < 40 && !found; seed++) {
      const { g, r } = play('arcade', seed, 'racer', 120_000);
      if (g.status !== 'over' || g.score < 1) continue;
      found = true;
      const rep = encodeReplay(r.replay({ mode: 'arcade', seed, classes: ['racer'] }));
      const ok = verifyRun(rep, 'arcade', g.score);
      expect(ok).toEqual({ ok: true, score: g.score, level: g.level, timeMs: g.time, cls: 'racer' });
      expect(verifyRun(rep, 'arcade', g.score + 500)).toEqual({ ok: false, error: 'score_mismatch' });
      expect(verifyRun(rep, 'classic', g.score)).toEqual({ ok: false, error: 'bad_mode' });
    }
    expect(found).toBe(true);
  });

  it('checks the daily seed matches the board date', () => {
    const date = '2026-10-15';
    const { g, r } = play('daily', dailySeed(date), 'racer', 120_000);
    const rep = encodeReplay(r.replay({ mode: 'daily', seed: dailySeed(date), classes: ['racer'] }));
    if (g.status === 'over') expect(verifyRun(rep, `daily:${date}`, g.score).ok).toBe(true);
    expect(verifyRun(rep, 'daily:2026-10-16', g.score)).toEqual({ ok: false, error: 'wrong_seed' });
  });

  it('a long run verifies quickly', () => {
    const { r } = play('zen', 5, 'racer', 600_000);
    const rep = decodeReplay(encodeReplay(r.replay({ mode: 'zen', seed: 5, classes: ['racer'] })))!;
    const t0 = performance.now();
    simulate(rep);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
