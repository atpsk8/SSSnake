import { describe, expect, it } from 'vitest';
import { Game, SHED_WALL_MS } from './engine';
import { dailySeed, todayKey } from './rng';
import type { ModeId, PickupKind, Vec } from './types';

function make(mode: ModeId = 'classic', seed = 1) {
  const g = new Game({ mode, seed });
  // Keep tests deterministic: clear random spawns.
  g.pickups = [];
  g.mines = [];
  g.mice = [];
  g.rival = null;
  return g;
}

function put(g: Game, kind: PickupKind, pos: Vec) {
  g.pickups.push({ id: 900 + g.pickups.length, kind, pos, ttl: Infinity, maxTtl: Infinity, age: 0 });
}

const line = (x0: number, y: number, len: number): Vec[] =>
  Array.from({ length: len }, (_, i) => ({ x: x0 - i, y }));

describe('core movement', () => {
  it('starts length 4 heading right and moves one cell per step', () => {
    const g = make();
    expect(g.snake).toHaveLength(4);
    g.step();
    expect(g.snake[0]).toEqual({ x: 6, y: 12 });
    expect(g.snake).toHaveLength(4);
  });

  it('ignores reversing and buffers quick turns', () => {
    const g = make();
    g.turn('left');
    expect(g.queue).toEqual([]);
    g.turn('up');
    g.turn('left');
    expect(g.queue).toEqual(['up', 'left']);
    g.step();
    g.step();
    expect(g.snake[0]).toEqual({ x: 4, y: 11 });
  });

  it('dies leaving the board in a walled arena', () => {
    const g = make('classic');
    g.snake = line(23, 5, 4);
    g.step();
    expect(g.status).toBe('over');
    expect(g.deathCause).toBe('wall');
  });

  it('wraps around in the wrap arena', () => {
    const g = make('zen');
    g.snake = line(23, 5, 4);
    g.step();
    expect(g.status).toBe('playing');
    expect(g.snake[0]).toEqual({ x: 0, y: 5 });
  });

  it('dies biting its own body', () => {
    const g = make();
    // Head at (5,5) heading down into a body segment at (5,6).
    g.snake = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 6 },
      { x: 4, y: 6 },
    ];
    g.dir = 'down';
    g.step();
    expect(g.status).toBe('over');
    expect(g.deathCause).toBe('self');
  });

  it('may chase its own tail tip because it moves away', () => {
    const g = make();
    g.snake = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 6 },
    ];
    g.dir = 'down';
    g.step();
    expect(g.status).toBe('playing');
  });
});

describe('food and scoring', () => {
  it('grows and scores when eating, then respawns food', () => {
    const g = make('classic');
    put(g, 'food', { x: 6, y: 12 });
    g.step();
    expect(g.score).toBe(10);
    expect(g.grow).toBe(1);
    expect(g.pickups.filter((p) => p.kind === 'food')).toHaveLength(1);
    g.step();
    expect(g.snake).toHaveLength(5);
  });

  it('builds combos for quick eats in arcade', () => {
    const g = make('arcade');
    put(g, 'food', { x: 6, y: 12 });
    put(g, 'food', { x: 7, y: 12 });
    g.step();
    g.step();
    expect(g.combo).toBe(2);
    expect(g.score).toBe(10 + 20);
  });

  it('does not combo in classic', () => {
    const g = make('classic');
    put(g, 'food', { x: 6, y: 12 });
    put(g, 'food', { x: 7, y: 12 });
    g.step();
    g.step();
    expect(g.score).toBe(20);
  });

  it('doubles points while surging', () => {
    const g = make('arcade');
    g.setSurge(true);
    put(g, 'food', { x: 6, y: 12 });
    g.step();
    expect(g.score).toBe(20);
  });

  it('length raises the multiplier', () => {
    const g = make('arcade');
    g.snake = line(10, 12, 12);
    expect(g.lengthMult).toBe(1.5);
    g.snake = line(22, 12, 20);
    expect(g.lengthMult).toBe(2);
  });
});

describe('shed', () => {
  it('drops the back half into walls', () => {
    const g = make('arcade');
    g.snake = line(15, 12, 10);
    expect(g.shed()).toBe(true);
    expect(g.snake).toHaveLength(5);
    expect(g.shedWalls).toHaveLength(5);
    expect(g.shed()).toBe(false); // cooldown
  });

  it('needs a minimum length and is disabled in classic', () => {
    const short = make('arcade');
    expect(short.shed()).toBe(false);
    const classic = make('classic');
    classic.snake = line(15, 12, 10);
    expect(classic.shed()).toBe(false);
  });

  it('shed walls kill on contact and expire later', () => {
    const g = make('arcade');
    g.shedWalls = [{ pos: { x: 6, y: 12 }, ttl: SHED_WALL_MS, maxTtl: SHED_WALL_MS, owner: 0 }];
    const g2 = make('arcade');
    g2.shedWalls = [{ pos: { x: 20, y: 20 }, ttl: 50, maxTtl: SHED_WALL_MS, owner: 0 }];
    g.step();
    expect(g.deathCause).toBe('shed');
    g2.update(60);
    expect(g2.shedWalls).toHaveLength(0);
  });

  it('zen crumbles shed walls instead of dying', () => {
    const g = make('zen');
    g.shedWalls = [{ pos: { x: 6, y: 12 }, ttl: SHED_WALL_MS, maxTtl: SHED_WALL_MS, owner: 0 }];
    g.step();
    expect(g.status).toBe('playing');
    expect(g.shedWalls).toHaveLength(0);
  });
});

