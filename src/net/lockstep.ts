import type { Game } from '../game/engine';
import type { Dir, SnakeClass } from '../game/types';

/**
 * Deterministic lockstep for online Versus (2-4 players). Every peer runs the same Game with the
 * same seed and exchanges only inputs. Local input is scheduled `delay` frames ahead and sent
 * immediately; a frame is simulated once every player's inputs for it are known, so the games
 * never diverge. Peers form a star around the host, which relays each guest's inputs to the
 * others (OnlineMatch does the relaying; this class just needs every player's inputs).
 */

export const FRAME_MS = 16;
const HASH_EVERY = 30;
const MAX_PENDING = 16;
/** Own hashes are kept this many frames for late peer hashes to compare against. */
const HASH_KEEP = HASH_EVERY * 40;

/** `quit` is only ever sent by the host, for a player whose connection dropped. */
export type NetInput = { t: 'turn'; d: Dir } | { t: 'shed' } | { t: 'hold'; on: boolean } | { t: 'quit' };

export type NetMsg =
  /** Guest to host on connect. */
  | { k: 'hello'; v: number; name: string; cls: SnakeClass }
  /** Host to guests: the room so far, in seat order; `you` is the receiver's seat. */
  | { k: 'lobby'; you: number; names: string[]; classes: SnakeClass[] }
  | { k: 'start'; seed: number; round: number; delay: number; you: number; names: string[]; classes: SnakeClass[] }
  /** Inputs of player `p` for frame `f` (guests send their own; the host stamps and relays). */
  | { k: 'in'; f: number; p?: number; i: NetInput[] }
  | { k: 'hash'; f: number; h: number }
  /** Guest to host: ready for the next round. Host to guests: how many are ready. */
  | { k: 'ready'; round: number; n?: number; of?: number }
  | { k: 'ping'; t: number }
  | { k: 'pong'; t: number }
  /** Host to guests: a player dropped out of the match. */
  | { k: 'left'; p: number; name: string }
  | { k: 'bye' };

// 2: the shed key casts Hex in versus. 3: 48x48 wraparound board, speed-up sudden death.
// 4: hold abilities stay off once drained until released. 5: walls never kill; every board wraps.
// 6: up to 4 players, relayed through the host.
export const PROTOCOL_VERSION = 6;

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
  /** Inputs per player, by frame. */
  private inputs: Map<number, NetInput[]>[];
  private pending: NetInput[] = [];
  private acc = 0;
  private myHashes = new Map<number, number>();
  private peerHashes = new Map<number, number[]>();
  /** Host: players who left. Their missing frames get a quit, then nothing (true once quit is sent). */
  private gone = new Map<number, boolean>();
  /** Host: inputs it made up for a player who left, to relay to the others. */
  onFill: (pid: number, f: number, inputs: NetInput[]) => void = () => {};
  desync = false;
  /** How long we've been waiting on a peer right now (ms). */
  waitingMs = 0;

  constructor(
    readonly game: Game,
    readonly me: number,
    readonly delay: number,
    private send: (m: NetMsg) => void,
  ) {
    this.inputs = game.players.map(() => new Map());
    for (let f = 0; f < delay; f++) for (const m of this.inputs) m.set(f, []);
    this.sent = delay;
  }

  input(i: NetInput) {
    if (this.pending.length < MAX_PENDING && i.t !== 'quit') this.pending.push(i);
  }

  receive(m: NetMsg) {
    if (m.k === 'in' && Number.isInteger(m.f) && Array.isArray(m.i)) {
      // Two-player messages may omit `p`: it's the other player.
      const p = m.p ?? (this.me === 0 ? 1 : 0);
      const slot = this.inputs[p];
      if (p !== this.me && slot && m.f >= this.frame && !slot.has(m.f)) slot.set(m.f, m.i.slice(0, MAX_PENDING));
    } else if (m.k === 'hash' && Number.isInteger(m.f)) {
      const mine = this.myHashes.get(m.f);
      if (mine !== undefined) {
        if (mine !== m.h) this.desync = true;
      } else {
        const list = this.peerHashes.get(m.f) ?? [];
        list.push(m.h);
        this.peerHashes.set(m.f, list);
      }
    }
  }

  /** Host: player `pid` left. From the first frame we lack their input for, they quit. */
  drop(pid: number) {
    if (pid !== this.me && this.inputs[pid] && !this.gone.has(pid)) this.gone.set(pid, false);
  }

  private apply(pid: number, inputs: NetInput[]) {
    const g = this.game;
    for (const i of inputs) {
      if (i.t === 'turn') g.turn(i.d, pid);
      else if (i.t === 'shed') g.shed(pid);
      else if (i.t === 'hold') g.setHeld(pid, !!i.on);
      else if (i.t === 'quit') g.forfeit(pid);
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
        this.inputs[this.me].set(this.sent, inputs);
        this.send({ k: 'in', f: this.sent, p: this.me, i: inputs });
        this.sent++;
      }
      for (const [pid, quit] of this.gone) {
        const slot = this.inputs[pid];
        if (slot.has(this.frame)) continue;
        const fill: NetInput[] = quit ? [] : [{ t: 'quit' }];
        this.gone.set(pid, true);
        slot.set(this.frame, fill);
        this.onFill(pid, this.frame, fill);
      }
      if (this.inputs.some((m) => !m.has(this.frame))) {
        this.waitingMs += dtMs;
        break;
      }
      this.waitingMs = 0;
      // Same order on every peer: player 0's inputs first.
      this.inputs.forEach((m, pid) => this.apply(pid, m.get(this.frame)!));
      this.game.update(FRAME_MS);
      for (const m of this.inputs) m.delete(this.frame);
      if (this.frame % HASH_EVERY === 0) {
        const h = hashGame(this.game);
        for (const peer of this.peerHashes.get(this.frame) ?? []) if (peer !== h) this.desync = true;
        this.peerHashes.delete(this.frame);
        this.myHashes.set(this.frame, h);
        this.myHashes.delete(this.frame - HASH_KEEP);
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
