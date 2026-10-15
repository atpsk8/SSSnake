import type { ArenaId, ModeId } from './types';

export interface ModeConfig {
  id: ModeId;
  name: string;
  blurb: string;
  /** Shed, combos and the length multiplier. */
  abilities: boolean;
  /** The snake type's ability (Surge, Dash, Spit, Hunker). */
  classAbility: boolean;
  powerUps: boolean;
  hazards: boolean;
  levels: boolean;
  drafts: boolean;
  bosses: boolean;
  /** Random arena twists from level 6. */
  twists: boolean;
  rewinds: number;
  players: 1 | 2;
  rhythm: boolean;
  /** No death: self-hits cut the tail, shed walls just crumble. */
  zen: boolean;
  arena: ArenaId;
}

const base: Omit<ModeConfig, 'id' | 'name' | 'blurb'> = {
  abilities: true,
  classAbility: true,
  powerUps: true,
  hazards: false,
  levels: false,
  drafts: false,
  bosses: false,
  twists: false,
  rewinds: 0,
  players: 1,
  rhythm: false,
  zen: false,
  arena: 'box',
};

export const MODES: Record<ModeId, ModeConfig> = {
  classic: {
    ...base,
    id: 'classic',
    name: 'Classic',
    blurb: 'Pure Snake. Eat, grow, survive.',
    abilities: false,
    classAbility: false,
    powerUps: false,
  },
  arcade: {
    ...base,
    id: 'arcade',
    name: 'Arcade',
    blurb: 'Levels, mutations, bosses, twists and a rival.',
    hazards: true,
    levels: true,
    drafts: true,
    bosses: true,
    twists: true,
    rewinds: 1,
  },
  daily: {
    ...base,
    id: 'daily',
    name: 'Daily',
    blurb: "Today's seeded run. Race your own ghost.",
    hazards: true,
    levels: true,
    drafts: true,
    bosses: true,
    twists: true,
    rewinds: 1,
  },
  zen: {
    ...base,
    id: 'zen',
    name: 'Zen',
    blurb: 'No death, no rush. Just slither.',
    zen: true,
    arena: 'wrap',
  },
  rhythm: {
    ...base,
    id: 'rhythm',
    name: 'Rhythm',
    blurb: 'Move to the beat. Turn on time for up to x4.',
    classAbility: false,
    rhythm: true,
  },
  versus: {
    ...base,
    id: 'versus',
    name: 'Versus',
    blurb: 'Two players, one screen. Best of three.',
    players: 2,
  },
  custom: {
    ...base,
    id: 'custom',
    name: 'Custom',
    blurb: 'Play levels from the editor or a shared link.',
  },
};

export const MODE_ORDER: ModeId[] = ['classic', 'arcade', 'daily', 'zen', 'rhythm', 'versus'];