describe('power-ups', () => {
  const loop = () => [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 6 },
    { x: 5, y: 6 },
    { x: 4, y: 6 },
  ];

  it('phase lets you pass through yourself', () => {
    const g = make('arcade');
    g.snake = loop();
    g.dir = 'down';
    g.effects.phase = 3000;
    g.step();
    expect(g.status).toBe('playing');
  });

  it('zen cuts the tail on a self hit', () => {
    const g = make('zen');
    g.snake = loop();
    g.dir = 'down';
    g.step();
    expect(g.status).toBe('playing');
    expect(g.snake.length).toBeLessThan(5);
  });

  it('shrink removes three segments', () => {
    const g = make('arcade');
    g.snake = line(5, 12, 8);
    put(g, 'shrink', { x: 6, y: 12 });
    g.step();
    expect(g.snake).toHaveLength(5);
  });

  it('timed effects activate and expire', () => {
    const g = make('arcade');
    put(g, 'slowmo', { x: 6, y: 12 });
    const before = g.interval;
    g.step();
    expect(g.effects.slowmo).toBeGreaterThan(0);
    expect(g.interval).toBeGreaterThan(before);
  });

  it('magnet pulls food towards the head', () => {
    const g = make('arcade');
    g.effects.magnet = 5000;
    put(g, 'food', { x: 9, y: 10 });
    g.step();
    expect(g.pickups[0].pos).toEqual({ x: 8, y: 10 });
  });
});

describe('hazards and arenas', () => {
  it('lit mines kill, unlit mines are safe', () => {
    const lit = make('arcade');
    lit.mines = [{ pos: { x: 6, y: 12 }, offset: 0 }];
    lit.step();
    expect(lit.deathCause).toBe('mine');

    const dim = make('arcade');
    dim.mines = [{ pos: { x: 6, y: 12 }, offset: 2000 }];
    dim.step();
    expect(dim.status).toBe('playing');
  });

  it('portals teleport the head to the twin', () => {
    const g = make('arcade');
    g.loadLevel(3, false);
    g.mines = [];
    g.rival = null;
    g.rivalRespawn = Infinity;
    g.snake = line(2, 3, 3);
    g.step();
    expect(g.arena.id).toBe('portals');
    expect(g.snake[0]).toEqual({ x: 20, y: 20 });
  });

  it('clearing a level opens a draft, then loads the next arena', () => {
    const g = make('arcade');
    g.levelFoods = g.foodsForLevel - 1;
    put(g, 'food', { x: 6, y: 12 });
    g.step();
    expect(g.status).toBe('draft');
    expect(g.draftOptions).toHaveLength(3);
    expect(g.score).toBeGreaterThan(10);
    const pick = g.draftOptions![0];
    g.chooseMutation(0);
    expect(g.mutations).toContain(pick);
    expect(g.level).toBe(2);
    expect(g.arena.id).toBe('wrap');
    expect(g.snake).toHaveLength(4);
    expect(g.banner).not.toBeNull();
  });

  it('collapse closes the border ring over time', () => {
    const g = make('arcade');
    g.loadLevel(6, false);
    expect(g.arena.id).toBe('collapse');
    g.collapseTimer = 1;
    g.update(16);
    expect(g.ring).toBe(1);
    expect(g.solid[0]).toBe(1);
  });

  it('maze shifts after a few foods and never lands on the snake', () => {
    const g = make('arcade');
    g.loadLevel(4, false);
    g.mines = [];
    g.rivalRespawn = Infinity;
    expect(g.arena.id).toBe('maze');
    for (let i = 0; i < 4; i++) {
      g.pickups = [];
      put(g, 'food', { x: g.snake[0].x + 1, y: 12 });
      g.step();
    }
    expect(g.pendingMaze).not.toBeNull();
    g.mazeWarn = 1;
    g.update(16);
    expect(g.pendingMaze).toBeNull();
    for (const s of g.snake) expect(g.solid[s.y * 24 + s.x]).toBe(0);
  });

  it('a longer player wins a head-on with the rival', () => {
    const g = make('arcade');
    g.rival = {
      body: [
        { x: 6, y: 12 },
        { x: 7, y: 12 },
        { x: 8, y: 12 },
      ],
      prevBody: [],
      dir: 'left',
      grow: 0,
      stunned: 0,
    };
    g.step();
    expect(g.status).toBe('playing');
    expect(g.rival).toBeNull();
    expect(g.rivalsDowned).toBe(1);
  });
});

describe('daily seed', () => {
  it('is stable for a date and gives identical spawns', () => {
    const key = todayKey(new Date(2026, 9, 15));
    expect(key).toBe('2026-10-15');
    expect(dailySeed(key)).toBe(dailySeed('2026-10-15'));
    expect(dailySeed(key)).not.toBe(dailySeed('2026-10-16'));
    const a = new Game({ mode: 'daily', seed: dailySeed(key) });
    const b = new Game({ mode: 'daily', seed: dailySeed(key) });
    expect(a.pickups.map((p) => p.pos)).toEqual(b.pickups.map((p) => p.pos));
    expect(a.arena.id).toBe(b.arena.id);
  });
});
