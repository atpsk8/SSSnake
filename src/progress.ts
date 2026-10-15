import type { RunStats } from './game/engine';
import type { ModeId, SnakeClass } from './game/types';
import type { SkinId } from './storage';

export interface RunContext {
  mode: ModeId;
  stats: RunStats;
  versusWin?: boolean;
  shared?: boolean;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  check(c: RunContext): boolean;
}

const levelMode = (m: ModeId) => m === 'arcade' || m === 'daily';

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_coil', name: 'Lasso', desc: 'Capture something with a coil.', check: (c) => c.stats.coils >= 1 },
  { id: 'big_coil', name: 'Constriction', desc: 'Capture 3 or more things in one coil.', check: (c) => c.stats.bestCoil >= 3 },
  { id: 'rival_down', name: 'Rivalry', desc: 'Take down the rival snake.', check: (c) => c.stats.rivalsDowned >= 1 },
  { id: 'level5', name: 'Deep Run', desc: 'Reach level 5 in Arcade or Daily.', check: (c) => levelMode(c.mode) && c.stats.level >= 5 },
  { id: 'level10', name: 'Long Haul', desc: 'Reach level 10 in Arcade or Daily.', check: (c) => levelMode(c.mode) && c.stats.level >= 10 },
  { id: 'boss', name: 'Kingslayer', desc: 'Defeat a boss.', check: (c) => c.stats.bossesDefeated >= 1 },
  { id: 'both_bosses', name: 'Regicide', desc: 'Defeat two bosses in one run.', check: (c) => c.stats.bossesDefeated >= 2 },
  { id: 'score1k', name: 'Four Digits', desc: 'Score 1,000 in one run.', check: (c) => c.mode !== 'zen' && c.stats.score >= 1000 },
  { id: 'score5k', name: 'High Roller', desc: 'Score 5,000 in one run.', check: (c) => c.mode !== 'zen' && c.stats.score >= 5000 },
  { id: 'combo4', name: 'Chain Reaction', desc: 'Hit a x4 combo.', check: (c) => c.stats.maxCombo >= 4 },
  { id: 'shed10', name: 'Molting Season', desc: 'Shed 10 times in one run.', check: (c) => c.stats.sheds >= 10 },
  { id: 'daily', name: 'Daily Driver', desc: 'Finish a Daily run.', check: (c) => c.mode === 'daily' },
  { id: 'rewind', name: 'Second Chance', desc: 'Use a rewind.', check: (c) => c.stats.rewindsUsed >= 1 },
  { id: 'mutant', name: 'Abomination', desc: 'Hold 5 mutations at once.', check: (c) => c.stats.mutations >= 5 },
  { id: 'rhythm16', name: 'In the Pocket', desc: 'Make 16 on-beat turns in a row.', check: (c) => c.stats.maxBeatStreak >= 16 },
  { id: 'versus', name: 'Duelist', desc: 'Win a Versus match.', check: (c) => !!c.versusWin },
  { id: 'creator', name: 'Architect', desc: 'Share a level from the editor.', check: (c) => !!c.shared },
  { id: 'zen5', name: 'Inner Peace', desc: 'Spend 5 minutes in one Zen run.', check: (c) => c.mode === 'zen' && c.stats.timeMs >= 300000 },
];

/** Returns newly earned achievements and adds them to `owned`. */
export function evaluate(owned: string[], ctx: RunContext): Achievement[] {
  const fresh = ACHIEVEMENTS.filter((a) => !owned.includes(a.id) && a.check(ctx));
  owned.push(...fresh.map((a) => a.id));
  return fresh;
}

export const CLASS_UNLOCK: Record<SnakeClass, string | null> = {
  racer: null,
  viper: 'level5',
  cobra: 'boss',
  python: 'big_coil',
};

export const SKINS: Record<SkinId, { name: string; head: string; tail: string; unlock: string | null; hint: string }> = {
  classic: { name: 'Neon', head: '', tail: '', unlock: null, hint: 'Default' },
  ember: { name: 'Ember', head: '#ffb347', tail: '#ff3d3d', unlock: 'shed10', hint: 'Shed 10 times in one run' },
  ghost: { name: 'Ghost', head: '#e8e8ff', tail: '#7a6cff', unlock: 'rhythm16', hint: '16 on-beat turns in a row' },
  gold: { name: 'Gold', head: '#fff3a0', tail: '#d4a017', unlock: 'score5k', hint: 'Score 5,000 in one run' },
};

export const isUnlocked = (owned: string[], req: string | null) => req === null || owned.includes(req);
