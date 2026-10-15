import { ARENAS, ARENA_ORDER, type Arena } from './arenas';
import { MODES, type ModeConfig } from './modes';
import { Rng } from './rng';
import {
  DIRS,
  H,
  OPPOSITE,
  W,
  add,
  eq,
  idx,
  inBounds,
  manhattan,
  wrapPos,
  type DeathCause,
  type Dir,
  type EffectKind,
  type GameEvent,
  type Mine,
  type ModeId,
  type Mouse,
  type Pickup,
  type PickupKind,
  type PowerKind,
  type Rival,
  type ShedWall,
  type Vec,
} from './types';

export const SHED_WALL_MS = 15000;
export const SHED_COOLDOWN_MS = 2500;
export const SHED_MIN_LENGTH = 6;
export const COMBO_WINDOW_MS = 2000;
export const MAX_COMBO = 4;
export const EFFECT_MS: Record<EffectKind, number> = { phase: 6000, slowmo: 5000, magnet: 8000 };
export const MINE_PERIOD_MS = 3200;
export const MINE_LIT_MS = 1100;
export const MINE_WARN_MS = 600;
const POWER_TTL_MS = 9000;
const GOLDEN_TTL_MS = 5000;
const BIT_TTL_MS = 7000;
const MOUSE_TTL_MS = 14000;
const MAZE_WARN_MS = 1800;
const MAZE_SHIFT_EVERY = 4;
const COLLAPSE_EVERY_MS = 7000;
const COLLAPSE_WARN_MS = 2000;
const COLLAPSE_MAX_RING = 7;
const RIVAL_RESPAWN_MS = 9000;
const BANNER_MS = 1600;
const SURGE_DRAIN_PER_MS = 1 / 2200;
const SURGE_REGEN_PER_MS = 1 / 30000;
const SURGE_PER_FOOD = 0.25;

const POWER_WEIGHTS: (readonly [PowerKind, number])[] = [
  ['phase', 2],
  ['slowmo', 2],
  ['magnet', 2],
  ['shrink', 1.5],
  ['golden', 1.5],
];

export interface GameOptions {
  mode: ModeId;
  seed?: number;
}

export interface RunStats {
  score: number;
  foods: number;
  maxLength: number;
  maxCombo: number;
  sheds: number;
  level: number;
  timeMs: number;
  rivalsDowned: number;
}

export class Game {
  readonly mode: ModeConfig;
  readonly rng: Rng;
  readonly seed: number;

  status: 'playing' | 'over' = 'playing';
  deathCause: DeathCause | null = null;
  time = 0;
  private acc = 0;
  private nextId = 1;

  snake: Vec[] = [];
  prevSnake: Vec[] = [];
  dir: Dir = 'right';
  queue: Dir[] = [];
  grow = 0;

  score = 0;
  foods = 0;
  levelFoods = 0;
  level = 1;
  combo = 0;
  lastEatTime = -Infinity;
  maxCombo = 0;
  maxLength = 0;
  sheds = 0;
  rivalsDowned = 0;

  arena!: Arena;
  private startArena = 0;
  /** Static solid cells: arena walls, current maze walls and the collapsed border. */
  solid = new Uint8Array(W * H);
  mazeIndex = 0;
  mazeWalls: Vec[] = [];
  pendingMaze: Vec[] | null = null;
  mazeWarn = 0;
  private mazeFoods = 0;
  ring = 0;
  collapseTimer = COLLAPSE_EVERY_MS;

  pickups: Pickup[] = [];
  shedWalls: ShedWall[] = [];
  shedCooldown = 0;
  mines: Mine[] = [];
  mice: Mouse[] = [];
  rival: Rival | null = null;
  rivalRespawn = Infinity;

  effects: Partial<Record<EffectKind, number>> = {};
  surge = 1;
  surgeHeld = false;
  private wasSurging = false;

  private powerTimer = 6000;
  private miceSkip = false;
  private mouseTimer = 9000;

  banner: { title: string; subtitle: string; ttl: number } | null = null;
  events: GameEvent[] = [];

  constructor(opts: GameOptions) {
    this.mode = MODES[opts.mode];
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
    this.rng = new Rng(this.seed);
    if (opts.mode === 'daily') this.startArena = this.seed % ARENA_ORDER.length;
    this.loadLevel(1, false);
  }

