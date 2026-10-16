import { describe, expect, it } from 'vitest';
import { Game, type Player } from './engine';
import { emptyLevel, type LevelData } from './levels';
import { DIRS, DIR_LIST, OPPOSITE, W, add, eq, manhattan, type Dir, type ModeId, type SnakeClass, type Vec } from './types';

/** Greedy bot: avoid anything deadly, drift toward food, use abilities sometimes. */
function botMove(g: Game, p: Player, rnd: () => number) {
  if (!p.alive) return;
  const head = p.body[0];
  const food = g.pickups.find((q) => q.kind === 'food')?.pos ?? head;
  const blocked = (c: Vec) =>
    g.solid[g.ix(c)] === 1 ||
    g.bossAt(c) ||
    g.players.some((o) => o.alive && o.body.some((s, i) => (o !== p || i < o.body.length - 1) && eq(s, c))) ||
    g.shedWalls.some((w) => eq(w.pos, c)) ||
    g.mines.some((m) => eq(m.pos, c)) ||
    (g.rival?.body.some((s) => eq(s, c)) ?? false);
  const options = DIR_LIST.filter((d) => d !== OPPOSITE[p.dir])
    .map((d) => {
      let n = add(head, DIRS[d]);
      if (!g.inb(n)) {
        if (!g.wraps) return null;
        n = g.wrapAt(n);
      }
      const exit = g.portalExit(n);
      if (exit) n = exit;
      return blocked(n) ? null : { d, score: manhattan(n, food) + rnd() * 2 };
    })
    .filter((o): o is { d: Dir; score: number } => o !== null)
    .sort((a, b) => a.score - b.score);
  if (options.length) g.turn(options[0].d, p.id);
  if (rnd() < 0.01) g.shed(p.id);
  g.setHeld(p.id, rnd() < 0.15);
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

const CLASSES: SnakeClass[] = ['racer', 'viper', 'cobra', 'python'];
const KNOWN_CAUSES = ['wall', 'self', 'shed', 'mine', 'rival', 'boss', 'player'];

const CUSTOM: LevelData = {
  ...emptyLevel(),
  walls: [100, 101, 102, 300, 324, 348],
  wells: [200],
  arrows: [[400, 'up']],
  modifiers: ['ripening'],
  rival: true,
  goal: 15,
};

describe('soak', () => {
  const modes: ModeId[] = ['classic', 'arcade', 'daily', 'zen', 'rhythm', 'versus', 'custom'];
  for (const mode of modes) {
    it(`${mode}: bot runs without breaking invariants`, () => {
      let maxLevel = 1;
      let totalFrames = 0;
      const causes = new Set<string>();
      for (let seed = 1; seed <= 25; seed++) {
        const g = new Game({
          mode,
          seed,
          classes: [CLASSES[seed % 4], CLASSES[(seed + 1) % 4]],
          level: mode === 'custom' ? CUSTOM : undefined,
          record: mode === 'daily',
        });
        // Start some runs deeper so bosses, twists and late arenas get exercised.
        if (g.mode.levels) g.loadLevel(1 + (seed % 12), false);
        const rnd = mulberry(seed * 7919);
        for (let frame = 0; frame < (mode === 'zen' ? 2500 : 5000) && g.status !== 'over'; frame++) {
          if (g.status === 'draft') g.chooseMutation(Math.floor(rnd() * 3));
          for (const p of g.players) botMove(g, p, rnd);
          g.update(16);
          g.drainEvents();
          totalFrames++;
          for (const p of g.players) {
            if (!p.alive) continue;
            expect(p.body.length).toBeGreaterThanOrEqual(2);
            for (const s of p.body) expect(g.inb(s)).toBe(true);
            expect(p.meter).toBeGreaterThanOrEqual(0);
            expect(p.meter).toBeLessThanOrEqual(1);
            expect(Number.isFinite(p.score)).toBe(true);
          }
          expect(g.pickups.filter((q) => q.kind === 'food').length).toBeLessThanOrEqual(g.mode.foods);
          for (const q of g.pickups) {
            expect(g.inb(q.pos)).toBe(true);
            expect(g.solid[q.pos.y * W + q.pos.x]).toBe(0);
          }
        }
        maxLevel = Math.max(maxLevel, g.level);
        if (g.deathCause) causes.add(g.deathCause);
        if (mode === 'zen') expect(g.status).toBe('playing');
      }
      expect(totalFrames).toBeGreaterThan(1000);
      if (mode === 'arcade' || mode === 'daily') expect(maxLevel).toBeGreaterThanOrEqual(10);
      for (const c of causes) expect(KNOWN_CAUSES).toContain(c);
    }, 120000);
  }
});
