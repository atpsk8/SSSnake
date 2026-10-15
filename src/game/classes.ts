import type { SnakeClass } from './types';

export interface ClassDef {
  id: SnakeClass;
  name: string;
  ability: string;
  desc: string;
  /** Hold abilities drain the meter while held; tap abilities cost a chunk per use. */
  hold: boolean;
  /** Meter per ms while held, or meter per use. */
  cost: number;
  unlock: string;
}

export const CLASSES: Record<SnakeClass, ClassDef> = {
  racer: {
    id: 'racer',
    name: 'Racer',
    ability: 'Surge',
    desc: 'Hold to boost. Points count double while surging.',
    hold: true,
    cost: 1 / 2200,
    unlock: 'Available from the start',
  },
  viper: {
    id: 'viper',
    name: 'Viper',
    ability: 'Dash',
    desc: 'Tap to lunge three cells at once, slipping through your own body.',
    hold: false,
    cost: 0.34,
    unlock: 'Reach level 5 in Arcade',
  },
  cobra: {
    id: 'cobra',
    name: 'Cobra',
    ability: 'Spit',
    desc: 'Tap to spit venom that breaks walls, mines, mice and rivals, and hurts bosses.',
    hold: false,
    cost: 0.34,
    unlock: 'Defeat a boss',
  },
  python: {
    id: 'python',
    name: 'Python',
    ability: 'Hunker',
    desc: 'Hold to freeze in place. Coils score one extra multiplier.',
    hold: true,
    cost: 1 / 1500,
    unlock: 'Capture 3 or more things in one coil',
  },
};

export const CLASS_ORDER: SnakeClass[] = ['racer', 'viper', 'cobra', 'python'];
