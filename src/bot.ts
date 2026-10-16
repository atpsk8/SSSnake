import { HEX_COST, type Game, type Player } from './game/engine';
import { Rng } from './game/rng';
import { DIRS, DIR_LIST, OPPOSITE, add, manhattan, type Dir, type Vec } from './game/types';
import type { Input } from './replay';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Personality = 'hunter' | 'collector' | 'trickster';

const REACTION_MS: Record<Difficulty, number> = { easy: 240, normal: 120, hard: 40 };
const NOISE: Record<Difficulty, number> = { easy: 3.5, normal: 1.2, hard: 0.15 };
const BLUNDER: Record<Difficulty, number> = { easy: 0.12, normal: 0.03, hard: 0 };
/** Chance per decision to cast a hex when the moment is right, and to steer through one. */
const HEX_EAGER: Record<Difficulty, number> = { easy: 0.15, normal: 0.35, hard: 0.6 };
const HEX_COPE: Record<Difficulty, number> = { easy: 0, normal: 0.6, hard: 1 };

/**
 * CPU opponent for Versus. Each decision scores the possible moves: deadly moves are out,
 * moves into pockets smaller than its own body are heavily penalised (flood fill), and the
 * rest are ranked by distance to a target that depends on the personality. Difficulty sets
 * reaction time, noise and the occasional blunder.
 */
export class Bot {
  private wait = 0;
  private rng: Rng;
  private holding = false;

  constructor(
    readonly pid: number,
    readonly difficulty: Difficulty,
    readonly personality: Personality,
    seed: number,
  ) {
    this.rng = new Rng(seed ^ 0x5eed);
  }

  get label() {
    return `cpu ${this.personality} (${this.difficulty})`;
  }

  /** Inputs to send this frame. */
  think(g: Game, dtMs: number): Input[] {
    const me = g.players[this.pid];
    if (!me?.alive || g.status !== 'playing' || g.banner) return [];
    this.wait -= dtMs;
    if (this.wait > 0) return [];
    this.wait = REACTION_MS[this.difficulty] * (0.7 + this.rng.next() * 0.6);

    const out: Input[] = [];
    const opp = g.players.find((p) => p.id !== this.pid && p.alive);
    const blocked = this.blockedMap(g, me);
    const target = this.target(g, me, opp);

    let best: { d: Dir; score: number } | null = null;
    const facing = me.queue.length ? me.queue[me.queue.length - 1] : me.dir;
    for (const d of DIR_LIST) {
      if (d === OPPOSITE[facing]) continue;
      const c = this.step(g, me.body[0], d);
      let score: number;
      if (!c || blocked[g.ix(c)]) score = -1e9;
      else {
        const space = this.flood(g, c, blocked, me.body.length + 20);
        score = space < me.body.length ? -1e6 + space : 0;
        score += target ? -manhattan(c, target) : 0;
        score += Math.min(space, 60) * 0.03;
        if (d === facing) score += 0.4;
        score += (this.rng.next() - 0.5) * NOISE[this.difficulty];
      }
      if (!best || score > best.score) best = { d, score };
    }
    if (best && this.rng.next() < BLUNDER[this.difficulty]) {
      // A human-ish mistake: pick any non-reverse direction.
      const opts = DIR_LIST.filter((d) => d !== OPPOSITE[facing]);
      best = { d: this.rng.pick(opts), score: 0 };
    }
    if (best && best.d !== facing) {
      // Hexed controls are flipped; a good player presses the opposite key on purpose.
      const flip = me.hexed > 0 && this.rng.next() < HEX_COPE[this.difficulty];
      out.push({ p: this.pid, t: 'turn', d: flip ? OPPOSITE[best.d] : best.d });
    }

    if (g.mode.hex) {
      if (opp && g.canHexP(me) && this.hexMoment(g, me, opp) && this.rng.next() < HEX_EAGER[this.difficulty]) {
        out.push({ p: this.pid, t: 'shed' });
      }
    } else if (opp && g.canShedP(me)) {
      // Shed to wall off a chasing opponent (trickster) or to escape a tight spot.
      const tail = me.body[me.body.length - 1];
      const chasing = manhattan(opp.body[0], tail) <= 3;
      const cramped = best !== null && best.score < -1e5;
      if ((this.personality === 'trickster' && chasing && this.rng.next() < 0.5) || (cramped && this.rng.next() < 0.6)) {
        out.push({ p: this.pid, t: 'shed' });
      }
    }

    // Surge toward food on a clear straight line (normal / hard).
    const wantSurge =
      this.difficulty !== 'easy' &&
      !!target &&
      me.meter > 0.35 &&
      best !== null &&
      best.score > -1e5 &&
      (me.body[0].x === target.x || me.body[0].y === target.y);
    if (wantSurge !== this.holding) {
      this.holding = wantSurge;
      out.push({ p: this.pid, t: 'hold', on: wantSurge });
    }
    return out;
  }

