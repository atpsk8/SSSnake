import type { Game, Player } from './game/engine';
import { DIRS, H, W, type Dir, type GameEvent, type PickupKind, type Vec } from './game/types';
import type { PaletteId, SkinId } from './storage';

/**
 * Green-phosphor terminal renderer. Everything is drawn on a character grid: solid blocks for
 * snakes and walls, glyphs for items. Movement is discrete, like a real terminal.
 */

export interface Palette {
  bg: string;
  fg: string;
  bright: string;
  dim: string;
  faint: string;
  /** Second player / accent phosphor. */
  alt: string;
  altDim: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  green: { bg: '#020a04', fg: '#33ff66', bright: '#c8ffd4', dim: '#1f9940', faint: '#0b3a18', alt: '#ffb000', altDim: '#8a5f00' },
  amber: { bg: '#0a0600', fg: '#ffb000', bright: '#ffe2a0', dim: '#a06e00', faint: '#3d2a00', alt: '#33ff66', altDim: '#1f9940' },
  white: { bg: '#05070a', fg: '#d8e6ff', bright: '#ffffff', dim: '#7f8aa0', faint: '#1f2533', alt: '#ffb000', altDim: '#8a5f00' },
};

export const POWER_LABEL: Record<string, string> = {
  phase: 'PHASE',
  slowmo: 'SLOW-MO',
  magnet: 'MAGNET',
  shrink: 'SHRINK',
  golden: 'GOLDEN',
};

const POWER_GLYPH: Record<string, string> = { phase: 'P', slowmo: 'S', magnet: 'M', shrink: '-', golden: '$' };
const BITS = ['0', '1', '+', '*', '#', '%', '.', ':'];
const ARROW_GLYPH: Record<Dir, string> = { up: '^', down: 'v', left: '<', right: '>' };