  // ---------------------------------------------------------------- input

  turn(dir: Dir) {
    if (this.status !== 'playing') return;
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if (dir === last || dir === OPPOSITE[last]) return;
    if (this.queue.length < 3) this.queue.push(dir);
  }

  setSurge(held: boolean) {
    this.surgeHeld = held;
  }

  get surging(): boolean {
    return this.mode.abilities && this.surgeHeld && this.surge > 0 && this.status === 'playing' && !this.banner;
  }

  get canShed(): boolean {
    return this.mode.abilities && this.shedCooldown <= 0 && this.snake.length >= SHED_MIN_LENGTH;
  }

  /** Drop the back half of the tail; it hardens into a temporary wall. */
  shed(): boolean {
    if (this.status !== 'playing' || this.banner || !this.canShed) return false;
    const keep = Math.max(3, Math.ceil(this.snake.length / 2));
    const removed = this.snake.splice(keep);
    this.prevSnake = this.prevSnake.slice(0, keep);
    for (const pos of removed) {
      if (!this.shedWalls.some((w) => eq(w.pos, pos))) {
        this.shedWalls.push({ pos: { ...pos }, ttl: SHED_WALL_MS, maxTtl: SHED_WALL_MS });
      }
    }
    this.sheds++;
    this.shedCooldown = SHED_COOLDOWN_MS;
    this.events.push({ type: 'shed', cells: removed });
    return true;
  }

  // ---------------------------------------------------------------- derived

  get wraps(): boolean {
    return this.arena.wrap;
  }

  get interval(): number {
    let base: number;
    if (this.mode.id === 'classic') base = Math.max(60, 135 - this.foods * 2.5);
    else if (this.mode.zen) base = 125;
    else base = Math.max(55, 130 - (this.level - 1) * 7 - this.levelFoods * 1.5);
    if (this.effects.slowmo) base *= 1.8;
    if (this.surging) base *= 0.55;
    return base;
  }

  /** Interpolation factor between the previous and current step, for rendering. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.acc / this.interval));
  }

  get lengthMult(): number {
    if (!this.mode.abilities) return 1;
    return 1 + Math.floor(Math.max(0, this.snake.length - 4) / 8) * 0.5;
  }

  get comboActive(): number {
    return this.time - this.lastEatTime <= COMBO_WINDOW_MS ? this.combo : 0;
  }

  get foodsForLevel(): number {
    return 8 + this.level * 2;
  }

  get stats(): RunStats {
    return {
      score: this.score,
      foods: this.foods,
      maxLength: this.maxLength,
      maxCombo: this.maxCombo,
      sheds: this.sheds,
      level: this.level,
      timeMs: this.time,
      rivalsDowned: this.rivalsDowned,
    };
  }

  mineLit(m: Mine, t = this.time): boolean {
    return (t + m.offset) % MINE_PERIOD_MS < MINE_LIT_MS;
  }

  /** 0..1 how close an unlit mine is to lighting up (for the warning pulse). */
  mineWarn(m: Mine, t = this.time): number {
    const phase = (t + m.offset) % MINE_PERIOD_MS;
    const until = MINE_PERIOD_MS - phase;
    return until <= MINE_WARN_MS ? 1 - until / MINE_WARN_MS : 0;
  }

  portalExit(p: Vec): Vec | null {
    for (const [a, b] of this.arena.portals) {
      if (eq(a, p)) return b;
      if (eq(b, p)) return a;
    }
    return null;
  }

  // ---------------------------------------------------------------- loop

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  update(dtMs: number) {
    if (this.status !== 'playing') return;
    const dt = Math.min(dtMs, 100);
    if (this.banner) {
      this.banner.ttl -= dt;
      if (this.banner.ttl <= 0) this.banner = null;
      return;
    }
    this.time += dt;
    this.tickTimers(dt);
    if (this.status !== 'playing') return;

    this.acc += dt;
    while (this.status === 'playing' && !this.banner && this.acc >= this.interval) {
      this.acc -= this.interval;
      this.step();
    }
    if (this.banner) this.acc = 0;
  }

