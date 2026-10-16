import { describe, expect, it } from 'vitest';
import { Game, HEX_COOLDOWN_MS, HEX_COST, HEX_IMMUNE_MS, HEX_MS, HEX_WARN_MS } from './engine';
import type { Vec } from './types';

/** A row of cells heading right, head first. */
const row = (x: number, y: number, len: number): Vec[] => Array.from({ length: len }, (_, i) => ({ x: x - i, y }));

/** A versus round past the opening grace period, with two long snakes far apart. */
function duel(len = 8) {
  const g = new Game({ mode: 'versus', seed: 3 });
  g.banner = null;
  g.time = 5000;
  g.players[0].body = row(10, 5, len);
  g.players[1].body = row(10, 18, len);
  for (const p of g.players) {
    p.prevBody = p.body.map((s) => ({ ...s }));
    p.dir = 'right';
  }
  g.drainEvents();
  return g;
}

/** Advance the clock without moving the snakes, so timers can be checked in isolation. */
function wait(g: Game, ms: number) {
  for (let t = 0; t < ms; t += 50) {
    for (const p of g.players) p.acc = 0;
    g.update(Math.min(50, ms - t));
  }
}

describe('versus hex', () => {
  it('the shed key hexes the opponent instead of shedding', () => {
    const g = duel();
    expect(g.shed(0)).toBe(true);
    expect(g.shedWalls).toHaveLength(0);
    expect(g.players[0].body).toHaveLength(8 - HEX_COST);
    expect(g.players[0].shedCooldown).toBe(HEX_COOLDOWN_MS);
    expect(g.players[0].hexes).toBe(1);
    expect(g.players[1].hexWarn).toBe(HEX_WARN_MS);
    expect(g.drainEvents()).toContainEqual(expect.objectContaining({ type: 'hex', player: 0, target: 1 }));
  });

  it('lands after the warning, wears off, then leaves the victim immune', () => {
    const g = duel();
    g.shed(0);
    const them = g.players[1];
    wait(g, HEX_WARN_MS - 50);
    expect(them.hexed).toBe(0);
    wait(g, 100);
    expect(them.hexed).toBeGreaterThan(0);
    expect(g.drainEvents()).toContainEqual({ type: 'hexed', player: 1, on: true });
    wait(g, HEX_MS);
    expect(them.hexed).toBe(0);
    expect(them.hexImmune).toBeGreaterThan(0);
    expect(g.drainEvents()).toContainEqual({ type: 'hexed', player: 1, on: false });
    wait(g, HEX_IMMUNE_MS);
    expect(them.hexImmune).toBe(0);
  });

  it('flips the victim’s controls only while hexed', () => {
    const g = duel();
    const them = g.players[1];
    them.hexed = 1000;
    g.turn('up', 1);
    expect(them.queue).toEqual(['down']);
    g.turn('up', 0);
    expect(g.players[0].queue).toEqual(['up']);
  });

  it('refuses during the grace period, when short, on cooldown, or at a protected target', () => {
    const early = duel();
    early.time = 1000;
    expect(early.shed(0)).toBe(false);

    const short = duel(5);
    expect(short.shed(0)).toBe(false);

    const g = duel();
    expect(g.shed(0)).toBe(true);
    // Player 0 is on cooldown; player 1's target (player 0) is fine, but player 1 can't stack on itself.
    expect(g.shed(0)).toBe(false);
    expect(g.shed(1)).toBe(true);

    const immune = duel();
    immune.players[1].hexImmune = 500;
    expect(immune.shed(0)).toBe(false);
    expect(immune.players[0].body).toHaveLength(8);
  });

  it('sudden death shortens the cooldown', () => {
    const g = duel();
    g.time = 95000;
    g.shed(0);
    expect(g.players[0].shedCooldown).toBeLessThan(HEX_COOLDOWN_MS);
  });

  it('other modes still shed', () => {
    const g = new Game({ mode: 'arcade', seed: 3 });
    g.banner = null;
    g.p0.body = row(10, 5, 8);
    g.p0.prevBody = g.p0.body.map((s) => ({ ...s }));
    expect(g.shed(0)).toBe(true);
    expect(g.shedWalls.length).toBeGreaterThan(0);
    expect(g.p0.hexes).toBe(0);
  });
});
