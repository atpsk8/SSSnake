import type { Game } from '../game/engine';
import type { Dir, SnakeClass } from '../game/types';

/**
 * Deterministic lockstep for online Versus. Both peers run the same Game with the same seed and
 * exchange only inputs. Local input is scheduled `delay` frames ahead and sent immediately; a
 * frame is simulated once both players' inputs for it are known, so the games never diverge.
 */

export const FRAME_MS = 16;
const HASH_EVERY = 30;
const MAX_PENDING = 16;

export type NetInput = { t: 'turn'; d: Dir } | { t: 'shed' } | { t: 'hold'; on: boolean };

export type NetMsg =
  | { k: 'hello'; v: number; name: string; cls: SnakeClass }
  | { k: 'start'; seed: number; round: number; delay: number }
  | { k: 'in'; f: number; i: NetInput[] }
  | { k: 'hash'; f: number; h: number }
  | { k: 'ready'; round: number }
  | { k: 'ping'; t: number }
  | { k: 'pong'; t: number }
  | { k: 'bye' };

// 2: the shed key casts Hex in versus. 3: 48x48 wraparound board, speed-up sudden death.
// 4: hold abilities stay off once drained until released. 5: walls never kill; every board wraps.
export const PROTOCOL_VERSION = 5;

/** Cheap FNV-1a fingerprint of the parts of the state that matter for desync detection. */
export function hashGame(g: Game): number {
  let h = 2166136261;
  const mix = (n: number) => {
    h ^= n & 0xffffffff;
    h = Math.imul(h, 16777619);
  };
  mix(g.stepCount);
  mix(g.rng.state);
  for (const p of g.players) {
    mix(p.score);
    mix(p.alive ? 1 : 0);
    mix(p.body.length);
    mix(p.shedCooldown);
    mix(p.hexWarn);
    mix(p.hexed);
    mix(p.hexImmune);
    for (const s of p.body) mix(s.x * 64 + s.y);
  }
  for (const pk of g.pickups) mix(pk.pos.x * 64 + pk.pos.y);
  mix(g.shedWalls.length);
  return h >>> 0;
}

export class Lockstep {
  /** Next frame to simulate. */
  frame = 0;
  /** Next frame we will commit local input for. */
  private sent: number;
  private local = new Map<number, NetInput[]>();
  private remote = new Map<number, NetInput[]>();
  private pending: NetInput[] = [];
  private acc = 0;
  private myHashes = new Map<number, number>();
  private peerHashes = new Map<number, number>();
  desync = false;
  /** How long we've been waiting on the peer right now (ms). */
  waitingMs = 0;

  constructor(
    readonly game: Game,
    readonly me: number,
    readonly delay: number,
    private send: (m: NetMsg) => void,
  ) {
    for (let f = 0; f < delay; f++) {
      this.local.set(f, []);
      this.remote.set(f, []);
    }
    this.sent = delay;
  }

  input(i: NetInput) {
    if (this.pending.length < MAX_PENDING) this.pending.push(i);
  }

  receive(m: NetMsg) {
    if (m.k === 'in' && Number.isInteger(m.f) && Array.isArray(m.i)) {
      this.remote.set(m.f, m.i.slice(0, MAX_PENDING));
    } else if (m.k === 'hash') {
      const mine = this.myHashes.get(m.f);
      if (mine !== undefined) {
        if (mine !== m.h) this.desync = true;
        this.myHashes.delete(m.f);
      } else this.peerHashes.set(m.f, m.h);
    }
  }

  private apply(pid: number, inputs: NetInput[]) {
    const g = this.game;
    for (const i of inputs) {
      if (i.t === 'turn') g.turn(i.d, pid);
      else if (i.t === 'shed') g.shed(pid);
      else if (i.t === 'hold') g.setHeld(pid, !!i.on);
    }
  }

  /** Advance by real elapsed time. Returns the number of frames simulated. */
  tick(dtMs: number): number {
    this.acc = Math.min(this.acc + dtMs, FRAME_MS * 12);
    let n = 0;
    while (this.acc >= FRAME_MS && this.game.status === 'playing') {
      if (this.sent <= this.frame + this.delay) {
        const inputs = this.pending;
        this.pending = [];
        this.local.set(this.sent, inputs);
        this.send({ k: 'in', f: this.sent, i: inputs });
        this.sent++;
      }
      const mine = this.local.get(this.frame);
      const theirs = this.remote.get(this.frame);
      if (!mine || !theirs) {
        this.waitingMs += dtMs;
        break;
      }
      this.waitingMs = 0;
      // Same order on both peers: player 0's inputs, then player 1's.
      for (let pid = 0; pid < 2; pid++) this.apply(pid, pid === this.me ? mine : theirs);
      this.game.update(FRAME_MS);
      this.local.delete(this.frame);
      this.remote.delete(this.frame);
      if (this.frame % HASH_EVERY === 0) {
        const h = hashGame(this.game);
        const peer = this.peerHashes.get(this.frame);
        if (peer !== undefined) {
          if (peer !== h) this.desync = true;
          this.peerHashes.delete(this.frame);
        } else this.myHashes.set(this.frame, h);
        this.send({ k: 'hash', f: this.frame, h });
      }
      this.frame++;
      this.acc -= FRAME_MS;
      n++;
    }
    return n;
  }
}

/** Input delay in frames for a measured round-trip time. */
export const delayForRtt = (rttMs: number) => Math.max(3, Math.min(12, Math.ceil(rttMs / 2 / FRAME_MS) + 2));
