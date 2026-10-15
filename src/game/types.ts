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

export const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export type ModeId = 'classic' | 'arcade' | 'daily' | 'zen';
export type ArenaId = 'box' | 'wrap' | 'portals' | 'maze' | 'collapse';

/** Timed effects that stay active for a while after pickup. */
export type EffectKind = 'phase' | 'slowmo' | 'magnet';
export type PowerKind = EffectKind | 'shrink' | 'golden';
export type PickupKind = 'food' | 'bit' | PowerKind;

export interface Pickup {
  id: number;
  kind: PickupKind;
  pos: Vec;
  /** Remaining life in ms; Infinity for regular food. */
  ttl: number;
  maxTtl: number;
}

export interface ShedWall {
  pos: Vec;
  ttl: number;
  maxTtl: number;
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
}

export interface Rival {
  body: Vec[];
  prevBody: Vec[];
  dir: Dir;
  grow: number;
}

export type DeathCause = 'wall' | 'self' | 'shed' | 'mine' | 'rival';

export type GameEvent =
  | { type: 'eat'; pos: Vec; points: number; mult: number; kind: 'food' | 'bit' | 'golden' }
  | { type: 'combo'; pos: Vec; combo: number }
  | { type: 'power'; pos: Vec; kind: PowerKind }
  | { type: 'shrink'; cells: Vec[] }
  | { type: 'shed'; cells: Vec[] }
  | { type: 'cut'; cells: Vec[] }
  | { type: 'mouse'; pos: Vec; points: number }
  | { type: 'portal'; from: Vec; to: Vec }
  | { type: 'rivalEat'; pos: Vec }
  | { type: 'rivalDie'; cells: Vec[]; byPlayer: boolean; points: number }
  | { type: 'shift' }
  | { type: 'collapse'; ring: number }
  | { type: 'expire'; kind: EffectKind }
  | { type: 'levelup'; level: number; bonus: number }
  | { type: 'surge' }
  | { type: 'die'; pos: Vec; cause: DeathCause; cells: Vec[] };

export const eq = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y;
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const inBounds = (p: Vec) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H;
export const wrapPos = (p: Vec): Vec => ({ x: (p.x + W) % W, y: (p.y + H) % H });
export const idx = (p: Vec) => p.y * W + p.x;
export const manhattan = (a: Vec, b: Vec) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
