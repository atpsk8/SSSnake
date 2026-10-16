import type { LevelSpec } from './levels';
import { Rng } from './rng';
import { DIRS, DIR_LIST, type Arrow, type Dir, type ModifierId, type Vec } from './types';

/**
 * Endless mode's world: a big board built from 16x16 chunks. Each chunk is a pure function of
 * (seed, chunk x, chunk y), so the same seed always gives the same world whatever order the
 * chunks are made in. Biomes come from a coarse Voronoi pattern over the chunk grid, so
 * neighbouring chunks usually share one. A final world pass pairs up warp gates and fills in
 * any pocket the snake could never reach.
 */

export const WORLD_SIZE = 128;
export const CHUNK = 16;
/** Chunks per side of a biome region cell (the Voronoi grid). */
const REGION = 3;
const LANDMARK_CHANCE = 0.3;

export type BiomeId = 'meadow' | 'glacier' | 'shadow' | 'orchard' | 'vortex' | 'circuit' | 'badlands';
type Shape = 'blob' | 'pillar' | 'hedge' | 'trace' | 'rubble';

export interface Biome {
  id: BiomeId;
  name: string;
  blurb: string;
  /** Twists that apply while your head is in this biome (wells and arrows are placed tiles). */
  modifiers: ModifierId[];
  clusters: [number, number];
  shape: Shape;
  mines: [number, number];
  wells: number;
  arrows: number;
  /** Most mice around at once while you are here. */
  mice: number;
}

/** Order matters: a chunk's biome is stored as its index in this list. */
export const BIOMES: Biome[] = [
  { id: 'meadow', name: 'Meadow', blurb: 'Open grass and plenty of mice.', modifiers: [], clusters: [2, 4], shape: 'blob', mines: [0, 1], wells: 0, arrows: 0, mice: 3 },
  { id: 'glacier', name: 'Glacier', blurb: 'Ice pillars. Turns kick in late.', modifiers: ['ice'], clusters: [3, 5], shape: 'pillar', mines: [0, 2], wells: 0, arrows: 0, mice: 1 },
  { id: 'shadow', name: 'Shadowlands', blurb: 'Dark, and mined.', modifiers: ['dark'], clusters: [2, 4], shape: 'blob', mines: [2, 4], wells: 0, arrows: 0, mice: 1 },
  { id: 'orchard', name: 'Orchard', blurb: 'Hedgerows. Food ripens, then rots.', modifiers: ['ripening'], clusters: [3, 5], shape: 'hedge', mines: [0, 1], wells: 0, arrows: 0, mice: 3 },
  { id: 'vortex', name: 'Vortex', blurb: 'Gravity wells drag food around.', modifiers: ['wells'], clusters: [2, 3], shape: 'blob', mines: [1, 2], wells: 2, arrows: 0, mice: 2 },
  { id: 'circuit', name: 'Circuit', blurb: 'Traces and arrow tiles.', modifiers: ['arrows'], clusters: [3, 5], shape: 'trace', mines: [1, 2], wells: 0, arrows: 5, mice: 2 },
  { id: 'badlands', name: 'Badlands', blurb: 'Rubble and minefields.', modifiers: [], clusters: [3, 6], shape: 'rubble', mines: [4, 7], wells: 0, arrows: 0, mice: 1 },
];
const BIOME_INDEX = new Map(BIOMES.map((b, i) => [b.id, i]));

export type LandmarkKind = 'shrine' | 'gate' | 'crater' | 'ruin';
export const LANDMARK_NAME: Record<LandmarkKind, string> = { shrine: 'Shrine', gate: 'Warp gate', crater: 'Crater', ruin: 'Broken gate' };

export interface Landmark {
  kind: LandmarkKind;
  /** Centre cell. */
  pos: Vec;
}

export interface Treasure {
  kind: 'golden' | 'bit';
  pos: Vec;
}

export interface Chunk {
  cx: number;
  cy: number;
  biome: BiomeId;
  walls: Vec[];
  mines: Vec[];
  wells: Vec[];
  arrows: Arrow[];
  treasure: Treasure[];
  landmark: Landmark | null;
}

export interface World {
  w: number;
  h: number;
  /** Chunks per row / column. */
  cols: number;
  rows: number;
  /** Biome of each chunk (index into BIOMES), row-major. */
  biome: Uint8Array;
  landmarks: Landmark[];
}

