import { Game } from '../game/engine';
import { MAX_PLAYERS } from '../game/modes';
import type { SnakeClass } from '../game/types';
import { CLASS_ORDER } from '../game/classes';
import { Lockstep, PROTOCOL_VERSION, delayForRtt, type NetMsg } from './lockstep';
import type { PeerLink } from './peer';

export interface OnlineHooks {
  /** A round is ready to play. */
  started(game: Game, lock: Lockstep): void;
  /** Before the match: who's in the room (seat order; `me` is your seat). */
  lobby(names: string[], me: number): void;
  /** Someone pressed "next round": how many players are ready so far. */
  peerReady(ready: number, of: number): void;
  /** A player dropped out; the match carries on without them. */
  left(name: string): void;
  /** The match is over because of the connection (not because someone won). */
  ended(reason: string): void;
}

/** Host side: one seat per player. Seat 0 is the host itself (no link). */
interface Seat {
  link: PeerLink | null;
  name: string;
  cls: SnakeClass;
  hello: boolean;
  rtt: number;
  pinged: boolean;
  ready: boolean;
  gone: boolean;
}

const cleanName = (s: unknown, fallback: string) =>
  String(s || '')
    .replace(/[^\w \-.]/g, '')
    .slice(0, 16) || fallback;

/**
 * Coordinates an online Versus match for 2-4 players. The host keeps a link to every guest and
 * relays inputs between them (a star), picks seeds, and decides when rounds start. Guests only
 * talk to the host. Matches are best of three for two players, first to three wins otherwise.
 */
export class OnlineMatch {
  me = 0;
  names: string[] = [];
  classes: SnakeClass[] = [];
  wins: number[] = [];
  round = 1;
  delay = 5;
  lock: Lockstep | null = null;
  /** The roster is fixed once the first round starts. */
  started = false;
  private seats: Seat[] = [];
  private hostLink: PeerLink | null = null;
  private hostHello = false;
  private readySelf = false;
  private done = false;

  constructor(
    readonly role: 'host' | 'guest',
    myName: string,
    myCls: SnakeClass,
    private hooks: OnlineHooks,
    /** Host: start by itself once this many players are in (quick match: 2). */
    private autoStart = 0,
  ) {
    this.myName = myName;
    this.myCls = myCls;
    if (role === 'host') {
      this.seats.push({ link: null, name: myName || 'P1', cls: myCls, hello: true, rtt: 0, pinged: true, ready: false, gone: false });
      this.syncRoster();
    }
  }

  private readonly myName: string;
  private readonly myCls: SnakeClass;

  /** Guest: attach the link to the host and say hello. */
  connect(link: PeerLink) {
    this.hostLink = link;
    link.onmessage = (m) => this.fromHost(m);
    link.onclose = () =>
      this.end(this.hostHello ? 'Lost the connection to the host.' : 'The link dropped before the match started. Both players should refresh the page and try again.');
    link.send({ k: 'hello', v: PROTOCOL_VERSION, name: this.myName, cls: this.myCls });
  }

  /** Host: a friend connected. Returns false if the room is full or the match has begun. */
  addGuest(link: PeerLink): boolean {
    if (this.started || this.done || this.seats.filter((s) => !s.gone).length >= MAX_PLAYERS) {
      link.close();
      return false;
    }
    const seat: Seat = { link, name: '', cls: 'racer', hello: false, rtt: 0, pinged: false, ready: false, gone: false };
    this.seats.push(seat);
    link.onmessage = (m) => this.fromGuest(seat, m);
    link.onclose = () => this.seatGone(seat);
    link.send({ k: 'ping', t: performance.now() });
    return true;
  }

  /** Players in the room (host: connected and greeted; guest: as last told). */
  get playerCount(): number {
    return this.role === 'host' ? this.liveSeats().length : this.names.length;
  }

  get full(): boolean {
    return this.role === 'host' && this.seats.filter((s) => !s.gone).length >= MAX_PLAYERS;
  }

  /** Round wins needed to take the match. */
  get winsNeeded(): number {
    return this.names.length >= 3 ? 3 : 2;
  }

