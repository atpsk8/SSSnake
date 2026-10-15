import { describe, expect, it } from 'vitest';
import { Bot, PERSONALITIES, type Difficulty } from './bot';
import { Game } from './game/engine';
import { Runner } from './runner';
import { decodeReplay, encodeReplay, simulate } from './replay';
import { hashGame } from './net/lockstep';

/** Bot vs bot through the Runner (so bot inputs are recorded like a player's). */
function match(a: Difficulty, b: Difficulty, seed: number) {
  const g = new Game({ mode: 'versus', seed, classes: ['racer', 'racer'] });
  const r = new Runner(g);
  const bots = [new Bot(0, a, PERSONALITIES[seed % 3], seed), new Bot(1, b, PERSONALITIES[(seed + 1) % 3], seed + 1)];
  for (let t = 0; t < 180_000 && g.status === 'playing'; t += 16) {
    for (const bot of bots) for (const i of bot.think(g, 16)) r.input(i);
    r.tick(16);
  }
  return { g, r };
}

describe('cpu opponents', () => {
  it('play full rounds without crashing and produce valid replays', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { g, r } = match('normal', 'hard', seed);
      const rep = decodeReplay(encodeReplay(r.replay({ mode: 'versus', seed, classes: ['racer', 'racer'] })))!;
      const out = simulate(rep)!;
      expect(hashGame(out)).toBe(hashGame(g));
    }
  });

  it('hard bots survive much longer than easy ones', () => {
    const life = (d: Difficulty) => {
      let total = 0;
      for (let seed = 1; seed <= 8; seed++) {
        // Solo survival: bot alone in arcade-like conditions (versus with an idle partner far away).
        const g = new Game({ mode: 'versus', seed, classes: ['racer', 'racer'] });
        const r = new Runner(g);
        const bot = new Bot(0, d, 'collector', seed);
        g.players[1].body = [
          { x: 22, y: 22 },
          { x: 22, y: 23 },
          { x: 21, y: 23 },
          { x: 21, y: 22 },
        ];
        g.players[1].dir = 'up';
        const idle = new Bot(1, 'hard', 'collector', seed + 9);
        for (let t = 0; t < 120_000 && g.players[0].alive && g.status === 'playing'; t += 16) {
          for (const i of bot.think(g, 16)) r.input(i);
          for (const i of idle.think(g, 16)) r.input(i);
          r.tick(16);
        }
        total += g.time;
      }
      return total;
    };
    expect(life('hard')).toBeGreaterThan(life('easy'));
  });

  it('never reverses into itself', () => {
    const g = new Game({ mode: 'versus', seed: 3 });
    const bot = new Bot(1, 'hard', 'hunter', 3);
    for (let i = 0; i < 50; i++) {
      for (const inp of bot.think(g, 200)) if (inp.t === 'turn') expect(inp.d).not.toBe(g.players[1].dir === 'left' ? 'right' : undefined);
    }
  });
});
