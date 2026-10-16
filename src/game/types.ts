/** Size of the standard arena. Board size is per game (`game.w` / `game.h`); Endless is bigger. */
export const W = 24;
export const H = 24;

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Vec {
  x: number;
  y: number;
}

export const DIRS: Record<Dir, Vec> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const DIR_LIST: Dir[] = ['up', 'right', 'down', 'left'];

export const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export type ModeId = 'classic' | 'arcade' | 'daily' | 'zen' | 'rhythm' | 'versus' | 'custom' | 'endless';
export type ArenaId = 'box' | 'wrap' | 'portals' | 'maze' | 'collapse' | 'custom' | 'world';

export type SnakeClass = 'racer' | 'viper' | 'cobra' | 'python';

export type ModifierId = 'ice' | 'dark' | 'wells' | 'arrows' | 'mirror' | 'ripening';

export type MutationId =
  | 'forked'
  | 'longmolt'
  | 'quickmolt'
  | 'venom'
  | 'ouroboros'
  | 'armour'
  | 'scales'
  | 'midas'
  | 'glutton'
  | 'dense'
  | 'adrenaline'
  | 'secondwind'
  | 'keeper'
  | 'rattle'
  | 'constrictor'
  | 'mineeater'
  | 'lucky'
  | 'blastshed'
  | 'timethief'
  | 'rewindplus';

export type BossKind = 'serpent' | 'queen';

/** Timed effects that stay active for a while after pickup. */
export type EffectKind = 'phase' | 'slowmo' | 'magnet';
export type PowerKind = EffectKind | 'shrink' | 'golden';
export type PickupKind = 'food' | 'bit' | 'rot' | PowerKind;

export interface Pickup {
  id: number;
  kind: PickupKind;
  pos: Vec;
  /** Remaining life in ms; Infinity for regular food. */
  ttl: number;
  maxTtl: number;
  /** Ms since spawn (used by Ripening). */
  age: number;
}

export interface ShedWall {
  pos: Vec;
  ttl: number;
  maxTtl: number;
  owner: number;
}

export interface Mine {
  pos: Vec;
  offset: number;
}

export interface Mouse {
  id: number;
  pos: Vec;
  prev: Vec;
  ttl: number;
  stunned: number;
  /** Swarm Queen drones count towards dropping her shield. */
  drone: boolean;
}

export interface Rival {
  body: Vec[];
  prevBody: Vec[];
  dir: Dir;
  grow: number;
  stunned: number;
}

export interface Arrow {
  pos: Vec;
  dir: Dir;
}

export interface Projectile {
  pos: Vec;
  prev: Vec;
  dir: Dir;
  owner: number;
  life: number;
}

export type DeathCause = 'wall' | 'self' | 'shed' | 'mine' | 'rival' | 'boss' | 'player' | 'left';

export type GameEvent =
  | { type: 'eat'; pos: Vec; points: number; mult: number; kind: 'food' | 'bit' | 'golden'; player: number }
  | { type: 'rot'; pos: Vec; player: number }
  | { type: 'combo'; pos: Vec; combo: number }
  | { type: 'power'; pos: Vec; kind: PowerKind; player: number }
  | { type: 'shrink'; cells: Vec[] }
  | { type: 'shed'; cells: Vec[]; player: number }
  /** Versus: `player` cast a hex on `target`, paying `cells` from its tail. */
  | { type: 'hex'; cells: Vec[]; player: number; target: number }
  /** The hex lands (after its warning) or wears off. */
  | { type: 'hexed'; player: number; on: boolean }
  | { type: 'cut'; cells: Vec[] }
  | { type: 'mouse'; pos: Vec; points: number; drone: boolean }
  | { type: 'portal'; from: Vec; to: Vec }
  | { type: 'rivalEat'; pos: Vec }
  | { type: 'rivalDie'; cells: Vec[]; byPlayer: boolean; points: number }
  | { type: 'coil'; cells: Vec[]; captured: number; points: number; player: number }
  | { type: 'defuse'; pos: Vec }
  | { type: 'shift' }
  | { type: 'collapse'; ring: number }
  | { type: 'expire'; kind: EffectKind }
  | { type: 'levelup'; level: number; bonus: number }
  | { type: 'draft' }
  | { type: 'ability'; cls: SnakeClass; player: number }
  | { type: 'dash'; cells: Vec[] }
  | { type: 'spitHit'; pos: Vec }
  | { type: 'stun'; pos: Vec }
  | { type: 'armour'; pos: Vec }
  | { type: 'rewind' }
  | { type: 'bossHit'; pos: Vec; hp: number }
  | { type: 'bossDie'; cells: Vec[]; kind: BossKind; points: number }
  | { type: 'shield'; up: boolean }
  | { type: 'beat'; strong: boolean }
  | { type: 'onbeat'; streak: number }
  | { type: 'offbeat' }
  | { type: 'die'; pos: Vec; cause: DeathCause; cells: Vec[]; player: number };

export const eq = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y;
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
// Board helpers default to the standard 24x24 arena; pass the game's size for other boards.
export const inBounds = (p: Vec, w = W, h = H) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
export const wrapPos = (p: Vec, w = W, h = H): Vec => ({ x: (p.x + w) % w, y: (p.y + h) % h });
export const idx = (p: Vec, w = W) => p.y * w + p.x;
export const manhattan = (a: Vec, b: Vec) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const chebyshev = (a: Vec, b: Vec) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
