import { describe, expect, it } from 'vitest';
import type { Game } from '../game/engine';
import { FRAME_MS, hashGame, type Lockstep, type NetMsg } from './lockstep';
import { OnlineMatch } from './online';
import type { PeerLink } from './peer';

/** In-memory links with queued (async-style) delivery, shared by every pair in a test. */
function network() {
  const queue: { to: FakeLink; msg: NetMsg }[] = [];
  class FakeLink {
    peer!: FakeLink;
    onmessage: (m: NetMsg) => void = () => {};
    onclose: () => void = () => {};
    open = true;
    send(m: NetMsg) {
      if (this.open) queue.push({ to: this.peer, msg: JSON.parse(JSON.stringify(m)) });
    }
    close() {
      if (!this.open) return;
      this.open = false;
      this.peer.open = false;
      this.onclose();
      this.peer.onclose();
    }
  }
  const pair = () => {
    const a = new FakeLink();
    const b = new FakeLink();
    a.peer = b;
    b.peer = a;
    return [a as unknown as PeerLink, b as unknown as PeerLink, a, b] as const;
  };
  const flush = () => {
    while (queue.length) {
      const { to, msg } = queue.shift()!;
      if (to.open) to.onmessage(msg);
    }
  };
  return { pair, flush };
}

const NAMES = ['Ann', 'Bob', 'Cat', 'Dan'];
const CLASSES = ['viper', 'cobra', 'racer', 'python'] as const;

/** Seats that start curled up and bite themselves on the first step. */
let coiled = [2, 3];

/**
 * The versus board wraps, so driving straight never ends a round. Player 2 (longer) heads at
 * player 1 in its lane and wins the head-on; players 3 and 4 start curled up and bite their own
 * bodies at once. Applied the same way on every peer before frame 0, so it stays deterministic.
 */
function pileUp(g: Game) {
  const y = g.players[0].body[0].y;
  g.players.forEach((p, i) => {
    if (i === 1) {
      p.body = Array.from({ length: 8 }, (_, k) => ({ x: 20 + k, y }));
      p.dir = 'left';
    } else if (coiled.includes(i)) {
      const x = 10 + i * 8;
      const cy = 30;
      p.body = [
        { x, y: cy },
        { x, y: cy + 1 },
        { x: x + 1, y: cy + 1 },
        { x: x + 1, y: cy },
        { x: x + 1, y: cy - 1 },
        { x, y: cy - 1 },
        { x: x - 1, y: cy - 1 },
        { x: x - 2, y: cy - 1 },
      ];
      p.dir = 'up';
    } else if (i > 1) {
      // A free lane of its own, far from everyone.
      p.body = Array.from({ length: 4 }, (_, k) => ({ x: 30 - k, y: 40 + i }));
      p.dir = 'right';
    } else return;
    p.prevBody = p.body.map((c) => ({ ...c }));
    p.queue = [];
  });
}

/** A host plus `guests` friends, all connected and greeted. */
function setup(guests: number, opts: { autoStart?: number } = {}) {
  const net = network();
  const rounds: Game[][] = [];
  const locks: (Lockstep | null)[] = [];
  const ended: string[] = [];
  const lobbies: string[][] = [];
  const left: string[] = [];
  const hooks = (i: number) => ({
    started: (g: Game, l: Lockstep) => {
      pileUp(g);
      (rounds[i] ??= []).push(g);
      locks[i] = l;
    },
    lobby: (names: string[]) => (lobbies[i] = names),
    peerReady: () => {},
    left: (name: string) => left.push(`${i}:${name}`),
    ended: (r: string) => ended.push(`${i}:${r}`),
  });
  const host = new OnlineMatch('host', NAMES[0], CLASSES[0], hooks(0), opts.autoStart ?? 0);
  const matches = [host];
  const hostSides: ReturnType<typeof net.pair>[2][] = [];
  for (let g = 1; g <= guests; g++) {
    const [hostEnd, guestEnd, rawHost] = net.pair();
    hostSides.push(rawHost);
    const guest = new OnlineMatch('guest', NAMES[g], CLASSES[g], hooks(g));
    host.addGuest(hostEnd);
    guest.connect(guestEnd);
    matches.push(guest);
    net.flush();
  }
  return { host, matches, rounds, locks, ended, lobbies, left, flush: net.flush, hostSides };
}

