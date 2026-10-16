import { describe, expect, it } from 'vitest';
import { Game } from '../game/engine';
import { DIRS, DIR_LIST, OPPOSITE, add, eq, inBounds, type Dir } from '../game/types';
import { FRAME_MS, Lockstep, delayForRtt, hashGame, type NetMsg } from './lockstep';

/** A player that turns away from walls and bodies, using only its own peer's view. */
function steer(p: Lockstep, rnd: () => number): Dir | null {
  const g = p.game;
  const me = g.players[p.me];
  if (!me.alive) return null;
  const free = (d: Dir) => {
    const c = add(me.body[0], DIRS[d]);
    return inBounds(c) && !g.solid[c.y * 24 + c.x] && !g.players.some((o) => o.body.some((s) => eq(s, c)));
  };
  if (free(me.dir) && rnd() > 0.05) return null;
  const options = DIR_LIST.filter((d) => d !== OPPOSITE[me.dir] && free(d));
  return options.length ? options[Math.floor(rnd() * options.length)] : null;
}

/** Two peers wired through a fake network with random latency on a shared virtual clock. */
function simulate(opts: { seed: number; latency: [number, number]; ticks: number; delay: number }) {
  let now = 0;
  const inflight: { at: number; to: 0 | 1; msg: NetMsg }[] = [];
  let r = opts.seed;
  const rnd = () => {
    r = (Math.imul(r ^ (r >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return r / 4294967296;
  };
  const make = (me: 0 | 1) => {
    const g = new Game({ mode: 'versus', seed: opts.seed, classes: ['racer', 'viper'] });
    // Long enough to hex (the shed key) from the start; identical on both peers.
    for (const pl of g.players) pl.grow = 6;
    // Ordered channel: never deliver earlier than the previous message to the same peer.
    let last = 0;
    return new Lockstep(g, me, opts.delay, (msg) => {
      const at = Math.max(last, now + opts.latency[0] + rnd() * (opts.latency[1] - opts.latency[0]));
      last = at;
      inflight.push({ at, to: me === 0 ? 1 : 0, msg: JSON.parse(JSON.stringify(msg)) });
    });
  };
  const peers = [make(0), make(1)];
  for (let t = 0; t < opts.ticks; t++) {
    now += FRAME_MS;
    for (let i = inflight.length - 1; i >= 0; i--) {
      if (inflight[i].at <= now) {
        peers[inflight[i].to].receive(inflight[i].msg);
        inflight.splice(i, 1);
      }
    }
    for (const p of peers) {
      const d = steer(p, rnd);
      if (d) p.input({ t: 'turn', d });
      if (rnd() < 0.01) p.input({ t: 'shed' });
      if (rnd() < 0.02) p.input({ t: 'hold', on: rnd() < 0.5 });
      p.tick(FRAME_MS + (rnd() - 0.5) * 6);
    }
  }
  return peers;
}

describe('lockstep', () => {
  for (const [label, latency] of [
    ['LAN', [5, 15]],
    ['typical', [40, 90]],
    ['bad', [120, 250]],
  ] as const) {
    it(`keeps both games identical (${label} latency)`, () => {
      for (let seed = 1; seed <= 6; seed++) {
        const [a, b] = simulate({ seed, latency: [...latency], ticks: 1500, delay: delayForRtt(latency[1] * 2) });
        expect(a.desync).toBe(false);
        expect(b.desync).toBe(false);
        // Compare at the same frame: step the leader back is impossible, so compare when equal.
        const fa = a.frame;
        const fb = b.frame;
        expect(Math.abs(fa - fb)).toBeLessThanOrEqual(30);
        if (fa === fb) expect(hashGame(a.game)).toBe(hashGame(b.game));
        if (a.game.status === 'playing' && b.game.status === 'playing') expect(Math.min(fa, fb)).toBeGreaterThan(200);
      }
    });
  }

  it('stays identical while players hex each other', () => {
    let hexes = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const [a, b] = simulate({ seed, latency: [40, 90], ticks: 2500, delay: 8 });
      expect(a.desync || b.desync).toBe(false);
      if (a.frame === b.frame) expect(hashGame(a.game)).toBe(hashGame(b.game));
      hexes += a.game.players.reduce((n, p) => n + p.hexes, 0);
    }
    expect(hexes).toBeGreaterThan(0);
  });

  it('reaches the same result on both sides when a round ends', () => {
    let finished = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const [a, b] = simulate({ seed, latency: [30, 60], ticks: 4000, delay: 5 });
      if (a.game.status === 'over' && b.game.status === 'over') {
        finished++;
        expect(a.frame).toBe(b.frame);
        expect(a.game.winner).toBe(b.game.winner);
        expect(hashGame(a.game)).toBe(hashGame(b.game));
      }
    }
    expect(finished).toBeGreaterThan(5);
  });

  it('detects a desync', () => {
    const g1 = new Game({ mode: 'versus', seed: 1 });
    const g2 = new Game({ mode: 'versus', seed: 2 });
    const sent: NetMsg[] = [];
    const a = new Lockstep(g1, 0, 3, (m) => sent.push(m));
    const b = new Lockstep(g2, 1, 3, () => {});
    for (let i = 0; i < 40; i++) {
      b.receive({ k: 'in', f: i + 3, i: [] });
      a.receive({ k: 'in', f: i + 3, i: [] });
    }
    a.tick(FRAME_MS * 2);
    const hashMsg = sent.find((m) => m.k === 'hash');
    expect(hashMsg).toBeTruthy();
    b.tick(FRAME_MS * 2);
    b.receive(hashMsg!);
    expect(b.desync).toBe(true);
  });

  it('picks a sensible input delay', () => {
    expect(delayForRtt(10)).toBe(3);
    expect(delayForRtt(100)).toBe(6);
    expect(delayForRtt(2000)).toBe(12);
  });
});
