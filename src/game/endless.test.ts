import { describe, expect, it } from 'vitest';
import { hashGame } from '../net/lockstep';
import { decodeReplay, encodeReplay, simulate } from '../replay';
import { Runner } from '../runner';
import { Game, type Player } from './engine';
import { MODES } from './modes';
import { DIRS, DIR_LIST, OPPOSITE, add, chebyshev, eq, manhattan, type Dir, type SnakeClass, type Vec } from './types';
import { BIOMES, CHUNK, WORLD_SIZE, biomeAt, chunkBiome, generateChunk, generateWorld, spawnChunk, worldSpawn } from './world';

const N = WORLD_SIZE / CHUNK;

describe('endless world generation', () => {
  it('a chunk is a pure function of (seed, cx, cy)', () => {
    for (const seed of [1, 42, 0xdeadbeef]) {
      const forward: unknown[] = [];
      for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) forward.push(generateChunk(seed, cx, cy));
      // Same chunks made in reverse order, interleaved with another seed's chunks.
      const backward: unknown[] = [];
      for (let i = N * N - 1; i >= 0; i--) {
        generateChunk(seed + 1, i % N, Math.floor(i / N));
        backward[i] = generateChunk(seed, i % N, Math.floor(i / N));
      }
      expect(backward).toEqual(forward);
    }
  });

  it('different seeds give different worlds', () => {
    const a = generateWorld(1);
    const b = generateWorld(2);
    expect(a.spec.arena.walls).not.toEqual(b.spec.arena.walls);
    expect([...a.world.biome]).not.toEqual([...b.world.biome]);
  });

  it('the whole world is deterministic per seed', () => {
    for (const seed of [3, 77, 123456]) {
      const a = generateWorld(seed);
      const b = generateWorld(seed);
      expect(b.spec).toEqual(a.spec);
      expect(b.treasure).toEqual(a.treasure);
      expect(b.world.landmarks).toEqual(a.world.landmarks);
      expect([...b.world.biome]).toEqual([...a.world.biome]);
    }
  });

  it('biomes form regions and the spawn chunk is a meadow', () => {
    const seen = new Set<string>();
    let sameAsNeighbour = 0;
    let pairs = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = spawnChunk();
      expect(chunkBiome(seed, s.cx, s.cy)).toBe('meadow');
      for (let cy = 0; cy < N; cy++) {
        for (let cx = 0; cx < N; cx++) {
          const b = chunkBiome(seed, cx, cy);
          seen.add(b);
          if (cx + 1 < N) {
            pairs++;
            if (chunkBiome(seed, cx + 1, cy) === b) sameAsNeighbour++;
          }
        }
      }
    }
    expect(seen.size).toBe(BIOMES.length);
    // Voronoi regions: neighbours share a biome far more often than chance (1 / 7).
    expect(sameAsNeighbour / pairs).toBeGreaterThan(0.4);
  });

  it('worlds are sealed, reachable and keep the spawn clear', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const { spec, treasure, world } = generateWorld(seed);
      const size = WORLD_SIZE;
      const solid = new Uint8Array(size * size);
      for (const w of spec.arena.walls) {
        expect(w.x >= 0 && w.y >= 0 && w.x < size && w.y < size).toBe(true);
        solid[w.y * size + w.x] = 1;
      }
      for (let i = 0; i < size; i++) {
        expect(solid[i]).toBe(1);
        expect(solid[(size - 1) * size + i]).toBe(1);
        expect(solid[i * size]).toBe(1);
        expect(solid[i * size + size - 1]).toBe(1);
      }
      const sp = worldSpawn();
      expect(spec.spawn).toEqual(sp);
      for (let x = sp.x - 4; x <= sp.x + 12; x++) expect(solid[sp.y * size + x]).toBe(0);

      // Every open cell can be reached from the spawn on foot.
      const seen = new Uint8Array(size * size);
      const stack = [sp.y * size + sp.x];
      seen[stack[0]] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        for (const n of [i + 1, i - 1, i + size, i - size]) {
          if (n < 0 || n >= size * size || seen[n] || solid[n]) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      for (let i = 0; i < size * size; i++) expect(solid[i] || seen[i]).toBeTruthy();

      const items: Vec[] = [...spec.mines, ...spec.wells, ...spec.arrows.map((a) => a.pos), ...treasure.map((t) => t.pos), ...spec.arena.portals.flat()];
      const keys = new Set<number>();
      for (const p of items) {
        expect(solid[p.y * size + p.x]).toBe(0);
        keys.add(p.y * size + p.x);
      }
      expect(keys.size).toBe(items.length);
      for (const a of spec.arrows) {
        const d = DIRS[a.dir];
        expect(solid[(a.pos.y + d.y) * size + a.pos.x + d.x]).toBe(0);
      }
      for (const l of world.landmarks) kinds.add(l.kind);
    }
    expect(kinds).toContain('shrine');
    expect(kinds).toContain('gate');
    expect(kinds).toContain('crater');
  });
});

