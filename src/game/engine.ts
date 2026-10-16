import { ARENA_ORDER, type Arena } from './arenas';
import { CLASSES } from './classes';
import { findEnclosed } from './coil';
import { arcadeLevel, levelFromData, simpleLevel, type LevelData, type LevelSpec } from './levels';
import { MODES, type ModeConfig } from './modes';
import { MUTATIONS, MUTATION_LIST } from './mutations';
import { Rng } from './rng';
import { biomeAt, generateWorld, type Biome, type BiomeId, type Treasure, type World } from './world';
import {
  DIRS,
  DIR_LIST,
  H,
  OPPOSITE,
  W,
  add,
  chebyshev,
  eq,
  manhattan,
  type Arrow,
  type BossKind,
  type DeathCause,
  type Dir,
  type EffectKind,
  type GameEvent,
  type Mine,
  type ModeId,
  type ModifierId,
  type Mouse,
  type MutationId,
  type Pickup,
  type PickupKind,
  type PowerKind,
  type Projectile,
  type Rival,
  type ShedWall,
  type SnakeClass,
  type Vec,
} from './types';

export const SHED_WALL_MS = 15000;
export const SHED_COOLDOWN_MS = 2500;
export const SHED_MIN_LENGTH = 6;
/** Versus Hex: the shed key flips the opponent's controls instead of shedding. */
export const HEX_COOLDOWN_MS = 8000;
const HEX_SUDDEN_DEATH_COOLDOWN_MS = 5000;
export const HEX_COST = 2;
export const HEX_MIN_LENGTH = 6;
/** The victim flashes this long before the hex lands, so it can be read. */
export const HEX_WARN_MS = 400;
export const HEX_MS = 2500;
/** After a hex wears off the victim can't be hexed again for this long. */
export const HEX_IMMUNE_MS = 3000;
/** No hexes in the opening seconds of a round. */
const HEX_GRACE_MS = 3000;
export const COMBO_WINDOW_MS = 2000;
export const MAX_COMBO = 4;
export const EFFECT_MS: Record<EffectKind, number> = { phase: 6000, slowmo: 5000, magnet: 8000 };
export const MINE_PERIOD_MS = 3200;
export const MINE_LIT_MS = 1100;
export const MINE_WARN_MS = 600;
export const RHYTHM_WINDOW_MS = 55;
const POWER_TTL_MS = 9000;
const GOLDEN_TTL_MS = 5000;
const BIT_TTL_MS = 7000;
const MOUSE_TTL_MS = 14000;
const ROT_TTL_MS = 8000;
const RIPEN_MS = 20000;
const MAZE_WARN_MS = 1800;
const MAZE_SHIFT_EVERY = 4;
const COLLAPSE_EVERY_MS = 7000;
const COLLAPSE_WARN_MS = 2000;
const COLLAPSE_MAX_RING = 7;
const VERSUS_SUDDEN_DEATH_MS = 90000;
/** Versus sudden death: both snakes speed up by this factor every step, down to the floor. */
const SUDDEN_DEATH_STEP_MS = 10000;
const SUDDEN_DEATH_SPEEDUP = 0.85;
const SUDDEN_DEATH_FLOOR = 0.45;
const RIVAL_RESPAWN_MS = 9000;
const BANNER_MS = 1600;
const METER_REGEN_PER_MS = 1 / 30000;
const METER_PER_FOOD = 0.25;
const SNAPSHOT_EVERY_MS = 400;
const REWIND_BACK_MS = 2500;
/** Endless: food kept on the board, how far it may be from your head, and the spawn radius. */
const ENDLESS_FOOD = 5;
const FOOD_LEASH = 24;
const SPAWN_RADIUS = 11;

export interface Player {
  id: number;
  cls: SnakeClass;
  body: Vec[];
  prevBody: Vec[];
  dir: Dir;
  queue: Dir[];
  /** Ice: the turn waiting one step before it applies. */
  iceBuffer: Dir | null;
  grow: number;
  alive: boolean;
  deathCause: DeathCause | null;
  /** Own tick accumulator so one player's surge doesn't speed up the other. */
  acc: number;
  meter: number;
  held: boolean;
  wasActive: boolean;
  shedCooldown: number;
  effects: Partial<Record<EffectKind, number>>;
  score: number;
  combo: number;
  lastEatTime: number;
  maxCombo: number;
  maxLength: number;
  sheds: number;
  foods: number;
  armour: number;
  lastTurnTime: number;
  rattleCooldown: number;
  /** Versus Hex timers (ms): warning before it lands, active (controls flipped), immunity after. */
  hexWarn: number;
  hexed: number;
  hexImmune: number;
  hexes: number;
}

export interface Boss {
  kind: BossKind;
  tier: number;
  hp: number;
  maxHp: number;
  invuln: number;
  stunned: number;
  // Serpent King
  body: Vec[];
  prevBody: Vec[];
  dir: Dir;
  moveTick: number;
  // Swarm Queen
  core: Vec;
  shield: boolean;
  shieldTimer: number;
  dronesEaten: number;
  spawnTimer: number;
  mineTimer: number;
  hitCooldown: number;
}

export interface GameOptions {
  mode: ModeId;
  seed?: number;
  classes?: SnakeClass[];
  level?: LevelData;
  /** Record a ghost trail of player 1. */
  record?: boolean;
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
  coils: number;
  bestCoil: number;
  bossesDefeated: number;
  rewindsUsed: number;
  maxBeatStreak: number;
  mutations: number;
  won: boolean;
}

/** Fields captured by rewind snapshots. */
const STATE_KEYS = [
  'time',
  'acc',
  'stepCount',
  'nextId',
  'players',
  'level',
  'levelFoods',
  'solid',
  'broken',
  'mazeIndex',
  'mazeWalls',
  'pendingMaze',
  'mazeWarn',
  'mazeFoods',
  'ring',
  'collapseTimer',
  'collapseActive',
  'pickups',
  'shedWalls',
  'mines',
  'mice',
  'rival',
  'rivalRespawn',
  'projectiles',
  'boss',
  'wells',
  'arrows',
  'enclosed',
  'powerTimer',
  'mouseTimer',
  'bpm',
  'beatStreak',
] as const;

function newPlayer(id: number, cls: SnakeClass): Player {
  return {
    id,
    cls,
    body: [],
    prevBody: [],
    dir: 'right',
    queue: [],
    iceBuffer: null,
    grow: 0,
    alive: true,
    deathCause: null,
    acc: 0,
    meter: 1,
    held: false,
    wasActive: false,
    shedCooldown: 0,
    effects: {},
    score: 0,
    combo: 0,
    lastEatTime: -Infinity,
    maxCombo: 0,
    maxLength: 0,
    sheds: 0,
    foods: 0,
    armour: 0,
    lastTurnTime: -Infinity,
    rattleCooldown: 0,
    hexWarn: 0,
    hexed: 0,
    hexImmune: 0,
    hexes: 0,
  };
}

export class Game {
  readonly mode: ModeConfig;
  readonly rng: Rng;
  readonly seed: number;
  readonly custom: LevelData | null;
  private readonly record: boolean;
  /** Board size for this game: 24x24 arenas, or the Endless world. */
  readonly w: number;
  readonly h: number;
  /** Endless: the generated world (biomes and landmarks); null in arena modes. */
  world: World | null = null;
  /** Endless: biome under player 1's head. */
  biome: BiomeId | null = null;

  status: 'playing' | 'draft' | 'over' = 'playing';
  won = false;
  /** Versus: winning player id, -1 for a draw. */
  winner: number | null = null;
  deathCause: DeathCause | null = null;
  time = 0;
  acc = 0;
  stepCount = 0;
  nextId = 1;

  players: Player[] = [];

  level = 1;
  levelFoods = 0;
  spec!: LevelSpec;
  arena!: Arena;
  private startArena = 0;
  modifiers = new Set<ModifierId>();
  /** Static solid cells: arena walls, maze walls and the collapsed border. */
  solid: Uint8Array;
  /** Walls destroyed by Cobra spit (cell indexes). */
  broken = new Set<number>();
  mazeIndex = 0;
  mazeWalls: Vec[] = [];
  pendingMaze: Vec[] | null = null;
  mazeWarn = 0;
  mazeFoods = 0;
  ring = 0;
  collapseTimer = COLLAPSE_EVERY_MS;
  collapseActive = false;

  pickups: Pickup[] = [];
  shedWalls: ShedWall[] = [];
  mines: Mine[] = [];
  mice: Mouse[] = [];
  rival: Rival | null = null;
  rivalRespawn = Infinity;
  projectiles: Projectile[] = [];
  boss: Boss | null = null;
  wells: Vec[] = [];
  arrows: Arrow[] = [];
  enclosed: Uint8Array;

  mutations: MutationId[] = [];
  draftOptions: MutationId[] | null = null;
  rewinds = 0;
  private snapshots: { time: number; state: Record<string, unknown>; rng: number }[] = [];
  private snapTimer = 0;

  bpm = 110;
  beatStreak = 0;
  maxBeatStreak = 0;

  coils = 0;
  bestCoil = 0;
  bossesDefeated = 0;
  rivalsDowned = 0;
  rewindsUsed = 0;
  /** Ghost trail: flattened [timeMs, x, y, length] per step of player 1. */
  trail: number[] = [];

  powerTimer = 6000;
  mouseTimer = 9000;
  private miceSkip = false;
  private wellSkip = false;

  banner: { title: string; subtitle: string; ttl: number } | null = null;
  events: GameEvent[] = [];

