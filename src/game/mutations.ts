import type { MutationId } from './types';

export interface MutationDef {
  id: MutationId;
  name: string;
  desc: string;
  /** Can be drafted more than once. */
  stacks: boolean;
}

const defs: MutationDef[] = [
  { id: 'forked', name: 'Forked Tongue', desc: 'Eat anything next to your head, diagonals included.', stacks: false },
  { id: 'longmolt', name: 'Long Molt', desc: 'Shed walls last twice as long.', stacks: false },
  { id: 'quickmolt', name: 'Quick Molt', desc: 'Shed cooldown halved, and you can shed from length 4.', stacks: false },
  { id: 'venom', name: 'Venom Skin', desc: 'Rivals blunder into your shed walls and die. Bosses take double damage from them.', stacks: false },
  { id: 'ouroboros', name: 'Ouroboros', desc: 'Biting yourself cuts off the tail instead of killing you.', stacks: false },
  { id: 'armour', name: 'Molt Armour', desc: 'Survive one lethal hit (you lose half your length).', stacks: true },
  { id: 'scales', name: 'Magnetic Scales', desc: 'Food within 3 cells always drifts toward you.', stacks: false },
  { id: 'midas', name: 'Midas', desc: 'Golden pickups appear twice as often and last longer.', stacks: false },
  { id: 'glutton', name: 'Glutton', desc: 'Food is worth 50% more, but you grow twice as fast.', stacks: false },
  { id: 'dense', name: 'Dense Body', desc: 'Your length multiplier rises every 5 segments instead of 8.', stacks: false },
  { id: 'adrenaline', name: 'Adrenaline', desc: 'Your ability meter drains 40% slower.', stacks: false },
  { id: 'secondwind', name: 'Second Wind', desc: 'Hitting a x3 combo refills your ability meter.', stacks: false },
  { id: 'keeper', name: 'Combo Keeper', desc: 'Combo window is 3 seconds instead of 2.', stacks: false },
  { id: 'rattle', name: 'Rattle', desc: 'Two quick turns release a wave that stuns enemies nearby.', stacks: false },
  { id: 'constrictor', name: 'Constrictor', desc: 'Coil captures score x3 instead of x2.', stacks: false },
  { id: 'mineeater', name: 'Mine Eater', desc: 'Swallow unlit mines for points.', stacks: false },
  { id: 'lucky', name: 'Lucky', desc: 'Power-ups appear 40% more often.', stacks: false },
  { id: 'blastshed', name: 'Blast Shed', desc: 'Shedding blows up mines near the dropped skin.', stacks: false },
  { id: 'timethief', name: 'Time Thief', desc: 'Phase and Slow-Mo last twice as long.', stacks: false },
  { id: 'rewindplus', name: 'Extra Rewind', desc: 'Gain one more rewind for this run.', stacks: true },
];

export const MUTATIONS = Object.fromEntries(defs.map((d) => [d.id, d])) as Record<MutationId, MutationDef>;
export const MUTATION_LIST: MutationId[] = defs.map((d) => d.id);