/** 32-bit integer hash of a few numbers (murmur3 finaliser per step). */
function hash(...ns: number[]): number {
  let h = 0x811c9dc5;
  for (const n of ns) {
    h = Math.imul(h ^ (n | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export function spawnChunk(size = WORLD_SIZE): { cx: number; cy: number } {
  const n = Math.floor(size / CHUNK);
  return { cx: Math.floor(n / 2), cy: Math.floor(n / 2) };
}

export function worldSpawn(size = WORLD_SIZE): Vec {
  const { cx, cy } = spawnChunk(size);
  return { x: cx * CHUNK + 3, y: cy * CHUNK + 8 };
}

/** Which biome a chunk belongs to: the nearest jittered region centre (Voronoi). */
export function chunkBiome(seed: number, cx: number, cy: number, size = WORLD_SIZE): BiomeId {
  const s = spawnChunk(size);
  if (cx === s.cx && cy === s.cy) return 'meadow';
  const px = (cx + 0.5) / REGION;
  const py = (cy + 0.5) / REGION;
  const rx = Math.floor(px);
  const ry = Math.floor(py);
  let best = Infinity;
  let biome: BiomeId = 'meadow';
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const r = new Rng(hash(seed, rx + dx, ry + dy, 0xb10e));
      const x = rx + dx + 0.15 + r.next() * 0.7;
      const y = ry + dy + 0.15 + r.next() * 0.7;
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < best) {
        best = d;
        biome = BIOMES[r.int(BIOMES.length)].id;
      }
    }
  }
  return biome;
}

/** One chunk's contents, in world coordinates. Pure: depends only on its arguments. */
export function generateChunk(seed: number, cx: number, cy: number, size = WORLD_SIZE): Chunk {
  const rng = new Rng(hash(seed, cx, cy, 0xc4a7));
  const biome = BIOMES[BIOME_INDEX.get(chunkBiome(seed, cx, cy, size))!];
  const ox = cx * CHUNK;
  const oy = cy * CHUNK;
  const out: Chunk = { cx, cy, biome: biome.id, walls: [], mines: [], wells: [], arrows: [], treasure: [], landmark: null };

  // Local occupancy: 1 = wall, 2 = halo around a wall cluster (no walls, items are fine),
  // 3 = kept clear of everything (world border, spawn lane, landmark grounds).
  const used = new Uint8Array(CHUNK * CHUNK);
  const at = (x: number, y: number) => (y - oy) * CHUNK + (x - ox);
  const inChunk = (x: number, y: number) => x >= ox && y >= oy && x < ox + CHUNK && y < oy + CHUNK;
  const open = (x: number, y: number) => inChunk(x, y) && !used[at(x, y)];
  const reserve = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inChunk(x, y)) used[at(x, y)] = 3;
  };
  reserve(0, 0, size - 1, 0);
  reserve(0, size - 1, size - 1, size - 1);
  reserve(0, 0, 0, size - 1);
  reserve(size - 1, 0, size - 1, size - 1);
  const s = spawnChunk(size);
  const isSpawn = cx === s.cx && cy === s.cy;
  // The spawn lane can poke into neighbouring chunks; reserve() ignores cells outside this one.
  const sp = worldSpawn(size);
  reserve(sp.x - 4, sp.y - 2, sp.x + 12, sp.y + 2);

  const take = (x: number, y: number) => {
    used[at(x, y)] = 1;
  };

  // Landmark first, so everything else builds around it.
  if (!isSpawn && rng.next() < LANDMARK_CHANCE) {
    const kind = rng.weighted<LandmarkKind>([
      ['shrine', 0.4],
      ['gate', 0.35],
      ['crater', 0.25],
    ]);
    const c = { x: ox + 5 + rng.int(6), y: oy + 5 + rng.int(6) };
    if (c.x > 3 && c.y > 3 && c.x < size - 4 && c.y < size - 4) {
      out.landmark = { kind, pos: c };
      if (kind === 'shrine') {
        // A 5x5 ring of wall with one doorway and a golden apple inside.
        const door = rng.pick(DIR_LIST);
        const gap = { x: c.x + DIRS[door].x * 2, y: c.y + DIRS[door].y * 2 };
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
            const p = { x: c.x + dx, y: c.y + dy };
            if (p.x === gap.x && p.y === gap.y) continue;
            out.walls.push(p);
          }
        }
        out.treasure.push({ kind: 'golden', pos: { ...c } });
      } else if (kind === 'gate') {
        // Four corner stones around a portal (paired up across the world later).
        for (const [dx, dy] of [
          [-2, -2],
          [2, -2],
          [-2, 2],
          [2, 2],
        ]) {
          out.walls.push({ x: c.x + dx, y: c.y + dy });
        }
      } else {
        // A ring of mines guarding a handful of bits. Coil it to defuse the lot.
        for (const [dx, dy] of [
          [-3, 0],
          [3, 0],
          [0, -3],
          [0, 3],
          [-2, -2],
          [2, -2],
          [-2, 2],
          [2, 2],
        ]) {
          out.mines.push({ x: c.x + dx, y: c.y + dy });
        }
        for (const d of [{ x: 0, y: 0 }, ...DIR_LIST.map((k) => DIRS[k])]) out.treasure.push({ kind: 'bit', pos: { x: c.x + d.x, y: c.y + d.y } });
      }
      reserve(c.x - 3, c.y - 3, c.x + 3, c.y + 3);
    }
  }

  // Wall clusters, each kept one cell apart from the others.
  const clusters = biome.clusters[0] + rng.int(biome.clusters[1] - biome.clusters[0] + 1);
  for (let k = 0; k < clusters; k++) {
    const start = { x: ox + 1 + rng.int(CHUNK - 2), y: oy + 1 + rng.int(CHUNK - 2) };
    const cells = shapeCells(biome.shape, start, rng).filter((p) => open(p.x, p.y));
    const unique = cells.filter((p, i) => cells.findIndex((q) => q.x === p.x && q.y === p.y) === i);
    if (unique.length < 2) continue;
    for (const p of unique) {
      take(p.x, p.y);
      out.walls.push(p);
    }
    for (const p of unique) {
      for (const d of DIR_LIST) {
        const n = { x: p.x + DIRS[d].x, y: p.y + DIRS[d].y };
        if (inChunk(n.x, n.y) && !used[at(n.x, n.y)]) used[at(n.x, n.y)] = 2;
      }
    }
  }

  const itemSpot = (): Vec | null => {
    for (let i = 0; i < 40; i++) {
      const p = { x: ox + rng.int(CHUNK), y: oy + rng.int(CHUNK) };
      const k = at(p.x, p.y);
      if (used[k] === 1 || used[k] === 3) continue;
      used[k] = 3;
      return p;
    }
    return null;
  };

  const mines = biome.mines[0] + rng.int(biome.mines[1] - biome.mines[0] + 1);
  for (let i = 0; i < mines; i++) {
    const p = itemSpot();
    if (p) out.mines.push(p);
  }
  for (let i = 0; i < biome.wells; i++) {
    const p = itemSpot();
    if (p) out.wells.push(p);
  }
  for (let i = 0; i < biome.arrows; i++) {
    const p = itemSpot();
    if (p) out.arrows.push({ pos: p, dir: rng.pick(DIR_LIST) });
  }
  return out;
}

