import { ARENAS, ARENA_ORDER, type Arena } from './arenas';
import type { Rng } from './rng';
import { DIR_LIST, H, W, type Arrow, type BossKind, type Dir, type ModifierId, type Vec } from './types';

/** Everything needed to set up one level. */
export interface LevelSpec {
  arena: Arena;
  modifiers: ModifierId[];
  /** Fixed positions; empty with the matching modifier means "place randomly". */
  wells: Vec[];
  arrows: Arrow[];
  mines: Vec[];
  randomMines: number;
  rival: boolean;
  /** The rival moves every other step and arrives later (its first, gentler level). */
  rivalSlow?: boolean;
  mice: boolean;
  powerUps: boolean;
  boss: BossKind | null;
  bossTier: number;
  spawn: Vec;
  spawnDir: Dir;
  /** Foods to clear the level; 0 = no food goal. */
  goalFoods: number;
}

/** Serializable level made in the editor / shared by link. Cells are indexes (y * W + x). */
export interface LevelData {
  name: string;
  walls: number[];
  portals: [number, number][];
  mines: number[];
  wells: number[];
  arrows: [number, Dir][];
  spawn: number;
  spawnDir: Dir;
  wrap: boolean;
  collapse: boolean;
  modifiers: ModifierId[];
  rival: boolean;
  mice: boolean;
  powerUps: boolean;
  goal: number;
}

export const MODIFIER_INFO: Record<ModifierId, { name: string; desc: string }> = {
  ice: { name: 'Ice', desc: 'Turns kick in one step late.' },
  dark: { name: 'Darkness', desc: 'You can only see near your head.' },
  wells: { name: 'Gravity Wells', desc: 'Wells pull food toward them.' },
  arrows: { name: 'Arrow Tiles', desc: 'Arrows force your direction.' },
  mirror: { name: 'Mirror', desc: 'Controls are flipped.' },
  ripening: { name: 'Ripening', desc: 'Food grows in value, then rots.' },
};
export const MODIFIER_LIST: ModifierId[] = ['ice', 'dark', 'wells', 'arrows', 'mirror', 'ripening'];

const v = (i: number): Vec => ({ x: i % W, y: Math.floor(i / W) });

export const DEFAULT_SPAWN: Vec = { x: 5, y: 12 };

export function isBossLevel(level: number) {
  return level % 5 === 0;
}

export function arcadeLevel(
  level: number,
  startArena: number,
  rng: Rng,
  opts: { hazards: boolean; bosses: boolean; twists: boolean },
): LevelSpec {
  const common = {
    wells: [],
    arrows: [],
    mines: [],
    spawn: { ...DEFAULT_SPAWN },
    spawnDir: 'right' as Dir,
    powerUps: true,
  };
  if (opts.bosses && isBossLevel(level)) {
    const n = level / 5;
    const boss: BossKind = n % 2 === 1 ? 'serpent' : 'queen';
    return {
      ...common,
      arena: { ...ARENAS.box, name: boss === 'serpent' ? 'Serpent King' : 'Swarm Queen' },
      modifiers: [],
      randomMines: 0,
      rival: false,
      mice: false,
      boss,
      bossTier: Math.ceil(n / 2),
      goalFoods: 0,
    };
  }
  // Boss levels don't consume an arena slot in the rotation.
  const slot = level - 1 - (opts.bosses ? Math.floor((level - 1) / 5) : 0);
  const arena = ARENAS[ARENA_ORDER[(startArena + slot) % ARENA_ORDER.length]];
  const modifiers: ModifierId[] = [];
  if (opts.twists && level >= 6) {
    const pool = MODIFIER_LIST.filter((m) => !(arena.wrap && m === 'mirror' && level < 8));
    const count = level >= 11 ? 2 : 1;
    while (modifiers.length < count) {
      const m = rng.pick(pool);
      if (!modifiers.includes(m)) modifiers.push(m);
    }
  }
  // Level 3 introduces the rival, so it gets a rookie one: half speed, and it arrives later.
  const rookie = level === 3;
  return {
    ...common,
    arena,
    modifiers,
    randomMines: opts.hazards && level >= 2 ? Math.min(level, 6) : 0,
    rival: opts.hazards && level >= 3,
    rivalSlow: rookie,
    mice: opts.hazards,
    boss: null,
    bossTier: 0,
    goalFoods: 8 + level * 2,
  };
}

