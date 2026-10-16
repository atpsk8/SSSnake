import { describe, expect, it } from 'vitest';
import { Game } from './engine';
import { emptyLevel } from './levels';
import type { ModeId, PickupKind, Vec } from './types';

function make(mode: ModeId = 'arcade', seed = 1) {
  const g = new Game({ mode, seed });
  g.pickups = [];
  g.mines = [];
  g.mice = [];
  g.rival = null;
  return g;
}

function put(g: Game, kind: PickupKind, pos: Vec) {
  g.pickups.push({ id: 900 + g.pickups.length, kind, pos, ttl: Infinity, maxTtl: Infinity, age: 0 });
}

/** A body whose head, moving up from (9,11) to (9,10), seals a ring around (10,10). */
function almostRing(g: Game) {
  g.snake = [
    { x: 9, y: 11 },
    { x: 10, y: 11 },
    { x: 11, y: 11 },
    { x: 11, y: 10 },
    { x: 11, y: 9 },
    { x: 10, y: 9 },
    { x: 9, y: 9 },
    { x: 8, y: 9 },
  ];
  g.dir = 'left';
  g.turn('up');
}

describe('coil', () => {
  it('captures enclosed food at double points', () => {
    const g = make();
    almostRing(g);
    put(g, 'food', { x: 10, y: 10 });
    g.step();
    expect(g.status).toBe('playing');
    expect(g.coils).toBe(1);
    expect(g.score).toBe(20);
  });

  it('defuses enclosed mines', () => {
    const g = make();
    almostRing(g);
    g.mines = [{ pos: { x: 10, y: 10 }, offset: 2000 }];
    g.step();
    expect(g.mines).toHaveLength(0);
    expect(g.bestCoil).toBe(1);
  });

  it('never spawns food inside an existing coil', () => {
    const g = make();
    almostRing(g);
    g.step();
    for (let i = 0; i < 50; i++) {
      g.pickups = [];
      g.spawnPickup('food', Infinity);
      expect(g.pickups[0].pos).not.toEqual({ x: 10, y: 10 });
    }
  });
});

describe('survival', () => {
  it('armour absorbs a lethal hit and bounces you', () => {
    const g = make();
    g.p0.armour = 1;
    g.snake = Array.from({ length: 8 }, (_, i) => ({ x: 23 - i, y: 5 }));
    g.step();
    expect(g.status).toBe('playing');
    expect(g.p0.armour).toBe(0);
    expect(g.snake).toHaveLength(4);
  });

  it('rewind restores an earlier state instead of dying once', () => {
    const g = make();
    expect(g.rewinds).toBe(1);
    g.snake = Array.from({ length: 4 }, (_, i) => ({ x: 8 - i, y: 5 }));
    for (let i = 0; i < 200 && g.status === 'playing'; i++) g.update(50);
    expect(g.rewindsUsed).toBe(1);
    expect(g.status).toBe('over');
  });
});

describe('snake types', () => {
  it('viper dash moves three cells at once', () => {
    const g = new Game({ mode: 'arcade', seed: 3, classes: ['viper'] });
    g.pickups = [];
    g.mines = [];
    const x = g.snake[0].x;
    g.setHeld(0, true);
    expect(g.snake[0].x).toBe(x + 3);
    expect(g.surge).toBeCloseTo(0.66, 2);
  });

  it('cobra spit breaks a wall', () => {
    const g = new Game({ mode: 'arcade', seed: 3, classes: ['cobra'] });
    g.loadLevel(3, false); // portals arena: pillar at x 11-12, y 7-9
    g.mines = [];
    g.snake = [
      { x: 11, y: 11 },
      { x: 11, y: 12 },
      { x: 11, y: 13 },
      { x: 11, y: 14 },
    ];
    g.dir = 'up';
    g.setHeld(0, true);
    expect(g.projectiles).toHaveLength(1);
    (g as unknown as { stepProjectiles(): void }).stepProjectiles();
    expect(g.solid[9 * 24 + 11]).toBe(0);
  });

  it('python hunker holds position', () => {
    const g = new Game({ mode: 'arcade', seed: 3, classes: ['python'] });
    g.pickups = [];
    g.mines = [];
    const h = { ...g.snake[0] };
    g.setHeld(0, true);
    g.step();
    expect(g.snake[0]).toEqual(h);
  });

  it('classic ignores snake types', () => {
    const g = new Game({ mode: 'classic', seed: 3, classes: ['viper'] });
    const x = g.snake[0].x;
    g.setHeld(0, true);
    expect(g.snake[0].x).toBe(x);
  });
});