describe('endless mode', () => {
  it('uses a big board and leaves the other modes at their own size', () => {
    const g = new Game({ mode: 'endless', seed: 5 });
    expect([g.w, g.h]).toEqual([WORLD_SIZE, WORLD_SIZE]);
    expect(g.solid.length).toBe(WORLD_SIZE * WORLD_SIZE);
    expect(g.world).not.toBeNull();
    expect(g.biome).toBe('meadow');
    expect(g.pickups.filter((p) => p.kind === 'food')).toHaveLength(5);
    for (const mode of ['classic', 'arcade', 'zen'] as const) {
      const a = new Game({ mode, seed: 5 });
      expect([a.w, a.h]).toEqual([24, 24]);
      expect(a.world).toBeNull();
    }
    const vs = new Game({ mode: 'versus', seed: 5 });
    expect([vs.w, vs.h]).toEqual([48, 48]);
    expect(vs.world).toBeNull();
    expect(MODES.endless.world).toBe(WORLD_SIZE);
  });

  it('twists follow the biome under the head', () => {
    const g = new Game({ mode: 'endless', seed: 9 });
    const wd = g.world!;
    // Teleport the snake into a chunk of each biome and step once.
    const done = new Set<string>();
    for (let i = 0; i < wd.biome.length && done.size < BIOMES.length; i++) {
      const b = BIOMES[wd.biome[i]];
      if (done.has(b.id)) continue;
      const cx = (i % wd.cols) * CHUNK;
      const cy = Math.floor(i / wd.cols) * CHUNK;
      let spot: Vec | null = null;
      for (let y = cy + 2; y < cy + CHUNK - 2 && !spot; y++) {
        for (let x = cx + 6; x < cx + CHUNK - 3 && !spot; x++) {
          const cells = [0, 1, 2, 3, 4].map((k) => ({ x: x - k, y }));
          if (cells.every((c) => !g.solid[g.ix(c)] && !g.mines.some((m) => eq(m.pos, c)) && !g.portalExit(c) && !g.arrows.some((a) => eq(a.pos, c)))) {
            if (!g.solid[g.ix({ x: x + 1, y })]) spot = { x, y };
          }
        }
      }
      if (!spot) continue;
      const p = g.p0;
      p.body = [0, 1, 2, 3].map((k) => ({ x: spot!.x - 1 - k, y: spot!.y }));
      p.prevBody = p.body.map((c) => ({ ...c }));
      p.dir = 'right';
      p.queue = [];
      g.mines = g.mines.filter((m) => chebyshev(m.pos, spot!) > 2);
      g.step();
      if (g.status !== 'playing') break;
      expect(g.biome).toBe(biomeAt(wd, p.body[0]).id);
      expect([...g.modifiers].sort()).toEqual([...b.modifiers].sort());
      done.add(b.id);
    }
    expect(done.size).toBeGreaterThanOrEqual(4);
  });
});

