import type { Game, Player } from './game/engine';
import { DIRS, H, W, type Dir, type GameEvent, type PickupKind, type Vec } from './game/types';
import type { PaletteId, SkinId } from './storage';

/**
 * Phosphor-terminal renderer. Everything sits on a character grid: blocks for snakes and walls,
 * glyphs for items. Bodies slide smoothly between cells; the static board (grid, walls) is
 * cached and only redrawn when it changes. Effects pulse gently instead of strobing.
 */

export interface Palette {
  bg: string;
  fg: string;
  bright: string;
  dim: string;
  faint: string;
  /** Second player / accent phosphor. */
  alt: string;
}

// Kept in step with the CSS variables in style.css.
export const PALETTES: Record<PaletteId, Palette> = {
  green: { bg: '#0c1511', fg: '#86d9a0', bright: '#cdeed6', dim: '#4f8a62', faint: '#1b2b21', alt: '#e3b766' },
  amber: { bg: '#15110b', fg: '#e2b468', bright: '#f4dcb0', dim: '#8e7140', faint: '#2d2416', alt: '#86d9a0' },
  white: { bg: '#11141a', fg: '#c9d2df', bright: '#eef2f7', dim: '#7a8494', faint: '#232a35', alt: '#e3b766' },
};

export const POWER_LABEL: Record<string, string> = {
  phase: 'PHASE',
  slowmo: 'SLOW-MO',
  magnet: 'MAGNET',
  shrink: 'SHRINK',
  golden: 'GOLDEN',
};

const POWER_GLYPH: Record<string, string> = { phase: 'P', slowmo: 'S', magnet: 'M', shrink: '-', golden: '$' };
const BITS = ['0', '1', '+', '*', '.', ':'];
const ARROW_GLYPH: Record<Dir, string> = { up: '^', down: 'v', left: '<', right: '>' };
const MAX_BITS = 220;

export const FONT = '"IBM Plex Mono", ui-monospace, Consolas, monospace';
export const DISPLAY_FONT = '"VT323", "IBM Plex Mono", ui-monospace, monospace';

type BlockStyle = 'solid' | 'outline' | 'hatch' | 'shade';

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  ch: string;
  color: string;
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