  constructor(opts: GameOptions) {
    this.mode = MODES[opts.mode];
    this.w = this.mode.world || this.mode.size || W;
    this.h = this.mode.world || this.mode.size || H;
    this.solid = new Uint8Array(this.w * this.h);
    this.enclosed = new Uint8Array(this.w * this.h);
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
    this.rng = new Rng(this.seed);
    this.custom = opts.level ?? null;
    this.record = !!opts.record;
    this.rewinds = this.mode.rewinds;
    if (opts.mode === 'daily') this.startArena = this.seed % ARENA_ORDER.length;
    const classes = opts.classes ?? [];
    for (let i = 0; i < this.mode.players; i++) {
      this.players.push(newPlayer(i, this.mode.classAbility ? (classes[i] ?? 'racer') : 'racer'));
    }
    this.loadLevel(1, false);
  }

  // ---------------------------------------------------------------- player-1 shorthands

  get p0(): Player {
    return this.players[0];
  }
  get snake() {
    return this.p0.body;
  }
  set snake(v: Vec[]) {
    this.p0.body = v;
  }
  get prevSnake() {
    return this.p0.prevBody;
  }
  set prevSnake(v: Vec[]) {
    this.p0.prevBody = v;
  }
  get dir() {
    return this.p0.dir;
  }
  set dir(d: Dir) {
    this.p0.dir = d;
  }
  get queue() {
    return this.p0.queue;
  }
  get grow() {
    return this.p0.grow;
  }
  get effects() {
    return this.p0.effects;
  }
  get score() {
    return this.p0.score;
  }
  set score(v: number) {
    this.p0.score = v;
  }
  get combo() {
    return this.p0.combo;
  }
  get surge() {
    return this.p0.meter;
  }
  get shedCooldown() {
    return this.p0.shedCooldown;
  }
  setSurge(held: boolean) {
    this.setHeld(0, held);
  }
  get surging(): boolean {
    return this.isSurging(this.p0);
  }
  get canShed(): boolean {
    return this.canShedP(this.p0);
  }

  // ---------------------------------------------------------------- queries

  has(m: MutationId): boolean {
    return this.mutations.includes(m);
  }