  private tickTimers(dt: number) {
    for (const k of Object.keys(this.effects) as EffectKind[]) {
      const left = (this.effects[k] ?? 0) - dt;
      if (left <= 0) {
        delete this.effects[k];
        this.events.push({ type: 'expire', kind: k });
      } else this.effects[k] = left;
    }

    this.shedCooldown = Math.max(0, this.shedCooldown - dt);
    for (const w of this.shedWalls) w.ttl -= dt;
    this.shedWalls = this.shedWalls.filter((w) => w.ttl > 0);

    for (const p of this.pickups) p.ttl -= dt;
    this.pickups = this.pickups.filter((p) => p.ttl > 0);
    for (const m of this.mice) m.ttl -= dt;
    this.mice = this.mice.filter((m) => m.ttl > 0);

    const surging = this.surging;
    if (surging) this.surge = Math.max(0, this.surge - dt * SURGE_DRAIN_PER_MS);
    else this.surge = Math.min(1, this.surge + dt * SURGE_REGEN_PER_MS);
    if (surging && !this.wasSurging) this.events.push({ type: 'surge' });
    this.wasSurging = surging;

    if (this.mode.powerUps) {
      this.powerTimer -= dt;
      if (this.powerTimer <= 0) {
        this.powerTimer = this.rng.range(8000, 13000);
        const onBoard = this.pickups.some((p) => p.kind !== 'food' && p.kind !== 'bit');
        if (!onBoard) {
          const kind = this.rng.weighted(POWER_WEIGHTS);
          this.spawnPickup(kind, kind === 'golden' ? GOLDEN_TTL_MS : POWER_TTL_MS);
        }
      }
    }

    if (this.mode.hazards) {
      this.mouseTimer -= dt;
      if (this.mouseTimer <= 0) {
        this.mouseTimer = this.rng.range(12000, 18000);
        if (this.mice.length < 1 + Math.floor(this.level / 3)) this.spawnMouse();
      }
      if (!this.rival && this.level >= 3) {
        this.rivalRespawn -= dt;
        if (this.rivalRespawn <= 0) this.spawnRival();
      }
    }

    if (this.pendingMaze) {
      this.mazeWarn -= dt;
      if (this.mazeWarn <= 0) this.applyMaze();
    }

    if (this.arena.collapse && this.ring < COLLAPSE_MAX_RING) {
      this.collapseTimer -= dt;
      if (this.collapseTimer <= 0) {
        this.collapseTimer = COLLAPSE_EVERY_MS;
        this.ring++;
        this.rebuildSolid();
        this.evictFromSolid();
        this.events.push({ type: 'collapse', ring: this.ring });
      }
    }
  }

  /** True during the warning window before the next ring closes. */
  get collapseWarning(): boolean {
    return this.arena.collapse && this.ring < COLLAPSE_MAX_RING && this.collapseTimer <= COLLAPSE_WARN_MS;
  }

  // ---------------------------------------------------------------- step

  step() {
    this.prevSnake = this.snake.map((s) => ({ ...s }));
    if (this.rival) this.rival.prevBody = this.rival.body.map((s) => ({ ...s }));
    for (const m of this.mice) m.prev = { ...m.pos };

    const next = this.queue.shift();
    if (next) this.dir = next;

    let head = add(this.snake[0], DIRS[this.dir]);
    if (!inBounds(head)) {
      if (this.wraps) head = wrapPos(head);
      else return this.die('wall', this.snake[0]);
    }
    const exit = this.portalExit(head);
    if (exit) {
      this.events.push({ type: 'portal', from: head, to: exit });
      head = { ...exit };
    }

    if (this.solid[idx(head)]) return this.die('wall', head);

    const shedIdx = this.shedWalls.findIndex((w) => eq(w.pos, head));
    if (shedIdx >= 0) {
      if (this.mode.zen) this.shedWalls.splice(shedIdx, 1);
      else return this.die('shed', head);
    }

    if (this.mines.some((m) => eq(m.pos, head) && this.mineLit(m))) return this.die('mine', head);

    if (this.rival?.body.some((s) => eq(s, head))) {
      if (eq(this.rival.body[0], head) && this.snake.length >= this.rival.body.length) {
        this.killRival(true);
      } else return this.die('rival', head);
    }

    // The tail tip moves out of the way this step unless we're growing.
    const checkLen = this.grow > 0 ? this.snake.length : this.snake.length - 1;
    for (let i = 1; i < checkLen; i++) {
      if (!eq(this.snake[i], head)) continue;
      if (this.effects.phase) break;
      if (this.mode.zen) {
        const cut = this.snake.splice(i);
        this.prevSnake = this.prevSnake.slice(0, i);
        this.grow = 0;
        this.events.push({ type: 'cut', cells: cut });
        break;
      }
      return this.die('self', head);
    }

    this.snake.unshift(head);
    if (this.grow > 0) this.grow--;
    else this.snake.pop();
    this.maxLength = Math.max(this.maxLength, this.snake.length);

    this.eatAt(head);
    if (this.status !== 'playing' || this.banner) return;

    if (this.rival) this.stepRival();
    if (this.status !== 'playing') return;
    this.stepMice();
    if (this.effects.magnet) this.stepMagnet();
  }

