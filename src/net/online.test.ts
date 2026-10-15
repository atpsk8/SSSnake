import { describe, expect, it } from 'vitest';
import type { Game } from '../game/engine';
import { FRAME_MS, hashGame, type Lockstep, type NetMsg } from './lockstep';
import { OnlineMatch } from './online';
import type { PeerLink } from './peer';

/** Two fake links with queued (async-style) delivery. */
function pair() {
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
      this.open = false;
      this.peer.open = false;
      this.peer.onclose();
    }
  }
  const a = new FakeLink();
  const b = new FakeLink();
  a.peer = b;
  b.peer = a;
  const flush = () => {
    while (queue.length) {
      const { to, msg } = queue.shift()!;
      to.onmessage(msg);
    }
  };
  return { a: a as unknown as PeerLink, b: b as unknown as PeerLink, flush };
}

function setup() {
  const { a, b, flush } = pair();
  const rounds: { host: Game[]; guest: Game[] } = { host: [], guest: [] };
  const locks: { host: Lockstep | null; guest: Lockstep | null } = { host: null, guest: null };
  const ended: string[] = [];
  const host = new OnlineMatch('host', a, 'Ann', 'viper', {
    started: (g, l) => {
      rounds.host.push(g);
      locks.host = l;
    },
    peerReady: () => {},
    ended: (r) => ended.push(`host:${r}`),
  });
  const guest = new OnlineMatch('guest', b, 'Bob', 'cobra', {
    started: (g, l) => {
      rounds.guest.push(g);
      locks.guest = l;
    },
    peerReady: () => {},
    ended: (r) => ended.push(`guest:${r}`),
  });
  flush();
  return { host, guest, rounds, locks, ended, flush };
}

/** Play the current round to the end with both players driving straight (someone hits a wall). */
function playOut(s: ReturnType<typeof setup>) {
  for (let i = 0; i < 4000; i++) {
    s.locks.host!.tick(FRAME_MS);
    s.locks.guest!.tick(FRAME_MS);
    s.flush();
    if (s.locks.host!.game.status === 'over' && s.locks.guest!.game.status === 'over') break;
  }
  expect(s.locks.host!.game.status).toBe('over');
  expect(hashGame(s.locks.host!.game)).toBe(hashGame(s.locks.guest!.game));
  s.host.recordRound(s.locks.host!.game.winner);
  s.guest.recordRound(s.locks.guest!.game.winner);
}

describe('online match', () => {
  it('handshakes and starts the same round on both sides', () => {
    const s = setup();
    expect(s.rounds.host).toHaveLength(1);
    expect(s.rounds.guest).toHaveLength(1);
    expect(s.rounds.host[0].seed).toBe(s.rounds.guest[0].seed);
    expect(s.host.names).toEqual(['Ann', 'Bob']);
    expect(s.guest.classes).toEqual(['viper', 'cobra']);
    expect(s.guest.me).toBe(1);
  });

  it('plays rounds to a best-of-three result and rematches', () => {
    const s = setup();
    let safety = 0;
    while (!s.host.matchOver && safety++ < 10) {
      playOut(s);
      expect(s.host.wins).toEqual(s.guest.wins);
      if (s.host.matchOver) break;
      s.host.ready();
      s.guest.ready();
      s.flush();
      expect(s.rounds.host.length).toBe(s.rounds.guest.length);
    }
    expect(s.host.matchOver).toBe(true);
    // Rematch resets the score.
    s.guest.ready();
    s.host.ready();
    s.flush();
    expect(s.host.wins).toEqual([0, 0]);
    expect(s.guest.wins).toEqual([0, 0]);
    expect(s.guest.round).toBe(1);
  });

  it('reports when the opponent leaves', () => {
    const s = setup();
    s.guest.leave();
    s.flush();
    expect(s.ended.some((e) => e.startsWith('host:'))).toBe(true);
  });
});
