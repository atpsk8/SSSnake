import type { ArenaId, Vec } from './types';

export interface Arena {
  id: ArenaId;
  name: string;
  blurb: string;
  wrap: boolean;
  walls: Vec[];
  portals: [Vec, Vec][];
  /** Wall patterns the Shifting Maze cycles through. Empty for other arenas. */
  mazes: Vec[][];
  collapse: boolean;
}

function hLine(y: number, x0: number, x1: number): Vec[] {
  const out: Vec[] = [];
  for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

function vLine(x: number, y0: number, y1: number): Vec[] {
  const out: Vec[] = [];
  for (let y = y0; y <= y1; y++) out.push({ x, y });
  return out;
}

function block(x0: number, y0: number, x1: number, y1: number): Vec[] {
  const out: Vec[] = [];
  for (let y = y0; y <= y1; y++) out.push(...hLine(y, x0, x1));
  return out;
}

// Every arena keeps row 12 (the spawn lane) clear from x=1 to x=12.

const MAZES: Vec[][] = [
  [...hLine(6, 4, 10), ...hLine(6, 13, 19), ...hLine(17, 4, 10), ...hLine(17, 13, 19)],
  [...vLine(6, 3, 9), ...vLine(6, 15, 20), ...vLine(17, 3, 9), ...vLine(17, 15, 20)],
  [
    ...block(8, 4, 9, 5),
    ...block(14, 4, 15, 5),
    ...block(8, 18, 9, 19),
    ...block(14, 18, 15, 19),
    ...hLine(9, 10, 13),
    ...hLine(15, 10, 13),
  ],
];

export const ARENAS: Record<Exclude<ArenaId, 'custom' | 'world'>, Arena> = {
  box: {
    id: 'box',
    name: 'Classic Box',
    blurb: 'Four walls. No excuses.',
    wrap: false,
    walls: [],
    portals: [],
    mazes: [],
    collapse: false,
  },
  wrap: {
    id: 'wrap',
    name: 'Wraparound',
    blurb: 'Edges loop to the other side.',
    wrap: true,
    walls: [],
    portals: [],
    mazes: [],
    collapse: false,
  },
  portals: {
    id: 'portals',
    name: 'Portals',
    blurb: 'Enter one ring, exit its twin.',
    wrap: false,
    walls: [...block(11, 7, 12, 9), ...block(11, 15, 12, 17)],
    portals: [
      [{ x: 3, y: 3 }, { x: 20, y: 20 }],
      [{ x: 20, y: 3 }, { x: 3, y: 20 }],
    ],
    mazes: [],
    collapse: false,
  },
  maze: {
    id: 'maze',
    name: 'Shifting Maze',
    blurb: 'Walls rearrange every few bites.',
    wrap: false,
    walls: [],
    portals: [],
    mazes: MAZES,
    collapse: false,
  },
  collapse: {
    id: 'collapse',
    name: 'Collapse',
    blurb: 'The border closes in. Keep moving.',
    wrap: false,
    walls: [],
    portals: [],
    mazes: [],
    collapse: true,
  },
};

export const ARENA_ORDER: Exclude<ArenaId, 'custom' | 'world'>[] = ['box', 'wrap', 'portals', 'maze', 'collapse'];