  get matchOver(): boolean {
    return this.wins.some((w) => w >= this.winsNeeded);
  }

  /** Host: start the match now. Returns a reason if it can't. */
  start(): string | null {
    if (this.role !== 'host') return 'only the host can start.';
    if (this.started) return 'already started.';
    if (this.liveSeats().length < 2) return 'waiting for at least one friend to join.';
    this.begin();
    return null;
  }

  leave() {
    if (this.done) return;
    this.done = true;
    if (this.hostLink) this.hostLink.close();
    for (const s of this.seats) s.link?.close();
  }

  private end(reason: string) {
    if (this.done) return;
    this.done = true;
    for (const s of this.seats) s.link?.close();
    this.hooks.ended(reason);
  }

  // ---------------------------------------------------------------- host

  private liveSeats(): Seat[] {
    return this.seats.filter((s) => !s.gone && s.hello && s.pinged);
  }

  private syncRoster() {
    this.names = this.seats.map((s) => s.name);
    this.classes = this.seats.map((s) => s.cls);
  }

  private broadcast(m: NetMsg, except?: Seat) {
    for (const s of this.seats) if (s !== except && !s.gone && s.link) s.link.send(m);
  }

  private broadcastLobby() {
    if (this.started) return;
    const ready = this.seats.filter((s) => s.hello);
    const names = ready.map((s) => s.name);
    const classes = ready.map((s) => s.cls);
    ready.forEach((s, i) => s.link?.send({ k: 'lobby', you: i, names, classes }));
    this.hooks.lobby(names, 0);
  }

  private fromGuest(seat: Seat, m: NetMsg) {
    switch (m.k) {
      case 'hello': {
        if (m.v !== PROTOCOL_VERSION) {
          seat.link?.close();
          return;
        }
        let name = cleanName(m.name, `P${this.seats.indexOf(seat) + 1}`);
        // Names must tell players apart.
        while (this.seats.some((s) => s !== seat && s.hello && s.name.toLowerCase() === name.toLowerCase())) name = `${name.slice(0, 14)} ${this.seats.indexOf(seat) + 1}`;
        seat.name = name;
        seat.cls = CLASS_ORDER.includes(m.cls) ? m.cls : 'racer';
        seat.hello = true;
        this.broadcastLobby();
        this.maybeAutoStart();
        break;
      }
      case 'ping':
        seat.link?.send({ k: 'pong', t: m.t });
        break;
      case 'pong':
        seat.rtt = performance.now() - m.t;
        seat.pinged = true;
        this.maybeAutoStart();
        break;
      case 'in': {
        const p = this.seats.indexOf(seat);
        if (!this.lock || !this.started) return;
        const stamped = { k: 'in' as const, f: m.f, p, i: m.i };
        this.lock.receive(stamped);
        this.broadcast(stamped, seat);
        break;
      }
      case 'hash':
        this.lock?.receive(m);
        break;
      case 'ready':
        seat.ready = true;
        this.readyChanged();
        break;
      case 'bye':
        this.seatGone(seat);
        break;
    }
  }

  private seatGone(seat: Seat) {
    if (seat.gone || this.done) return;
    seat.gone = true;
    seat.link = null;
    if (!this.started) {
      // Before the match a seat can just be dropped.
      this.seats.splice(this.seats.indexOf(seat), 1);
      this.syncRoster();
      this.broadcastLobby();
      return;
    }
    const p = this.seats.indexOf(seat);
    this.lock?.drop(p);
    this.broadcast({ k: 'left', p, name: seat.name });
    this.hooks.left(seat.name);
    if (!this.seats.some((s) => s.link && !s.gone)) {
      this.end('Everyone else left the match.');
      return;
    }
    this.readyChanged();
  }

  private maybeAutoStart() {
    if (this.autoStart && !this.started && this.liveSeats().length >= this.autoStart) this.begin();
  }