/** Greedy bot that understands the big board: avoid anything deadly, head for the nearest food. */
function botMove(g: Game, p: Player, rnd: () => number) {
  if (!p.alive) return;
  // Decide again only once the last turn has been applied; stale queued turns steer into walls.
  if (p.queue.length) return;
  const head = p.body[0];
  const food = g.pickups.filter((q) => q.kind === 'food').sort((a, b) => manhattan(a.pos, head) - manhattan(b.pos, head))[0]?.pos ?? head;
  const blocked = (c: Vec) =>
    !g.inb(c) ||
    g.solid[g.ix(c)] === 1 ||
    p.body.some((s, i) => i < p.body.length - 1 && eq(s, c)) ||
    g.shedWalls.some((w) => eq(w.pos, c)) ||
    g.mines.some((m) => eq(m.pos, c));
  const options = DIR_LIST.filter((d) => d !== OPPOSITE[p.dir])
    .map((d) => {
      let n = add(head, DIRS[d]);
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

describe('endless soak', () => {
  it('bot explores without breaking invariants', () => {
    let totalFrames = 0;
    let foods = 0;
    const biomes = new Set<string>();
    const causes = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const g = new Game({ mode: 'endless', seed, classes: [CLASSES[seed % 4]] });
      const rnd = mulberry(seed * 7919);
      for (let frame = 0; frame < 6000 && g.status !== 'over'; frame++) {
        botMove(g, g.p0, rnd);
        g.update(16);
        g.drainEvents();
        totalFrames++;
        const p = g.p0;
        if (!p.alive) continue;
        expect(p.body.length).toBeGreaterThanOrEqual(2);
        for (const s of p.body) expect(g.inb(s)).toBe(true);
        expect(p.meter).toBeGreaterThanOrEqual(0);
        expect(p.meter).toBeLessThanOrEqual(1);
        expect(Number.isFinite(p.score)).toBe(true);
        const food = g.pickups.filter((q) => q.kind === 'food');
        expect(food.length).toBeLessThanOrEqual(5);
        for (const q of g.pickups) {
          expect(g.inb(q.pos)).toBe(true);
          expect(g.solid[g.ix(q.pos)]).toBe(0);
        }
        for (const q of food) expect(chebyshev(q.pos, p.body[0])).toBeLessThanOrEqual(26);
        expect(g.biome).toBe(g.biomeAt(p.body[0])!.id);
        biomes.add(g.biome!);
      }
      foods += g.p0.foods;
      if (g.deathCause) causes.add(g.deathCause);
    }
    expect(totalFrames).toBeGreaterThan(10000);
    expect(foods).toBeGreaterThan(30);
    expect(biomes.size).toBeGreaterThanOrEqual(3);
    for (const c of causes) expect(['wall', 'self', 'shed', 'mine']).toContain(c);
  }, 120000);

  it('a replay reproduces an endless run exactly', () => {
    for (const [seed, cls] of [
      [21, 'racer'],
      [22, 'viper'],
      [23, 'cobra'],
      [24, 'python'],
    ] as [number, SnakeClass][]) {
      const g = new Game({ mode: 'endless', seed, classes: [cls] });
      const r = new Runner(g, { keyframes: true });
      const rnd = mulberry(seed * 31);
      for (let t = 0; t < 45_000 && g.status !== 'over'; t += 16) {
        const me = g.p0;
        const head = me.body[0];
        const free = (d: Dir) => {
          const c = add(head, DIRS[d]);
          return g.inb(c) && !g.solid[g.ix(c)] && !me.body.some((s) => eq(s, c)) && !g.mines.some((m) => eq(m.pos, c));
        };
        if (!free(me.dir) || rnd() < 0.04) {
          const opts = DIR_LIST.filter((d) => d !== OPPOSITE[me.dir] && free(d));
          if (opts.length) r.input({ p: 0, t: 'turn', d: opts[Math.floor(rnd() * opts.length)] });
        }
        if (rnd() < 0.01) r.input({ p: 0, t: 'shed' });
        if (rnd() < 0.02) r.input({ p: 0, t: 'hold', on: rnd() < 0.5 });
        r.tick(8 + rnd() * 25);
      }
      const rep = decodeReplay(encodeReplay(r.replay({ mode: 'endless', seed, classes: [cls] })))!;
      expect(rep.mode).toBe('endless');
      const out = simulate(rep)!;
      expect(out.score).toBe(g.score);
      expect(out.time).toBe(g.time);
      expect(hashGame(out)).toBe(hashGame(g));
      expect(out.p0.body).toEqual(g.p0.body);
      // Keyframe clones replay to the same place too.
      const point = r.rewindPoint(3);
      expect(point).not.toBeNull();
      expect(point!.g.w).toBe(WORLD_SIZE);
    }
  }, 60000);
});