describe('bosses', () => {
  it('level 5 is the Serpent King and shed walls hurt it', () => {
    const g = make();
    g.loadLevel(5, false);
    expect(g.boss?.kind).toBe('serpent');
    const b = g.boss!;
    b.stunned = 0;
    const ahead = { x: b.body[0].x, y: b.body[0].y - 1 };
    g.shedWalls = [{ pos: ahead, ttl: 9000, maxTtl: 9000, owner: 0 }];
    for (let i = 0; i < 4 && b.hp === b.maxHp; i++) g.step();
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('level 10 is the Swarm Queen; four drones drop her shield', () => {
    const g = make();
    g.loadLevel(10, false);
    expect(g.boss?.kind).toBe('queen');
    for (let i = 0; i < 4; i++) {
      g.mice = [{ id: 50 + i, pos: { x: 6, y: 12 }, prev: { x: 6, y: 12 }, ttl: Infinity, stunned: 0, drone: true }];
      g.snake = [
        { x: 5, y: 12 },
        { x: 4, y: 12 },
        { x: 3, y: 12 },
        { x: 2, y: 12 },
      ];
      g.dir = 'right';
      g.step();
    }
    expect(g.boss!.shield).toBe(false);
  });

  it('killing a boss completes the level', () => {
    const g = make();
    g.loadLevel(5, false);
    g.boss!.hp = 1;
    g.damageBoss(1);
    expect(g.boss).toBeNull();
    expect(g.bossesDefeated).toBe(1);
    expect(g.status).toBe('draft');
  });
});

describe('arena twists', () => {
  it('ice delays turns by one step', () => {
    const g = make();
    g.modifiers.add('ice');
    g.turn('up');
    g.step();
    expect(g.snake[0]).toEqual({ x: 6, y: 12 });
    g.step();
    expect(g.snake[0]).toEqual({ x: 6, y: 11 });
  });

  it('mirror flips controls', () => {
    const g = make();
    g.modifiers.add('mirror');
    g.turn('up');
    g.step();
    expect(g.snake[0]).toEqual({ x: 5, y: 13 });
  });

  it('arrow tiles force direction', () => {
    const g = make();
    g.arrows = [{ pos: { x: 6, y: 12 }, dir: 'down' }];
    g.step();
    g.step();
    expect(g.snake[0]).toEqual({ x: 6, y: 13 });
  });

  it('ripening food rots and shrinks you', () => {
    const g = make();
    g.modifiers.add('ripening');
    g.snake = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 2, y: 5 },
      { x: 1, y: 5 },
      { x: 0, y: 5 },
    ];
    put(g, 'food', { x: 20, y: 20 });
    g.pickups[0].age = 25000;
    (g as unknown as { tickTimers(dt: number): void }).tickTimers(1);
    const rot = g.pickups.find((p) => p.kind === 'rot')!;
    expect(rot).toBeTruthy();
    rot.pos = { x: 6, y: 5 };
    g.step();
    expect(g.snake).toHaveLength(4);
  });
});

describe('mutations', () => {
  it('ouroboros turns a self-bite into a cut', () => {
    const g = make();
    g.mutations.push('ouroboros');
    g.snake = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 6 },
      { x: 4, y: 6 },
    ];
    g.dir = 'down';
    g.step();
    expect(g.status).toBe('playing');
  });

  it('forked tongue eats food next to the head', () => {
    const g = make();
    g.mutations.push('forked');
    put(g, 'food', { x: 6, y: 11 });
    g.step();
    expect(g.score).toBe(10);
  });

  it('quick molt allows shedding at length 4', () => {
    const g = make();
    expect(g.shed()).toBe(false);
    g.mutations.push('quickmolt');
    expect(g.shed()).toBe(true);
  });

  it('drafts never offer a non-stacking mutation you already have', () => {
    const g = make();
    g.mutations.push('forked', 'venom', 'midas');
    for (let i = 0; i < 30; i++) {
      for (const id of g.rollDraft()) expect(['forked', 'venom', 'midas']).not.toContain(id);
    }
  });
});

