import { describe, expect, it } from 'vitest';
import { Game } from './game/engine';
import { emptyLevel } from './game/levels';
import { decodeGhost, encodeGhost, ghostBodyAt } from './ghost';
import { evaluate } from './progress';
import { decodeChallenge, encodeChallenge } from './share';

describe('ghost codec', () => {
  it('round-trips a recorded run', () => {
    const g = new Game({ mode: 'daily', seed: 9, record: true });
    for (let i = 0; i < 10; i++) g.update(50);
    const ghost = decodeGhost(encodeGhost(g.trail))!;
    expect(ghost.times.length).toBe(g.trail.length / 4);
    const last = ghost.times.length - 1;
    expect(ghost.xs[last]).toBe(g.snake[0].x);
    const body = ghostBodyAt(ghost, ghost.times[last])!;
    expect(body[0]).toEqual(g.snake[0]);
    expect(ghostBodyAt(ghost, ghost.times[last] + 10000)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(decodeGhost('%%%')).toBeNull();
  });
});

describe('challenge links', () => {
  it('round-trips a run challenge', () => {
    const code = encodeChallenge({ kind: 'run', mode: 'arcade', seed: 123456789, target: 4200, from: 'Andrew' });
    expect(code).toMatch(/^[\w-]+$/);
    expect(decodeChallenge(code)).toEqual({ kind: 'run', mode: 'arcade', seed: 123456789, target: 4200, from: 'Andrew' });
  });

  it('round-trips a level, compressing walls', () => {
    const level = { ...emptyLevel(), name: 'Spiral', walls: [0, 1, 2, 50, 575], wells: [100], arrows: [[200, 'up']] as [number, 'up'][], modifiers: ['ice' as const], goal: 12 };
    const c = decodeChallenge(encodeChallenge({ kind: 'level', mode: 'custom', seed: 1, target: 0, from: '', level }))!;
    expect(c.kind).toBe('level');
    expect(c.level!.walls).toEqual([0, 1, 2, 50, 575]);
    expect(c.level!.modifiers).toEqual(['ice']);
    expect(c.level!.arrows).toEqual([[200, 'up']]);
    expect(c.level!.name).toBe('Spiral');
  });

  it('sanitises hostile payloads', () => {
    const evil = btoa(JSON.stringify({ v: 1, k: 'level', l: { name: 'x'.repeat(500), mines: [-1, 9999, 3, 'a'], modifiers: ['nuke'], spawn: 'no' } }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const c = decodeChallenge(evil)!;
    expect(c.level!.name.length).toBeLessThanOrEqual(32);
    expect(c.level!.mines).toEqual([3]);
    expect(c.level!.modifiers).toEqual([]);
    expect(decodeChallenge('not-base64!!')).toBeNull();
  });
});

describe('achievements', () => {
  it('awards once and only when earned', () => {
    const owned: string[] = [];
    const g = new Game({ mode: 'arcade', seed: 1 });
    const stats = { ...g.stats, coils: 1, bossesDefeated: 1, level: 5 };
    const fresh = evaluate(owned, { mode: 'arcade', stats });
    expect(fresh.map((a) => a.id)).toEqual(expect.arrayContaining(['first_coil', 'boss', 'level5']));
    expect(evaluate(owned, { mode: 'arcade', stats })).toHaveLength(0);
  });
});