/** Play the current round to the end on every peer. */
function playOut(s: ReturnType<typeof setup>) {
  for (let i = 0; i < 6000; i++) {
    for (const l of s.locks) l?.tick(FRAME_MS);
    s.flush();
    if (s.locks.every((l) => !l || l.game.status === 'over')) break;
  }
  const live = s.locks.filter((l): l is Lockstep => !!l && !s.ended.some((e) => e.startsWith(`${s.locks.indexOf(l)}:`)));
  for (const l of live) {
    expect(l.game.status).toBe('over');
    expect(l.desync).toBe(false);
    expect(hashGame(l.game)).toBe(hashGame(live[0].game));
  }
  s.matches.forEach((m, i) => s.locks[i] && m.recordRound(s.locks[i]!.game.winner));
}

describe('online match', () => {
  it('handshakes and starts the same round on both sides', () => {
    const s = setup(1, { autoStart: 2 });
    expect(s.rounds[0]).toHaveLength(1);
    expect(s.rounds[1]).toHaveLength(1);
    expect(s.rounds[0][0].seed).toBe(s.rounds[1][0].seed);
    expect(s.host.names).toEqual(['Ann', 'Bob']);
    expect(s.matches[1].classes).toEqual(['viper', 'cobra']);
    expect(s.matches[1].me).toBe(1);
  });

  it('plays rounds to a best-of-three result and rematches', () => {
    const s = setup(1, { autoStart: 2 });
    let safety = 0;
    while (!s.host.matchOver && safety++ < 10) {
      playOut(s);
      expect(s.host.wins).toEqual(s.matches[1].wins);
      if (!s.host.matchOver) {
        for (const m of s.matches) m.ready();
        s.flush();
      }
    }
    expect(s.host.matchOver).toBe(true);
    expect(Math.max(...s.host.wins)).toBe(2);
    // Rematch resets.
    for (const m of s.matches) m.ready();
    s.flush();
    expect(s.host.wins).toEqual([0, 0]);
    expect(s.matches[1].round).toBe(1);
  });

  it('shows the lobby and waits for the host to start', () => {
    const s = setup(3);
    expect(s.rounds[0]).toBeUndefined();
    expect(s.lobbies[0]).toEqual(['Ann', 'Bob', 'Cat', 'Dan']);
    expect(s.lobbies[3]).toEqual(['Ann', 'Bob', 'Cat', 'Dan']);
    expect(s.matches[3].me).toBe(3);
    expect(s.host.full).toBe(true);
    expect(s.matches[1].start()).not.toBeNull();
    expect(s.host.start()).toBeNull();
    s.flush();
    for (let i = 0; i < 4; i++) {
      expect(s.rounds[i]).toHaveLength(1);
      expect(s.rounds[i][0].players).toHaveLength(4);
    }
  });

  it('keeps four players in lockstep through the host, first to three wins', () => {
    const s = setup(3);
    s.host.start();
    s.flush();
    let safety = 0;
    while (!s.host.matchOver && safety++ < 10) {
      playOut(s);
      for (const m of s.matches) expect(m.wins).toEqual(s.host.wins);
      if (!s.host.matchOver) {
        for (const m of s.matches) m.ready();
        s.flush();
      }
    }
    expect(s.host.winsNeeded).toBe(3);
    expect(Math.max(...s.host.wins)).toBe(3);
  });

  it('carries on when a guest drops out mid-round', () => {
    coiled = [3];
    const s = setup(3);
    s.host.start();
    s.flush();
    for (let i = 0; i < 40; i++) {
      for (const l of s.locks) l?.tick(FRAME_MS);
      s.flush();
    }
    // Cat (seat 2) loses the connection.
    s.hostSides[1].close();
    s.locks[2] = null;
    expect(s.left).toContain('0:Cat');
    playOut(s);
    expect(s.locks[0]!.game.players[2].deathCause).toBe('left');
    expect(s.ended.filter((e) => !e.startsWith('2:'))).toEqual([]);
    coiled = [2, 3];
  });

  it('ends for everyone when the host leaves', () => {
    const s = setup(2, { autoStart: 0 });
    s.host.start();
    s.flush();
    s.host.leave();
    s.flush();
    expect(s.ended.some((e) => e.startsWith('1:'))).toBe(true);
    expect(s.ended.some((e) => e.startsWith('2:'))).toBe(true);
  });

  it('lets a guest leave the lobby before the start', () => {
    const s = setup(2);
    s.hostSides[0].close();
    s.flush();
    expect(s.lobbies[0]).toEqual(['Ann', 'Cat']);
    expect(s.matches[2].me).toBe(1);
  });
});