export function simpleLevel(arenaId: keyof typeof ARENAS, powerUps: boolean): LevelSpec {
  return {
    arena: ARENAS[arenaId],
    modifiers: [],
    wells: [],
    arrows: [],
    mines: [],
    randomMines: 0,
    rival: false,
    mice: false,
    powerUps,
    boss: null,
    bossTier: 0,
    spawn: { ...DEFAULT_SPAWN },
    spawnDir: 'right',
    goalFoods: 0,
  };
}

export function levelFromData(d: LevelData): LevelSpec {
  return {
    arena: {
      id: 'custom',
      name: d.name || 'Custom level',
      blurb: '',
      wrap: d.wrap,
      walls: d.walls.map(v),
      portals: d.portals.map(([a, b]) => [v(a), v(b)] as [Vec, Vec]),
      mazes: [],
      collapse: d.collapse,
    },
    modifiers: [...d.modifiers],
    wells: d.wells.map(v),
    arrows: d.arrows.map(([i, dir]) => ({ pos: v(i), dir })),
    mines: d.mines.map(v),
    randomMines: 0,
    rival: d.rival,
    mice: d.mice,
    powerUps: d.powerUps,
    boss: null,
    bossTier: 0,
    spawn: v(d.spawn),
    spawnDir: d.spawnDir,
    goalFoods: d.goal,
  };
}

export function emptyLevel(): LevelData {
  return {
    name: 'My level',
    walls: [],
    portals: [],
    mines: [],
    wells: [],
    arrows: [],
    spawn: DEFAULT_SPAWN.y * W + DEFAULT_SPAWN.x,
    spawnDir: 'right',
    wrap: false,
    collapse: false,
    modifiers: [],
    rival: false,
    mice: true,
    powerUps: true,
    goal: 30,
  };
}

/** Sanitise untrusted level data (e.g. from a link). Returns null if unusable. */
export function sanitizeLevel(raw: unknown): LevelData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const cell = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 && (n as number) < W * H ? (n as number) : null);
  const cells = (a: unknown, max: number) =>
    Array.isArray(a) ? [...new Set(a.map(cell).filter((n): n is number => n !== null))].slice(0, max) : [];
  const dir = (d: unknown): Dir => (DIR_LIST.includes(d as Dir) ? (d as Dir) : 'right');
  const base = emptyLevel();
  const spawn = cell(r.spawn) ?? base.spawn;
  const walls = cells(r.walls, W * H).filter((i) => i !== spawn);
  const portals = Array.isArray(r.portals)
    ? (r.portals as unknown[])
        .map((p) => (Array.isArray(p) ? [cell(p[0]), cell(p[1])] : [null, null]))
        .filter((p): p is [number, number] => p[0] !== null && p[1] !== null && p[0] !== p[1])
        .slice(0, 4)
    : [];
  const arrows = Array.isArray(r.arrows)
    ? (r.arrows as unknown[])
        .map((a) => (Array.isArray(a) ? ([cell(a[0]), dir(a[1])] as const) : ([null, 'right'] as const)))
        .filter((a): a is readonly [number, Dir] => a[0] !== null)
        .map(([i, d]) => [i, d] as [number, Dir])
        .slice(0, 60)
    : [];
  const mods = Array.isArray(r.modifiers)
    ? (r.modifiers as unknown[]).filter((m): m is ModifierId => MODIFIER_LIST.includes(m as ModifierId))
    : [];
  const goal = Number.isInteger(r.goal) ? Math.max(0, Math.min(999, r.goal as number)) : base.goal;
  return {
    name: typeof r.name === 'string' ? r.name.slice(0, 32) : base.name,
    walls,
    portals,
    mines: cells(r.mines, 40),
    wells: cells(r.wells, 6),
    arrows,
    spawn,
    spawnDir: dir(r.spawnDir),
    wrap: r.wrap === true,
    collapse: r.collapse === true,
    modifiers: [...new Set(mods)],
    rival: r.rival === true,
    mice: r.mice !== false,
    powerUps: r.powerUps !== false,
    goal,
  };
}

export const cellOf = (p: Vec) => p.y * W + p.x;
export { v as vecOf };