  private begin() {
    if (!this.started) {
      // Lock the roster: anyone still mid-handshake is turned away.
      for (const s of this.seats) if (!s.gone && !(s.hello && s.pinged)) s.link?.close();
      this.seats = this.seats.filter((s) => !s.gone && s.hello && s.pinged);
      this.started = true;
      this.syncRoster();
    }
    if (this.round === 1) this.wins = this.seats.map(() => 0);
    // A guest's input reaches another guest via the host: allow for both legs.
    const rtts = this.seats
      .filter((s) => s.link && !s.gone)
      .map((s) => s.rtt)
      .sort((a, b) => b - a);
    this.delay = delayForRtt((rtts[0] ?? 0) + (rtts[1] ?? 0));
    const seed = Math.floor(Math.random() * 2 ** 32);
    this.seats.forEach((s, i) => {
      if (s.link && !s.gone) s.link.send({ k: 'start', seed, round: this.round, delay: this.delay, you: i, names: this.names, classes: this.classes });
    });
    this.newRound(seed);
  }

  private readyChanged() {
    if (this.role !== 'host' || !this.lock) return;
    const live = this.seats.filter((s) => !s.gone);
    const ready = live.filter((s, i) => (i === 0 ? this.readySelf : s.ready)).length;
    this.broadcast({ k: 'ready', round: this.round, n: ready, of: live.length });
    this.hooks.peerReady(ready, live.length);
    if (ready < live.length) return;
    if (this.matchOver) {
      this.wins = this.seats.map(() => 0);
      this.round = 1;
    } else this.round++;
    this.begin();
  }

  // ---------------------------------------------------------------- guest

  private fromHost(m: NetMsg) {
    switch (m.k) {
      case 'lobby':
        this.hostHello = true;
        this.me = m.you;
        this.names = m.names.map((n, i) => cleanName(n, `P${i + 1}`));
        this.classes = m.classes.map((c) => (CLASS_ORDER.includes(c) ? c : 'racer'));
        this.hooks.lobby(this.names, this.me);
        break;
      case 'ping':
        this.hostLink?.send({ k: 'pong', t: m.t });
        break;
      case 'start':
        this.hostHello = true;
        this.started = true;
        this.me = m.you;
        this.names = m.names.map((n, i) => cleanName(n, `P${i + 1}`));
        this.classes = m.classes.map((c) => (CLASS_ORDER.includes(c) ? c : 'racer'));
        if (m.round === 1 || this.wins.length !== this.names.length) this.wins = this.names.map(() => 0);
        this.round = m.round;
        this.delay = m.delay;
        this.newRound(m.seed);
        break;
      case 'in':
      case 'hash':
        this.lock?.receive(m);
        break;
      case 'ready':
        if (m.n !== undefined && m.of !== undefined) this.hooks.peerReady(m.n, m.of);
        break;
      case 'left':
        this.hooks.left(cleanName(m.name, `P${m.p + 1}`));
        break;
      case 'bye':
        this.end('The host left the match.');
        break;
    }
  }

  // ---------------------------------------------------------------- both

  private newRound(seed: number) {
    const game = new Game({ mode: 'versus', seed, classes: [...this.classes], players: this.names.length });
    // Set on every peer before frame 0, so it stays deterministic.
    game.banner = { title: `Round ${this.round}`, subtitle: this.names.join(' vs '), ttl: 1500 };
    const send = this.role === 'host' ? (msg: NetMsg) => this.broadcast(msg) : (msg: NetMsg) => this.hostLink?.send(msg);
    this.lock = new Lockstep(game, this.me, this.delay, send);
    if (this.role === 'host') {
      this.lock.onFill = (p, f, i) => this.broadcast({ k: 'in', f, p, i });
      this.seats.forEach((s, i) => {
        if (s.gone) this.lock!.drop(i);
        s.ready = false;
      });
    }
    this.readySelf = false;
    this.hooks.started(game, this.lock);
  }

  /** Call once when the round's game reports status 'over'. Same result on every peer. */
  recordRound(winner: number | null) {
    if (winner !== null && winner >= 0 && winner < this.wins.length) this.wins[winner]++;
  }

  /** Local player wants the next round (or a rematch). */
  ready() {
    if (this.readySelf) return;
    this.readySelf = true;
    if (this.role === 'host') this.readyChanged();
    else this.hostLink?.send({ k: 'ready', round: this.round });
  }

  get waitingForPeer(): boolean {
    return this.readySelf;
  }
}
