import type { Game } from './game/engine';
import { MODIFIER_INFO } from './game/levels';
import { CLASSES } from './game/classes';

/** Everything the board can show; the renderer draws a matching icon for each. */
export type LegendIcon =
  | 'you'
  | 'foe'
  | 'food'
  | 'bit'
  | 'golden'
  | 'rot'
  | 'phase'
  | 'slowmo'
  | 'magnet'
  | 'shrink'
  | 'mine'
  | 'mouse'
  | 'drone'
  | 'rival'
  | 'boss'
  | 'wall'
  | 'shed'
  | 'portal'
  | 'well'
  | 'arrow'
  | 'hex';

export interface LegendEntry {
  icon: LegendIcon;
  name: string;
  desc: string;
}

const ENTRIES: Record<LegendIcon, Omit<LegendEntry, 'icon'>> = {
  you: { name: 'you', desc: "eat to grow. don't bite snakes or your own tail" },
  foe: { name: 'other snakes', desc: 'hit their body and you die; head-on, the longer snake wins' },
  food: { name: 'food', desc: '+10 and grow by one' },
  bit: { name: 'bits', desc: '+5, dropped when a rival or boss goes down' },
  golden: { name: 'golden', desc: '+50 and grow by three. vanishes soon' },
  rot: { name: 'rotten food', desc: 'ripe food that sat too long: -10' },
  phase: { name: 'phase', desc: 'pass through your own body for 6s' },
  slowmo: { name: 'slow-mo', desc: 'everything slows down for 5s' },
  magnet: { name: 'magnet', desc: 'pulls nearby food to you for 8s' },
  shrink: { name: 'shrink', desc: 'trims 3 off your tail' },
  mine: { name: 'mine', desc: 'deadly while lit. it pulses, then flashes, then lights' },
  mouse: { name: 'mouse', desc: 'runs away. catch it for +20' },
  drone: { name: 'drone', desc: "the queen's minion. eat them to drop her shield" },
  rival: { name: 'rival.exe', desc: 'a cpu snake. its body kills; beat it head-on while longer' },
  boss: { name: 'boss', desc: 'its body kills. the level intro says how to hurt it' },
  wall: { name: 'wall', desc: 'harmless: pass straight through. edges wrap' },
  shed: { name: 'shed skin', desc: 'tail you dropped with space. deadly for 15s' },
  portal: { name: 'portal', desc: 'enter one, come out of its twin' },
  well: { name: 'gravity well', desc: 'pulls food towards it' },
  arrow: { name: 'arrow tile', desc: 'forces your direction' },
  hex: { name: 'hex', desc: 'space flips the nearest rival’s controls for 2.5s (costs 2 tail, 8s cooldown)' },
};

/** What can show up in this game right now, in reading order. */
export function legendFor(g: Game): LegendEntry[] {
  const m = g.mode;
  const s = g.spec;
  const icons: LegendIcon[] = ['you'];
  if (g.players.length > 1) icons.push('foe');
  icons.push('food');
  if (m.powerUps) icons.push('golden', 'phase', 'slowmo', 'magnet', 'shrink');
  if (m.hex) icons.push('hex');
  if (m.abilities && !m.hex) icons.push('shed');
  const ripens = g.world ? true : g.modifiers.has('ripening');
  if (ripens) icons.push('rot');
  if (s.rival || g.rival) icons.push('rival', 'bit');
  if (s.boss) icons.push('boss', 'bit');
  if (s.boss === 'queen') icons.push('drone');
  if (s.mice || g.world || g.mice.length) icons.push('mouse');
  if (g.mines.length || s.randomMines > 0 || m.hazards) icons.push('mine');
  if (g.solid.some((c) => c === 1) || g.mode.levels || g.world || g.ring > 0 || m.id === 'versus') icons.push('wall');
  if (g.arena.portals.length || g.world) icons.push('portal');
  if (g.wells.length || g.modifiers.has('wells') || g.world) icons.push('well');
  if (g.arrows.length || g.modifiers.has('arrows') || g.world) icons.push('arrow');
  return [...new Set(icons)].map((icon) => ({ icon, ...ENTRIES[icon] }));
}

export interface LevelIntro {
  title: string;
  subtitle: string;
  lines: string[];
}

/** The pop-up shown when a level starts: what it is, the goal, and what's in it. */
export function levelIntro(g: Game, opts: { players?: string[]; winsNeeded?: number } = {}): LevelIntro {
  const m = g.mode;
  const s = g.spec;
  const lines: string[] = [];
  let title = m.name;
  let subtitle = m.blurb;
  if (m.levels) {
    title = s.boss ? `Level ${g.level}: boss fight` : `Level ${g.level}`;
    subtitle = s.boss ? (s.boss === 'serpent' ? 'The Serpent King' : 'The Swarm Queen') : g.arena.name;
  }

  if (s.boss === 'serpent') lines.push('The Serpent King hunts you. He takes damage when he runs into your shed skin, gets boxed in, or you coil around his head.');
  if (s.boss === 'queen') lines.push('The Swarm Queen hides behind a shield. Eat her drones to drop it, then touch her or coil around her.');
  if (!s.boss && g.arena.blurb && m.levels) lines.push(`Arena: ${g.arena.blurb}`);
  if (s.goalFoods > 0) lines.push(`Goal: eat ${s.goalFoods} food to clear the level.`);
  if (m.id === 'classic') lines.push('Goal: get as long as you can. No power-ups, no abilities.');
  if (m.zen) lines.push('No death: biting yourself just cuts your tail off.');
  if (m.rhythm) lines.push('Turn on the beat to build a streak and a bigger multiplier.');
  if (g.world) lines.push('Explore a huge world. Each biome has its own twist, and food stays near you.');
  if (m.id === 'versus') {
    const who = opts.players?.length ? opts.players.join(' vs ') : `${g.players.length} snakes`;
    lines.push(`${who}. The last snake alive takes the round; first to ${opts.winsNeeded ?? 2} wins the match.`);
    lines.push('Space casts Hex: the nearest rival’s controls flip for 2.5s. It costs 2 tail and has an 8s cooldown.');
    lines.push('After 60s, sudden death: everyone speeds up and the arena shrinks.');
  }

  for (const mod of g.modifiers) lines.push(`Twist, ${MODIFIER_INFO[mod].name}: ${MODIFIER_INFO[mod].desc}`);
  if (s.rival) lines.push('Rival.exe is on the board: a cpu snake hunting the same food.');
  if (s.mice) lines.push('Mice run around: catch them for bonus points.');
  if (g.mines.length || s.randomMines > 0) lines.push('Mines: deadly while lit. Watch them pulse before they light.');
  if (g.arena.portals.length) lines.push('Portals: enter one and come out of its twin.');
  if (g.arena.mazes.length) lines.push('The maze walls shift as you eat (they are harmless, but they move).');

  const me = g.p0;
  if (m.classAbility) lines.push(`Your snake: ${CLASSES[me.cls].name}. ${CLASSES[me.cls].ability} (shift/E): ${CLASSES[me.cls].desc}`);
  if (m.abilities && !m.hex) lines.push('Space sheds half your tail as a 15s wall. Close a loop with your body to capture what’s inside.');
  lines.push('Walls never kill: you pass through them and the edges wrap around.');
  return { title, subtitle, lines };
}