/** Top-left cell coordinates between the previous and current step; snaps across wraps/portals. */
function slide(cur: Vec[], prev: Vec[], t: number): Vec[] {
  return cur.map((c, i) => {
    const p = prev[i] ?? prev[prev.length - 1] ?? c;
    if (Math.abs(p.x - c.x) + Math.abs(p.y - c.y) > 1) return c;
    return { x: lerp(p.x, c.x, t), y: lerp(p.y, c.y, t) };
  });
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private lctx: CanvasRenderingContext2D;
  private board = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  private boardKey = '';
  private dpr = 1;
  private size = 0;
  private cell = 0;
  private lastFont = '';
  private bits: Bit[] = [];
  private popups: Popup[] = [];
  private rings: Ring[] = [];
  private coilFlash: { cells: Vec[]; life: number } | null = null;
  private shake = 0;
  private flash = 0;
  private beat = 0;
  private clock = 0;
  palette: Palette = PALETTES.green;
  skin: SkinId = 'classic';
  reducedMotion = false;
  ghost: Vec[] | null = null;
  /** Editor: highlighted cell (e.g. the first end of a portal pair). */
  marker: Vec | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    const lctx = this.layer.getContext('2d');
    const bctx = this.board.getContext('2d');
    if (!ctx || !lctx || !bctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.lctx = lctx;
    this.bctx = bctx;
  }

  get cellSize() {
    return this.cell;
  }

  resize(cssSize: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = Math.floor(cssSize);
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    for (const c of [this.canvas, this.layer, this.board]) {
      c.width = Math.floor(this.size * this.dpr);
      c.height = Math.floor(this.size * this.dpr);
    }
    for (const c of [this.ctx, this.lctx, this.bctx]) c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cell = this.size / W;
    this.boardKey = '';
    this.lastFont = '';
  }

  reset() {
    this.bits = [];
    this.popups = [];
    this.rings = [];
    this.coilFlash = null;
    this.shake = 0;
    this.flash = 0;
    this.ghost = null;
  }

  playerColor(id: number): string {
    return id === 1 ? this.palette.alt : this.palette.fg;
  }

  pickupColor(kind: PickupKind): string {
    return kind === 'rot' || kind === 'bit' ? this.palette.dim : this.palette.bright;
  }

  // ---------------------------------------------------------------- effects

  private burst(cells: Vec[], color: string, perCell: number, speed = 4) {
    for (const c of cells) {
      for (let i = 0; i < perCell && this.bits.length < MAX_BITS; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = (0.3 + Math.random()) * speed;
        const life = 300 + Math.random() * 400;
        this.bits.push({
          x: c.x + 0.5,
          y: c.y + 0.5,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life,
          max: life,
          ch: BITS[Math.floor(Math.random() * BITS.length)],
          color,
        });
      }
    }
  }

  private popup(text: string, at: Vec, color = this.palette.bright, size = 0.85) {
    this.popups.push({ text, x: at.x + 0.5, y: at.y + 0.2, life: 1000, max: 1000, color, size });
  }

  private ring(at: Vec, radius: number, color = this.palette.fg, life = 500) {
    this.rings.push({ x: at.x + 0.5, y: at.y + 0.5, radius, color, life, max: life });
  }

  private addShake(amount: number) {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, amount * 0.6);
  }

  private screenFlash(amount = 1) {
    if (!this.reducedMotion) this.flash = Math.max(this.flash, amount);
  }

  handle(events: GameEvent[], game: Game) {
    const p = this.palette;
    for (const e of events) {
      switch (e.type) {
        case 'eat': {
          this.burst([e.pos], p.fg, e.kind === 'golden' ? 12 : 5);
          const mult = e.mult > 1 ? ` x${+e.mult.toFixed(1)}` : '';
          this.popup(`+${e.points}${mult}`, e.pos, this.playerColor(e.player));
          break;
        }
        case 'rot':
          this.burst([e.pos], p.dim, 6);
          this.popup('ROTTEN -10', e.pos, p.dim);
          break;
        case 'combo':
          this.popup(`COMBO x${e.combo}`, { x: e.pos.x, y: e.pos.y - 1 }, p.bright, 0.95);
          break;
        case 'power':
          this.burst([e.pos], p.fg, 8);
          this.popup(`> ${POWER_LABEL[e.kind]}`, { x: e.pos.x, y: e.pos.y - 1 }, p.bright, 0.9);
          break;
        case 'shrink':
          this.burst(e.cells, p.dim, 4);
          break;
        case 'shed':
          this.burst(e.cells, this.playerColor(e.player), 3, 3);
          this.addShake(4);
          if (e.cells.length) this.popup('SHED', e.cells[0], this.playerColor(e.player));
          break;
        case 'cut':
          this.burst(e.cells, p.dim, 3, 3);
          break;
        case 'mouse':
          this.burst([e.pos], p.fg, 6);
          this.popup(`+${e.points}`, e.pos);
          break;
        case 'portal':
          this.burst([e.from, e.to], p.dim, 5, 3);
          break;
        case 'rivalDie':
          this.burst(e.cells, p.dim, 3);
          this.addShake(5);
          if (e.byPlayer && e.cells.length) this.popup(`RIVAL.EXE KILLED +${e.points}`, e.cells[0]);
          break;
        case 'coil': {
          this.coilFlash = { cells: e.cells, life: 800 };
          const c = e.cells[Math.floor(e.cells.length / 2)] ?? { x: 12, y: 12 };
          this.popup(`COIL x${e.captured} +${e.points}`, c, p.bright, 1.05);
          this.addShake(3);
          break;
        }
        case 'defuse':
          this.burst([e.pos], p.fg, 5, 3);
          this.ring(e.pos, 1.2);
          break;
        case 'shift':
        case 'collapse':
          this.addShake(5);
          break;
        case 'levelup':
          this.burst(game.snake, p.fg, 2);
          break;
        case 'dash':
          for (const c of e.cells) this.burst([c], p.dim, 2, 2);
          this.addShake(2);
          break;
        case 'spitHit':
          this.burst([e.pos], p.fg, 8, 5);
          this.ring(e.pos, 1.5);
          break;
        case 'stun':
          this.ring(e.pos, 3.5, p.fg, 600);
          this.popup('RATTLE', e.pos);
          break;
        case 'armour':
          this.ring(e.pos, 2, p.bright, 600);
          this.popup('ARMOUR HELD', e.pos);
          this.addShake(6);
          break;
        case 'rewind':
          this.screenFlash(0.6);
          break;
        case 'bossHit':
          this.burst([e.pos], p.fg, 14, 6);
          this.ring(e.pos, 2.5, p.bright, 600);
          this.popup(e.hp > 0 ? `HIT // ${e.hp} LEFT` : 'TERMINATED', e.pos, p.bright, 1);
          this.addShake(8);
          break;
        case 'bossDie':
          this.burst(e.cells, p.fg, 5, 7);
          this.popup(`PROCESS KILLED +${e.points}`, e.cells[0] ?? { x: 12, y: 12 }, p.bright, 1.1);
          this.addShake(10);
          this.screenFlash(0.5);
          break;
        case 'shield':
          if (!e.up && game.boss) this.popup('FIREWALL DOWN', game.boss.core, p.bright, 1);
          break;
        case 'beat':
          this.beat = e.strong ? 1 : 0.5;
          break;
        case 'onbeat':
          if (game.p0.body.length) this.popup(e.streak > 1 ? `SYNC x${e.streak}` : 'SYNC', { x: game.p0.body[0].x, y: game.p0.body[0].y - 1 }, p.bright, 0.75);
          break;
        case 'offbeat':
          if (game.p0.body.length) this.popup('DESYNC', { x: game.p0.body[0].x, y: game.p0.body[0].y - 1 }, p.dim, 0.75);
          break;
        case 'die':
          this.burst(e.cells, this.playerColor(e.player), 2, 6);
          this.burst([e.pos], p.fg, 16, 7);
          this.addShake(10);
          this.screenFlash(1);
          break;
      }
    }
  }

  // ---------------------------------------------------------------- draw

  private tick(dt: number) {
    this.clock += dt;
    const keep: Bit[] = [];
    for (const b of this.bits) {
      b.life -= dt;
      if (b.life <= 0) continue;
      b.x += (b.vx * dt) / 1000;
      b.y += (b.vy * dt) / 1000;
      b.vx *= 0.93;
      b.vy *= 0.93;
      keep.push(b);
    }
    this.bits = keep;
    for (const pu of this.popups) {
      pu.life -= dt;
      pu.y -= (dt / 1000) * 1.2;
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
    this.beat = Math.max(0, this.beat - dt / 200);
  }

  /** 0..1 smooth pulse; replaces hard on/off blinking. */
  private pulse(period: number, phase = 0): number {
    return 0.5 + 0.5 * Math.sin((this.clock / period) * Math.PI * 2 + phase);
  }

  private setFont(f: string, c = this.ctx) {
    if (c === this.ctx) {
      if (this.lastFont === f) return;
      this.lastFont = f;
    }
    c.font = f;
  }

  draw(game: Game, dt: number) {
    this.tick(dt);
    const { ctx, size, cell } = this;
    const p = this.palette;

    ctx.save();
    if (this.shake > 0) {
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, size, size);
      ctx.translate(Math.round((Math.random() - 0.5) * this.shake), Math.round((Math.random() - 0.5) * this.shake));
    }
    this.drawBoard(game);
    ctx.drawImage(this.board, 0, 0, size, size);

    if (this.beat > 0) {
      ctx.globalAlpha = this.beat * 0.8;
      ctx.strokeStyle = p.bright;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      ctx.globalAlpha = 1;
    }

    if (this.coilFlash) {
      ctx.fillStyle = p.fg;
      ctx.globalAlpha = (this.coilFlash.life / 800) * 0.25;
      for (const c of this.coilFlash.cells) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
      ctx.globalAlpha = 1;
    }

    this.drawWarnings(game);
    this.drawWells(game);
    this.drawArrows(game);
    this.drawPortals(game);
    this.drawShedWalls(game);
    this.drawMines(game);
    this.drawPickups(game);
    this.drawMice(game);
    if (this.ghost) for (const c of this.ghost) this.block(c.x, c.y, p.dim, 'outline', 0.45);
    if (game.rival) this.drawRival(game);
    if (game.boss) this.drawBoss(game);
    for (const pl of game.players) this.drawPlayer(game, pl);
    this.drawProjectiles(game);

    if (game.modifiers.has('dark')) this.drawDarkness(game);

    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.5;
      const rad = r.radius * cell * (0.3 + t * 0.7);
      ctx.strokeRect(r.x * cell - rad, r.y * cell - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;

    if (this.bits.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.setFont(`700 ${Math.round(cell * 0.7)}px ${FONT}`);
      for (const b of this.bits) {
        ctx.globalAlpha = Math.max(0, b.life / b.max) * 0.85;
        ctx.fillStyle = b.color;
        ctx.fillText(b.ch, b.x * cell, b.y * cell);
      }
      ctx.globalAlpha = 1;
    }

    for (const pu of this.popups) {
      ctx.globalAlpha = Math.min(1, (pu.life / pu.max) * 2.5);
      this.setFont(`${Math.round(cell * pu.size * 1.15)}px ${DISPLAY_FONT}`);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(pu.text).width;
      const x = Math.min(size - w / 2 - 4, Math.max(w / 2 + 4, pu.x * cell));
      const y = pu.y * cell;
      ctx.fillStyle = p.bg;
      ctx.fillRect(x - w / 2 - 3, y - cell * 0.42, w + 6, cell * 0.84);
      ctx.fillStyle = pu.color;
      ctx.fillText(pu.text, x, y);
    }
    ctx.globalAlpha = 1;

    if (game.boss) this.drawBossBar(game);

    if (this.marker) {
      ctx.strokeStyle = p.bright;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(this.marker.x * cell + 1, this.marker.y * cell + 1, cell - 2, cell - 2);
      ctx.setLineDash([]);
    }

    if (game.players.some((pl) => pl.alive && pl.effects.slowmo)) {
      ctx.fillStyle = p.fg;
      ctx.globalAlpha = 0.035 + this.pulse(1600) * 0.02;
      ctx.fillRect(0, 0, size, size);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    // restore() also reverts the font, so forget the cached one.
    this.lastFont = '';

    if (this.flash > 0) {
      ctx.fillStyle = p.fg;
      ctx.globalAlpha = this.flash * 0.12;
      ctx.fillRect(0, 0, size, size);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- static board (cached)

  private drawBoard(game: Game) {
    // Cheap fingerprint of everything the cached layer depends on.
    let h = 0;
    const solid = game.solid;
    for (let i = 0; i < solid.length; i++) if (solid[i]) h = (Math.imul(h, 31) + i + 1) | 0;
    const key = `${this.size}|${this.palette.bg}|${game.wraps ? 1 : 0}|${game.ring}|${h}`;
    if (key === this.boardKey) return;
    this.boardKey = key;

    const c = this.bctx;
    const { size, cell } = this;
    const p = this.palette;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.board.width, this.board.height);
    c.restore();
    c.fillStyle = p.bg;
    c.fillRect(0, 0, size, size);

    // Faint dot per cell, like an empty character grid.
    c.fillStyle = p.faint;
    const d = Math.max(1, Math.round(cell * 0.08));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) c.fillRect(Math.round((x + 0.5) * cell) - d / 2, Math.round((y + 0.5) * cell) - d / 2, d, d);
    }

    c.strokeStyle = p.dim;
    c.lineWidth = 1;
    if (game.wraps) c.setLineDash([cell * 0.5, cell * 0.25]);
    c.strokeRect(0.5, 0.5, size - 1, size - 1);
    c.setLineDash([]);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!solid[y * W + x]) continue;
        const ring = x < game.ring || y < game.ring || x >= W - game.ring || y >= H - game.ring;
        if (ring) this.block(x, y, p.dim, 'shade', 0.5, c);
        else {
          this.block(x, y, p.dim, 'solid', 0.7, c);
          this.glyph('#', x, y, p.bg, 0.7, 0.7, FONT, c);
        }
      }
    }
  }

  // ---------------------------------------------------------------- primitives

  /** A character-cell block with a small gutter so the grid stays visible. */
  private block(x: number, y: number, color: string, style: BlockStyle = 'solid', alpha = 1, c = this.ctx) {
    const { cell } = this;
    const g = Math.max(1, Math.round(cell * 0.06));
    const px = Math.round(x * cell) + g;
    const py = Math.round(y * cell) + g;
    const s = Math.round(cell) - g * 2;
    c.globalAlpha = alpha;
    if (style === 'solid') {
      c.fillStyle = color;
      c.fillRect(px, py, s, s);
    } else if (style === 'outline') {
      c.strokeStyle = color;
      c.lineWidth = Math.max(1, g);
      c.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
    } else if (style === 'hatch') {
      c.fillStyle = color;
      const step = Math.max(2, Math.round(s / 4));
      for (let i = 0; i < s; i += step) c.fillRect(px, py + i, s, Math.max(1, Math.round(step / 2)));
    } else {
      // Shade: a checkerboard, like the ░ character.
      c.fillStyle = color;
      const q = Math.max(2, Math.round(s / 5));
      for (let yy = 0; yy < s; yy += q) {
        for (let xx = (yy / q) % 2 ? q : 0; xx < s; xx += q * 2) c.fillRect(px + xx, py + yy, q, q);
      }
    }
    c.globalAlpha = 1;
  }

  private glyph(ch: string, x: number, y: number, color: string, scale = 0.8, alpha = 1, font = FONT, c = this.ctx) {
    const { cell } = this;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    this.setFont(`700 ${Math.round(cell * scale)}px ${font}`, c);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(ch, (x + 0.5) * cell, (y + 0.55) * cell);
    c.globalAlpha = 1;
  }

  /** Inverse video: a filled block with a dark glyph cut into it. */
  private inverse(ch: string, x: number, y: number, color: string, alpha = 1) {
    this.block(x, y, color, 'solid', alpha);
    this.glyph(ch, x, y, this.palette.bg, 0.75, alpha);
  }

  // ---------------------------------------------------------------- layers

  private drawWarnings(game: Game) {
    const p = this.palette;
    if (game.collapseWarning) {
      const next = game.ring + 1;
      const a = 0.25 + this.pulse(900) * 0.45;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (game.solid[y * W + x]) continue;
          if (x < next || y < next || x >= W - next || y >= H - next) this.block(x, y, p.fg, 'outline', a);
        }
      }
    }
    if (game.pendingMaze) {
      const a = 0.2 + this.pulse(800) * 0.4;
      for (const w of game.pendingMaze) this.glyph('#', w.x, w.y, p.fg, 0.8, a);
    }
  }

  private drawWells(game: Game) {
    const { ctx, cell } = this;
    for (const w of game.wells) {
      const t = (this.clock / 1100) % 1;
      for (let k = 0; k < 3; k++) {
        const f = (t + k / 3) % 1;
        const r = cell * (1.6 - f * 1.4);
        ctx.globalAlpha = 0.15 + f * 0.35;
        ctx.strokeStyle = this.palette.fg;
        ctx.lineWidth = 1;
        ctx.strokeRect((w.x + 0.5) * cell - r / 2, (w.y + 0.5) * cell - r / 2, r, r);
      }
      ctx.globalAlpha = 1;
      this.glyph('O', w.x, w.y, this.palette.bright, 0.8);
    }
  }

  private drawArrows(game: Game) {
    for (const a of game.arrows) {
      this.block(a.pos.x, a.pos.y, this.palette.faint);
      this.glyph(ARROW_GLYPH[a.dir], a.pos.x, a.pos.y, this.palette.fg, 0.85, 0.7 + this.pulse(1400) * 0.3);
    }
  }

  private drawPortals(game: Game) {
    const p = this.palette;
    game.arena.portals.forEach((pair, i) => {
      for (const pt of pair) {
        this.block(pt.x, pt.y, p.fg, 'outline', 0.6 + this.pulse(1600, i) * 0.4);
        this.glyph(String.fromCharCode(65 + i), pt.x, pt.y, p.bright, 0.7);
      }
    });
  }

  private drawShedWalls(game: Game) {
    for (const w of game.shedWalls) {
      // Fade out over the last 2 seconds instead of flashing.
      const alpha = w.ttl < 2000 ? 0.15 + (w.ttl / 2000) * 0.5 : 0.65 + (w.ttl / w.maxTtl) * 0.3;
      this.block(w.pos.x, w.pos.y, this.playerColor(w.owner), 'shade', alpha);
    }
  }

  private drawMines(game: Game) {
    const p = this.palette;
    for (const m of game.mines) {
      if (game.mineLit(m)) this.inverse('*', m.pos.x, m.pos.y, p.fg);
      else {
        // Brightens smoothly as it gets ready to light.
        const warn = game.mineWarn(m);
        this.glyph('*', m.pos.x, m.pos.y, warn > 0 ? p.bright : p.dim, 0.9, 0.55 + warn * 0.45);
      }
    }
  }

  private drawPickups(game: Game) {
    const p = this.palette;
    const ripening = game.modifiers.has('ripening');
    for (const pk of game.pickups) {
      // Timed pickups fade as they run out rather than blinking.
      const a = pk.ttl < 2000 ? 0.35 + (pk.ttl / 2000) * 0.65 : 1;
      const { x, y } = pk.pos;
      switch (pk.kind) {
        case 'food': {
          const ripe = ripening ? Math.min(1, pk.age / 16000) : 0;
          this.glyph('@', x, y, ripe > 0.5 ? p.bright : p.fg, 0.95 + ripe * 0.15, a);
          break;
        }
        case 'bit':
          this.glyph('.', x, y, p.fg, 1, a);
          break;
        case 'rot':
          this.glyph('%', x, y, p.dim, 0.9, a);
          break;
        case 'golden':
          this.inverse('$', x, y, p.bright, a * (0.85 + this.pulse(1200) * 0.15));
          break;
        default:
          this.inverse(POWER_GLYPH[pk.kind], x, y, p.fg, a);
      }
      if (Number.isFinite(pk.maxTtl) && pk.kind !== 'bit') {
        const { ctx, cell } = this;
        ctx.fillStyle = p.dim;
        ctx.fillRect(x * cell + 2, (y + 1) * cell - 2, (cell - 4) * (pk.ttl / pk.maxTtl), 1.5);
      }
    }
  }

  private drawMice(game: Game) {
    const p = this.palette;
    const t = game.worldAlpha;
    for (const m of game.mice) {
      const jump = Math.abs(m.prev.x - m.pos.x) + Math.abs(m.prev.y - m.pos.y) > 1;
      const x = jump ? m.pos.x : lerp(m.prev.x, m.pos.x, t);
      const y = jump ? m.pos.y : lerp(m.prev.y, m.pos.y, t);
      const a = m.ttl < 2000 ? 0.35 + (m.ttl / 2000) * 0.65 : 1;
      this.glyph(m.drone ? 'w' : 'm', x, y, m.drone ? p.bright : p.fg, 0.95, a);
      if (m.stunned > 0) this.glyph('z', x + 0.35, y - 0.45, p.dim, 0.5);
    }
  }

  private drawRival(game: Game) {
    const r = game.rival!;
    const p = this.palette;
    const pts = slide(r.body, r.prevBody, game.worldAlpha);
    for (let i = pts.length - 1; i >= 1; i--) this.block(pts[i].x, pts[i].y, p.dim, 'hatch', r.stunned > 0 ? 0.5 : 1);
    this.block(pts[0].x, pts[0].y, p.fg, 'hatch');
    this.glyph(ARROW_GLYPH[r.dir], pts[0].x, pts[0].y, p.bright, 0.7);
    if (r.stunned > 0) this.glyph('z', pts[0].x + 0.4, pts[0].y - 0.5, p.dim, 0.5);
  }

  private drawBoss(game: Game) {
    const b = game.boss!;
    const p = this.palette;
    const hurt = b.invuln > 0 ? this.pulse(220) : 0;
    const color = hurt > 0.5 ? p.bright : p.fg;
    if (b.kind === 'serpent') {
      const pts = slide(b.body, b.prevBody, game.worldAlpha);
      for (let i = pts.length - 1; i >= 1; i--) this.block(pts[i].x, pts[i].y, color, 'hatch');
      const h = pts[0];
      this.inverse('K', h.x, h.y, hurt > 0.5 ? p.fg : p.bright);
      if (b.stunned > 0) this.glyph('z', h.x + 0.4, h.y - 0.5, p.dim, 0.5);
      return;
    }
    const { ctx, cell } = this;
    const c = b.core;
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      this.block(c.x + dx, c.y + dy, color, 'hatch');
    }
    ctx.fillStyle = p.bg;
    ctx.fillRect((c.x + 0.6) * cell, (c.y + 0.6) * cell, cell * 0.8, cell * 0.8);
    this.glyph('Q', c.x + 0.5, c.y + 0.5, p.bright, 0.85);
    if (b.shield) {
      ctx.strokeStyle = p.fg;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -this.clock / 80;
      ctx.strokeRect((c.x - 0.5) * cell, (c.y - 0.5) * cell, cell * 3, cell * 3);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      this.setFont(`${Math.round(cell * 0.8)}px ${DISPLAY_FONT}`);
      ctx.fillStyle = p.bright;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`[${'#'.repeat(b.dronesEaten)}${'.'.repeat(4 - b.dronesEaten)}]`, (c.x + 1) * cell, (c.y - 0.95) * cell);
    }
  }

  private drawBossBar(game: Game) {
    const b = game.boss!;
    const { ctx, size, cell } = this;
    const name = b.kind === 'serpent' ? 'SERPENT_KING' : 'SWARM_QUEEN';
    const bar = `${name} [${'#'.repeat(b.hp)}${'.'.repeat(Math.max(0, b.maxHp - b.hp))}]`;
    this.setFont(`${Math.round(cell * 0.9)}px ${DISPLAY_FONT}`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(bar).width;
    ctx.fillStyle = this.palette.bg;
    ctx.fillRect(size / 2 - w / 2 - 6, 2, w + 12, cell * 0.95);
    ctx.fillStyle = this.palette.bright;
    ctx.fillText(bar, size / 2, 3);
  }

  private drawProjectiles(game: Game) {
    const t = game.worldAlpha;
    for (const pr of game.projectiles) {
      const jump = Math.abs(pr.prev.x - pr.pos.x) + Math.abs(pr.prev.y - pr.pos.y) > 2;
      this.glyph('*', jump ? pr.pos.x : lerp(pr.prev.x, pr.pos.x, t), jump ? pr.pos.y : lerp(pr.prev.y, pr.pos.y, t), this.palette.bright, 1);
    }
  }

  private drawDarkness(game: Game) {
    const { ctx, cell, size } = this;
    const l = this.lctx;
    l.save();
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, this.layer.width, this.layer.height);
    l.restore();
    l.fillStyle = this.palette.bg;
    l.globalAlpha = 0.95;
    l.fillRect(0, 0, size, size);
    l.globalAlpha = 1;
    l.globalCompositeOperation = 'destination-out';
    for (const pl of game.players) {
      if (!pl.alive || !pl.body.length) continue;
      const h = slide(pl.body.slice(0, 1), pl.prevBody.slice(0, 1), game.alphaFor(pl))[0];
      const hx = (h.x + 0.5) * cell;
      const hy = (h.y + 0.5) * cell;
      const g = l.createRadialGradient(hx, hy, cell * 2, hx, hy, cell * 5.5);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g;
      l.fillRect(0, 0, size, size);
    }
    l.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.layer, 0, 0, size, size);
    for (const pk of game.pickups) this.glyph('.', pk.pos.x, pk.pos.y, this.palette.fg, 1, 0.3 + this.pulse(1600) * 0.3);
  }

  private drawPlayer(game: Game, pl: Player) {
    if (!pl.body.length || (!pl.alive && game.status !== 'over')) return;
    const p = this.palette;
    const color = this.playerColor(pl.id);
    const phase = pl.effects.phase ?? 0;
    const dead = !pl.alive;
    let style: BlockStyle = 'solid';
    if (pl.id === 0 && this.skin === 'ember') style = 'hatch';
    if (pl.id === 0 && this.skin === 'ghost') style = 'outline';
    // Phase: hollow blocks; in its last 1.5s it eases back to solid.
    let alphaMul = 1;
    if (phase && !dead) {
      style = 'outline';
      if (phase < 1500) alphaMul = 0.6 + this.pulse(500) * 0.4;
    }

    const pts = game.status === 'over' ? pl.body : slide(pl.body, pl.prevBody, game.alphaFor(pl));
    const n = pts.length;
    for (let i = n - 1; i >= 1; i--) {
      const fade = 1 - (i / Math.max(n, 6)) * 0.45;
      this.block(pts[i].x, pts[i].y, color, style, (dead ? 0.35 : fade) * alphaMul);
    }
    const h = pts[0];
    const headColor = pl.id === 0 && this.skin === 'gold' ? p.bright : color;
    this.block(h.x, h.y, headColor, 'solid', dead ? 0.5 : 1);
    this.glyph(dead ? 'x' : ARROW_GLYPH[pl.dir], h.x, h.y, p.bg, 0.8);

    if (game.isSurging(pl) && Math.random() < 0.35 && this.bits.length < MAX_BITS) {
      const back = DIRS[pl.dir];
      this.bits.push({
        x: h.x + 0.5 - back.x * 0.8,
        y: h.y + 0.5 - back.y * 0.8,
        vx: -back.x * 3 + (Math.random() - 0.5),
        vy: -back.y * 3 + (Math.random() - 0.5),
        life: 250,
        max: 250,
        ch: '>',
        color: p.dim,
      });
    }
    if (game.isHunkering(pl)) {
      this.glyph('[', h.x - 0.75, h.y, p.bright, 0.9);
      this.glyph(']', h.x + 0.75, h.y, p.bright, 0.9);
    }
    if (pl.armour > 0) this.block(h.x, h.y, p.bright, 'outline', 0.6);
    if (pl.effects.magnet) {
      const { ctx, cell } = this;
      ctx.strokeStyle = p.dim;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([2, 6]);
      ctx.lineDashOffset = this.clock / 60;
      ctx.strokeRect((h.x - 5.5) * cell, (h.y - 5.5) * cell, cell * 12, cell * 12);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.globalAlpha = 1;
    }
    if (game.players.length > 1) this.glyph(`P${pl.id + 1}`, h.x, h.y - 0.85, color, 0.55);
  }
}