function shapeCells(shape: Shape, s: Vec, rng: Rng): Vec[] {
  const out: Vec[] = [{ ...s }];
  switch (shape) {
    case 'blob': {
      let c = s;
      const n = 4 + rng.int(6);
      for (let i = 0; i < n; i++) {
        const d = DIRS[rng.pick(DIR_LIST)];
        c = { x: c.x + d.x, y: c.y + d.y };
        out.push(c);
      }
      break;
    }
    case 'pillar': {
      const big = rng.next() < 0.3;
      const n = big ? 3 : 2;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (x || y) out.push({ x: s.x + x, y: s.y + y });
      break;
    }
    case 'hedge': {
      const d = DIRS[rng.next() < 0.5 ? 'right' : 'down'];
      const n = 4 + rng.int(5);
      for (let i = 1; i < n; i++) out.push({ x: s.x + d.x * i, y: s.y + d.y * i });
      break;
    }
    case 'trace': {
      let d: Dir = rng.pick(DIR_LIST);
      let c = s;
      const a = 3 + rng.int(3);
      const b = 2 + rng.int(3);
      for (let i = 1; i < a + b; i++) {
        if (i === a) d = rng.next() < 0.5 ? (d === 'up' || d === 'down' ? 'left' : 'up') : d === 'up' || d === 'down' ? 'right' : 'down';
        c = { x: c.x + DIRS[d].x, y: c.y + DIRS[d].y };
        out.push(c);
      }
      break;
    }
    case 'rubble': {
      const n = 2 + rng.int(4);
      for (let i = 0; i < n; i++) out.push({ x: s.x - 1 + rng.int(3), y: s.y - 1 + rng.int(3) });
      break;
    }
  }
  return out;
}

export interface WorldGen {
  world: World;
  spec: LevelSpec;
  treasure: Treasure[];
}