export const FONT = '"IBM Plex Mono", ui-monospace, Consolas, monospace';
export const DISPLAY_FONT = '"VT323", "IBM Plex Mono", ui-monospace, monospace';

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

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private lctx: CanvasRenderingContext2D;
  private size = 0;
  private cell = 0;
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

  private burst(cells: Vec[], color: string, perCell: number, speed = 5) {
    for (const c of cells) {
      for (let i = 0; i < perCell && this.bits.length < 500; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = (0.3 + Math.random()) * speed;
        const life = 300 + Math.random() * 500;
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

  private ring(at: Vec, radius: number, color = this.palette.bright, life = 500) {
    this.rings.push({ x: at.x + 0.5, y: at.y + 0.5, radius, color, life, max: life });
  }

  private addShake(amount: number) {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, amount);
  }

  private screenFlash(amount = 1) {
    if (!this.reducedMotion) this.flash = Math.max(this.flash, amount);
  }

  handle(events: GameEvent[], game: Game) {
    const p = this.palette;
    for (const e of events) {
      switch (e.type) {
        case 'eat': {
          this.burst([e.pos], p.bright, e.kind === 'golden' ? 20 : 8);
          const mult = e.mult > 1 ? ` x${+e.mult.toFixed(1)}` : '';
          this.popup(`+${e.points}${mult}`, e.pos, this.playerColor(e.player));
          break;
        }
        case 'rot':
          this.burst([e.pos], p.dim, 10);
          this.popup('ROTTEN -10', e.pos, p.dim);
          break;
        case 'combo':
          this.popup(`COMBO x${e.combo}`, { x: e.pos.x, y: e.pos.y - 1 }, p.bright, 0.95);
          break;
        case 'power':
          this.burst([e.pos], p.bright, 14);
          this.popup(`> ${POWER_LABEL[e.kind]}`, { x: e.pos.x, y: e.pos.y - 1 }, p.bright, 0.9);
          break;
        case 'shrink':
          this.burst(e.cells, p.dim, 6);
          break;
        case 'shed':
          this.burst(e.cells, this.playerColor(e.player), 5, 3);
          this.addShake(4);
          if (e.cells.length) this.popup('SHED', e.cells[0], this.playerColor(e.player));
          break;
        case 'cut':
          this.burst(e.cells, p.dim, 4, 3);
          break;
        case 'mouse':
          this.burst([e.pos], p.bright, 10);
          this.popup(`+${e.points}`, e.pos);
          break;
        case 'portal':
          this.burst([e.from, e.to], p.fg, 8, 3);
          break;
        case 'rivalDie':
          this.burst(e.cells, p.dim, 6);
          this.addShake(5);
          if (e.byPlayer && e.cells.length) this.popup(`RIVAL.EXE KILLED +${e.points}`, e.cells[0]);
          break;
        case 'coil': {
          this.coilFlash = { cells: e.cells, life: 700 };
          const c = e.cells[Math.floor(e.cells.length / 2)] ?? { x: 12, y: 12 };
          this.popup(`COIL x${e.captured} +${e.points}`, c, p.bright, 1.05);
          this.addShake(4);
          break;
        }
        case 'defuse':
          this.burst([e.pos], p.fg, 8, 3);
          this.ring(e.pos, 1.2);
          break;
        case 'shift':
        case 'collapse':
          this.addShake(6);
          break;
        case 'levelup':
          this.burst(game.snake, p.fg, 4);
          break;
        case 'dash':
          for (const c of e.cells) this.burst([c], p.fg, 4, 2);
          this.addShake(3);
          break;
        case 'spitHit':
          this.burst([e.pos], p.bright, 14, 6);
          this.ring(e.pos, 1.5);
          break;
        case 'stun':
          this.ring(e.pos, 3.5, p.fg, 600);
          this.popup('RATTLE', e.pos);
          break;
        case 'armour':
          this.ring(e.pos, 2, p.bright, 600);
          this.popup('ARMOUR HELD', e.pos);
          this.addShake(8);
          break;
        case 'rewind':
          this.screenFlash(0.8);
          break;
        case 'bossHit':
          this.burst([e.pos], p.bright, 26, 8);
          this.ring(e.pos, 2.5, p.bright, 600);
          this.popup(e.hp > 0 ? `HIT // ${e.hp} LEFT` : 'TERMINATED', e.pos, p.bright, 1);
          this.addShake(10);
          break;
        case 'bossDie':
          this.burst(e.cells, p.bright, 10, 9);
          this.popup(`PROCESS KILLED +${e.points}`, e.cells[0] ?? { x: 12, y: 12 }, p.bright, 1.1);
          this.addShake(14);
          this.screenFlash(0.6);
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
          this.burst(e.cells, this.playerColor(e.player), 5, 7);
          this.burst([e.pos], p.bright, 30, 9);
          this.addShake(12);
          this.screenFlash(1);
          break;
      }
    }
  }

  // ---------------------------------------------------------------- draw

  private tick(dt: number) {
    this.clock += dt;
    for (const b of this.bits) {
      b.life -= dt;
      b.x += (b.vx * dt) / 1000;
      b.y += (b.vy * dt) / 1000;
      b.vx *= 0.93;
      b.vy *= 0.93;
    }
    this.bits = this.bits.filter((b) => b.life > 0);
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
    this.flash = Math.max(0, this.flash - dt / 350);
    this.beat = Math.max(0, this.beat - dt / 160);
  }

  private blink(period: number) {
    return Math.floor(this.clock / period) % 2 === 0;
  }

  draw(game: Game, dt: number) {
    this.tick(dt);
    const { ctx, size, cell } = this;
    const p = this.palette;

    ctx.save();
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, size, size);
    if (this.shake > 0) {
      // Terminal shake snaps to whole pixels.
      ctx.translate(Math.round((Math.random() - 0.5) * this.shake), Math.round((Math.random() - 0.5) * this.shake));
    }

    // Faint dot per cell, like an empty character grid.
    ctx.fillStyle = p.faint;
    const d = Math.max(1, Math.round(cell * 0.08));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) ctx.fillRect(Math.round((x + 0.5) * cell) - d / 2, Math.round((y + 0.5) * cell) - d / 2, d, d);
    }

    ctx.strokeStyle = this.beat > 0 ? p.bright : p.dim;
    ctx.lineWidth = 1 + this.beat * 2;
    if (game.wraps) ctx.setLineDash([cell * 0.5, cell * 0.25]);
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    ctx.setLineDash([]);

    if (this.coilFlash) {
      ctx.fillStyle = p.fg;
      ctx.globalAlpha = (this.coilFlash.life / 700) * 0.45 * (this.blink(70) ? 1 : 0.6);
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
    if (this.ghost) this.drawBlocks(this.ghost, p.dim, 'outline', 0.5);
    if (game.rival) this.drawRival(game);
    if (game.boss) this.drawBoss(game);
    for (const pl of game.players) this.drawPlayer(game, pl);
    this.drawProjectiles(game);

    if (game.modifiers.has('dark')) this.drawDarkness(game);

    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      const rad = r.radius * cell * (0.3 + t * 0.7);
      ctx.strokeRect(r.x * cell - rad, r.y * cell - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(cell * 0.75)}px ${FONT}`;
    for (const b of this.bits) {
      ctx.globalAlpha = Math.max(0, b.life / b.max);
      ctx.fillStyle = b.color;
      ctx.fillText(b.ch, b.x * cell, b.y * cell);
    }
    ctx.globalAlpha = 1;

    for (const pu of this.popups) {
      ctx.globalAlpha = Math.min(1, (pu.life / pu.max) * 2.5);
      ctx.font = `${Math.round(cell * pu.size * 1.15)}px ${DISPLAY_FONT}`;
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
      ctx.globalAlpha = 0.05 + (this.blink(500) ? 0.02 : 0);
      ctx.fillRect(0, 0, size, size);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = p.fg;
      ctx.globalAlpha = this.flash * 0.3;
      ctx.fillRect(0, 0, size, size);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- primitives

  /** A character-cell block with a 1px gutter so the grid stays visible. */
  private block(x: number, y: number, color: string, style: 'solid' | 'outline' | 'hatch' | 'shade' = 'solid', alpha = 1) {
    const { ctx, cell } = this;
    const g = Math.max(1, Math.round(cell * 0.06));
    const px = Math.round(x * cell) + g;
    const py = Math.round(y * cell) + g;
    const s = Math.round(cell) - g * 2;
    ctx.globalAlpha = alpha;
    if (style === 'solid') {
      ctx.fillStyle = color;
      ctx.fillRect(px, py, s, s);
    } else if (style === 'outline') {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, g);
      ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
    } else if (style === 'hatch') {
      ctx.fillStyle = color;
      const step = Math.max(2, Math.round(s / 4));
      for (let i = 0; i < s; i += step) {
        ctx.fillRect(px, py + i, s, Math.max(1, Math.round(step / 2)));
      }
    } else {
      // Shade: a checkerboard, like the ░ character.
      ctx.fillStyle = color;
      const q = Math.max(2, Math.round(s / 5));
      for (let yy = 0; yy < s; yy += q) {
        for (let xx = (yy / q) % 2 ? q : 0; xx < s; xx += q * 2) ctx.fillRect(px + xx, py + yy, q, q);
      }
    }
    ctx.globalAlpha = 1;
  }

  private glyph(ch: string, x: number, y: number, color: string, scale = 0.8, alpha = 1, font = FONT) {
    const { ctx, cell } = this;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.round(cell * scale)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, (x + 0.5) * cell, (y + 0.55) * cell);
    ctx.globalAlpha = 1;
  }

  /** Inverse video: a filled block with a dark glyph cut into it. */
  private inverse(ch: string, x: number, y: number, color: string, alpha = 1) {
    this.block(x, y, color, 'solid', alpha);
    this.glyph(ch, x, y, this.palette.bg, 0.75, alpha);
  }

  private drawBlocks(cells: Vec[], color: string, style: 'solid' | 'outline' | 'hatch' | 'shade', alpha = 1) {
    for (const c of cells) this.block(c.x, c.y, color, style, alpha);
  }

  // ---------------------------------------------------------------- layers

  private drawSolid(game: Game) {
    const p = this.palette;
    const warn = game.collapseWarning;
    const next = game.ring + 1;
    const blink = this.blink(180);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (game.solid[y * W + x]) {
          const ring = x < game.ring || y < game.ring || x >= W - game.ring || y >= H - game.ring;
          if (ring) this.block(x, y, p.dim, 'shade', 0.6);
          else {
            this.block(x, y, p.dim, 'solid', 0.85);
            this.glyph('#', x, y, p.bg, 0.7, 0.8);
          }
        } else if (warn && blink && (x < next || y < next || x >= W - next || y >= H - next)) {
          this.block(x, y, p.fg, 'outline', 0.8);
        }
      }
    }
  }

  private drawPending(game: Game) {
    if (!game.pendingMaze || !this.blink(150)) return;
    for (const w of game.pendingMaze) this.glyph('#', w.x, w.y, this.palette.fg, 0.8, 0.7);
  }

  private drawWells(game: Game) {
    const { ctx, cell } = this;
    for (const w of game.wells) {
      const t = (this.clock / 700) % 1;
      for (let k = 0; k < 3; k++) {
        const r = cell * (1.6 - ((t + k / 3) % 1) * 1.4);
        ctx.globalAlpha = 0.25 + ((t + k / 3) % 1) * 0.5;
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
      this.glyph(ARROW_GLYPH[a.dir], a.pos.x, a.pos.y, this.palette.fg, 0.85, this.blink(300) ? 1 : 0.6);
    }
  }

  private drawPortals(game: Game) {
    const p = this.palette;
    game.arena.portals.forEach((pair, i) => {
      for (const pt of pair) {
        this.block(pt.x, pt.y, p.fg, 'outline', this.blink(400 + i * 90) ? 1 : 0.6);
        this.glyph(String.fromCharCode(65 + i), pt.x, pt.y, p.bright, 0.7);
      }
    });
  }

  private drawShedWalls(game: Game) {
    for (const w of game.shedWalls) {
      const crumbling = w.ttl < 2000;
      const alpha = crumbling ? (this.blink(90) ? 0.7 : 0.25) : 0.5 + (w.ttl / w.maxTtl) * 0.5;
      this.block(w.pos.x, w.pos.y, this.playerColor(w.owner), 'shade', alpha);
    }
  }

  private drawMines(game: Game) {
    const p = this.palette;
    for (const m of game.mines) {
      if (game.mineLit(m)) this.inverse('*', m.pos.x, m.pos.y, p.bright, this.blink(100) ? 1 : 0.8);
      else {
        const warn = game.mineWarn(m);
        this.glyph('*', m.pos.x, m.pos.y, warn > 0 && this.blink(80) ? p.bright : p.dim, 0.9, 0.6 + warn * 0.4);
      }
    }
  }

  private drawPickups(game: Game) {
    const p = this.palette;
    const ripening = game.modifiers.has('ripening');
    for (const pk of game.pickups) {
      const expiring = pk.ttl < 2000 && !this.blink(120);
      const a = expiring ? 0.3 : 1;
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
          this.inverse('$', x, y, p.bright, this.blink(200) ? a : a * 0.75);
          break;
        default:
          this.inverse(POWER_GLYPH[pk.kind], x, y, p.fg, a);
      }
      if (Number.isFinite(pk.maxTtl) && pk.kind !== 'bit') {
        // Remaining life as an underline that shrinks.
        const { ctx, cell } = this;
        ctx.fillStyle = p.dim;
        ctx.fillRect(x * cell + 2, (y + 1) * cell - 2, (cell - 4) * (pk.ttl / pk.maxTtl), 1.5);
      }
    }
  }

  private drawMice(game: Game) {
    const p = this.palette;
    for (const m of game.mice) {
      const a = m.ttl < 2000 && !this.blink(120) ? 0.4 : 1;
      this.glyph(m.drone ? 'w' : 'm', m.pos.x, m.pos.y, m.drone ? p.bright : p.fg, 0.95, a);
      if (m.stunned > 0) this.glyph('z', m.pos.x + 0.35, m.pos.y - 0.45, p.dim, 0.5);
    }
  }

  private drawRival(game: Game) {
    const r = game.rival!;
    const p = this.palette;
    this.drawBlocks(r.body.slice(1), p.dim, 'hatch', r.stunned > 0 ? 0.5 : 1);
    this.block(r.body[0].x, r.body[0].y, p.fg, 'hatch');
    this.glyph(ARROW_GLYPH[r.dir], r.body[0].x, r.body[0].y, p.bright, 0.7);
    if (r.stunned > 0) this.glyph('z', r.body[0].x + 0.4, r.body[0].y - 0.5, p.dim, 0.5);
  }

  private drawBoss(game: Game) {
    const b = game.boss!;
    const p = this.palette;
    const hurt = b.invuln > 0 && this.blink(70);
    if (b.kind === 'serpent') {
      for (let i = b.body.length - 1; i >= 1; i--) this.block(b.body[i].x, b.body[i].y, hurt ? p.bright : p.fg, 'hatch');
      const h = b.body[0];
      this.inverse('K', h.x, h.y, hurt ? p.fg : p.bright);
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
      this.block(c.x + dx, c.y + dy, hurt ? p.bright : p.fg, 'hatch');
    }
    ctx.fillStyle = p.bg;
    ctx.fillRect((c.x + 0.6) * cell, (c.y + 0.6) * cell, cell * 0.8, cell * 0.8);
    this.glyph('Q', c.x + 0.5, c.y + 0.5, p.bright, 0.85);
    if (b.shield) {
      ctx.strokeStyle = p.fg;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -this.clock / 60;
      ctx.strokeRect((c.x - 0.5) * cell, (c.y - 0.5) * cell, cell * 3, cell * 3);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.font = `${Math.round(cell * 0.8)}px ${DISPLAY_FONT}`;
      ctx.fillStyle = p.bright;
      ctx.textAlign = 'center';
      ctx.fillText(`[${'#'.repeat(b.dronesEaten)}${'.'.repeat(4 - b.dronesEaten)}]`, (c.x + 1) * cell, (c.y - 0.95) * cell);
    }
  }

  private drawBossBar(game: Game) {
    const b = game.boss!;
    const { ctx, size, cell } = this;
    const name = b.kind === 'serpent' ? 'SERPENT_KING' : 'SWARM_QUEEN';
    const bar = `${name} [${'#'.repeat(b.hp)}${'.'.repeat(Math.max(0, b.maxHp - b.hp))}]`;
    ctx.font = `${Math.round(cell * 0.9)}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(bar).width;
    ctx.fillStyle = this.palette.bg;
    ctx.fillRect(size / 2 - w / 2 - 6, 2, w + 12, cell * 0.95);
    ctx.fillStyle = this.palette.bright;
    ctx.fillText(bar, size / 2, 3);
  }

  private drawProjectiles(game: Game) {
    for (const pr of game.projectiles) this.glyph('*', pr.pos.x, pr.pos.y, this.palette.bright, 1);
  }

  private drawDarkness(game: Game) {
    const { ctx, cell, size } = this;
    const l = this.lctx;
    l.save();
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, this.layer.width, this.layer.height);
    l.restore();
    l.fillStyle = this.palette.bg;
    l.globalAlpha = 0.96;
    l.fillRect(0, 0, size, size);
    l.globalAlpha = 1;
    l.globalCompositeOperation = 'destination-out';
    for (const pl of game.players) {
      if (!pl.alive || !pl.body.length) continue;
      const hx = (pl.body[0].x + 0.5) * cell;
      const hy = (pl.body[0].y + 0.5) * cell;
      const g = l.createRadialGradient(hx, hy, cell * 2, hx, hy, cell * 5.5);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g;
      l.fillRect(0, 0, size, size);
    }
    l.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.layer, 0, 0, size, size);
    for (const pk of game.pickups) this.glyph('.', pk.pos.x, pk.pos.y, this.palette.fg, 1, this.blink(400) ? 0.6 : 0.3);
  }

  private drawPlayer(game: Game, pl: Player) {
    if (!pl.body.length || (!pl.alive && game.status !== 'over')) return;
    const p = this.palette;
    const color = this.playerColor(pl.id);
    const phase = pl.effects.phase ?? 0;
    const dead = !pl.alive;
    let style: 'solid' | 'outline' | 'hatch' | 'shade' = 'solid';
    if (pl.id === 0 && this.skin === 'ember') style = 'hatch';
    if (pl.id === 0 && this.skin === 'ghost') style = 'outline';
    if (phase && !dead) style = phase < 1500 && this.blink(100) ? 'solid' : 'outline';

    const n = pl.body.length;
    for (let i = n - 1; i >= 1; i--) {
      const s = pl.body[i];
      const fade = 1 - (i / Math.max(n, 6)) * 0.5;
      this.block(s.x, s.y, color, style, dead ? 0.35 : fade);
    }
    const h = pl.body[0];
    const headColor = pl.id === 0 && this.skin === 'gold' ? p.bright : color;
    this.block(h.x, h.y, headColor, 'solid', dead ? 0.5 : 1);
    this.glyph(dead ? 'x' : ARROW_GLYPH[pl.dir], h.x, h.y, p.bg, 0.8);

    if (game.isSurging(pl)) {
      const back = DIRS[pl.dir];
      if (Math.random() < 0.5) {
        this.bits.push({
          x: h.x + 0.5 - back.x * 0.8,
          y: h.y + 0.5 - back.y * 0.8,
          vx: -back.x * 4 + (Math.random() - 0.5),
          vy: -back.y * 4 + (Math.random() - 0.5),
          life: 250,
          max: 250,
          ch: '>',
          color: p.bright,
        });
      }
    }
    if (game.isHunkering(pl)) {
      this.glyph('[', h.x - 0.75, h.y, p.bright, 0.9);
      this.glyph(']', h.x + 0.75, h.y, p.bright, 0.9);
    }
    if (pl.armour > 0) this.block(h.x, h.y, p.bright, 'outline', 0.7);
    if (pl.effects.magnet) {
      const { ctx, cell } = this;
      ctx.strokeStyle = p.dim;
      ctx.setLineDash([2, 6]);
      ctx.lineDashOffset = this.clock / 40;
      ctx.strokeRect((h.x - 5.5) * cell, (h.y - 5.5) * cell, cell * 12, cell * 12);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    if (game.players.length > 1) this.glyph(`P${pl.id + 1}`, h.x, h.y - 0.85, color, 0.55);
  }
}
