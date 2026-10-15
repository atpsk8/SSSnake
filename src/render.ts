import type { Game, Player } from './game/engine';
import { DIRS, H, W, type Dir, type GameEvent, type PickupKind, type Vec } from './game/types';
import type { PaletteId } from './storage';

export interface Palette {
  bgTop: string;
  bgBottom: string;
  grid: string;
  border: string;
  head: string;
  tail: string;
  p2Head: string;
  p2Tail: string;
  food: string;
  golden: string;
  bit: string;
  rot: string;
  wall: string;
  danger: string;
  mouse: string;
  drone: string;
  rival: string;
  boss: string;
  portalA: string;
  portalB: string;
  well: string;
  arrow: string;
  spit: string;
  phase: string;
  slowmo: string;
  magnet: string;
  shrink: string;
  text: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  neon: {
    bgTop: '#0d1024',
    bgBottom: '#06070f',
    grid: 'rgba(120,140,255,0.07)',
    border: '#3b46a8',
    head: '#39ff9f',
    tail: '#00a8ff',
    p2Head: '#ffd23f',
    p2Tail: '#ff7a3d',
    food: '#ff3d7f',
    golden: '#ffd23f',
    bit: '#ff9ad5',
    rot: '#7f8f3a',
    wall: '#5b6bff',
    danger: '#ff4d4d',
    mouse: '#d8d8e8',
    drone: '#c77dff',
    rival: '#ff5cf4',
    boss: '#ff2e63',
    portalA: '#00e5ff',
    portalB: '#ff9f1c',
    well: '#9d4dff',
    arrow: '#4dffea',
    spit: '#b6ff3d',
    phase: '#b48cff',
    slowmo: '#4dd2ff',
    magnet: '#ff7a3d',
    shrink: '#a6ff3d',
    text: '#ffffff',
  },
  // Okabe-Ito based; shapes and icons also differ so colour is never the only cue.
  safe: {
    bgTop: '#111318',
    bgBottom: '#08090c',
    grid: 'rgba(255,255,255,0.06)',
    border: '#6b6f7a',
    head: '#56B4E9',
    tail: '#0072B2',
    p2Head: '#F0E442',
    p2Tail: '#E69F00',
    food: '#E69F00',
    golden: '#F0E442',
    bit: '#E69F00',
    rot: '#7a6a3a',
    wall: '#9a9ea8',
    danger: '#D55E00',
    mouse: '#c8c8c8',
    drone: '#CC79A7',
    rival: '#CC79A7',
    boss: '#D55E00',
    portalA: '#56B4E9',
    portalB: '#E69F00',
    well: '#CC79A7',
    arrow: '#009E73',
    spit: '#009E73',
    phase: '#CC79A7',
    slowmo: '#56B4E9',
    magnet: '#ffffff',
    shrink: '#009E73',
    text: '#ffffff',
  },
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  max: number;
  radius: number;
  color: string;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/** Interpolate segment positions; snap across wraps and portals instead of sliding over the board. */
function interpolate(cur: Vec[], prev: Vec[], t: number): Vec[] {
  return cur.map((c, i) => {
    const p = prev[i] ?? prev[prev.length - 1] ?? c;
    if (Math.abs(p.x - c.x) + Math.abs(p.y - c.y) > 1) return { x: c.x + 0.5, y: c.y + 0.5 };
    return { x: lerp(p.x, c.x, t) + 0.5, y: lerp(p.y, c.y, t) + 0.5 };
  });
}

export const POWER_LABEL: Record<string, string> = {
  phase: 'PHASE',
  slowmo: 'SLOW-MO',
  magnet: 'MAGNET',
  shrink: 'SHRINK',
  golden: 'GOLDEN!',
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private lctx: CanvasRenderingContext2D;
  private size = 0;
  private cell = 0;
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private rings: Ring[] = [];
  private coilFlash: { cells: Vec[]; life: number } | null = null;
  private shake = 0;
  private flash = 0;
  private flashColor = '255,80,80';
  private beat = 0;
  private clock = 0;
  palette: Palette = PALETTES.neon;
  /** Player 1 skin override (empty strings = palette colours). */
  skin = { head: '', tail: '' };
  reducedMotion = false;
  ghost: Vec[] | null = null;
  /** Editor: highlighted cell (e.g. the first end of a portal pair). */
  marker: Vec | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    const lctx = this.layer.getContext('2d');
    if (!ctx || !lctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.lctx = lctx;
  }

  get cellSize() {
    return this.cell;
  }

  resize(cssSize: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = Math.floor(cssSize);
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.canvas.width = Math.floor(this.size * dpr);
    this.canvas.height = Math.floor(this.size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layer.width = this.canvas.width;
    this.layer.height = this.canvas.height;
    this.lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cell = this.size / W;
  }

  reset() {
    this.particles = [];
    this.popups = [];
    this.rings = [];
    this.coilFlash = null;
    this.shake = 0;
    this.flash = 0;
    this.ghost = null;
  }

  playerColors(id: number): [string, string] {
    if (id === 1) return [this.palette.p2Head, this.palette.p2Tail];
    return [this.skin.head || this.palette.head, this.skin.tail || this.palette.tail];
  }

  // ---------------------------------------------------------------- effects

  private burst(cells: Vec[], color: string, perCell: number, speed = 6) {
    const max = 600;
    for (const c of cells) {
      for (let i = 0; i < perCell && this.particles.length < max; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = (0.3 + Math.random()) * speed;
        const life = 350 + Math.random() * 450;
        this.particles.push({
          x: c.x + 0.5,
          y: c.y + 0.5,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life,
          max: life,
          color,
          size: 0.08 + Math.random() * 0.12,
        });
      }
    }
  }

  private popup(text: string, at: Vec, color: string, size = 0.7) {
    this.popups.push({ text, x: at.x + 0.5, y: at.y + 0.2, life: 900, max: 900, color, size });
  }

  private ring(at: Vec, radius: number, color: string, life = 500) {
    this.rings.push({ x: at.x + 0.5, y: at.y + 0.5, radius, color, life, max: life });
  }

  private addShake(amount: number) {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, amount);
  }

  private screenFlash(rgb: string, amount = 1) {
    if (this.reducedMotion) return;
    this.flashColor = rgb;
    this.flash = Math.max(this.flash, amount);
  }

  handle(events: GameEvent[], game: Game) {
    const p = this.palette;
    for (const e of events) {
      switch (e.type) {
        case 'eat': {
          const color = e.kind === 'golden' ? p.golden : e.kind === 'bit' ? p.bit : p.food;
          this.burst([e.pos], color, e.kind === 'golden' ? 26 : 12);
          const mult = e.mult > 1 ? ` x${+e.mult.toFixed(1)}` : '';
          this.popup(`+${e.points}${mult}`, e.pos, color, e.kind === 'golden' ? 0.9 : 0.65);
          break;
        }
        case 'rot':
          this.burst([e.pos], p.rot, 14);
          this.popup('ROTTEN -10', e.pos, p.rot);
          break;
        case 'combo':
          this.popup(`COMBO x${e.combo}`, { x: e.pos.x, y: e.pos.y - 1 }, p.golden, 0.75);
          break;
        case 'power':
          this.burst([e.pos], this.pickupColor(e.kind), 18);
          this.popup(POWER_LABEL[e.kind], { x: e.pos.x, y: e.pos.y - 1 }, this.pickupColor(e.kind), 0.75);
          break;
        case 'shrink':
          this.burst(e.cells, p.shrink, 8);
          break;
        case 'shed': {
          const [, tail] = this.playerColors(e.player);
          this.burst(e.cells, tail, 6, 4);
          this.addShake(5);
          if (e.cells.length) this.popup('SHED!', e.cells[0], this.playerColors(e.player)[0], 0.7);
          break;
        }
        case 'cut':
          this.burst(e.cells, p.tail, 5, 4);
          break;
        case 'mouse':
          this.burst([e.pos], e.drone ? p.drone : p.mouse, 14);
          this.popup(`+${e.points}`, e.pos, e.drone ? p.drone : p.mouse);
          break;
        case 'portal':
          this.burst([e.from, e.to], p.portalA, 10, 4);
          break;
        case 'rivalDie':
          this.burst(e.cells, p.rival, 8);
          this.addShake(6);
          if (e.byPlayer && e.cells.length) this.popup(`RIVAL DOWN +${e.points}`, e.cells[0], p.rival, 0.75);
          break;
        case 'coil': {
          this.coilFlash = { cells: e.cells, life: 600 };
          this.burst(e.cells, p.golden, 2, 3);
          const c = e.cells[Math.floor(e.cells.length / 2)] ?? { x: 12, y: 12 };
          this.popup(`COIL x${e.captured}  +${e.points}`, c, p.golden, 0.85);
          this.addShake(4);
          break;
        }
        case 'defuse':
          this.burst([e.pos], p.danger, 10, 4);
          this.ring(e.pos, 1.2, p.danger);
          break;
        case 'shift':
        case 'collapse':
          this.addShake(7);
          break;
        case 'levelup':
          this.burst(game.snake, this.playerColors(0)[0], 6);
          break;
        case 'dash':
          for (const c of e.cells) this.burst([c], this.playerColors(0)[0], 5, 3);
          this.addShake(3);
          break;
        case 'spitHit':
          this.burst([e.pos], p.spit, 16, 7);
          this.ring(e.pos, 1.5, p.spit);
          break;
        case 'stun':
          this.ring(e.pos, 3.5, p.slowmo, 600);
          this.popup('RATTLE!', e.pos, p.slowmo, 0.6);
          break;
        case 'armour':
          this.ring(e.pos, 2, '#ffffff', 600);
          this.popup('ARMOUR!', e.pos, '#ffffff', 0.8);
          this.addShake(8);
          break;
        case 'rewind':
          this.screenFlash('80,160,255', 0.9);
          break;
        case 'bossHit':
          this.burst([e.pos], p.boss, 30, 9);
          this.ring(e.pos, 2.5, p.boss, 600);
          this.popup(e.hp > 0 ? `HIT! ${e.hp} left` : 'FINISHED!', e.pos, p.boss, 0.85);
          this.addShake(10);
          break;
        case 'bossDie':
          this.burst(e.cells, p.boss, 12, 10);
          this.burst(e.cells, p.golden, 6, 6);
          this.popup(`BOSS DOWN +${e.points}`, e.cells[0] ?? { x: 12, y: 12 }, p.golden, 1);
          this.addShake(16);
          this.screenFlash('255,210,63', 0.6);
          break;
        case 'shield':
          if (!e.up && game.boss) this.popup('SHIELD DOWN!', game.boss.core, p.golden, 0.85);
          break;
        case 'beat':
          this.beat = e.strong ? 1 : 0.5;
          break;
        case 'onbeat':
          if (game.p0.body.length) this.popup(e.streak > 1 ? `PERFECT x${e.streak}` : 'PERFECT', { x: game.p0.body[0].x, y: game.p0.body[0].y - 1 }, p.golden, 0.55);
          break;
        case 'offbeat':
          if (game.p0.body.length) this.popup('MISS', { x: game.p0.body[0].x, y: game.p0.body[0].y - 1 }, p.danger, 0.55);
          break;
        case 'die':
          this.burst(e.cells, this.playerColors(e.player)[0], 6, 8);
          this.burst([e.pos], p.danger, 40, 10);
          this.addShake(14);
          this.screenFlash('255,80,80', 1);
          break;
      }
    }
  }

  pickupColor(kind: PickupKind): string {
    const p = this.palette;
    switch (kind) {
      case 'food':
        return p.food;
      case 'bit':
        return p.bit;
      case 'rot':
        return p.rot;
      case 'golden':
        return p.golden;
      default:
        return p[kind];
    }
  }

  // ---------------------------------------------------------------- draw

  private tick(dt: number) {
    this.clock += dt;
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.x += (pt.vx * dt) / 1000;
      pt.y += (pt.vy * dt) / 1000;
      pt.vx *= 0.94;
      pt.vy *= 0.94;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const pu of this.popups) {
      pu.life -= dt;
      pu.y -= (dt / 1000) * 1.4;
    }
    this.popups = this.popups.filter((pu) => pu.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    if (this.coilFlash) {
      this.coilFlash.life -= dt;
      if (this.coilFlash.life <= 0) this.coilFlash = null;
    }
    this.shake = Math.max(0, this.shake - dt * 0.03);
    this.flash = Math.max(0, this.flash - dt / 400);
    this.beat = Math.max(0, this.beat - dt / 180);
  }

  draw(game: Game, dt: number) {
    this.tick(dt);
    const { ctx, size, cell } = this;
    const p = this.palette;

    ctx.save();
    const bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, p.bgTop);
    bg.addColorStop(1, p.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    ctx.fillStyle = p.grid;
    for (let y = 1; y < H; y++) {
      for (let x = 1; x < W; x++) ctx.fillRect(x * cell - 1, y * cell - 1, 2, 2);
    }

    // Border: solid line for walls, dashed for wraparound; pulses on the beat in Rhythm.
    ctx.lineWidth = 2 + this.beat * 3;
    ctx.strokeStyle = this.beat > 0 ? mixHex(p.border, p.golden, this.beat) : p.border;
    if (game.wraps) ctx.setLineDash([cell * 0.4, cell * 0.4]);
    ctx.strokeRect(1, 1, size - 2, size - 2);
    ctx.setLineDash([]);

    if (this.coilFlash) {
      ctx.fillStyle = p.golden;
      ctx.globalAlpha = (this.coilFlash.life / 600) * 0.3;
      for (const c of this.coilFlash.cells) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
      ctx.globalAlpha = 1;
    }

    this.drawSolid(game);
    this.drawPending(game);
    this.drawWells(game);
    this.drawArrows(game);
    this.drawPortals(game);
    this.drawShedWalls(game);
    this.drawMines(game);
    this.drawPickups(game);
    this.drawMice(game);
    if (this.ghost) this.drawGhost(this.ghost);
    if (game.rival) this.drawRival(game);
    if (game.boss) this.drawBoss(game);
    for (const pl of game.players) this.drawPlayer(game, pl);
    this.drawProjectiles(game);

    if (game.modifiers.has('dark')) this.drawDarkness(game);

    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x * cell, r.y * cell, r.radius * cell * (0.3 + t * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      const s = pt.size * cell;
      ctx.fillRect(pt.x * cell - s / 2, pt.y * cell - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const pu of this.popups) {
      ctx.globalAlpha = Math.min(1, (pu.life / pu.max) * 2);
      ctx.font = `800 ${Math.round(cell * pu.size)}px system-ui, sans-serif`;
      const x = Math.min(size - 40, Math.max(40, pu.x * cell));
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(pu.text, x + 1, pu.y * cell + 1);
      ctx.fillStyle = pu.color;
      ctx.fillText(pu.text, x, pu.y * cell);
    }
    ctx.globalAlpha = 1;

    if (game.players.some((pl) => pl.alive && pl.effects.slowmo)) {
      const v = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(40,120,255,0.22)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, size, size);
    }

    if (game.boss) this.drawBossBar(game);

    if (this.marker) {
      ctx.strokeStyle = p.golden;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      this.rect(this.marker.x, this.marker.y, 0.02);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(${this.flashColor},${this.flash * 0.35})`;
      ctx.fillRect(0, 0, size, size);
    }
  }

  private rect(x: number, y: number, inset = 0.08, radius = 0.18) {
    const c = this.cell;
    this.ctx.beginPath();
    this.ctx.roundRect(x * c + c * inset, y * c + c * inset, c * (1 - inset * 2), c * (1 - inset * 2), c * radius);
  }

  private drawSolid(game: Game) {
    const { ctx } = this;
    const p = this.palette;
    const warn = game.collapseWarning;
    const nextRing = game.ring + 1;
    const blink = Math.floor(this.clock / 180) % 2 === 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (game.solid[y * W + x]) {
          const isRing = x < game.ring || y < game.ring || x >= W - game.ring || y >= H - game.ring;
          ctx.fillStyle = isRing ? 'rgba(255,77,77,0.18)' : p.wall;
          ctx.globalAlpha = isRing ? 1 : 0.85;
          this.rect(x, y, 0.06);
          ctx.fill();
          if (!isRing) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        } else if (warn && blink && (x < nextRing || y < nextRing || x >= W - nextRing || y >= H - nextRing)) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = p.danger;
          ctx.lineWidth = 1.5;
          this.rect(x, y, 0.15);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPending(game: Game) {
    if (!game.pendingMaze) return;
    const { ctx } = this;
    const blink = Math.floor(this.clock / 150) % 2 === 0;
    ctx.strokeStyle = blink ? this.palette.danger : this.palette.wall;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    for (const w of game.pendingMaze) {
      this.rect(w.x, w.y, 0.12);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawWells(game: Game) {
    const { ctx, cell } = this;
    for (const w of game.wells) {
      const cx = (w.x + 0.5) * cell;
      const cy = (w.y + 0.5) * cell;
      for (let k = 0; k < 3; k++) {
        const r = cell * (0.25 + k * 0.35 + ((this.clock / 900) % 0.35));
        ctx.globalAlpha = 0.5 - k * 0.15;
        ctx.strokeStyle = this.palette.well;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, cell * 1.3 - r), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.palette.well;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawArrows(game: Game) {
    const { ctx, cell } = this;
    for (const a of game.arrows) {
      const cx = (a.pos.x + 0.5) * cell;
      const cy = (a.pos.y + 0.5) * cell;
      const d = DIRS[a.dir];
      const side = { x: -d.y, y: d.x };
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = this.palette.arrow;
      this.rect(a.pos.x, a.pos.y, 0.06);
      ctx.fill();
      ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(this.clock / 250));
      ctx.strokeStyle = this.palette.arrow;
      ctx.lineWidth = Math.max(2, cell * 0.1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const off of [-0.15, 0.15]) {
        const bx = cx + d.x * off * cell;
        const by = cy + d.y * off * cell;
        ctx.beginPath();
        ctx.moveTo(bx - d.x * cell * 0.12 + side.x * cell * 0.22, by - d.y * cell * 0.12 + side.y * cell * 0.22);
        ctx.lineTo(bx + d.x * cell * 0.12, by + d.y * cell * 0.12);
        ctx.lineTo(bx - d.x * cell * 0.12 - side.x * cell * 0.22, by - d.y * cell * 0.12 - side.y * cell * 0.22);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPortals(game: Game) {
    const { ctx, cell } = this;
    const colors = [this.palette.portalA, this.palette.portalB];
    game.arena.portals.forEach((pair, i) => {
      for (const pt of pair) {
        const cx = (pt.x + 0.5) * cell;
        const cy = (pt.y + 0.5) * cell;
        const spin = (this.clock / 400) * (i ? -1 : 1);
        ctx.strokeStyle = colors[i % 2];
        ctx.lineWidth = cell * 0.12;
        for (let k = 0; k < 2; k++) {
          ctx.globalAlpha = k ? 0.5 : 1;
          ctx.beginPath();
          ctx.arc(cx, cy, cell * (k ? 0.25 : 0.42), spin + k, spin + k + Math.PI * 1.4);
          ctx.stroke();
        }
      }
    });
    ctx.globalAlpha = 1;
  }

  private drawShedWalls(game: Game) {
    const { ctx } = this;
    for (const w of game.shedWalls) {
      const [, tail] = this.playerColors(w.owner);
      const life = w.ttl / w.maxTtl;
      const crumbling = w.ttl < 2000;
      ctx.globalAlpha = crumbling ? 0.35 + 0.4 * Math.abs(Math.sin(this.clock / 90)) : 0.55 + life * 0.45;
      ctx.fillStyle = mixHex(tail, '#20243a', 0.45);
      this.rect(w.pos.x, w.pos.y, 0.1, 0.3);
      ctx.fill();
      ctx.strokeStyle = tail;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha *= 0.6;
      ctx.beginPath();
      const c = this.cell;
      ctx.arc((w.pos.x + 0.5) * c, (w.pos.y + 0.75) * c, c * 0.22, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawMines(game: Game) {
    const { ctx, cell } = this;
    const p = this.palette;
    for (const m of game.mines) {
      const lit = game.mineLit(m);
      const warn = game.mineWarn(m);
      const cx = (m.pos.x + 0.5) * cell;
      const cy = (m.pos.y + 0.5) * cell;
      const r = cell * (lit ? 0.36 : 0.26 + warn * 0.08);
      if (lit) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = p.danger;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.62, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = lit ? 1 : 0.45 + warn * 0.5;
      ctx.strokeStyle = p.danger;
      ctx.lineWidth = cell * 0.08;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + (lit ? this.clock / 300 : 0);
        ctx.moveTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7);
        ctx.lineTo(cx + Math.cos(a) * r * 1.35, cy + Math.sin(a) * r * 1.35);
      }
      ctx.stroke();
      ctx.fillStyle = lit ? p.danger : '#2a2d40';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawPickups(game: Game) {
    const { ctx, cell } = this;
    const ripening = game.modifiers.has('ripening');
    for (const pk of game.pickups) {
      const cx = (pk.pos.x + 0.5) * cell;
      const cy = (pk.pos.y + 0.5) * cell;
      let color = this.pickupColor(pk.kind);
      if (ripening && pk.kind === 'food') color = mixHex(this.palette.food, this.palette.golden, Math.min(1, pk.age / 16000));
      const pulse = 1 + Math.sin(this.clock / 180 + pk.id) * 0.08;
      const expiring = pk.ttl < 2000 && Math.floor(this.clock / 120) % 2 === 0;
      ctx.globalAlpha = expiring ? 0.35 : 1;

      ctx.fillStyle = color;
      ctx.globalAlpha *= 0.2;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.6 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = expiring ? 0.35 : 1;

      if (pk.kind === 'food' || pk.kind === 'bit' || pk.kind === 'rot') {
        ctx.beginPath();
        ctx.arc(cx, cy, cell * (pk.kind === 'bit' ? 0.2 : 0.32) * pulse, 0, Math.PI * 2);
        ctx.fill();
        if (pk.kind === 'rot') {
          // A couple of buzzing flies
          ctx.fillStyle = '#111';
          for (let k = 0; k < 2; k++) {
            const a = this.clock / (150 + k * 60) + k * 3;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * cell * 0.45, cy + Math.sin(a * 1.3) * cell * 0.35, cell * 0.06, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.beginPath();
          ctx.arc(cx - cell * 0.1, cy - cell * 0.1, cell * 0.08, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        this.drawPowerIcon(pk.kind, cx, cy, pulse, color);
      }

      if (Number.isFinite(pk.maxTtl) && pk.kind !== 'bit') {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.55, -Math.PI / 2, -Math.PI / 2 + (pk.ttl / pk.maxTtl) * Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPowerIcon(kind: PickupKind, cx: number, cy: number, pulse: number, color: string) {
    const { ctx, cell } = this;
    const s = cell * 0.36 * pulse;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#0b0d1a';
    ctx.lineWidth = Math.max(1.5, cell * 0.08);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (kind === 'golden') {
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const r = k % 2 ? s * 0.5 : s * 1.15;
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    ctx.roundRect(cx - s, cy - s, s * 2, s * 2, s * 0.45);
    ctx.fill();
    ctx.beginPath();
    switch (kind) {
      case 'phase':
        ctx.setLineDash([s * 0.35, s * 0.3]);
        ctx.arc(cx, cy, s * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case 'slowmo':
        ctx.moveTo(cx - s * 0.5, cy - s * 0.6);
        ctx.lineTo(cx + s * 0.5, cy - s * 0.6);
        ctx.lineTo(cx - s * 0.5, cy + s * 0.6);
        ctx.lineTo(cx + s * 0.5, cy + s * 0.6);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'magnet':
        ctx.moveTo(cx - s * 0.5, cy - s * 0.6);
        ctx.lineTo(cx - s * 0.5, cy + s * 0.05);
        ctx.arc(cx, cy + s * 0.05, s * 0.5, Math.PI, 0, true);
        ctx.lineTo(cx + s * 0.5, cy - s * 0.6);
        ctx.stroke();
        break;
      case 'shrink':
        ctx.moveTo(cx - s * 0.55, cy - s * 0.55);
        ctx.lineTo(cx, cy - s * 0.05);
        ctx.lineTo(cx + s * 0.55, cy - s * 0.55);
        ctx.moveTo(cx - s * 0.55, cy + s * 0.05);
        ctx.lineTo(cx, cy + s * 0.55);
        ctx.lineTo(cx + s * 0.55, cy + s * 0.05);
        ctx.stroke();
        break;
    }
  }

  private drawMice(game: Game) {
    const { ctx, cell } = this;
    const t = game.worldAlpha;
    for (const m of game.mice) {
      const jump = Math.abs(m.prev.x - m.pos.x) + Math.abs(m.prev.y - m.pos.y) > 1;
      const x = (jump ? m.pos.x : lerp(m.prev.x, m.pos.x, t)) + 0.5;
      const y = (jump ? m.pos.y : lerp(m.prev.y, m.pos.y, t)) + 0.5;
      ctx.globalAlpha = m.ttl < 2000 && Math.floor(this.clock / 120) % 2 === 0 ? 0.4 : 1;
      if (m.drone) {
        // Drone: a small winged diamond
        const flap = Math.sin(this.clock / 60) * 0.12;
        ctx.fillStyle = this.palette.drone;
        ctx.beginPath();
        ctx.moveTo(x * cell, (y - 0.3) * cell);
        ctx.lineTo((x + 0.22) * cell, y * cell);
        ctx.lineTo(x * cell, (y + 0.3) * cell);
        ctx.lineTo((x - 0.22) * cell, y * cell);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha *= 0.5;
        ctx.beginPath();
        ctx.ellipse((x - 0.3) * cell, (y - 0.1) * cell, cell * 0.18, cell * (0.1 + flap), -0.4, 0, Math.PI * 2);
        ctx.ellipse((x + 0.3) * cell, (y - 0.1) * cell, cell * 0.18, cell * (0.1 + flap), 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const facing = m.pos.x >= m.prev.x ? 1 : -1;
        ctx.fillStyle = this.palette.mouse;
        ctx.beginPath();
        ctx.ellipse(x * cell, y * cell, cell * 0.3, cell * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc((x + 0.18 * facing) * cell, (y - 0.2) * cell, cell * 0.11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.palette.mouse;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo((x - 0.28 * facing) * cell, y * cell);
        ctx.quadraticCurveTo((x - 0.5 * facing) * cell, (y - 0.3) * cell, (x - 0.55 * facing) * cell, (y + 0.05) * cell);
        ctx.stroke();
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc((x + 0.2 * facing) * cell, (y - 0.03) * cell, cell * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      if (m.stunned > 0) this.drawStunStars(x, y - 0.45);
    }
    ctx.globalAlpha = 1;
  }

  private drawStunStars(x: number, y: number) {
    const { ctx, cell } = this;
    ctx.fillStyle = this.palette.golden;
    for (let k = 0; k < 3; k++) {
      const a = this.clock / 200 + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc((x + Math.cos(a) * 0.3) * cell, (y + Math.sin(a) * 0.1) * cell, cell * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGhost(body: Vec[]) {
    const pts = body.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
    this.drawBody(pts, '#ffffff', '#8890c0', 0.6, 0.22);
  }

  private drawRival(game: Game) {
    const r = game.rival!;
    const pts = interpolate(r.body, r.prevBody, game.worldAlpha);
    this.drawBody(pts, this.palette.rival, mixHex(this.palette.rival, '#5a1a8f', 0.55), 0.62, r.stunned > 0 ? 0.6 : 1);
    this.drawEyes(pts, r.dir, '#fff');
    if (r.stunned > 0 && pts.length) this.drawStunStars(pts[0].x - 0.5, pts[0].y - 0.9);
  }

  private drawBoss(game: Game) {
    const b = game.boss!;
    const { ctx, cell } = this;
    const p = this.palette;
    const hurt = b.invuln > 0 && Math.floor(this.clock / 80) % 2 === 0;
    if (b.kind === 'serpent') {
      const pts = interpolate(b.body, b.prevBody, game.worldAlpha);
      this.drawBody(pts, hurt ? '#ffffff' : p.boss, mixHex(p.boss, '#3a0618', 0.6), 0.92, 1);
      this.drawEyes(pts, b.dir, p.golden);
      if (pts.length) {
        // Crown
        const h = pts[0];
        ctx.fillStyle = p.golden;
        ctx.beginPath();
        const cx = h.x * cell;
        const cy = (h.y - 0.55) * cell;
        const w = cell * 0.5;
        ctx.moveTo(cx - w / 2, cy + cell * 0.18);
        ctx.lineTo(cx - w / 2, cy - cell * 0.05);
        ctx.lineTo(cx - w / 4, cy + cell * 0.07);
        ctx.lineTo(cx, cy - cell * 0.12);
        ctx.lineTo(cx + w / 4, cy + cell * 0.07);
        ctx.lineTo(cx + w / 2, cy - cell * 0.05);
        ctx.lineTo(cx + w / 2, cy + cell * 0.18);
        ctx.closePath();
        ctx.fill();
        if (b.stunned > 0) this.drawStunStars(h.x - 0.5, h.y - 1.1);
      }
      return;
    }
    // Swarm Queen: 2x2 core
    const x = b.core.x * cell;
    const y = b.core.y * cell;
    const s = cell * 2;
    const pulse = 1 + Math.sin(this.clock / 200) * 0.04;
    ctx.save();
    ctx.translate(x + s / 2, y + s / 2);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = hurt ? '#ffffff' : p.boss;
    ctx.beginPath();
    ctx.roundRect(-s / 2 + 3, -s / 2 + 3, s - 6, s - 6, cell * 0.5);
    ctx.fill();
    ctx.fillStyle = p.drone;
    ctx.beginPath();
    ctx.arc(0, 0, cell * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0d1a';
    ctx.beginPath();
    ctx.arc(0, 0, cell * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (b.shield) {
      ctx.strokeStyle = p.slowmo;
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(this.clock / 150);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, cell * 1.45, 0, Math.PI * 2);
      ctx.stroke();
      // Drone counter pips
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k < b.dronesEaten ? p.golden : 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(x + s / 2 + (k - 1.5) * cell * 0.4, y - cell * 0.35, cell * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawBossBar(game: Game) {
    const b = game.boss!;
    const { ctx, size, cell } = this;
    const w = size * 0.5;
    const x = (size - w) / 2;
    const y = cell * 0.35;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 2, y - 2, w + 4, cell * 0.35 + 4);
    ctx.fillStyle = this.palette.boss;
    ctx.fillRect(x, y, w * (b.hp / b.maxHp), cell * 0.35);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(cell * 0.4)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(b.kind === 'serpent' ? 'SERPENT KING' : 'SWARM QUEEN', size / 2, y + cell * 0.45);
  }

  private drawProjectiles(game: Game) {
    const { ctx, cell } = this;
    const t = game.worldAlpha;
    for (const pr of game.projectiles) {
      const jump = Math.abs(pr.prev.x - pr.pos.x) + Math.abs(pr.prev.y - pr.pos.y) > 2;
      const x = (jump ? pr.pos.x : lerp(pr.prev.x, pr.pos.x, t)) + 0.5;
      const y = (jump ? pr.pos.y : lerp(pr.prev.y, pr.pos.y, t)) + 0.5;
      ctx.fillStyle = this.palette.spit;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(x * cell, y * cell, cell * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x * cell, y * cell, cell * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawDarkness(game: Game) {
    const { ctx, cell, size } = this;
    const l = this.lctx;
    l.save();
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, this.layer.width, this.layer.height);
    l.restore();
    l.globalCompositeOperation = 'source-over';
    l.fillStyle = 'rgba(2,3,8,0.94)';
    l.fillRect(0, 0, size, size);
    l.globalCompositeOperation = 'destination-out';
    for (const pl of game.players) {
      if (!pl.alive || !pl.body.length) continue;
      const pts = interpolate(pl.body.slice(0, 1), pl.prevBody.slice(0, 1), game.alphaFor(pl));
      const hx = pts[0].x * cell;
      const hy = pts[0].y * cell;
      const g = l.createRadialGradient(hx, hy, cell * 2, hx, hy, cell * 5.5);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g;
      l.fillRect(0, 0, size, size);
    }
    l.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.layer, 0, 0, size, size);
    // Food glows faintly through the dark.
    for (const pk of game.pickups) {
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.clock / 250 + pk.id);
      ctx.fillStyle = this.pickupColor(pk.kind);
      ctx.beginPath();
      ctx.arc((pk.pos.x + 0.5) * cell, (pk.pos.y + 0.5) * cell, cell * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayer(game: Game, pl: Player) {
    if (!pl.body.length || (!pl.alive && game.status !== 'over')) return;
    const p = this.palette;
    const [head, tail] = this.playerColors(pl.id);
    const pts = interpolate(pl.body, pl.prevBody, game.status === 'over' ? 1 : game.alphaFor(pl));
    const phase = pl.effects.phase ?? 0;
    let alpha = pl.alive ? 1 : 0.4;
    if (phase && pl.alive) alpha = phase < 1500 && Math.floor(this.clock / 100) % 2 ? 0.8 : 0.5;

    if (game.isSurging(pl) && pts.length) {
      const h = pts[0];
      for (let i = 0; i < 2; i++) {
        this.particles.push({
          x: h.x + (Math.random() - 0.5) * 0.4,
          y: h.y + (Math.random() - 0.5) * 0.4,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          life: 300,
          max: 300,
          color: p.golden,
          size: 0.1,
        });
      }
    }

    this.drawBody(pts, head, tail, 0.78, alpha, phase ? p.phase : undefined);
    this.drawEyes(pts, pl.dir, pl.alive ? '#0b0d1a' : p.danger);

    if (game.isHunkering(pl) && pts.length) {
      const { ctx, cell } = this;
      ctx.strokeStyle = head;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(pts[0].x * cell, pts[0].y * cell, cell * (0.7 + 0.1 * Math.sin(this.clock / 80)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (pl.armour > 0 && pts.length) {
      const { ctx, cell } = this;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pts[0].x * cell, pts[0].y * cell, cell * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (pl.effects.magnet && pts.length) {
      const { ctx, cell } = this;
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.clock / 150);
      ctx.strokeStyle = p.magnet;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(pts[0].x * cell, pts[0].y * cell, cell * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (game.players.length > 1 && pts.length) {
      const { ctx, cell } = this;
      ctx.fillStyle = head;
      ctx.font = `800 ${Math.round(cell * 0.45)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`P${pl.id + 1}`, pts[0].x * cell, (pts[0].y - 0.5) * cell);
    }
  }

  /** Thick rounded body with a head-to-tail colour gradient and a soft glow pass. */
  private drawBody(pts: Vec[], headColor: string, tailColor: string, width: number, alpha: number, outline?: string) {
    const { ctx, cell, lctx, layer, size } = this;
    if (!pts.length) return;
    const n = pts.length;

    // Each pass is drawn opaque on an offscreen layer and then composited once, so the
    // overlapping round caps don't show up as beads when the body is translucent.
    for (const pass of [0, 1]) {
      lctx.save();
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, layer.width, layer.height);
      lctx.restore();
      lctx.lineCap = 'round';
      lctx.lineJoin = 'round';
      for (let i = n - 1; i >= 0; i--) {
        const a = pts[i];
        const b = pts[i - 1] ?? a;
        const broken = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 1.5;
        const taper = 1 - (i / Math.max(n, 8)) * 0.25;
        lctx.strokeStyle = mixHex(headColor, tailColor, n > 1 ? i / (n - 1) : 0);
        lctx.lineWidth = cell * width * taper * (pass === 0 ? 1.7 : 1);
        lctx.beginPath();
        lctx.moveTo(a.x * cell, a.y * cell);
        lctx.lineTo((broken ? a.x : b.x) * cell, (broken ? a.y : b.y) * cell);
        lctx.stroke();
      }
      ctx.globalAlpha = alpha * (pass === 0 ? 0.18 : 1);
      ctx.drawImage(layer, 0, 0, size, size);
    }
    if (outline) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(pts[0].x * cell, pts[0].y * cell, cell * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  private drawEyes(pts: Vec[], dir: Dir, pupil: string) {
    if (!pts.length) return;
    const { ctx, cell } = this;
    const h = pts[0];
    const d = DIRS[dir];
    const side = { x: -d.y, y: d.x };
    for (const s of [-1, 1]) {
      const ex = (h.x + d.x * 0.15 + side.x * 0.2 * s) * cell;
      const ey = (h.y + d.y * 0.15 + side.y * 0.2 * s) * cell;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex, ey, cell * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pupil;
      ctx.beginPath();
      ctx.arc(ex + d.x * cell * 0.04, ey + d.y * cell * 0.04, cell * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