  private die(cause: DeathCause, pos: Vec) {
    this.status = 'over';
    this.deathCause = cause;
    this.surgeHeld = false;
    this.events.push({ type: 'die', pos, cause, cells: this.snake.map((s) => ({ ...s })) });
  }

  // ---------------------------------------------------------------- eating

  private eatAt(head: Vec) {
    const pi = this.pickups.findIndex((p) => eq(p.pos, head));
    if (pi >= 0) {
      const [p] = this.pickups.splice(pi, 1);
      this.consume(p);
    }
    const mi = this.mice.findIndex((m) => eq(m.pos, head));
    if (mi >= 0) {
      this.mice.splice(mi, 1);
      const points = Math.round(25 * this.lengthMult);
      this.score += points;
      this.grow += 2;
      this.events.push({ type: 'mouse', pos: head, points });
    }
  }

  private consume(p: Pickup) {
    if (p.kind === 'food' || p.kind === 'bit' || p.kind === 'golden') {
      if (this.mode.abilities) {
        this.combo = this.time - this.lastEatTime <= COMBO_WINDOW_MS ? Math.min(MAX_COMBO, this.combo + 1) : 1;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        if (this.combo > 1) this.events.push({ type: 'combo', pos: p.pos, combo: this.combo });
      }
      this.lastEatTime = this.time;
      const base = p.kind === 'golden' ? 50 : p.kind === 'bit' ? 5 : 10;
      const mult = (this.mode.abilities ? this.combo : 1) * this.lengthMult * (this.surging ? 2 : 1);
      const points = Math.round(base * mult);
      this.score += points;
      this.grow += p.kind === 'golden' ? 3 : 1;
      this.events.push({ type: 'eat', pos: p.pos, points, mult, kind: p.kind });

      if (p.kind === 'bit') return;
      this.surge = Math.min(1, this.surge + SURGE_PER_FOOD);
      this.foods++;
      if (p.kind === 'food') this.spawnPickup('food', Infinity);
      this.afterFood();
      return;
    }

    this.events.push({ type: 'power', pos: p.pos, kind: p.kind });
    if (p.kind === 'shrink') {
      const remove = Math.min(3, Math.max(0, this.snake.length - 3));
      const cells = this.snake.splice(this.snake.length - remove, remove);
      this.prevSnake = this.prevSnake.slice(0, this.snake.length);
      this.grow = 0;
      this.events.push({ type: 'shrink', cells });
      return;
    }
    this.effects[p.kind] = EFFECT_MS[p.kind];
  }

  private afterFood() {
    if (this.arena.mazes.length) {
      this.mazeFoods++;
      if (this.mazeFoods >= MAZE_SHIFT_EVERY && !this.pendingMaze) {
        this.mazeFoods = 0;
        this.mazeIndex = (this.mazeIndex + 1) % this.arena.mazes.length;
        this.pendingMaze = this.arena.mazes[this.mazeIndex];
        this.mazeWarn = MAZE_WARN_MS;
      }
    }
    if (this.mode.levels) {
      this.levelFoods++;
      if (this.levelFoods >= this.foodsForLevel) {
        const bonus = this.snake.length * 10 * this.level;
        this.score += bonus;
        this.events.push({ type: 'levelup', level: this.level + 1, bonus });
        this.loadLevel(this.level + 1, true);
      }
    }
  }

  // ---------------------------------------------------------------- levels