/** Build the whole world from its chunks, then the world-level pass. Deterministic per seed. */
export function generateWorld(seed: number, size = WORLD_SIZE): WorldGen {
  const cols = Math.floor(size / CHUNK);
  const rows = cols;
  const chunks: Chunk[] = [];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) chunks.push(generateChunk(seed, cx, cy, size));

  const n = size * size;
  const at = (p: Vec) => p.y * size + p.x;
  const solid = new Uint8Array(n);
  for (let i = 0; i < size; i++) {
    solid[i] = solid[(size - 1) * size + i] = solid[i * size] = solid[i * size + size - 1] = 1;
  }
  for (const c of chunks) for (const w of c.walls) solid[at(w)] = 1;

  // Pair warp gates across the world; an odd one out stays a broken gate.
  const gates = chunks.filter((c) => c.landmark?.kind === 'gate').map((c) => c.landmark!);
  const rng = new Rng(hash(seed, 0x9a7e));
  for (let i = gates.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [gates[i], gates[j]] = [gates[j], gates[i]];
  }
  const portals: [Vec, Vec][] = [];
  for (let i = 0; i + 1 < gates.length; i += 2) portals.push([{ ...gates[i].pos }, { ...gates[i + 1].pos }]);
  if (gates.length % 2) {
    const last = gates[gates.length - 1];
    last.kind = 'ruin';
    solid[at(last.pos)] = 1;
  }

  // Fill any pocket that can't be reached from the spawn.
  const spawn = worldSpawn(size);
  const seen = new Uint8Array(n);
  const stack = [at(spawn)];
  seen[at(spawn)] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % size;
    const y = (i - x) / size;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const k = ny * size + nx;
      if (seen[k] || solid[k]) continue;
      seen[k] = 1;
      stack.push(k);
    }
  }
  for (let i = 0; i < n; i++) if (!seen[i]) solid[i] = 1;
  const reachable = (p: Vec) => seen[at(p)] === 1;
  // Portals in sealed pockets are useless; drop both ends.
  const livePortals = portals.filter(([a, b]) => reachable(a) && reachable(b));

  const walls: Vec[] = [];
  for (let i = 0; i < n; i++) if (solid[i]) walls.push({ x: i % size, y: Math.floor(i / size) });
  const mines = chunks.flatMap((c) => c.mines).filter(reachable);
  const wells = chunks.flatMap((c) => c.wells).filter(reachable);
  // An arrow must not fling you straight into a wall.
  const arrows = chunks
    .flatMap((c) => c.arrows)
    .filter((a) => {
      if (!reachable(a.pos)) return false;
      const d = DIRS[a.dir];
      for (let k = 1; k <= 3; k++) {
        const p = { x: a.pos.x + d.x * k, y: a.pos.y + d.y * k };
        if (solid[at(p)] || mines.some((m) => m.x === p.x && m.y === p.y)) return false;
      }
      return true;
    });
  const treasure = chunks.flatMap((c) => c.treasure).filter((t) => reachable(t.pos));
  const landmarks = chunks.flatMap((c) => (c.landmark ? [c.landmark] : []));

  const biome = new Uint8Array(cols * rows);
  chunks.forEach((c, i) => (biome[i] = BIOME_INDEX.get(c.biome)!));

  return {
    world: { w: size, h: size, cols, rows, biome, landmarks },
    treasure,
    spec: {
      arena: {
        id: 'world',
        name: 'Endless',
        blurb: 'A big world of biomes.',
        wrap: false,
        walls,
        portals: livePortals,
        mazes: [],
        collapse: false,
      },
      modifiers: [],
      wells,
      arrows,
      mines,
      randomMines: 0,
      rival: false,
      mice: true,
      powerUps: true,
      boss: null,
      bossTier: 0,
      spawn,
      spawnDir: 'right',
      goalFoods: 0,
    },
  };
}

export function biomeAt(world: World, p: Vec): Biome {
  const cx = Math.min(world.cols - 1, Math.max(0, Math.floor(p.x / CHUNK)));
  const cy = Math.min(world.rows - 1, Math.max(0, Math.floor(p.y / CHUNK)));
  return BIOMES[world.biome[cy * world.cols + cx]];
}

/** The nearest landmark within `radius` cells (Chebyshev), if any. */
export function landmarkNear(world: World, p: Vec, radius: number): Landmark | null {
  let best: Landmark | null = null;
  let bd = Infinity;
  for (const l of world.landmarks) {
    const d = Math.max(Math.abs(l.pos.x - p.x), Math.abs(l.pos.y - p.y));
    if (d <= radius && d < bd) {
      bd = d;
      best = l;
    }
  }
  return best;
}
