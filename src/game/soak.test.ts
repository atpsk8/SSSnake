import { describe, expect, it } from 'vitest';
import { Game } from './engine';
import { DIRS, OPPOSITE, W, add, eq, idx, inBounds, manhattan, wrapPos, type Dir, type ModeId, type Vec } from './types';

/** Greedy bot: avoid anything deadly, drift toward food, shed and surge sometimes. */
function botMove(g: Game, rnd: () => number) {
  const head = g.snake[0];
  const food = g.pickups.find((p) => p.kind === 'food')?.pos ?? head;
  const blocked = (p: Vec) =>
    g.solid[idx(p)] === 1 ||
    g.snake.some((s, i) => i < g.snake.length - 1 && eq(s, p)) ||
    g.shedWalls.some((w) => eq(w.pos, p)) ||
    g.mines.some((m) => eq(m.pos, p)) ||
    (g.rival?.body.some((s) => eq(s, p)) ?? false);
  const options = (Object.keys(DIRS) as Dir[])
    .filter((d) => d !== OPPOSITE[g.dir])
    .map((d) => {
      let n = add(head, DIRS[d]);
      if (!inBounds(n)) {
        if (!g.wraps) return null;
        n = wrapPos(n);
      }
      const exit = g.portalExit(n);
      if (exit) n = exit;
      return blocked(n) ? null : { d, score: manhattan(n, food) + rnd() * 2 };
    })
    .filter((o): o is { d: Dir; score: number } => o !== null)
    .sort((a, b) => a.score - b.score);
  if (options.length) g.turn(options[0].d);
  if (rnd() < 0.01) g.shed();
  g.setSurge(rnd() < 0.2);
}

function mulberry(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hasLevels = (m: ModeId) => m === 'arcade' || m === 'daily';

describe('soak', () => {
  const modes: ModeId[] = ['classic', 'arcade', 'daily', 'zen'];
  for (const mode of modes) {
    it(`${mode}: bot runs without breaking invariants`, () => {
      let maxLevel = 1;
      let totalSteps = 0;
      const causes: Record<string, number> = {};
      for (let seed = 1; seed <= 25; seed++) {
        const g = new Game({ mode, seed });
        // Start some runs deeper so rivals, mazes and collapse get exercised too.
        if (g.mode.levels) (g as unknown as { loadLevel(l: number, b: boolean): void }).loadLevel(1 + (seed % 7), false);
        const rnd = mulberry(seed * 7919);
        for (let frame = 0; frame < (mode === 'zen' ? 2500 : 6000) && g.status === 'playing'; frame++) {
          botMove(g, rnd);
          g.update(16);
          g.drainEvents();
          totalSteps++;
          // Invariants
          expect(g.snake.length).toBeGreaterThanOrEqual(2);
          for (const s of g.snake) expect(inBounds(s)).toBe(true);
          expect(g.pickups.filter((p) => p.kind === 'food').length).toBeLessThanOrEqual(1);
          for (const p of g.pickups) {
            expect(inBounds(p.pos)).toBe(true);
            expect(g.solid[p.pos.y * W + p.pos.x]).toBe(0);
          }
          expect(Number.isFinite(g.score)).toBe(true);
          expect(g.surge).toBeGreaterThanOrEqual(0);
          expect(g.surge).toBeLessThanOrEqual(1);
        }
        maxLevel = Math.max(maxLevel, g.level);
        if (g.deathCause) causes[g.deathCause] = (causes[g.deathCause] ?? 0) + 1;
        if (mode === 'zen') expect(g.status).toBe('playing');
      }
      expect(totalSteps).toBeGreaterThan(1000);
      if (hasLevels(mode)) expect(maxLevel).toBeGreaterThanOrEqual(7);
      expect(Object.keys(causes).every((c) => ['wall', 'self', 'shed', 'mine', 'rival'].includes(c))).toBe(true);
    }, 60000);
  }
});