  private loadLevel(level: number, showBanner: boolean) {
    this.level = level;
    this.levelFoods = 0;
    const arenaId = this.mode.levels
      ? ARENA_ORDER[(this.startArena + level - 1) % ARENA_ORDER.length]
      : this.mode.arena;
    this.arena = ARENAS[arenaId];
    this.mazeIndex = 0;
    this.mazeFoods = 0;
    this.mazeWalls = this.arena.mazes.length ? this.arena.mazes[0] : [];
    this.pendingMaze = null;
    this.ring = 0;
    this.collapseTimer = COLLAPSE_EVERY_MS;
    this.rebuildSolid();

    this.snake = [
      { x: 5, y: 12 },
      { x: 4, y: 12 },
      { x: 3, y: 12 },
      { x: 2, y: 12 },
    ];
    this.prevSnake = this.snake.map((s) => ({ ...s }));
    this.dir = 'right';
    this.queue = [];
    this.grow = 0;
    this.acc = 0;
    this.maxLength = Math.max(this.maxLength, this.snake.length);

    this.pickups = [];
    this.shedWalls = [];
    this.mice = [];
    this.mines = [];
    this.rival = null;
    this.effects = {};
    this.combo = 0;
    this.lastEatTime = -Infinity;

    if (this.mode.hazards && level >= 2) {
      const count = Math.min(level, 6);
      for (let i = 0; i < count; i++) {
        const pos = this.freeCell(6);
        if (pos) this.mines.push({ pos, offset: this.rng.int(MINE_PERIOD_MS) });
      }
    }
    this.rivalRespawn = this.mode.hazards && level >= 3 ? 3000 : Infinity;

    this.spawnPickup('food', Infinity);
    this.powerTimer = this.rng.range(5000, 8000);
    this.mouseTimer = this.rng.range(7000, 11000);

    if (showBanner) {
      this.banner = { title: `Level ${level}`, subtitle: this.arena.name, ttl: BANNER_MS };
    }
  }

