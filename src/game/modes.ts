import type { ArenaId, ModeId } from './types';

export interface ModeConfig {
  id: ModeId;
  name: string;
  blurb: string;
  /** Shed, Surge, combos and the length multiplier. */
  abilities: boolean;
  powerUps: boolean;
  hazards: boolean;
  levels: boolean;
  /** No death: self-hits cut the tail, shed walls just crumble. */
  zen: boolean;
  arena: ArenaId;
}

export const MODES: Record<ModeId, ModeConfig> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    blurb: 'Pure Snake. Eat, grow, survive.',
    abilities: false,
    powerUps: false,
    hazards: false,
    levels: false,
    zen: false,
    arena: 'box',
  },
  arcade: {
    id: 'arcade',
    name: 'Arcade',
    blurb: 'Levels, arenas, power-ups, hazards and a rival.',
    abilities: true,
    powerUps: true,
    hazards: true,
    levels: true,
    zen: false,
    arena: 'box',
  },
  daily: {
    id: 'daily',
    name: 'Daily',
    blurb: "Today's seeded run. Same spawns for everyone.",
    abilities: true,
    powerUps: true,
    hazards: true,
    levels: true,
    zen: false,
    arena: 'box',
  },
  zen: {
    id: 'zen',
    name: 'Zen',
    blurb: 'No death, no rush. Just slither.',
    abilities: true,
    powerUps: true,
    hazards: false,
    levels: false,
    zen: true,
    arena: 'wrap',
  },
};

export const MODE_ORDER: ModeId[] = ['classic', 'arcade', 'daily', 'zen'];
