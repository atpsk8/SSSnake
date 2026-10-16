import { Game } from '../game/engine';
import type { SnakeClass } from '../game/types';
import { CLASS_ORDER } from '../game/classes';
import { Lockstep, PROTOCOL_VERSION, delayForRtt, type NetMsg } from './lockstep';
import type { PeerLink } from './peer';

export interface OnlineHooks {
  /** A round is ready to play. */
  started(game: Game, lock: Lockstep): void;
  /** The opponent pressed "next round". */
  peerReady(): void;
  /** The match is over because of the connection (not because someone won). */
  ended(reason: string): void;
}

/**
 * Coordinates an online Versus match over a PeerLink: hello + ping handshake, round starts
 * (the host picks seeds), wins, and best-of-three rematches. Player 1 is the host.
 */
export class OnlineMatch {
  readonly me: 0 | 1;
  names: [string, string] = ['P1', 'P2'];
  classes: [SnakeClass, SnakeClass] = ['racer', 'racer'];
  wins: [number, number] = [0, 0];
  round = 1;
  delay = 5;
  lock: Lockstep | null = null;
  rtt = 0;
  private peerHello = false;
  private pinged = false;
  private readySelf = false;
  private readyPeer = false;
  private done = false;

  constructor(
    readonly role: 'host' | 'guest',
    private link: PeerLink,
    myName: string,
    myCls: SnakeClass,
    private hooks: OnlineHooks,
  ) {
    this.me = role === 'host' ? 0 : 1;
    this.names[this.me] = myName || `P${this.me + 1}`;
    this.classes[this.me] = myCls;
    link.onmessage = (m) => this.receive(m);
    // Dropping before the hello usually means the other side is on an older build and hung up.
    link.onclose = () =>
      this.end(this.peerHello ? 'Connection lost.' : 'The link dropped before the match started. Both players should refresh the page and try again.');
    link.send({ k: 'hello', v: PROTOCOL_VERSION, name: myName, cls: myCls });
    if (role === 'host') link.send({ k: 'ping', t: performance.now() });
  }

  get them(): 0 | 1 {
    return this.me === 0 ? 1 : 0;
  }

  get matchOver(): boolean {
    return this.wins[0] >= 2 || this.wins[1] >= 2;
  }

  private end(reason: string) {
    if (this.done) return;
    this.done = true;
    this.hooks.ended(reason);
  }

  leave() {
    this.done = true;
    this.link.close();
  }

  private receive(m: NetMsg) {
    switch (m.k) {
      case 'hello': {
        if (m.v !== PROTOCOL_VERSION) {
          this.link.close();
          this.end('Your opponent is running a different version. Both of you should refresh.');
          return;
        }
        this.names[this.them] = String(m.name || '').replace(/[^\w \-.]/g, '').slice(0, 16) || `P${this.them + 1}`;
        // Two players with the same name would be indistinguishable.
        if (this.names[0].toLowerCase() === this.names[1].toLowerCase()) this.names = [`${this.names[0]} 1`, `${this.names[1]} 2`];
        this.classes[this.them] = CLASS_ORDER.includes(m.cls) ? m.cls : 'racer';
        this.peerHello = true;
        this.maybeBegin();
        break;
      }
      case 'ping':
        this.link.send({ k: 'pong', t: m.t });
        break;
      case 'pong':
        this.rtt = performance.now() - m.t;
        this.delay = delayForRtt(this.rtt);
        this.pinged = true;
        this.maybeBegin();
        break;
      case 'start':
        if (this.role !== 'guest') return;
        if (m.round === 1) this.wins = [0, 0];
        this.round = m.round;
        this.delay = m.delay;
        this.newRound(m.seed);
        break;
      case 'in':
      case 'hash':
        this.lock?.receive(m);
        break;
      case 'ready':
        this.readyPeer = true;
        this.hooks.peerReady();
        this.maybeNext();
        break;
      case 'bye':
        this.end('Your opponent left the match.');
        break;
    }
  }

  private maybeBegin() {
    if (this.role === 'host' && this.peerHello && this.pinged && !this.lock) this.begin();
  }

  private begin() {
    const seed = Math.floor(Math.random() * 2 ** 32);
    this.link.send({ k: 'start', seed, round: this.round, delay: this.delay });
    this.newRound(seed);
  }

  private newRound(seed: number) {
    const game = new Game({ mode: 'versus', seed, classes: [...this.classes] });
    // Set on both peers before frame 0, so it stays deterministic.
    game.banner = { title: `Round ${this.round}`, subtitle: `${this.names[0]} vs ${this.names[1]}`, ttl: 1500 };
    this.lock = new Lockstep(game, this.me, this.delay, (msg) => this.link.send(msg));
    this.readySelf = false;
    this.readyPeer = false;
    this.hooks.started(game, this.lock);
  }

  /** Call once when the round's game reports status 'over'. Same result on both peers. */
  recordRound(winner: number | null) {
    if (winner !== null && winner >= 0) this.wins[winner as 0 | 1]++;
  }

  /** Local player wants the next round (or a rematch). */
  ready() {
    if (this.readySelf) return;
    this.readySelf = true;
    this.link.send({ k: 'ready', round: this.round });
    this.maybeNext();
  }

  get waitingForPeer(): boolean {
    return this.readySelf && !this.readyPeer;
  }

  private maybeNext() {
    if (this.role !== 'host' || !this.readySelf || !this.readyPeer) return;
    if (this.matchOver) {
      this.wins = [0, 0];
      this.round = 1;
    } else this.round++;
    this.begin();
  }
}