  private rebuildSolid() {
    this.solid.fill(0);
    for (const w of this.arena.walls) this.solid[idx(w)] = 1;
    for (const w of this.mazeWalls) this.solid[idx(w)] = 1;
    const r = this.ring;
    if (r > 0) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (x < r || y < r || x >= W - r || y >= H - r) this.solid[y * W + x] = 1;
        }
      }
    }
  }

  /** Move or drop anything now sitting inside a solid cell. */
  private evictFromSolid() {
    const inSolid = (p: Vec) => this.solid[idx(p)] === 1;
    const lost = this.pickups.filter((p) => inSolid(p.pos));
    this.pickups = this.pickups.filter((p) => !inSolid(p.pos));
    for (const p of lost) {
      if (p.kind === 'food') this.spawnPickup('food', Infinity);
    }
    this.shedWalls = this.shedWalls.filter((w) => !inSolid(w.pos));
    this.mines = this.mines.filter((m) => !inSolid(m.pos));
    this.mice = this.mice.filter((m) => !inSolid(m.pos));
    if (this.rival && inSolid(this.rival.body[0])) this.killRival(false);
  }

  private applyMaze() {
    const next = this.pendingMaze ?? [];
    this.pendingMaze = null;
    // Never drop a wall onto a living thing.
    const occupied = (p: Vec) =>
      this.snake.some((s) => eq(s, p)) || (this.rival?.body.some((s) => eq(s, p)) ?? false);
    this.mazeWalls = next.filter((p) => !occupied(p));
    this.rebuildSolid();
    this.evictFromSolid();
    this.events.push({ type: 'shift' });
  }

  // ---------------------------------------------------------------- spawning

  /** Cell free of everything; optionally at least `minDist` from the snake head. */
  freeCell(minDist = 3): Vec | null {
    const head = this.snake[0];
    const ok = (p: Vec) => {
      if (this.solid[idx(p)]) return false;
      if (head && manhattan(p, head) < minDist) return false;
      if (this.collapseWarning && this.inNextRing(p)) return false;
      if (this.pendingMaze?.some((w) => eq(w, p))) return false;
      if (this.portalExit(p)) return false;
      if (this.snake.some((s) => eq(s, p))) return false;
      if (this.pickups.some((s) => eq(s.pos, p))) return false;
      if (this.shedWalls.some((s) => eq(s.pos, p))) return false;
      if (this.mines.some((s) => eq(s.pos, p))) return false;
      if (this.mice.some((s) => eq(s.pos, p))) return false;
      if (this.rival?.body.some((s) => eq(s, p))) return false;
      // Keep the spawn lane clear so a fresh level never starts on a hazard.
      if (p.y === 12 && head && head.x === 5 && head.y === 12) return false;
      return true;
    };
    for (let i = 0; i < 200; i++) {
      const p = { x: this.rng.int(W), y: this.rng.int(H) };
      if (ok(p)) return p;
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (ok({ x, y })) return { x, y };
    }
    return minDist > 0 ? this.freeCell(0) : null;
  }

  private inNextRing(p: Vec): boolean {
    const r = this.ring + 1;
    return p.x < r || p.y < r || p.x >= W - r || p.y >= H - r;
  }

  private spawnPickup(kind: PickupKind, ttl: number, at?: Vec) {
    const pos = at ?? this.freeCell(3);
    if (!pos) return;
    this.pickups.push({ id: this.nextId++, kind, pos, ttl, maxTtl: ttl });
  }

  private spawnMouse() {
    const pos = this.freeCell(6);
    if (pos) this.mice.push({ id: this.nextId++, pos, prev: { ...pos }, ttl: MOUSE_TTL_MS });
  }

  // ---------------------------------------------------------------- critters

  private blockedForCritter(p: Vec, self?: Vec[]): boolean {
    if (!inBounds(p)) return true;
    if (this.solid[idx(p)]) return true;
    if (this.portalExit(p)) return true;
    if (this.shedWalls.some((w) => eq(w.pos, p))) return true;
    if (this.mines.some((m) => eq(m.pos, p))) return true;
    if (this.snake.some((s) => eq(s, p))) return true;
    if (this.collapseWarning && this.inNextRing(p)) return true;
    if (self) {
      for (let i = 0; i < self.length - 1; i++) if (eq(self[i], p)) return true;
    }
    return false;
  }

  private neighbour(p: Vec, d: Dir): Vec {
    const n = add(p, DIRS[d]);
    return this.wraps ? wrapPos(n) : n;
  }

  private stepMice() {
    // Mice move every other step.
    this.miceSkip = !this.miceSkip;
    if (!this.mice.length || this.miceSkip) return;
    const head = this.snake[0];
    for (const m of this.mice) {
      const options = (Object.keys(DIRS) as Dir[])
        .map((d) => this.neighbour(m.pos, d))
        .filter(
          (p) =>
            !this.blockedForCritter(p) &&
            !this.pickups.some((q) => eq(q.pos, p)) &&
            !this.mice.some((o) => o !== m && eq(o.pos, p)) &&
            !(this.rival?.body.some((s) => eq(s, p)) ?? false),
        );
      if (!options.length) continue;
      const pick =
        this.rng.next() < 0.25
          ? this.rng.pick(options)
          : options.reduce((best, p) => (manhattan(p, head) > manhattan(best, head) ? p : best));
      m.pos = pick;
    }
  }

  private stepMagnet() {
    const head = this.snake[0];
    for (const p of this.pickups) {
      if (p.kind !== 'food' && p.kind !== 'bit' && p.kind !== 'golden') continue;
      const dist = manhattan(p.pos, head);
      if (dist > 6 || dist <= 1) continue;
      const dx = Math.sign(head.x - p.pos.x);
      const dy = Math.sign(head.y - p.pos.y);
      const tries: Vec[] =
        Math.abs(head.x - p.pos.x) >= Math.abs(head.y - p.pos.y)
          ? [{ x: p.pos.x + dx, y: p.pos.y }, { x: p.pos.x, y: p.pos.y + dy }]
          : [{ x: p.pos.x, y: p.pos.y + dy }, { x: p.pos.x + dx, y: p.pos.y }];
      for (const t of tries) {
        if (eq(t, p.pos)) continue;
        const occupied =
          this.blockedForCritter(t) ||
          this.pickups.some((q) => eq(q.pos, t)) ||
          (this.rival?.body.some((s) => eq(s, t)) ?? false);
        if (!occupied) {
          p.pos = t;
          break;
        }
      }
    }
  }

  private spawnRival() {
    const head = this.snake[0];
    for (let tries = 0; tries < 80; tries++) {
      const start = { x: this.rng.int(W), y: this.rng.int(H) };
      const dir = this.rng.pick(Object.keys(DIRS) as Dir[]);
      const back = DIRS[OPPOSITE[dir]];
      const body: Vec[] = [];
      for (let i = 0; i < 4; i++) body.push({ x: start.x + back.x * i, y: start.y + back.y * i });
      if (manhattan(start, head) < 9) continue;
      if (body.some((p) => this.blockedForCritter(p) || this.pickups.some((q) => eq(q.pos, p)))) continue;
      if (this.blockedForCritter(this.neighbour(start, dir))) continue;
      this.rival = { body, prevBody: body.map((p) => ({ ...p })), dir, grow: 0 };
      this.rivalRespawn = RIVAL_RESPAWN_MS;
      return;
    }
    this.rivalRespawn = 1000;
  }

  private rivalBlocked(p: Vec, body: Vec[]): boolean {
    return this.blockedForCritter(p, body);
  }

  /** BFS towards the nearest food; falls back to any safe move. */
  private rivalChoose(r: Rival): Dir | null {
    const head = r.body[0];
    const dirs = (Object.keys(DIRS) as Dir[]).filter((d) => d !== OPPOSITE[r.dir]);
    const safe = dirs.filter((d) => !this.rivalBlocked(this.neighbour(head, d), r.body));
    if (!safe.length) return null;
    if (this.rng.next() < 0.12) return this.rng.pick(safe);

    const targets = new Set(
      this.pickups.filter((p) => p.kind === 'food' || p.kind === 'bit').map((p) => idx(p.pos)),
    );
    if (targets.size) {
      const seen = new Uint8Array(W * H);
      seen[idx(head)] = 1;
      const queue: { p: Vec; first: Dir }[] = [];
      for (const d of safe) {
        const n = this.neighbour(head, d);
        if (seen[idx(n)]) continue;
        seen[idx(n)] = 1;
        queue.push({ p: n, first: d });
      }
      for (let qi = 0; qi < queue.length; qi++) {
        const { p, first } = queue[qi];
        if (targets.has(idx(p))) return first;
        for (const d of Object.keys(DIRS) as Dir[]) {
          const n = this.neighbour(p, d);
          if (!inBounds(n) || seen[idx(n)] || this.rivalBlocked(n, r.body)) continue;
          seen[idx(n)] = 1;
          queue.push({ p: n, first });
        }
      }
    }
    return safe.includes(r.dir) ? r.dir : this.rng.pick(safe);
  }

  private stepRival() {
    const r = this.rival!;
    const d = this.rivalChoose(r);
    if (!d) return this.killRival(this.isAdjacentToPlayer(r.body[0]));
    r.dir = d;
    const nh = this.neighbour(r.body[0], d);
    const playerHead = this.snake[0];
    if (eq(nh, playerHead)) {
      if (this.snake.length >= r.body.length) return this.killRival(true);
      return this.die('rival', nh);
    }
    if (this.snake.some((s) => eq(s, nh))) return this.killRival(true);
    r.body.unshift(nh);
    if (r.grow > 0) r.grow--;
    else r.body.pop();

    const pi = this.pickups.findIndex((p) => eq(p.pos, nh) && (p.kind === 'food' || p.kind === 'bit'));
    if (pi >= 0) {
      const [p] = this.pickups.splice(pi, 1);
      r.grow++;
      this.events.push({ type: 'rivalEat', pos: nh });
      if (p.kind === 'food') this.spawnPickup('food', Infinity);
    }
  }

  private isAdjacentToPlayer(p: Vec): boolean {
    return this.snake.some((s) => manhattan(s, p) <= 1) || this.shedWalls.some((w) => manhattan(w.pos, p) <= 1);
  }

  private killRival(byPlayer: boolean) {
    const r = this.rival;
    if (!r) return;
    this.rival = null;
    this.rivalRespawn = RIVAL_RESPAWN_MS;
    const points = byPlayer ? Math.round(40 * this.lengthMult) : 0;
    if (byPlayer) {
      this.score += points;
      this.rivalsDowned++;
    }
    for (let i = 1; i < r.body.length; i += 2) {
      const p = r.body[i];
      if (inBounds(p) && !this.solid[idx(p)] && !this.pickups.some((q) => eq(q.pos, p)) && !this.snake.some((s) => eq(s, p))) {
        this.spawnPickup('bit', BIT_TTL_MS, { ...p });
      }
    }
    this.events.push({ type: 'rivalDie', cells: r.body, byPlayer, points });
  }
}