describe('modes', () => {
  it('versus: running into the other snake ends the round', () => {
    const g = new Game({ mode: 'versus', seed: 1 });
    expect(g.players).toHaveLength(2);
    // A column just ahead of player 1's head, which player 1 runs into.
    const h = g.players[0].body[0];
    g.players[1].body = [3, 2, 1, 0].map((dy) => ({ x: h.x + 1, y: h.y + dy }));
    g.players[1].dir = 'down';
    g.step();
    expect(g.status).toBe('over');
    expect(g.winner).toBe(1);
  });

  it('versus: surge only speeds up the surging player', () => {
    const g = new Game({ mode: 'versus', seed: 1 });
    g.setHeld(0, true);
    expect(g.playerInterval(g.players[0])).toBeLessThan(g.playerInterval(g.players[1]));
  });

  it('rhythm: on-beat turns build a streak and multiplier', () => {
    const g = make('rhythm');
    g.update(5);
    g.turn('up');
    expect(g.beatStreak).toBe(1);
    expect(g.rhythmMult).toBeGreaterThan(1);
  });

  it('custom levels load from data and finish on the goal', () => {
    const level = { ...emptyLevel(), walls: [5 * 24 + 5], goal: 1 };
    const g = new Game({ mode: 'custom', seed: 2, level });
    expect(g.solid[5 * 24 + 5]).toBe(1);
    g.pickups = [];
    put(g, 'food', { x: 6, y: 12 });
    g.step();
    expect(g.status).toBe('over');
    expect(g.won).toBe(true);
  });

  it('records a ghost trail when asked', () => {
    const g = new Game({ mode: 'daily', seed: 4, record: true });
    g.step();
    g.step();
    expect(g.trail.length).toBe(8);
  });
});

describe('hold abilities', () => {
  it('a drained meter keeps surge off until the key is released', () => {
    const g = new Game({ mode: 'zen', seed: 1 });
    g.banner = null;
    g.p0.meter = 0.05;
    g.setHeld(0, true);
    let sounds = 0;
    for (let i = 0; i < 125; i++) {
      g.update(16);
      sounds += g.drainEvents().filter((e) => e.type === 'ability').length;
    }
    expect(sounds).toBe(1);
    expect(g.isSurging(g.p0)).toBe(false);
    g.setHeld(0, false);
    g.setHeld(0, true);
    expect(g.isSurging(g.p0)).toBe(true);
  });
});

describe('versus sudden death', () => {
  it('starts at 60s, speeds up, and shrinks a wrapping board', () => {
    const g = new Game({ mode: 'versus', seed: 2 });
    g.banner = null;
    // Park both snakes in the middle, away from everything, and run the clock.
    g.time = 59_990;
    g.update(16);
    expect((g.banner as { title: string } | null)?.title).toBe('Sudden death');
    expect(g.suddenDeathPace).toBeLessThan(1);
    for (let i = 0; i < 60; i++) {
      g.banner = null;
      for (const p of g.players) p.acc = 0;
      g.update(500);
    }
    expect(g.ring).toBeGreaterThan(0);
    expect(g.ring).toBeLessThanOrEqual(g.maxRing);
    // A snake walking into the closed ring comes out on the far side of the open square.
    const r = g.ring;
    const p = g.players[0];
    p.body = [{ x: r, y: 20 }, { x: r + 1, y: 20 }, { x: r + 2, y: 20 }];
    p.prevBody = p.body.map((c) => ({ ...c }));
    p.dir = 'left';
    p.queue = [];
    p.alive = true;
    g.status = 'playing';
    g.step();
    expect(p.alive).toBe(true);
    expect(p.body[0]).toEqual({ x: g.w - 1 - r, y: 20 });
  });
});