  /** Hex when it hurts most: the opponent is about to hit something, racing us for food, or close by. */
  private hexMoment(g: Game, me: Player, opp: Player): boolean {
    const head = opp.body[0];
    const blocked = this.blockedMap(g, opp);
    const ahead1 = this.step(g, head, opp.dir);
    const ahead2 = ahead1 && this.step(g, ahead1, opp.dir);
    const tight = !ahead1 || !!blocked[g.ix(ahead1)] || !ahead2 || !!blocked[g.ix(ahead2)];
    const food = g.pickups.filter((p) => p.kind !== 'rot');
    const racing = food.some((f) => manhattan(f.pos, head) <= 3 && manhattan(f.pos, head) < manhattan(f.pos, me.body[0]));
    // Up close, paying for a hex mustn't leave us the shorter snake in a head-on.
    const close = manhattan(head, me.body[0]) <= 5 && me.body.length - HEX_COST > opp.body.length;
    if (tight) return true;
    // Otherwise only when we can afford the length: falling behind loses head-on fights.
    if (me.body.length - HEX_COST < opp.body.length - 2) return false;
    return this.personality === 'collector' ? racing : racing || close;
  }

  private target(g: Game, me: Player, opp: Player | undefined): Vec | null {
    const head = me.body[0];
    const foods = g.pickups.filter((p) => p.kind !== 'rot');
    const nearest = foods.reduce<Vec | null>((b, p) => (!b || manhattan(p.pos, head) < manhattan(b, head) ? p.pos : b), null);
    if (opp && this.personality === 'hunter' && me.body.length >= opp.body.length - 2) {
      // Aim a couple of cells ahead of the opponent to cut them off.
      const d = DIRS[opp.dir];
      const ahead = { x: opp.body[0].x + d.x * 3, y: opp.body[0].y + d.y * 3 };
      if (g.inb(ahead) && manhattan(ahead, head) < 12) return ahead;
    }
    if (opp && this.personality === 'trickster' && nearest && manhattan(nearest, opp.body[0]) < manhattan(nearest, head)) {
      // Losing the race for food: hang around the opponent's path instead.
      return opp.body[Math.min(2, opp.body.length - 1)];
    }
    return nearest;
  }

  private step(g: Game, from: Vec, d: Dir): Vec | null {
    let c = add(from, DIRS[d]);
    if (!g.inb(c) || (g.wraps && g.inRing(c))) {
      if (!g.wraps) return null;
      c = g.wrapAt(c);
    }
    return g.portalExit(c) ?? c;
  }

  private blockedMap(g: Game, me: Player): Uint8Array {
    const b = new Uint8Array(g.w * g.h);
    for (let i = 0; i < b.length; i++) b[i] = g.solid[i];
    for (const w of g.shedWalls) b[g.ix(w.pos)] = 1;
    for (const m of g.mines) b[g.ix(m.pos)] = 1;
    for (const c of g.bossCells()) b[g.ix(c)] = 1;
    for (const p of g.players) {
      if (!p.alive) continue;
      // Our own tail tip moves out of the way.
      const len = p === me ? p.body.length - 1 : p.body.length;
      for (let i = 0; i < len; i++) b[g.ix(p.body[i])] = 1;
      // Avoid head-on collisions with a bigger snake.
      if (p !== me && p.body.length >= me.body.length) {
        for (const d of DIR_LIST) {
          const c = add(p.body[0], DIRS[d]);
          if (g.inb(c)) b[g.ix(c)] = 1;
        }
      }
    }
    if (g.rival) for (const s of g.rival.body) b[g.ix(s)] = 1;
    return b;
  }

  private flood(g: Game, start: Vec, blocked: Uint8Array, limit: number): number {
    const seen = new Uint8Array(g.w * g.h);
    const stack = [start];
    seen[g.ix(start)] = 1;
    let n = 0;
    while (stack.length && n < limit) {
      const c = stack.pop()!;
      n++;
      for (const d of DIR_LIST) {
        let nx = add(c, DIRS[d]);
        if (!g.inb(nx)) {
          if (!g.wraps) continue;
          nx = g.wrapAt(nx);
        }
        const i = g.ix(nx);
        if (seen[i] || blocked[i]) continue;
        seen[i] = 1;
        stack.push(nx);
      }
    }
    return n;
  }
}

export const PERSONALITIES: Personality[] = ['hunter', 'collector', 'trickster'];