  inb(p: Vec): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.w && p.y < this.h;
  }

  wrapAt(p: Vec): Vec {
    return { x: (p.x + this.w) % this.w, y: (p.y + this.h) % this.h };
  }

  ix(p: Vec): number {
    return p.y * this.w + p.x;
  }

  /** Endless: the biome at a cell. */
  biomeAt(p: Vec): Biome | null {
    return this.world ? biomeAt(this.world, p) : null;
  }

  /** Does food at this cell ripen? Per biome in Endless, per level elsewhere. */
  ripensAt(p: Vec): boolean {
    return this.world ? biomeAt(this.world, p).modifiers.includes('ripening') : this.modifiers.has('ripening');
  }

  get wraps(): boolean {
    return this.arena.wrap;
  }

  get foodsForLevel(): number {
    return this.spec.goalFoods;
  }

  get comboWindow(): number {
    return this.has('keeper') ? 3000 : COMBO_WINDOW_MS;
  }

  comboActive(p = this.p0): number {
    return this.time - p.lastEatTime <= this.comboWindow ? p.combo : 0;
  }

  lengthMultP(p: Player): number {
    if (!this.mode.abilities) return 1;
    const step = this.has('dense') ? 5 : 8;
    return 1 + Math.floor(Math.max(0, p.body.length - 4) / step) * 0.5;
  }

  get lengthMult(): number {
    return this.lengthMultP(this.p0);
  }

  get rhythmMult(): number {
    return this.mode.rhythm ? 1 + Math.min(this.beatStreak, 12) / 4 : 1;
  }

  // The shed key, its cooldown and its meter belong to Hex in versus, so these answer for it there.
  get shedMinLength(): number {
    if (this.mode.hex) return HEX_MIN_LENGTH;
    return this.has('quickmolt') ? 4 : SHED_MIN_LENGTH;
  }

  get shedCooldownMax(): number {
    if (this.mode.hex) return this.suddenDeath ? HEX_SUDDEN_DEATH_COOLDOWN_MS : HEX_COOLDOWN_MS;
    return this.has('quickmolt') ? SHED_COOLDOWN_MS / 2 : SHED_COOLDOWN_MS;
  }

  canShedP(p: Player): boolean {
    if (this.mode.hex) return this.canHexP(p);
    return this.mode.abilities && p.alive && p.shedCooldown <= 0 && p.body.length >= this.shedMinLength;
  }

  /** The opponent a hex from `p` would hit, if it can be hexed right now. */
  hexTarget(p: Player): Player | null {
    const o = this.players.find((q) => q !== p && q.alive);
    if (!o || o.hexWarn > 0 || o.hexed > 0 || o.hexImmune > 0) return null;
    return o;
  }

  canHexP(p: Player): boolean {
    return (
      this.mode.hex &&
      p.alive &&
      this.time >= HEX_GRACE_MS &&
      p.shedCooldown <= 0 &&
      p.body.length >= HEX_MIN_LENGTH &&
      this.hexTarget(p) !== null
    );
  }

  private abilityLive(p: Player): boolean {
    return this.mode.classAbility && p.alive && this.status === 'playing' && !this.banner;
  }

  isSurging(p: Player): boolean {
    return p.cls === 'racer' && p.held && p.meter > 0 && this.abilityLive(p);
  }

  isHunkering(p: Player): boolean {
    return p.cls === 'python' && p.held && p.meter > 0 && this.abilityLive(p);
  }

  get baseInterval(): number {
    let b: number;
    const id = this.mode.id;
    if (this.mode.rhythm) b = 60000 / this.bpm / 2;
    else if (id === 'classic') b = Math.max(60, 135 - this.p0.foods * 2.5);
    else if (this.mode.zen) b = 125;
    else if (id === 'versus') b = 120 * this.suddenDeathPace;
    else if (id === 'custom') b = Math.max(70, 125 - this.levelFoods);
    else if (this.world) b = Math.max(70, 125 - this.p0.foods * 1.2);
    else if (this.spec.boss) b = Math.max(85, 120 - this.spec.bossTier * 5);
    else b = Math.max(55, 130 - (this.level - 1) * 7 - this.levelFoods * 1.5);
    if (this.players.some((p) => p.alive && p.effects.slowmo)) b *= 1.8;
    return b;
  }

  /** Versus: past 90 s the round is in sudden death. */
  get suddenDeath(): boolean {
    return this.mode.id === 'versus' && this.time >= VERSUS_SUDDEN_DEATH_MS;
  }

  /** Versus sudden death: step-interval factor, shrinking every 10 s down to the floor. */
  get suddenDeathPace(): number {
    if (!this.suddenDeath) return 1;
    const steps = Math.floor((this.time - VERSUS_SUDDEN_DEATH_MS) / SUDDEN_DEATH_STEP_MS) + 1;
    return Math.max(SUDDEN_DEATH_FLOOR, Math.pow(SUDDEN_DEATH_SPEEDUP, steps));
  }

  playerInterval(p: Player): number {
    return this.baseInterval * (this.isSurging(p) ? 0.55 : 1);
  }

  get interval(): number {
    return this.playerInterval(this.p0);
  }

  alphaFor(p: Player): number {
    return Math.min(1, Math.max(0, p.acc / this.playerInterval(p)));
  }

  get alpha(): number {
    return this.alphaFor(this.p0);
  }

  get worldAlpha(): number {
    return Math.min(1, Math.max(0, this.acc / this.baseInterval));
  }

  get stats(): RunStats {
    const p = this.p0;
    return {
      score: p.score,
      foods: p.foods,
      maxLength: p.maxLength,
      maxCombo: p.maxCombo,
      sheds: p.sheds,
      level: this.level,
      timeMs: this.time,
      rivalsDowned: this.rivalsDowned,
      coils: this.coils,
      bestCoil: this.bestCoil,
      bossesDefeated: this.bossesDefeated,
      rewindsUsed: this.rewindsUsed,
      maxBeatStreak: this.maxBeatStreak,
      mutations: this.mutations.length,
      won: this.won,
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

  bossCells(): Vec[] {
    const b = this.boss;
    if (!b) return [];
    if (b.kind === 'serpent') return b.body;
    const c = b.core;
    return [c, { x: c.x + 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x + 1, y: c.y + 1 }];
  }

  bossAt(p: Vec): boolean {
    return this.bossCells().some((c) => eq(c, p));
  }

  /** True during the warning window before the next ring closes. */
  get collapseWarning(): boolean {
    return this.collapseActive && this.ring < COLLAPSE_MAX_RING && this.collapseTimer <= COLLAPSE_WARN_MS;
  }

  // ---------------------------------------------------------------- input

  turn(dir: Dir, pid = 0) {
    if (this.status !== 'playing') return;
    const p = this.players[pid];
    if (!p?.alive) return;
    if (this.modifiers.has('mirror') !== p.hexed > 0) dir = OPPOSITE[dir];
    const last = p.queue.length ? p.queue[p.queue.length - 1] : (p.iceBuffer ?? p.dir);
    if (dir === last || dir === OPPOSITE[last] || p.queue.length >= 3) return;
    p.queue.push(dir);

    if (this.mode.rhythm && !this.banner) {
      const iv = this.baseInterval;
      const off = Math.min(this.acc, iv - this.acc);
      if (off <= RHYTHM_WINDOW_MS) {
        this.beatStreak++;
        this.maxBeatStreak = Math.max(this.maxBeatStreak, this.beatStreak);
        this.events.push({ type: 'onbeat', streak: this.beatStreak });
      } else {
        if (this.beatStreak > 0) this.events.push({ type: 'offbeat' });
        this.beatStreak = 0;
      }
    }

    if (this.has('rattle') && pid === 0) {
      if (this.time - p.lastTurnTime < 350 && p.rattleCooldown <= 0) {
        this.rattle(p);
        p.rattleCooldown = 4000;
      }
      p.lastTurnTime = this.time;
    }
  }

  /** Ability key pressed or released. Tap abilities fire on press. */
  setHeld(pid: number, held: boolean) {
    const p = this.players[pid];
    if (!p) return;
    const wasHeld = p.held;
    p.held = held;
    if (held && !wasHeld && !CLASSES[p.cls].hold) this.useAbility(p);
  }

  private useAbility(p: Player) {
    if (!this.abilityLive(p)) return;
    const def = CLASSES[p.cls];
    if (p.meter < def.cost) return;
    p.meter -= def.cost;
    this.events.push({ type: 'ability', cls: p.cls, player: p.id });
    if (p.cls === 'viper') {
      const from = p.body[0];
      const cells: Vec[] = [];
      for (let i = 0; i < 3 && p.alive && this.status === 'playing' && !this.banner; i++) {
        p.prevBody = p.body.map((s) => ({ ...s }));
        if (!this.advance(p, true)) break;
        cells.push({ ...p.body[0] });
      }
      if (cells.length) this.events.push({ type: 'dash', cells: [from, ...cells] });
      if (this.world && p.id === 0) this.syncBiome();
    } else if (p.cls === 'cobra') {
      const h = p.body[0];
      this.projectiles.push({ pos: { ...h }, prev: { ...h }, dir: p.dir, owner: p.id, life: 8 });
    }
  }

  shed(pid = 0): boolean {
    if (this.mode.hex) return this.hex(pid);
    const p = this.players[pid];
    if (!p || this.status !== 'playing' || this.banner || !this.canShedP(p)) return false;
    const keep = Math.max(3, Math.ceil(p.body.length / 2));
    const removed = p.body.splice(keep);
    p.prevBody = p.prevBody.slice(0, keep);
    const ttl = this.has('longmolt') ? SHED_WALL_MS * 2 : SHED_WALL_MS;
    for (const pos of removed) {
      if (!this.shedWalls.some((w) => eq(w.pos, pos))) {
        this.shedWalls.push({ pos: { ...pos }, ttl, maxTtl: ttl, owner: p.id });
      }
    }
    p.sheds++;
    p.shedCooldown = this.shedCooldownMax;
    this.events.push({ type: 'shed', cells: removed, player: p.id });
    if (this.has('blastshed')) {
      const blown = this.mines.filter((m) => removed.some((c) => chebyshev(c, m.pos) <= 2));
      for (const m of blown) {
        p.score += Math.round(15 * this.lengthMultP(p));
        this.events.push({ type: 'defuse', pos: m.pos });
      }
      this.mines = this.mines.filter((m) => !blown.includes(m));
    }
    this.checkCoil(p);
    return true;
  }

  /** Versus: pay tail segments to flip the opponent's controls for a while. */
  hex(pid = 0): boolean {
    const p = this.players[pid];
    if (!p || this.status !== 'playing' || this.banner || !this.canHexP(p)) return false;
    const target = this.hexTarget(p)!;
    const cells = p.body.splice(p.body.length - HEX_COST, HEX_COST);
    p.prevBody = p.prevBody.slice(0, p.body.length);
    p.shedCooldown = this.shedCooldownMax;
    p.hexes++;
    target.hexWarn = HEX_WARN_MS;
    this.events.push({ type: 'hex', cells, player: p.id, target: target.id });
    return true;
  }

  private tickHex(p: Player, dt: number) {
    if (p.hexWarn > 0) {
      p.hexWarn = Math.max(0, p.hexWarn - dt);
      if (p.hexWarn === 0) {
        p.hexed = HEX_MS;
        this.events.push({ type: 'hexed', player: p.id, on: true });
      }
    } else if (p.hexed > 0) {
      p.hexed = Math.max(0, p.hexed - dt);
      if (p.hexed === 0) {
        p.hexImmune = HEX_IMMUNE_MS;
        this.events.push({ type: 'hexed', player: p.id, on: false });
      }
    } else p.hexImmune = Math.max(0, p.hexImmune - dt);
  }

  chooseMutation(i: number) {
    if (this.status !== 'draft' || !this.draftOptions) return;
    const id = this.draftOptions[i];
    if (!id) return;
    this.mutations.push(id);
    if (id === 'armour') this.p0.armour++;
    if (id === 'rewindplus') this.rewinds++;
    this.draftOptions = null;
    this.status = 'playing';
    this.loadLevel(this.level + 1, true);
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
    for (const p of this.players) if (p.alive) p.acc += dt;
    for (let guard = 0; guard < 30 && this.status === 'playing' && !this.banner; guard++) {
      let moved = false;
      for (const p of [...this.players]) {
        if (!p.alive || this.status !== 'playing' || this.banner) continue;
        const iv = this.playerInterval(p);
        if (p.acc >= iv) {
          p.acc -= iv;
          this.stepPlayer(p);
          moved = true;
        }
      }
      if (this.status !== 'playing' || this.banner) break;
      const base = this.baseInterval;
      if (this.acc >= base) {
        this.acc -= base;
        this.stepWorld();
        moved = true;
      }
      if (!moved) break;
    }
    if (this.banner) {
      this.acc = 0;
      for (const p of this.players) p.acc = 0;
    }
  }

  private tickTimers(dt: number) {
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const k of Object.keys(p.effects) as EffectKind[]) {
        const left = (p.effects[k] ?? 0) - dt;
        if (left <= 0) {
          delete p.effects[k];
          this.events.push({ type: 'expire', kind: k });
        } else p.effects[k] = left;
      }
      p.shedCooldown = Math.max(0, p.shedCooldown - dt);
      p.rattleCooldown = Math.max(0, p.rattleCooldown - dt);
      this.tickHex(p, dt);
      const def = CLASSES[p.cls];
      const active = this.isSurging(p) || this.isHunkering(p);
      if (active) p.meter = Math.max(0, p.meter - dt * def.cost * (this.has('adrenaline') ? 0.6 : 1));
      else p.meter = Math.min(1, p.meter + dt * METER_REGEN_PER_MS);
      if (active && !p.wasActive) this.events.push({ type: 'ability', cls: p.cls, player: p.id });
      p.wasActive = active;
    }

    for (const w of this.shedWalls) w.ttl -= dt;
    this.shedWalls = this.shedWalls.filter((w) => w.ttl > 0);

    const ripening = this.modifiers.has('ripening');
    let rotted = false;
    for (const pk of this.pickups) {
      pk.ttl -= dt;
      pk.age += dt;
      if ((this.world ? this.ripensAt(pk.pos) : ripening) && pk.kind === 'food' && pk.age > RIPEN_MS) {
        pk.kind = 'rot';
        pk.ttl = ROT_TTL_MS;
        pk.maxTtl = ROT_TTL_MS;
        rotted = true;
      }
    }
    this.pickups = this.pickups.filter((p) => p.ttl > 0);
    if (rotted) this.spawnPickup('food', Infinity);

    for (const m of this.mice) {
      m.ttl -= dt;
      m.stunned = Math.max(0, m.stunned - dt);
    }
    this.mice = this.mice.filter((m) => m.ttl > 0);
    if (this.rival) this.rival.stunned = Math.max(0, this.rival.stunned - dt);

    if (this.spec.powerUps && this.mode.powerUps) {
      this.powerTimer -= dt;
      if (this.powerTimer <= 0) {
        this.powerTimer = this.rng.range(8000, 13000) * (this.has('lucky') ? 0.6 : 1);
        // Endless treasure never expires and doesn't count as a power-up on the board.
        const onBoard = this.pickups.some((p) => !['food', 'bit', 'rot'].includes(p.kind) && Number.isFinite(p.maxTtl));
        if (!onBoard) {
          const weights: [PowerKind, number][] = [
            ['phase', 2],
            ['slowmo', this.mode.rhythm ? 0 : 2],
            ['magnet', 2],
            ['shrink', 1.5],
            ['golden', this.has('midas') ? 3 : 1.5],
          ];
          const kind = this.rng.weighted(weights);
          const ttl = kind === 'golden' ? GOLDEN_TTL_MS * (this.has('midas') ? 1.6 : 1) : POWER_TTL_MS;
          this.spawnPickup(kind, ttl);
        }
      }
    }

    if (this.spec.mice) {
      this.mouseTimer -= dt;
      if (this.mouseTimer <= 0) {
        if (this.world) {
          this.mouseTimer = this.rng.range(5000, 9000);
          if (this.mice.length < (this.biomeAt(this.p0.body[0])?.mice ?? 1)) this.spawnMouse(false);
        } else {
          this.mouseTimer = this.rng.range(12000, 18000);
          if (this.mice.length < 1 + Math.floor(this.level / 3)) this.spawnMouse(false);
        }
      }
    }
    if (this.spec.rival && !this.rival) {
      this.rivalRespawn -= dt;
      if (this.rivalRespawn <= 0) this.spawnRival();
    }

    if (this.boss) this.tickBoss(dt);

    if (this.pendingMaze) {
      this.mazeWarn -= dt;
      if (this.mazeWarn <= 0) this.applyMaze();
    }

    // Versus sudden death: no closing walls (the board wraps), both snakes just keep speeding up.
    if (this.suddenDeath && this.time - dt < VERSUS_SUDDEN_DEATH_MS) {
      this.banner = { title: 'Sudden death', subtitle: 'Faster and faster', ttl: BANNER_MS };
    }
    if (this.collapseActive && this.ring < COLLAPSE_MAX_RING) {
      this.collapseTimer -= dt;
      if (this.collapseTimer <= 0) {
        this.collapseTimer = COLLAPSE_EVERY_MS;
        this.ring++;
        this.rebuildSolid();
        this.evictFromSolid();
        this.events.push({ type: 'collapse', ring: this.ring });
      }
    }

    if (this.rewinds > 0) {
      this.snapTimer -= dt;
      if (this.snapTimer <= 0) {
        this.snapTimer = SNAPSHOT_EVERY_MS;
        this.snapshots.push(this.capture());
        if (this.snapshots.length > 12) this.snapshots.shift();
      }
    }
  }

  /** Independent deep copy (used for instant replays). */
  clone(): Game {
    const copy = Object.create(Game.prototype) as Game;
    const src = this as unknown as Record<string, unknown>;
    const dst = copy as unknown as Record<string, unknown>;
    for (const k of Object.keys(this)) {
      if (k === 'rng' || k === 'events') continue;
      dst[k] = structuredClone(src[k]);
    }
    dst.rng = new Rng(0);
    copy.rng.state = this.rng.state;
    dst.events = [];
    return copy;
  }

  /** One full tick for every player and the world (used by tests and tools). */
  step() {
    for (const p of [...this.players]) {
      if (p.alive && this.status === 'playing' && !this.banner) this.stepPlayer(p);
    }
    if (this.status === 'playing' && !this.banner) this.stepWorld();
  }

  // ---------------------------------------------------------------- players

  private stepPlayer(p: Player) {
    p.prevBody = p.body.map((s) => ({ ...s }));
    if (this.isHunkering(p)) return;
    const next = p.queue.shift();
    if (this.modifiers.has('ice')) {
      const apply = p.iceBuffer;
      p.iceBuffer = next ?? null;
      if (apply && apply !== OPPOSITE[p.dir]) p.dir = apply;
    } else if (next) p.dir = next;
    this.advance(p, false);
    if (this.world && p.id === 0) this.syncBiome();
    if (this.record && p.id === 0 && p.alive) {
      const h = p.body[0];
      this.trail.push(Math.round(this.time), h.x, h.y, p.body.length);
    }
  }

  /** Move a player one cell. Returns false if it died, was stopped, or the level changed. */
  private advance(p: Player, dashing: boolean): boolean {
    let head = add(p.body[0], DIRS[p.dir]);
    if (!this.inb(head)) {
      if (this.wraps) head = this.wrapAt(head);
      else return this.hurt(p, 'wall', p.body[0]);
    }
    const exit = this.portalExit(head);
    if (exit) {
      this.events.push({ type: 'portal', from: head, to: exit });
      head = { ...exit };
    }

    if (this.solid[this.ix(head)]) return this.hurt(p, 'wall', head);
    if (this.bossAt(head)) return this.hurt(p, 'boss', head);

    const si = this.shedWalls.findIndex((w) => eq(w.pos, head));
    if (si >= 0) {
      if (this.mode.zen) this.shedWalls.splice(si, 1);
      else return this.hurt(p, 'shed', head);
    }

    const mi = this.mines.findIndex((m) => eq(m.pos, head));
    if (mi >= 0) {
      if (this.mineLit(this.mines[mi])) return this.hurt(p, 'mine', head);
      if (this.has('mineeater')) {
        this.mines.splice(mi, 1);
        const points = Math.round(20 * this.lengthMultP(p));
        p.score += points;
        this.events.push({ type: 'defuse', pos: head });
      }
    }

    if (this.rival?.body.some((s) => eq(s, head))) {
      if (eq(this.rival.body[0], head) && p.body.length >= this.rival.body.length) this.killRival(true);
      else return this.hurt(p, 'rival', head);
    }

    for (const o of this.players) {
      if (o === p || !o.alive) continue;
      const oi = o.body.findIndex((s) => eq(s, head));
      if (oi < 0) continue;
      if (oi === 0) {
        if (p.body.length > o.body.length) this.kill(o, 'player', head);
        else if (p.body.length < o.body.length) return this.hurt(p, 'player', head);
        else {
          this.kill(o, 'player', head);
          return this.hurt(p, 'player', head);
        }
      } else return this.hurt(p, 'player', head);
    }

    // The tail tip moves out of the way this step unless we're growing.
    const checkLen = p.grow > 0 ? p.body.length : p.body.length - 1;
    for (let i = 1; i < checkLen; i++) {
      if (!eq(p.body[i], head)) continue;
      if (p.effects.phase || dashing) break;
      if (this.mode.zen || (this.has('ouroboros') && p.id === 0)) {
        const cut = p.body.splice(i);
        p.prevBody = p.prevBody.slice(0, i);
        p.grow = 0;
        p.combo = 0;
        this.events.push({ type: 'cut', cells: cut });
        break;
      }
      return this.hurt(p, 'self', head);
    }

    p.body.unshift(head);
    if (p.grow > 0) p.grow--;
    else p.body.pop();
    p.maxLength = Math.max(p.maxLength, p.body.length);

    const arrow = this.arrows.find((a) => eq(a.pos, head));
    if (arrow && arrow.dir !== OPPOSITE[p.dir]) {
      p.dir = arrow.dir;
      p.queue = [];
      p.iceBuffer = null;
    }

    const level = this.level;
    this.eatAt(p, head, 1);
    if (this.has('forked') && p.id === 0) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          let c = { x: head.x + dx, y: head.y + dy };
          if (!this.inb(c)) {
            if (!this.wraps) continue;
            c = this.wrapAt(c);
          }
          this.eatAt(p, c, 1);
          if (this.level !== level || this.status !== 'playing') return false;
        }
      }
    }
    if (this.level !== level || this.status !== 'playing' || this.banner) return false;
    this.checkCoil(p);
    return this.status === 'playing' && !this.banner && this.level === level;
  }

  /** A lethal hit: armour, then rewind, then death. Always returns false. */
  private hurt(p: Player, cause: DeathCause, pos: Vec): false {
    if (p.armour > 0) {
      p.armour--;
      const keep = Math.max(3, Math.ceil(p.body.length / 2));
      p.body.splice(keep);
      p.prevBody = p.body.map((s) => ({ ...s }));
      p.effects.phase = Math.max(p.effects.phase ?? 0, 1500);
      p.queue = [];
      p.iceBuffer = null;
      p.dir = this.safeDir(p) ?? p.dir;
      this.events.push({ type: 'armour', pos });
      return false;
    }
    if (this.rewinds > 0 && this.players.length === 1 && this.snapshots.length) {
      this.doRewind();
      return false;
    }
    this.kill(p, cause, pos);
    return false;
  }

  private kill(p: Player, cause: DeathCause, pos: Vec) {
    if (!p.alive) return;
    p.alive = false;
    p.deathCause = cause;
    p.held = false;
    this.events.push({ type: 'die', pos, cause, cells: p.body.map((s) => ({ ...s })), player: p.id });
    const alive = this.players.filter((o) => o.alive);
    if (this.players.length === 1) {
      this.status = 'over';
      this.deathCause = cause;
    } else if (alive.length <= 1) {
      this.status = 'over';
      this.deathCause = cause;
      this.winner = alive.length ? alive[0].id : -1;
      this.won = this.winner >= 0;
    }
  }

  private deadlyFor(p: Player, c: Vec): boolean {
    if (!this.inb(c)) return !this.wraps;
    if (this.solid[this.ix(c)] || this.bossAt(c)) return true;
    if (this.shedWalls.some((w) => eq(w.pos, c))) return true;
    if (this.mines.some((m) => eq(m.pos, c) && this.mineLit(m))) return true;
    if (this.rival?.body.some((s) => eq(s, c))) return true;
    for (const o of this.players) {
      if (!o.alive) continue;
      const len = o === p ? o.body.length - 1 : o.body.length;
      for (let i = o === p ? 1 : 0; i < len; i++) if (eq(o.body[i], c)) return true;
    }
    return false;
  }

  private safeDir(p: Player): Dir | null {
    const order = [p.dir, ...DIR_LIST.filter((d) => d !== p.dir && d !== OPPOSITE[p.dir])];
    for (const d of order) {
      let c = add(p.body[0], DIRS[d]);
      if (!this.inb(c) && this.wraps) c = this.wrapAt(c);
      if (!this.deadlyFor(p, c)) return d;
    }
    return null;
  }

  // ---------------------------------------------------------------- rewind

  private capture() {
    const self = this as unknown as Record<string, unknown>;
    const state: Record<string, unknown> = {};
    for (const k of STATE_KEYS) state[k] = structuredClone(self[k]);
    return { time: this.time, state, rng: this.rng.state };
  }

  private doRewind() {
    const target = this.time - REWIND_BACK_MS;
    let snap = this.snapshots[0];
    for (const s of this.snapshots) if (s.time <= target) snap = s;
    const self = this as unknown as Record<string, unknown>;
    for (const k of STATE_KEYS) self[k] = structuredClone(snap.state[k]);
    this.rng.state = snap.rng;
    this.snapshots = this.snapshots.filter((s) => s.time < snap.time);
    this.rewinds--;
    this.rewindsUsed++;
    const p = this.p0;
    p.effects.phase = Math.max(p.effects.phase ?? 0, 1500);
    p.queue = [];
    p.held = false;
    if (this.record) {
      let n = this.trail.length;
      while (n >= 4 && this.trail[n - 4] > this.time) n -= 4;
      this.trail.length = n;
    }
    this.syncBiome();
    this.banner = { title: 'Rewind', subtitle: `${this.rewinds} left`, ttl: 900 };
    this.events.push({ type: 'rewind' });
  }

  // ---------------------------------------------------------------- eating

  private eatAt(p: Player, cell: Vec, coilMult: number) {
    const pi = this.pickups.findIndex((pk) => eq(pk.pos, cell));
    if (pi >= 0) {
      const [pk] = this.pickups.splice(pi, 1);
      this.consume(p, pk, coilMult);
    }
    if (this.status !== 'playing') return;
    const mi = this.mice.findIndex((m) => eq(m.pos, cell));
    if (mi >= 0) {
      const [m] = this.mice.splice(mi, 1);
      this.eatMouse(p, m, coilMult);
    }
  }

  private eatMouse(p: Player, m: Mouse, mult: number): number {
    const points = Math.round((m.drone ? 15 : 25) * this.lengthMultP(p) * mult);
    p.score += points;
    p.grow += m.drone ? 1 : 2;
    this.events.push({ type: 'mouse', pos: m.pos, points, drone: m.drone });
    const b = this.boss;
    if (m.drone && b?.kind === 'queen' && b.shield) {
      b.dronesEaten++;
      if (b.dronesEaten >= 4) {
        b.shield = false;
        b.shieldTimer = 4500;
        this.events.push({ type: 'shield', up: false });
      }
    }
    return points;
  }

  private consume(p: Player, pk: Pickup, coilMult: number): number {
    const kind = pk.kind;
    if (kind === 'food' || kind === 'bit' || kind === 'golden') {
      if (this.mode.abilities) {
        p.combo = this.time - p.lastEatTime <= this.comboWindow ? Math.min(MAX_COMBO, p.combo + 1) : 1;
        p.maxCombo = Math.max(p.maxCombo, p.combo);
        if (p.combo > 1) this.events.push({ type: 'combo', pos: pk.pos, combo: p.combo });
        if (p.combo >= 3 && this.has('secondwind')) p.meter = 1;
      }
      p.lastEatTime = this.time;
      let base = kind === 'golden' ? 50 : kind === 'bit' ? 5 : 10;
      if (kind === 'food' && this.has('glutton')) base *= 1.5;
      if (kind === 'food' && this.ripensAt(pk.pos)) base *= 1 + Math.min(pk.age / 8000, 2);
      const mult =
        (this.mode.abilities ? p.combo : 1) *
        this.lengthMultP(p) *
        (this.isSurging(p) ? 2 : 1) *
        this.rhythmMult *
        coilMult;
      const points = Math.round(base * mult);
      p.score += points;
      p.grow += kind === 'golden' ? 3 : kind === 'food' && this.has('glutton') ? 2 : 1;
      this.events.push({ type: 'eat', pos: pk.pos, points, mult, kind, player: p.id });

      if (kind === 'bit') return points;
      p.meter = Math.min(1, p.meter + METER_PER_FOOD);
      p.foods++;
      if (kind === 'food') this.spawnPickup('food', Infinity);
      this.afterFood();
      return points;
    }

    if (kind === 'rot') {
      const remove = Math.min(2, Math.max(0, p.body.length - 3));
      p.body.splice(p.body.length - remove, remove);
      p.prevBody = p.prevBody.slice(0, p.body.length);
      p.score = Math.max(0, p.score - 10);
      p.combo = 0;
      this.events.push({ type: 'rot', pos: pk.pos, player: p.id });
      return 0;
    }

    this.events.push({ type: 'power', pos: pk.pos, kind, player: p.id });
    if (kind === 'shrink') {
      const remove = Math.min(3, Math.max(0, p.body.length - 3));
      const cells = p.body.splice(p.body.length - remove, remove);
      p.prevBody = p.prevBody.slice(0, p.body.length);
      p.grow = 0;
      this.events.push({ type: 'shrink', cells });
      return 0;
    }
    const thief = this.has('timethief') && (kind === 'phase' || kind === 'slowmo');
    p.effects[kind] = EFFECT_MS[kind] * (thief ? 2 : 1);
    return 0;
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
    if (this.mode.rhythm) {
      const total = this.players.reduce((s, p) => s + p.foods, 0);
      if (total % 5 === 0) this.bpm = Math.min(180, this.bpm + 6);
    }
    this.levelFoods++;
    if (this.spec.goalFoods > 0 && this.levelFoods >= this.spec.goalFoods) this.completeLevel();
  }

  private completeLevel() {
    if (this.custom) {
      this.won = true;
      this.status = 'over';
      this.events.push({ type: 'levelup', level: this.level + 1, bonus: 0 });
      return;
    }
    if (!this.mode.levels) return;
    const p = this.p0;
    const bonus = p.body.length * 10 * this.level;
    p.score += bonus;
    this.events.push({ type: 'levelup', level: this.level + 1, bonus });
    if (this.mode.drafts) {
      this.draftOptions = this.rollDraft();
      this.status = 'draft';
      this.events.push({ type: 'draft' });
    } else this.loadLevel(this.level + 1, true);
  }

  rollDraft(): MutationId[] {
    const pool = MUTATION_LIST.filter((id) => MUTATIONS[id].stacks || !this.has(id));
    const out: MutationId[] = [];
    while (out.length < 3 && pool.length) {
      const i = this.rng.int(pool.length);
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  // ---------------------------------------------------------------- coil

  private checkCoil(p: Player) {
    if (!this.mode.abilities || !p.alive) return;
    const barrier = new Uint8Array(this.w * this.h);
    for (const s of p.body) barrier[this.ix(s)] = 1;
    for (const w of this.shedWalls) if (w.owner === p.id) barrier[this.ix(w.pos)] = 1;
    const enc = findEnclosed(barrier, this.w, this.h);
    this.enclosed = enc;

    const inside = (c: Vec) => enc[this.ix(c)] === 1;
    const mult = (this.has('constrictor') ? 3 : 2) + (p.cls === 'python' ? 1 : 0);
    let captured = 0;
    let points = 0;
    const level = this.level;

    for (const pk of this.pickups.filter((q) => inside(q.pos))) {
      if (!this.pickups.includes(pk)) continue;
      this.pickups.splice(this.pickups.indexOf(pk), 1);
      points += this.consume(p, pk, mult);
      captured++;
      if (this.level !== level || this.status !== 'playing') break;
    }
    if (this.level !== level || this.status !== 'playing') return this.coilEvent(p, enc, captured, points);

    for (const m of this.mice.filter((q) => inside(q.pos))) {
      this.mice.splice(this.mice.indexOf(m), 1);
      points += this.eatMouse(p, m, mult);
      captured++;
    }
    const defused = this.mines.filter((m) => inside(m.pos));
    for (const m of defused) {
      const pts = Math.round(15 * this.lengthMultP(p) * mult);
      p.score += pts;
      points += pts;
      captured++;
      this.events.push({ type: 'defuse', pos: m.pos });
    }
    this.mines = this.mines.filter((m) => !defused.includes(m));

    if (this.rival && inside(this.rival.body[0])) {
      points += this.killRival(true);
      captured++;
    }
    const b = this.boss;
    if (b && this.bossCells().some((c) => (b.kind === 'serpent' ? eq(c, b.body[0]) && inside(c) : inside(c)))) {
      if (b.invuln <= 0 && (b.kind === 'serpent' || !b.shield)) {
        captured++;
        this.coilEvent(p, enc, captured, points);
        this.damageBoss(1);
        return;
      }
    }
    this.coilEvent(p, enc, captured, points);
  }

  private coilEvent(p: Player, enc: Uint8Array, captured: number, points: number) {
    if (!captured) return;
    this.coils++;
    this.bestCoil = Math.max(this.bestCoil, captured);
    const cells: Vec[] = [];
    for (let i = 0; i < enc.length; i++) if (enc[i]) cells.push({ x: i % this.w, y: Math.floor(i / this.w) });
    this.events.push({ type: 'coil', cells, captured, points, player: p.id });
  }

  // ---------------------------------------------------------------- world step

  private stepWorld() {
    this.stepCount++;
    if (this.mode.rhythm) this.events.push({ type: 'beat', strong: this.stepCount % 2 === 0 });
    this.stepProjectiles();
    if (this.status !== 'playing' || this.banner) return;
    for (const m of this.mice) m.prev = { ...m.pos };
    if (this.rival) {
      this.rival.prevBody = this.rival.body.map((s) => ({ ...s }));
      if (this.rival.stunned <= 0) this.stepRival();
    }
    if (this.status !== 'playing') return;
    this.stepMice();
    if (this.boss) this.stepBoss();
    if (this.status !== 'playing' || this.banner) return;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.effects.magnet) this.pull(p.body[0], 6, 1);
      else if (this.has('scales') && p.id === 0) this.pull(p.body[0], 3, 1);
    }
    if (this.world) this.tendFood();
    if (this.wells.length) {
      this.wellSkip = !this.wellSkip;
      if (!this.wellSkip) {
        for (const w of this.wells) this.pull(w, 6, 0, true);
      }
    }
  }

  /** Drag pickups one cell toward `to` if within `radius`. */
  private pull(to: Vec, radius: number, minDist: number, all = false) {
    for (const pk of this.pickups) {
      if (!all && pk.kind !== 'food' && pk.kind !== 'bit' && pk.kind !== 'golden') continue;
      const dist = manhattan(pk.pos, to);
      if (dist > radius || dist <= minDist) continue;
      const dx = Math.sign(to.x - pk.pos.x);
      const dy = Math.sign(to.y - pk.pos.y);
      const tries: Vec[] =
        Math.abs(to.x - pk.pos.x) >= Math.abs(to.y - pk.pos.y)
          ? [{ x: pk.pos.x + dx, y: pk.pos.y }, { x: pk.pos.x, y: pk.pos.y + dy }]
          : [{ x: pk.pos.x, y: pk.pos.y + dy }, { x: pk.pos.x + dx, y: pk.pos.y }];
      for (const t of tries) {
        if (eq(t, pk.pos)) continue;
        const occupied =
          this.blockedForCritter(t) ||
          this.pickups.some((q) => eq(q.pos, t)) ||
          (this.rival?.body.some((s) => eq(s, t)) ?? false);
        if (!occupied) {
          pk.pos = t;
          break;
        }
      }
    }
  }

  private stepProjectiles() {
    const keep: Projectile[] = [];
    for (const pr of this.projectiles) {
      pr.prev = { ...pr.pos };
      let alive = true;
      for (let s = 0; s < 2 && alive; s++) {
        let n = add(pr.pos, DIRS[pr.dir]);
        if (!this.inb(n)) {
          if (!this.wraps) {
            alive = false;
            break;
          }
          n = this.wrapAt(n);
        }
        pr.pos = n;
        alive = !this.projectileHit(pr);
      }
      pr.life--;
      if (alive && pr.life > 0) keep.push(pr);
    }
    this.projectiles = keep;
  }

  /** Resolve a spit landing on `pr.pos`. Returns true if it was absorbed. */
  private projectileHit(pr: Projectile): boolean {
    const c = pr.pos;
    const owner = this.players[pr.owner];
    const hit = () => {
      this.events.push({ type: 'spitHit', pos: { ...c } });
      return true;
    };
    if (this.solid[this.ix(c)]) {
      const isRing = c.x < this.ring || c.y < this.ring || c.x >= this.w - this.ring || c.y >= this.h - this.ring;
      if (!isRing) {
        this.broken.add(this.ix(c));
        this.rebuildSolid();
      }
      return hit();
    }
    if (this.bossAt(c)) {
      const b = this.boss!;
      if (b.kind === 'serpent' || !b.shield) this.damageBoss(1);
      return hit();
    }
    const si = this.shedWalls.findIndex((w) => eq(w.pos, c));
    if (si >= 0) {
      this.shedWalls.splice(si, 1);
      return hit();
    }
    const mi = this.mines.findIndex((m) => eq(m.pos, c));
    if (mi >= 0) {
      this.mines.splice(mi, 1);
      if (owner) owner.score += Math.round(15 * this.lengthMultP(owner));
      this.events.push({ type: 'defuse', pos: c });
      return hit();
    }
    const mo = this.mice.findIndex((m) => eq(m.pos, c));
    if (mo >= 0) {
      const [m] = this.mice.splice(mo, 1);
      if (owner) {
        const pts = Math.round(20 * this.lengthMultP(owner));
        owner.score += pts;
        this.events.push({ type: 'mouse', pos: m.pos, points: pts, drone: m.drone });
      }
      return hit();
    }
    if (this.rival?.body.some((s) => eq(s, c))) {
      this.killRival(true);
      return hit();
    }
    for (const o of this.players) {
      if (o.id === pr.owner || !o.alive || !o.body.some((s) => eq(s, c))) continue;
      const remove = Math.min(3, Math.max(0, o.body.length - 3));
      const cells = o.body.splice(o.body.length - remove, remove);
      o.prevBody = o.prevBody.slice(0, o.body.length);
      this.events.push({ type: 'shrink', cells });
      return hit();
    }
    return false;
  }

  private rattle(p: Player) {
    const h = p.body[0];
    for (const m of this.mice) if (chebyshev(m.pos, h) <= 3) m.stunned = 2000;
    if (this.rival && this.rival.body.some((s) => chebyshev(s, h) <= 3)) this.rival.stunned = 2000;
    if (this.boss?.kind === 'serpent' && this.boss.body.some((s) => chebyshev(s, h) <= 3)) {
      this.boss.stunned = Math.max(this.boss.stunned, 1500);
    }
    this.events.push({ type: 'stun', pos: { ...h } });
  }

  // ---------------------------------------------------------------- levels

  loadLevel(level: number, showBanner: boolean) {
    this.level = level;
    this.levelFoods = 0;
    let treasure: Treasure[] = [];
    let spec: LevelSpec;
    if (this.mode.world) {
      const gen = generateWorld(this.seed, this.w);
      this.world = gen.world;
      treasure = gen.treasure;
      spec = gen.spec;
    } else if (this.custom) spec = levelFromData(this.custom);
    else if (this.mode.levels) {
      spec = arcadeLevel(level, this.startArena, this.rng, {
        hazards: this.mode.hazards,
        bosses: this.mode.bosses,
        twists: this.mode.twists,
      });
    } else spec = simpleLevel(this.mode.arena === 'custom' || this.mode.arena === 'world' ? 'box' : this.mode.arena, this.mode.powerUps);
    this.spec = spec;
    this.arena = spec.arena;
    this.modifiers = new Set(spec.modifiers);
    this.broken.clear();
    this.mazeIndex = 0;
    this.mazeFoods = 0;
    this.mazeWalls = this.arena.mazes.length ? this.arena.mazes[0] : [];
    this.pendingMaze = null;
    this.ring = 0;
    this.collapseActive = this.arena.collapse;
    this.collapseTimer = COLLAPSE_EVERY_MS;
    this.wells = spec.wells.map((w) => ({ ...w }));
    this.arrows = spec.arrows.map((a) => ({ pos: { ...a.pos }, dir: a.dir }));
    this.rebuildSolid();

    const spawns: [Vec, Dir][] =
      this.players.length === 2
        ? [
            [this.levelSpawnFor(0), 'right'],
            [this.levelSpawnFor(1), 'left'],
          ]
        : [[spec.spawn, spec.spawnDir]];
    this.players.forEach((p, i) => {
      const [pos, dir] = spawns[i];
      p.body = this.layBody(pos, dir, 4);
      p.prevBody = p.body.map((s) => ({ ...s }));
      p.dir = dir;
      p.queue = [];
      p.iceBuffer = null;
      p.grow = 0;
      p.acc = 0;
      p.effects = {};
      p.combo = 0;
      p.lastEatTime = -Infinity;
      p.maxLength = Math.max(p.maxLength, p.body.length);
    });
    this.acc = 0;

    this.pickups = [];
    this.shedWalls = [];
    this.mice = [];
    this.mines = spec.mines.map((pos) => ({ pos: { ...pos }, offset: this.rng.int(MINE_PERIOD_MS) }));
    this.rival = null;
    this.projectiles = [];
    this.boss = null;
    this.snapshots = [];
    this.snapTimer = 0;
    this.enclosed = new Uint8Array(this.w * this.h);

    for (let i = 0; i < spec.randomMines; i++) {
      const pos = this.freeCell(6);
      if (pos) this.mines.push({ pos, offset: this.rng.int(MINE_PERIOD_MS) });
    }
    if (this.modifiers.has('wells') && !this.wells.length) {
      for (let i = 0; i < 2; i++) {
        const pos = this.freeCell(6);
        if (pos) this.wells.push(pos);
      }
    }
    if (this.modifiers.has('arrows') && !this.arrows.length) {
      for (let i = 0; i < 5; i++) {
        const pos = this.freeCell(5);
        if (pos) this.arrows.push({ pos, dir: this.rng.pick(DIR_LIST) });
      }
    }
    this.rivalRespawn = spec.rival ? 3000 : Infinity;
    if (spec.boss) this.spawnBoss(spec.boss, spec.bossTier);

    for (let i = 0; i < this.mode.foods; i++) this.spawnPickup('food', Infinity);
    if (this.world) {
      for (const t of treasure) this.spawnPickup(t.kind, Infinity, { ...t.pos });
      for (let i = 1; i < ENDLESS_FOOD; i++) this.spawnPickup('food', Infinity);
      this.biome = null;
      this.syncBiome();
    }
    this.powerTimer = this.rng.range(5000, 8000);
    this.mouseTimer = this.rng.range(7000, 11000);

    this.banner = null;
    if (showBanner) {
      const twist = spec.modifiers.length ? ` · ${spec.modifiers.map((m) => m[0].toUpperCase() + m.slice(1)).join(' + ')}` : '';
      this.banner = {
        title: spec.boss ? 'Boss fight' : `Level ${level}`,
        subtitle: `${this.arena.name}${twist}`,
        ttl: BANNER_MS,
      };
    }
  }

  /** Lay a body behind `head`, bending around walls and edges if needed. */
  private layBody(head: Vec, dir: Dir, len: number): Vec[] {
    const cells = [{ ...head }];
    let back = OPPOSITE[dir];
    let cur = head;
    const free = (c: Vec) => this.inb(c) && !this.solid[this.ix(c)] && !cells.some((s) => eq(s, c));
    for (let i = 1; i < len; i++) {
      const options = [back, ...DIR_LIST.filter((d) => d !== back && d !== dir)];
      const d = options.find((o) => free(add(cur, DIRS[o])));
      if (d) {
        cur = add(cur, DIRS[d]);
        back = d;
      }
      cells.push({ ...cur });
    }
    return cells;
  }

  rebuildSolid() {
    this.solid.fill(0);
    for (const w of this.arena.walls) this.solid[this.ix(w)] = 1;
    for (const w of this.mazeWalls) this.solid[this.ix(w)] = 1;
    for (const b of this.broken) this.solid[b] = 0;
    const r = this.ring;
    if (r > 0) {
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          if (x < r || y < r || x >= this.w - r || y >= this.h - r) this.solid[y * this.w + x] = 1;
        }
      }
    }
  }

  /** Move or drop anything now sitting inside a solid cell. */
  private evictFromSolid() {
    const inSolid = (p: Vec) => this.solid[this.ix(p)] === 1;
    const lost = this.pickups.filter((p) => inSolid(p.pos));
    this.pickups = this.pickups.filter((p) => !inSolid(p.pos));
    for (const p of lost) if (p.kind === 'food') this.spawnPickup('food', Infinity);
    this.shedWalls = this.shedWalls.filter((w) => !inSolid(w.pos));
    this.mines = this.mines.filter((m) => !inSolid(m.pos));
    this.mice = this.mice.filter((m) => !inSolid(m.pos));
    this.wells = this.wells.filter((w) => !inSolid(w));
    this.arrows = this.arrows.filter((a) => !inSolid(a.pos));
    if (this.rival && inSolid(this.rival.body[0])) this.killRival(false);
  }

  private applyMaze() {
    const next = this.pendingMaze ?? [];
    this.pendingMaze = null;
    // Never drop a wall onto a living thing.
    const occupied = (p: Vec) =>
      this.players.some((pl) => pl.body.some((s) => eq(s, p))) ||
      (this.rival?.body.some((s) => eq(s, p)) ?? false);
    this.mazeWalls = next.filter((p) => !occupied(p));
    this.broken.clear();
    this.rebuildSolid();
    this.evictFromSolid();
    this.events.push({ type: 'shift' });
  }

  // ---------------------------------------------------------------- spawning

  private inSpawnLane(c: Vec): boolean {
    for (const p of this.players) {
      const h = p.body[0];
      if (!h) continue;
      const fresh = p.body.length && eq(p.body[0], this.levelSpawnFor(p.id));
      if (!fresh) continue;
      const d = DIRS[p.dir];
      for (let i = 0; i <= 7; i++) if (eq(c, { x: h.x + d.x * i, y: h.y + d.y * i })) return true;
    }
    return false;
  }

  private levelSpawnFor(id: number): Vec {
    if (this.players.length === 2) {
      // Opposite corners, scaled to the board: (4, 6) and (19, 17) on the standard 24x24.
      const dx = Math.round(this.w / 6);
      const dy = Math.round(this.h / 4);
      return id === 0 ? { x: dx, y: dy } : { x: this.w - 1 - dx, y: this.h - 1 - dy };
    }
    return this.spec.spawn;
  }

  /** Cell free of everything; optionally at least `minDist` from every snake head. */
  freeCell(minDist = 3, near?: { at: Vec; radius: number }): Vec | null {
    const heads = this.liveHeads();
    const ok = (p: Vec) => (!near || chebyshev(p, near.at) <= near.radius) && this.spawnable(p, minDist, heads);
    for (let i = 0; i < 200; i++) {
      const p = { x: this.rng.int(this.w), y: this.rng.int(this.h) };
      if (ok(p)) return p;
    }
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) if (ok({ x, y })) return { x, y };
    }
    if (near) return this.freeCell(minDist);
    return minDist > 0 ? this.freeCell(0) : null;
  }

  private liveHeads(): Vec[] {
    return this.players.filter((p) => p.alive && p.body.length).map((p) => p.body[0]);
  }

  /** Free of everything and at least `minDist` (Manhattan) from every head. */
  private spawnable(p: Vec, minDist: number, heads: Vec[]): boolean {
    if (this.solid[this.ix(p)] || this.enclosed[this.ix(p)]) return false;
    if (heads.some((h) => manhattan(p, h) < minDist)) return false;
    if (this.collapseWarning && this.inNextRing(p)) return false;
    if (this.pendingMaze?.some((w) => eq(w, p))) return false;
    if (this.portalExit(p)) return false;
    if (this.bossAt(p)) return false;
    if (this.players.some((pl) => pl.body.some((s) => eq(s, p)))) return false;
    if (this.pickups.some((s) => eq(s.pos, p))) return false;
    if (this.shedWalls.some((s) => eq(s.pos, p))) return false;
    if (this.mines.some((s) => eq(s.pos, p))) return false;
    if (this.mice.some((s) => eq(s.pos, p))) return false;
    if (this.wells.some((s) => eq(s, p))) return false;
    if (this.arrows.some((s) => eq(s.pos, p))) return false;
    if (this.rival?.body.some((s) => eq(s, p))) return false;
    if (this.inSpawnLane(p)) return false;
    return true;
  }

  /** Where new things appear: anywhere on an arena, near player 1 in the Endless world. */
  private spawnCell(minDist: number): Vec | null {
    if (!this.world) return this.freeCell(minDist);
    const at = this.p0.body[0];
    const heads = this.liveHeads();
    const span = SPAWN_RADIUS * 2 + 1;
    for (let i = 0; i < 120; i++) {
      const p = { x: at.x - SPAWN_RADIUS + this.rng.int(span), y: at.y - SPAWN_RADIUS + this.rng.int(span) };
      if (this.inb(p) && this.spawnable(p, minDist, heads)) return p;
    }
    return null;
  }

  // ---------------------------------------------------------------- endless world

  /** Twists follow the biome under player 1's head. */
  private syncBiome() {
    const head = this.p0.body[0];
    if (!this.world || !head) return;
    const b = biomeAt(this.world, head);
    if (b.id === this.biome) return;
    this.biome = b.id;
    this.modifiers = new Set(b.modifiers);
  }

  /** Keep a few foods near the head: far ones move closer, missing ones are topped up. */
  private tendFood() {
    const head = this.p0.body[0];
    if (!head) return;
    let foods = 0;
    for (const pk of [...this.pickups]) {
      if (pk.kind !== 'food') continue;
      if (chebyshev(pk.pos, head) > FOOD_LEASH) this.pickups.splice(this.pickups.indexOf(pk), 1);
      else foods++;
    }
    if (foods < ENDLESS_FOOD) this.spawnPickup('food', Infinity);
  }

  private inNextRing(p: Vec): boolean {
    const r = this.ring + 1;
    return p.x < r || p.y < r || p.x >= this.w - r || p.y >= this.h - r;
  }

  spawnPickup(kind: PickupKind, ttl: number, at?: Vec) {
    const pos = at ?? this.spawnCell(3);
    if (!pos) return;
    this.pickups.push({ id: this.nextId++, kind, pos, ttl, maxTtl: ttl, age: 0 });
  }

  private spawnMouse(drone: boolean, near?: { at: Vec; radius: number }) {
    const pos = this.world && !near ? this.spawnCell(6) : this.freeCell(drone ? 3 : 6, near);
    if (pos) {
      this.mice.push({
        id: this.nextId++,
        pos,
        prev: { ...pos },
        ttl: drone ? Infinity : MOUSE_TTL_MS,
        stunned: 0,
        drone,
      });
    }
  }

  // ---------------------------------------------------------------- critters

  private blockedForCritter(p: Vec, self?: Vec[], ignoreShed = false): boolean {
    if (!this.inb(p)) return true;
    if (this.solid[this.ix(p)]) return true;
    if (this.portalExit(p)) return true;
    if (this.bossAt(p)) return true;
    if (!ignoreShed && this.shedWalls.some((w) => eq(w.pos, p))) return true;
    if (this.mines.some((m) => eq(m.pos, p))) return true;
    if (this.players.some((pl) => pl.alive && pl.body.some((s) => eq(s, p)))) return true;
    if (this.collapseWarning && this.inNextRing(p)) return true;
    if (self) {
      for (let i = 0; i < self.length - 1; i++) if (eq(self[i], p)) return true;
    }
    return false;
  }

  private neighbour(p: Vec, d: Dir): Vec {
    const n = add(p, DIRS[d]);
    return this.wraps ? this.wrapAt(n) : n;
  }

  private stepMice() {
    // Mice move every other step.
    this.miceSkip = !this.miceSkip;
    if (!this.mice.length || this.miceSkip) return;
    const heads = this.players.filter((p) => p.alive).map((p) => p.body[0]);
    const distTo = (c: Vec) => Math.min(...heads.map((h) => manhattan(c, h)));
    for (const m of this.mice) {
      if (m.stunned > 0) continue;
      const options = DIR_LIST.map((d) => this.neighbour(m.pos, d)).filter(
        (p) =>
          !this.blockedForCritter(p) &&
          !this.pickups.some((q) => eq(q.pos, p)) &&
          !this.mice.some((o) => o !== m && eq(o.pos, p)) &&
          !(this.rival?.body.some((s) => eq(s, p)) ?? false),
      );
      if (!options.length) continue;
      m.pos =
        this.rng.next() < 0.25
          ? this.rng.pick(options)
          : options.reduce((best, p) => (distTo(p) > distTo(best) ? p : best));
    }
  }

  private spawnRival() {
    const head = this.p0.body[0];
    for (let tries = 0; tries < 80; tries++) {
      const start = { x: this.rng.int(this.w), y: this.rng.int(this.h) };
      const dir = this.rng.pick(DIR_LIST);
      const back = DIRS[OPPOSITE[dir]];
      const body: Vec[] = [];
      for (let i = 0; i < 4; i++) body.push({ x: start.x + back.x * i, y: start.y + back.y * i });
      if (manhattan(start, head) < 9) continue;
      if (body.some((p) => this.blockedForCritter(p) || this.pickups.some((q) => eq(q.pos, p)))) continue;
      if (this.blockedForCritter(this.neighbour(start, dir))) continue;
      this.rival = { body, prevBody: body.map((p) => ({ ...p })), dir, grow: 0, stunned: 0 };
      this.rivalRespawn = RIVAL_RESPAWN_MS;
      return;
    }
    this.rivalRespawn = 1000;
  }

  /** BFS towards the nearest target cell; falls back to any safe move. */
  private pathStep(head: Vec, dir: Dir, body: Vec[], targets: Set<number>, ignoreShed: boolean, avoid?: (c: Vec) => boolean): Dir | null {
    const blocked = (c: Vec) => this.blockedForCritter(c, body, ignoreShed) || (avoid?.(c) ?? false);
    const dirs = DIR_LIST.filter((d) => d !== OPPOSITE[dir]);
    const safe = dirs.filter((d) => !blocked(this.neighbour(head, d)) || targets.has(this.ix(this.neighbour(head, d))));
    if (!safe.length) return null;
    if (targets.size) {
      const seen = new Uint8Array(this.w * this.h);
      seen[this.ix(head)] = 1;
      const queue: { p: Vec; first: Dir }[] = [];
      for (const d of safe) {
        const n = this.neighbour(head, d);
        if (!this.inb(n) || seen[this.ix(n)]) continue;
        seen[this.ix(n)] = 1;
        queue.push({ p: n, first: d });
      }
      for (let qi = 0; qi < queue.length; qi++) {
        const { p, first } = queue[qi];
        if (targets.has(this.ix(p))) return first;
        for (const d of DIR_LIST) {
          const n = this.neighbour(p, d);
          if (!this.inb(n) || seen[this.ix(n)]) continue;
          if (blocked(n) && !targets.has(this.ix(n))) continue;
          seen[this.ix(n)] = 1;
          queue.push({ p: n, first });
        }
      }
    }
    return safe.includes(dir) ? dir : this.rng.pick(safe);
  }

  private stepRival() {
    const r = this.rival!;
    const venom = this.has('venom');
    const targets = new Set(
      this.pickups.filter((p) => p.kind === 'food' || p.kind === 'bit').map((p) => this.ix(p.pos)),
    );
    const d = this.rng.next() < 0.12 ? null : this.pathStep(r.body[0], r.dir, r.body, targets, venom);
    const dir =
      d ??
      (() => {
        const safe = DIR_LIST.filter(
          (x) => x !== OPPOSITE[r.dir] && !this.blockedForCritter(this.neighbour(r.body[0], x), r.body, venom),
        );
        return safe.length ? this.rng.pick(safe) : null;
      })();
    if (!dir) {
      this.killRival(this.isAdjacentToPlayer(r.body[0]));
      return;
    }
    r.dir = dir;
    const nh = this.neighbour(r.body[0], dir);
    if (venom && this.shedWalls.some((w) => eq(w.pos, nh))) {
      this.killRival(true);
      return;
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      if (eq(nh, p.body[0])) {
        if (p.body.length >= r.body.length) this.killRival(true);
        else this.hurt(p, 'rival', nh);
        return;
      }
      if (p.body.some((s) => eq(s, nh))) {
        this.killRival(true);
        return;
      }
    }
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
    return (
      this.players.some((pl) => pl.body.some((s) => manhattan(s, p) <= 1)) ||
      this.shedWalls.some((w) => manhattan(w.pos, p) <= 1)
    );
  }

  private killRival(byPlayer: boolean): number {
    const r = this.rival;
    if (!r) return 0;
    this.rival = null;
    this.rivalRespawn = RIVAL_RESPAWN_MS;
    const points = byPlayer ? Math.round(40 * this.lengthMult) : 0;
    if (byPlayer) {
      this.p0.score += points;
      this.rivalsDowned++;
    }
    this.dropBits(r.body);
    this.events.push({ type: 'rivalDie', cells: r.body, byPlayer, points });
    return points;
  }

  private dropBits(cells: Vec[]) {
    for (let i = 1; i < cells.length; i += 2) {
      const p = cells[i];
      if (
        this.inb(p) &&
        !this.solid[this.ix(p)] &&
        !this.pickups.some((q) => eq(q.pos, p)) &&
        !this.players.some((pl) => pl.body.some((s) => eq(s, p)))
      ) {
        this.spawnPickup('bit', BIT_TTL_MS, { ...p });
      }
    }
  }

  // ---------------------------------------------------------------- bosses

  private spawnBoss(kind: BossKind, tier: number) {
    const hp = 3 + (tier - 1);
    const b: Boss = {
      kind,
      tier,
      hp,
      maxHp: hp,
      invuln: 0,
      stunned: 1500,
      body: [],
      prevBody: [],
      dir: 'left',
      moveTick: 0,
      core: { x: 15, y: 5 },
      shield: true,
      shieldTimer: 0,
      dronesEaten: 0,
      spawnTimer: 1200,
      mineTimer: 5000,
      hitCooldown: 0,
    };
    if (kind === 'serpent') {
      b.body = this.layBody({ x: 19, y: 19 }, 'up', 10 + tier * 2);
      b.prevBody = b.body.map((s) => ({ ...s }));
      b.dir = 'up';
    }
    this.boss = b;
  }

  private tickBoss(dt: number) {
    const b = this.boss!;
    b.invuln = Math.max(0, b.invuln - dt);
    b.stunned = Math.max(0, b.stunned - dt);
    b.hitCooldown = Math.max(0, b.hitCooldown - dt);
    if (b.kind !== 'queen') return;
    const near = { at: { x: b.core.x, y: b.core.y }, radius: 5 };
    b.spawnTimer -= dt;
    if (b.spawnTimer <= 0) {
      b.spawnTimer = 2500;
      if (this.mice.filter((m) => m.drone).length < 6) this.spawnMouse(true, near);
    }
    b.mineTimer -= dt;
    if (b.mineTimer <= 0) {
      b.mineTimer = 7000 - b.tier * 500;
      if (this.mines.length < 4 + b.tier) {
        const pos = this.freeCell(5, { at: b.core, radius: 7 });
        if (pos) this.mines.push({ pos, offset: this.rng.int(MINE_PERIOD_MS) });
      }
    }
    if (!b.shield) {
      b.shieldTimer -= dt;
      if (b.shieldTimer <= 0) {
        b.shield = true;
        b.dronesEaten = 0;
        this.events.push({ type: 'shield', up: true });
      }
    }
  }

  private stepBoss() {
    const b = this.boss!;
    if (b.kind === 'queen') {
      if (b.shield || b.hitCooldown > 0) return;
      const cells = this.bossCells();
      const touching = this.players.some((p) => p.alive && cells.some((c) => manhattan(c, p.body[0]) === 1));
      if (touching) {
        b.hitCooldown = 1200;
        this.damageBoss(1);
      }
      return;
    }

    b.prevBody = b.body.map((s) => ({ ...s }));
    if (b.stunned > 0) return;
    b.moveTick++;
    if (b.moveTick % 4 === 3) return;

    const target = this.p0.alive ? this.p0 : this.players.find((p) => p.alive);
    if (!target) return;
    const th = target.body[0];
    const ahead = add(th, DIRS[target.dir]);
    const targets = new Set([this.ix(th)]);
    if (this.inb(ahead)) targets.add(this.ix(ahead));
    // The serpent ignores shed walls; that's how you trick it.
    const saved = this.boss;
    this.boss = null; // don't treat its own cells as blocking via bossAt
    const d = this.pathStep(b.body[0], b.dir, b.body, targets, true, (c) =>
      this.players.some((p) => p.alive && p.body.slice(1).some((s) => eq(s, c))),
    );
    this.boss = saved;
    if (!d) {
      this.damageBoss(1);
      return;
    }
    b.dir = d;
    const nh = this.neighbour(b.body[0], d);
    for (const p of this.players) {
      if (p.alive && eq(p.body[0], nh)) {
        this.hurt(p, 'boss', nh);
        return;
      }
    }
    const si = this.shedWalls.findIndex((w) => eq(w.pos, nh));
    if (si >= 0) {
      this.shedWalls.splice(si, 1);
      this.damageBoss(this.has('venom') ? 2 : 1);
      return;
    }
    b.body.unshift(nh);
    b.body.pop();
  }

  damageBoss(n: number) {
    const b = this.boss;
    if (!b || b.invuln > 0) return;
    b.hp = Math.max(0, b.hp - n);
    b.invuln = 1200;
    const pos = b.kind === 'serpent' ? b.body[0] : b.core;
    this.events.push({ type: 'bossHit', pos: { ...pos }, hp: b.hp });
    if (b.kind === 'serpent') {
      b.stunned = 1200;
      const remove = Math.min(3, Math.max(0, b.body.length - 3));
      const cut = b.body.splice(b.body.length - remove, remove);
      b.prevBody = b.prevBody.slice(0, b.body.length);
      this.dropBits(cut);
    }
    if (b.hp <= 0) this.killBoss();
  }

  private killBoss() {
    const b = this.boss!;
    const cells = this.bossCells().map((c) => ({ ...c }));
    const points = Math.round(200 * b.tier * this.lengthMult);
    this.p0.score += points;
    this.bossesDefeated++;
    this.boss = null;
    this.mice = this.mice.filter((m) => !m.drone);
    this.dropBits(cells);
    this.events.push({ type: 'bossDie', cells, kind: b.kind, points });
    this.completeLevel();
  }
}
