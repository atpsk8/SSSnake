import type { Game, Player } from './game/engine';
import { DIRS, H, W, type Dir, type GameEvent, type PickupKind, type Vec } from './game/types';
import { BIOMES, CHUNK, LANDMARK_NAME, type BiomeId } from './game/world';
import type { PaletteId, SkinId } from './storage';
import { THEMES, type Palette, type ThemeDef, type ThemeId } from './themes';

/**
 * Theme-aware renderer. Two drawing families:
 *  - grid  (terminal, nokia, gameboy): blocks and characters on a cell grid.
 *  - soft  (paper, minimal): continuous rounded bodies and drawn shapes.
 * Bodies slide smoothly between cells; the static board is cached; effects pulse gently.
 * Boards bigger than 24x24 (Endless) are drawn through a follow camera showing 24 cells
 * across, with a minimap in the corner.
 */

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

/** Endless biome tint over the floor: a palette key (or a colour) and its strength. */
const BIOME_TINT: Record<BiomeId, [string, number]> = {
  meadow: ['fg', 0],
  glacier: ['fg', 0.07],
  shadow: ['#000000', 0.22],
  orchard: ['accent', 0.06],
  vortex: ['rival', 0.07],
  circuit: ['lines', 0.35],
  badlands: ['danger', 0.06],
};

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
  theme: ThemeDef = THEMES.terminal;
  palette: Palette = THEMES.terminal.palette('green');
  skin: SkinId = 'classic';
  reducedMotion = false;
  ghost: Vec[] | null = null;
  /** Editor: highlighted cell (e.g. the first end of a portal pair). */
  marker: Vec | null = null;
  /** Instant-replay camera: zoom toward a cell. */
  camera: { x: number; y: number; zoom: number } | null = null;
  /** Big boards: the view centre (in cells) and zoom; null when the whole board fits. */
  private view: { x: number; y: number; zoom: number } | null = null;
  private follow: Vec | null = null;
  private mini = document.createElement('canvas');
  private miniKey = '';
  private lastBiome: BiomeId | null = null;
  private landmarksSeen = new Set<number>();
  /** Endless chunks that have been on screen (the minimap only shows these). */
  private explored = new Uint8Array(0);
  private exploredCount = 0;

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

  get soft() {
    return this.theme.family === 'soft';
  }

  setTheme(id: ThemeId, variant: PaletteId) {
    this.theme = THEMES[id] ?? THEMES.terminal;
    this.palette = this.theme.palette(variant);
    this.invalidate();
  }

  /** Force the cached board to redraw (e.g. after fonts load). */
  invalidate() {
    this.boardKey = '';
    this.lastFont = '';
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
    this.invalidate();
  }

  reset() {
    this.bits = [];
    this.popups = [];
    this.rings = [];
    this.coilFlash = null;
    this.shake = 0;
    this.flash = 0;
    this.ghost = null;
    this.follow = null;
    this.lastBiome = null;
    this.landmarksSeen.clear();
    this.explored = new Uint8Array(0);
    this.exploredCount = 0;
  }

  playerColor(id: number): string {
    return id === 1 ? this.palette.alt : this.palette.fg;
  }

  /** Hex effects: violet on colour themes, the player's own colour on monochrome ones. */
  private hexColor(id: number): string {
    return this.soft || this.theme.id === 'terminal' ? mix(this.playerColor(id), '#b26bff', 0.65) : this.playerColor(id);
  }

  pickupColor(kind: PickupKind): string {
    const p = this.palette;
    if (kind === 'rot' || kind === 'bit') return p.dim;
    if (kind === 'food') return p.accent;
    if (kind === 'golden') return p.gold;
    return p.fg;
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
    const caps = (s: string) => (this.soft ? s.toLowerCase() : s);
    for (const e of events) {
      switch (e.type) {
        case 'eat': {
          this.burst([e.pos], e.kind === 'golden' ? p.gold : p.accent, e.kind === 'golden' ? 12 : 5);
          const mult = e.mult > 1 ? ` x${+e.mult.toFixed(1)}` : '';
          this.popup(`+${e.points}${mult}`, e.pos, this.playerColor(e.player));
          break;
        }
        case 'rot':
          this.burst([e.pos], p.dim, 6);
          this.popup(caps('ROTTEN -10'), e.pos, p.dim);
          break;
        case 'combo':
          this.popup(caps(`COMBO x${e.combo}`), { x: e.pos.x, y: e.pos.y - 1 }, p.bright, 0.95);
          break;
        case 'power':
          this.burst([e.pos], p.fg, 8);
          this.popup(caps(`> ${POWER_LABEL[e.kind]}`), { x: e.pos.x, y: e.pos.y - 1 }, p.bright, 0.9);
          break;
        case 'shrink':
          this.burst(e.cells, p.dim, 4);
          break;
        case 'shed':
          this.burst(e.cells, this.playerColor(e.player), 3, 3);
          this.addShake(4);
          if (e.cells.length) this.popup(caps('SHED'), e.cells[0], this.playerColor(e.player));
          break;
        case 'cut':
          this.burst(e.cells, p.dim, 3, 3);
          break;
        case 'hex': {
          this.burst(e.cells, this.playerColor(e.player), 3, 3);
          if (e.cells.length) this.popup(caps('HEX!'), e.cells[0], this.playerColor(e.player));
          const at = game.players[e.target]?.body[0];
          if (at) this.ring(at, 2.5, this.hexColor(e.target), 400);
          break;
        }
        case 'hexed': {
          const at = game.players[e.player]?.body[0];
          if (!at) break;
          if (e.on) {
            this.popup(caps('HEXED'), { x: at.x, y: at.y - 1 }, this.hexColor(e.player), 0.95);
            this.addShake(3);
          } else this.ring(at, 1.5, this.playerColor(e.player), 400);
          break;
        }
        case 'mouse':
          this.burst([e.pos], p.fg, 6);
          this.popup(`+${e.points}`, e.pos);
          break;
        case 'portal':
          this.burst([e.from, e.to], p.dim, 5, 3);
          break;
        case 'rivalDie':
          this.burst(e.cells, p.rival, 3);
          this.addShake(5);
          if (e.byPlayer && e.cells.length) this.popup(this.soft ? `rival down +${e.points}` : `RIVAL.EXE KILLED +${e.points}`, e.cells[0]);
          break;
        case 'coil': {
          this.coilFlash = { cells: e.cells, life: 800 };
          const c = e.cells[Math.floor(e.cells.length / 2)] ?? { x: 12, y: 12 };
          this.popup(caps(`COIL x${e.captured} +${e.points}`), c, p.bright, 1.05);
          this.addShake(3);
          break;
        }
        case 'defuse':
          this.burst([e.pos], p.danger, 5, 3);
          this.ring(e.pos, 1.2, p.danger);
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
          this.popup(caps('RATTLE'), e.pos);
          break;
        case 'armour':
          this.ring(e.pos, 2, p.bright, 600);
          this.popup(caps('ARMOUR HELD'), e.pos);
          this.addShake(6);
          break;
        case 'rewind':
          this.screenFlash(0.6);
          break;
        case 'bossHit':
          this.burst([e.pos], p.danger, 14, 6);
          this.ring(e.pos, 2.5, p.danger, 600);
          this.popup(caps(e.hp > 0 ? `HIT // ${e.hp} LEFT` : 'TERMINATED'), e.pos, p.bright, 1);
          this.addShake(8);
          break;
        case 'bossDie':
          this.burst(e.cells, p.danger, 5, 7);
          this.popup(this.soft ? `boss defeated +${e.points}` : `PROCESS KILLED +${e.points}`, e.cells[0] ?? { x: 12, y: 12 }, p.bright, 1.1);
          this.addShake(10);
          this.screenFlash(0.5);
          break;
        case 'shield':
          if (!e.up && game.boss) this.popup(caps('FIREWALL DOWN'), game.boss.core, p.bright, 1);
          break;
        case 'beat':
          this.beat = e.strong ? 1 : 0.5;
          break;
        case 'onbeat':
          if (game.p0.body.length) this.popup(caps(e.streak > 1 ? `SYNC x${e.streak}` : 'SYNC'), { x: game.p0.body[0].x, y: game.p0.body[0].y - 1 }, p.bright, 0.75);
          break;
        case 'offbeat':
          if (game.p0.body.length) this.popup(caps('DESYNC'), { x: game.p0.body[0].x, y: game.p0.body[0].y - 1 }, p.dim, 0.75);
          break;
        case 'die':
          this.burst(e.cells, this.playerColor(e.player), 2, 6);
          this.burst([e.pos], p.danger, 16, 7);
          this.addShake(10);
          this.screenFlash(1);
          break;
      }
    }
  }

  // ---------------------------------------------------------------- frame

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
    const soft = this.soft;

    ctx.save();
    if (this.shake > 0) {
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, size, size);
      ctx.translate(Math.round((Math.random() - 0.5) * this.shake), Math.round((Math.random() - 0.5) * this.shake));
    }
    const big = game.w > W || game.h > H;
    if (big) {
      this.followCamera(game, dt);
      const v = this.view!;
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, size, size);
      // Whole device pixels when not zooming, so grid themes stay crisp.
      const snap = (n: number) => (v.zoom === 1 ? Math.round(n * this.dpr) / this.dpr : n);
      ctx.translate(snap(size / 2 - v.x * cell * v.zoom), snap(size / 2 - v.y * cell * v.zoom));
      ctx.scale(v.zoom, v.zoom);
      this.drawBoardView(game);
      this.announce(game);
    } else {
      this.view = null;
      this.drawBoard(game);
      if (this.camera && this.camera.zoom > 1.001) {
        const { zoom } = this.camera;
        ctx.fillStyle = p.bg;
        ctx.fillRect(0, 0, size, size);
        // Keep the view inside the board.
        const half = size / 2 / zoom;
        const cx = Math.min(size - half, Math.max(half, (this.camera.x + 0.5) * cell));
        const cy = Math.min(size - half, Math.max(half, (this.camera.y + 0.5) * cell));
        ctx.translate(size / 2, size / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(this.board, 0, 0, size, size);
    }

    if (this.beat > 0) {
      this.onScreen(() => {
        ctx.globalAlpha = this.beat * 0.8;
        ctx.strokeStyle = p.bright;
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, size - 2, size - 2);
        ctx.globalAlpha = 1;
      });
    }

    if (this.coilFlash) {
      ctx.fillStyle = soft ? p.gold : p.fg;
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
    if (this.ghost) {
      if (soft) this.tube(this.ghost, p.dim, 0.5, 0.45, [0.2, 0.25]);
      else for (const c of this.ghost) this.block(c.x, c.y, p.dim, 'outline', 0.45);
    }
    if (game.rival) this.drawRival(game);
    if (game.boss) this.drawBoss(game);
    for (const pl of game.players) this.drawPlayer(game, pl);
    this.drawProjectiles(game);

    if (this.view && game.world) {
      const rects = this.darkRects(game);
      if (rects.length) this.drawDarkness(game, rects);
    } else if (game.modifiers.has('dark')) this.drawDarkness(game);

    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.5;
      const rad = r.radius * cell * (0.3 + t * 0.7);
      ctx.beginPath();
      if (soft) ctx.arc(r.x * cell, r.y * cell, rad, 0, Math.PI * 2);
      else ctx.rect(r.x * cell - rad, r.y * cell - rad, rad * 2, rad * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (this.bits.length) {
      if (soft) {
        for (const b of this.bits) {
          ctx.globalAlpha = Math.max(0, b.life / b.max) * 0.8;
          ctx.fillStyle = b.color;
          ctx.beginPath();
          ctx.arc(b.x * cell, b.y * cell, cell * 0.08, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        this.setFont(`700 ${Math.round(cell * 0.7)}px ${this.theme.font}`);
        for (const b of this.bits) {
          ctx.globalAlpha = Math.max(0, b.life / b.max) * 0.85;
          ctx.fillStyle = b.color;
          ctx.fillText(b.ch, b.x * cell, b.y * cell);
        }
      }
      ctx.globalAlpha = 1;
    }

    for (const pu of this.popups) {
      ctx.globalAlpha = Math.min(1, (pu.life / pu.max) * 2.5);
      const scale = this.theme.display.includes('Silkscreen') ? 0.75 : soft ? 1.05 : 1.15;
      this.setFont(`${soft ? '700 ' : ''}${Math.round(cell * pu.size * scale)}px ${this.theme.display}`);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(pu.text).width;
      const [left, right] = this.view ? [(this.view.x - W / 2 / this.view.zoom) * cell, (this.view.x + W / 2 / this.view.zoom) * cell] : [0, size];
      const x = Math.min(right - w / 2 - 4, Math.max(left + w / 2 + 4, pu.x * cell));
      const y = pu.y * cell;
      if (soft) {
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = p.bg;
        ctx.strokeText(pu.text, x, y);
      } else {
        ctx.fillStyle = p.bg;
        ctx.fillRect(x - w / 2 - 3, y - cell * 0.42, w + 6, cell * 0.84);
      }
      ctx.fillStyle = pu.color;
      ctx.fillText(pu.text, x, y);
    }
    ctx.globalAlpha = 1;

    if (game.boss) this.onScreen(() => this.drawBossBar(game));

    if (this.marker) {
      ctx.strokeStyle = p.bright;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(this.marker.x * cell + 1, this.marker.y * cell + 1, cell - 2, cell - 2);
      ctx.setLineDash([]);
    }

    if (game.players.some((pl) => pl.alive && pl.effects.slowmo)) {
      this.onScreen(() => {
        ctx.fillStyle = soft ? '#6aa3d9' : p.fg;
        ctx.globalAlpha = 0.035 + this.pulse(1600) * 0.02;
        ctx.fillRect(0, 0, size, size);
        ctx.globalAlpha = 1;
      });
    }

    if (big && game.world) this.onScreen(() => this.drawMinimap(game));

    ctx.restore();
    // restore() also reverts the font, so forget the cached one.
    this.lastFont = '';

    if (this.flash > 0) {
      ctx.fillStyle = soft ? p.danger : p.fg;
      ctx.globalAlpha = this.flash * 0.12;
      ctx.fillRect(0, 0, size, size);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- static board (cached)

  private drawBoard(game: Game) {
    let h = 0;
    const solid = game.solid;
    for (let i = 0; i < solid.length; i++) if (solid[i]) h = (Math.imul(h, 31) + i + 1) | 0;
    const key = `${this.size}|${this.theme.id}|${this.palette.bg}|${game.wraps ? 1 : 0}|${game.ring}|${h}`;
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

    switch (this.theme.background) {
      case 'dots':
      case 'subtle': {
        c.fillStyle = this.theme.background === 'dots' ? p.faint : p.lines;
        const d = Math.max(1, Math.round(cell * (this.theme.background === 'dots' ? 0.08 : 0.1)));
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) c.fillRect(Math.round((x + 0.5) * cell) - d / 2, Math.round((y + 0.5) * cell) - d / 2, d, d);
        }
        break;
      }
      case 'lcd':
        // Faint pixel grid, like an unlit LCD matrix.
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) this.block(x, y, p.lines, 'solid', 1, c);
        }
        break;
      case 'ruled':
        c.strokeStyle = p.lines;
        c.lineWidth = 1;
        for (let y = 1; y < H; y++) {
          c.beginPath();
          c.moveTo(0, Math.round(y * cell) + 0.5);
          c.lineTo(size, Math.round(y * cell) + 0.5);
          c.stroke();
        }
        c.strokeStyle = 'rgba(196, 90, 62, 0.35)';
        c.beginPath();
        c.moveTo(Math.round(cell * 0.6) + 0.5, 0);
        c.lineTo(Math.round(cell * 0.6) + 0.5, size);
        c.stroke();
        break;
    }

    c.strokeStyle = this.soft ? p.dim : p.dim;
    c.lineWidth = this.soft ? 2 : 1;
    if (game.wraps) c.setLineDash([cell * 0.5, cell * 0.25]);
    if (this.theme.id === 'minimal') {
      c.beginPath();
      c.roundRect(1, 1, size - 2, size - 2, cell * 0.5);
      c.stroke();
    } else c.strokeRect(1, 1, size - 2, size - 2);
    c.setLineDash([]);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!solid[y * W + x]) continue;
        const ring = x < game.ring || y < game.ring || x >= W - game.ring || y >= H - game.ring;
        this.wallCell(x, y, ring, c);
      }
    }
  }

  private wallCell(x: number, y: number, ring: boolean, c: CanvasRenderingContext2D) {
    const p = this.palette;
    if (this.soft) this.softWall(x, y, ring, c);
    else if (ring) this.block(x, y, p.dim, 'shade', 0.5, c);
    else {
      this.block(x, y, p.dim, 'solid', this.theme.wallGlyph ? 0.7 : 1, c);
      if (this.theme.wallGlyph) this.glyph('#', x, y, p.bg, 0.7, 0.7, this.theme.font, c);
    }
  }

  // ---------------------------------------------------------------- big boards (Endless)

  /** Ease the view toward a point a little ahead of the head (or the replay focus). */
  private followCamera(game: Game, dt: number) {
    let target: Vec;
    // Endless follows the snake at 24 cells across; big arenas (versus) zoom out to show it all.
    const fit = game.world ? 1 : Math.min(W / game.w, H / game.h);
    let zoom = fit;
    if (this.camera) {
      target = { x: this.camera.x + 0.5, y: this.camera.y + 0.5 };
      zoom = fit * Math.max(1, this.camera.zoom);
    } else if (!game.world) {
      target = { x: game.w / 2, y: game.h / 2 };
    } else {
      const pl = game.players.find((q) => q.alive && q.body.length) ?? game.p0;
      if (pl.body.length) {
        const h = game.status === 'over' ? pl.body[0] : slide(pl.body.slice(0, 1), pl.prevBody.slice(0, 1), game.alphaFor(pl))[0];
        const d = game.status === 'over' ? { x: 0, y: 0 } : DIRS[pl.dir];
        target = { x: h.x + 0.5 + d.x * 2, y: h.y + 0.5 + d.y * 2 };
      } else target = { x: game.w / 2, y: game.h / 2 };
    }
    const f = this.follow;
    if (!f || Math.abs(f.x - target.x) + Math.abs(f.y - target.y) > 14) this.follow = { ...target };
    else {
      const k = 1 - Math.pow(0.0005, dt / 1000);
      f.x += (target.x - f.x) * k;
      f.y += (target.y - f.y) * k;
    }
    const half = W / 2 / zoom;
    const clamp = (n: number, max: number) => Math.min(max - half, Math.max(half, n));
    this.view = { x: clamp(this.follow!.x, game.w), y: clamp(this.follow!.y, game.h), zoom };

    if (game.world) {
      const wd = game.world;
      if (this.explored.length !== wd.cols * wd.rows) this.explored = new Uint8Array(wd.cols * wd.rows);
      const [x0, y0, x1, y1] = this.viewCells(game, 0);
      for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
        for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
          const i = cy * wd.cols + cx;
          if (!this.explored[i]) {
            this.explored[i] = 1;
            this.exploredCount++;
          }
        }
      }
    }
  }

  /** Visible cell range [x0, y0, x1, y1] (inclusive), padded by `pad` cells. */
  private viewCells(game: Game, pad = 1): [number, number, number, number] {
    const v = this.view!;
    const half = W / 2 / v.zoom + pad;
    return [
      Math.max(0, Math.floor(v.x - half)),
      Math.max(0, Math.floor(v.y - half)),
      Math.min(game.w - 1, Math.ceil(v.x + half)),
      Math.min(game.h - 1, Math.ceil(v.y + half)),
    ];
  }

  private inView(x: number, y: number, pad = 1.5): boolean {
    const v = this.view;
    if (!v) return true;
    const half = W / 2 / v.zoom + pad;
    return Math.abs(x + 0.5 - v.x) <= half && Math.abs(y + 0.5 - v.y) <= half;
  }

  /** Run `fn` in screen space (no camera) on big boards. */
  private onScreen(fn: () => void) {
    if (!this.view) return fn();
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    fn();
    ctx.restore();
    this.lastFont = '';
  }

  private tint(key: string): string {
    return (this.palette as unknown as Record<string, string>)[key] ?? key;
  }

  /** The visible part of a big board, drawn straight to the screen every frame. */
  private drawBoardView(game: Game) {
    const { ctx: c, cell } = this;
    const p = this.palette;
    const [x0, y0, x1, y1] = this.viewCells(game);
    const wd = game.world;
    if (wd) {
      for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
        for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
          const [key, a] = BIOME_TINT[BIOMES[wd.biome[cy * wd.cols + cx]].id];
          if (!a) continue;
          c.globalAlpha = a;
          c.fillStyle = this.tint(key);
          c.fillRect(cx * CHUNK * cell, cy * CHUNK * cell, CHUNK * cell, CHUNK * cell);
        }
      }
      c.globalAlpha = 1;
    }
    switch (this.theme.background) {
      case 'dots':
      case 'subtle': {
        c.fillStyle = this.theme.background === 'dots' ? p.faint : p.lines;
        const d = Math.max(1, Math.round(cell * (this.theme.background === 'dots' ? 0.08 : 0.1)));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) c.fillRect(Math.round((x + 0.5) * cell) - d / 2, Math.round((y + 0.5) * cell) - d / 2, d, d);
        }
        break;
      }
      case 'lcd':
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) this.block(x, y, p.lines, 'solid', 1, c);
        }
        break;
      case 'ruled':
        c.strokeStyle = p.lines;
        c.lineWidth = 1;
        c.beginPath();
        for (let y = Math.max(1, y0); y <= y1; y++) {
          c.moveTo(x0 * cell, Math.round(y * cell) + 0.5);
          c.lineTo((x1 + 1) * cell, Math.round(y * cell) + 0.5);
        }
        c.stroke();
        break;
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (game.solid[y * game.w + x]) this.wallCell(x, y, game.inRing({ x, y }), c);
    }
  }

  /** Pop the biome's name on entering it, and a landmark's when it first comes close. */
  private announce(game: Game) {
    const wd = game.world;
    const head = game.p0.body[0];
    if (!wd || !head || game.status !== 'playing' || this.camera) return;
    const caps = (t: string) => (this.soft ? t.toLowerCase() : t.toUpperCase());
    if (game.biome && game.biome !== this.lastBiome) {
      this.lastBiome = game.biome;
      const b = BIOMES.find((x) => x.id === game.biome)!;
      this.popup(caps(b.name), { x: head.x, y: head.y - 2 }, this.palette.bright, 1.1);
    }
    wd.landmarks.forEach((l, i) => {
      if (this.landmarksSeen.has(i) || Math.max(Math.abs(l.pos.x - head.x), Math.abs(l.pos.y - head.y)) > 7) return;
      this.landmarksSeen.add(i);
      this.popup(caps(LANDMARK_NAME[l.kind]), { x: l.pos.x, y: l.pos.y - 3 }, this.palette.gold, 0.9);
    });
  }

  /** Shadowlands chunks in view, as [x, y, w, h] in cells. */
  private darkRects(game: Game): [number, number, number, number][] {
    const wd = game.world!;
    const [x0, y0, x1, y1] = this.viewCells(game);
    const out: [number, number, number, number][] = [];
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        if (BIOMES[wd.biome[cy * wd.cols + cx]].modifiers.includes('dark')) out.push([cx * CHUNK, cy * CHUNK, CHUNK, CHUNK]);
      }
    }
    return out;
  }

  /** Explored map in the corner: biomes, walls, landmarks, food and where you are. */
  private drawMinimap(game: Game) {
    const wd = game.world!;
    const { ctx, size } = this;
    const p = this.palette;
    const m = Math.round(Math.min(size * 0.24, 150));
    const ox = size - m - 6;
    const oy = 6;
    const key = `${this.theme.id}|${p.bg}|${game.broken.size}|${this.exploredCount}`;
    if (key !== this.miniKey) {
      this.miniKey = key;
      this.mini.width = game.w;
      this.mini.height = game.h;
      const g = this.mini.getContext('2d')!;
      g.clearRect(0, 0, game.w, game.h);
      for (let cy = 0; cy < wd.rows; cy++) {
        for (let cx = 0; cx < wd.cols; cx++) {
          if (!this.explored[cy * wd.cols + cx]) continue;
          g.globalAlpha = 1;
          g.fillStyle = p.bg;
          g.fillRect(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
          const [tk, a] = BIOME_TINT[BIOMES[wd.biome[cy * wd.cols + cx]].id];
          g.globalAlpha = Math.min(1, a * 3);
          g.fillStyle = this.tint(tk);
          g.fillRect(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
          g.globalAlpha = 1;
          g.fillStyle = p.dim;
          for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++) {
            for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) if (game.solid[y * game.w + x]) g.fillRect(x, y, 1, 1);
          }
        }
      }
    }
    ctx.fillStyle = p.bg;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(ox, oy, m, m);
    ctx.globalAlpha = 0.9;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mini, ox, oy, m, m);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.dim;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, m + 1, m + 1);
    const s = m / game.w;
    const seen = (v: Vec) => this.explored[Math.floor(v.y / CHUNK) * wd.cols + Math.floor(v.x / CHUNK)] === 1;
    for (const l of wd.landmarks) {
      if (!seen(l.pos)) continue;
      ctx.fillStyle = l.kind === 'shrine' ? p.gold : l.kind === 'crater' ? p.danger : this.soft ? p.rival : p.bright;
      const r = Math.max(2, s * 2.5);
      ctx.fillRect(ox + (l.pos.x + 0.5) * s - r / 2, oy + (l.pos.y + 0.5) * s - r / 2, r, r);
    }
    ctx.fillStyle = p.accent;
    for (const pk of game.pickups) {
      if (pk.kind === 'food') ctx.fillRect(ox + pk.pos.x * s - 0.5, oy + pk.pos.y * s - 0.5, Math.max(1.5, s), Math.max(1.5, s));
    }
    const v = this.view!;
    const hv = W / 2 / v.zoom;
    ctx.strokeStyle = p.fg;
    ctx.globalAlpha = 0.55;
    ctx.strokeRect(ox + (v.x - hv) * s, oy + (v.y - hv) * s, hv * 2 * s, hv * 2 * s);
    ctx.globalAlpha = 1;
    const head = game.p0.body[0];
    if (head) {
      const r = Math.max(3, s * 3);
      ctx.fillStyle = p.bright;
      ctx.globalAlpha = 0.6 + this.pulse(700) * 0.4;
      ctx.fillRect(ox + (head.x + 0.5) * s - r / 2, oy + (head.y + 0.5) * s - r / 2, r, r);
      ctx.globalAlpha = 1;
    }
  }

  private softWall(x: number, y: number, ring: boolean, c: CanvasRenderingContext2D) {
    const { cell } = this;
    const p = this.palette;
    const px = x * cell;
    const py = y * cell;
    if (this.theme.id === 'paper') {
      // Cross-hatched ink box.
      c.save();
      c.beginPath();
      c.rect(px + 1, py + 1, cell - 2, cell - 2);
      c.clip();
      c.strokeStyle = ring ? p.dim : p.fg;
      c.globalAlpha = ring ? 0.35 : 0.55;
      c.lineWidth = 1;
      for (let k = -cell; k < cell; k += cell / 4) {
        c.beginPath();
        c.moveTo(px + k, py + cell);
        c.lineTo(px + k + cell, py);
        c.stroke();
      }
      c.restore();
      if (!ring) {
        c.strokeStyle = p.fg;
        c.lineWidth = 1.2;
        c.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
      }
      return;
    }
    c.fillStyle = ring ? p.faint : p.dim;
    c.beginPath();
    c.roundRect(px + 1.5, py + 1.5, cell - 3, cell - 3, cell * 0.22);
    c.fill();
  }

  // ---------------------------------------------------------------- primitives

  /** A character-cell block with a small gutter so the grid stays visible. */
  private block(x: number, y: number, color: string, style: BlockStyle = 'solid', alpha = 1, c = this.ctx) {
    const { cell } = this;
    const g = Math.max(1, Math.round(cell * this.theme.gap));
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
      c.fillStyle = color;
      const q = Math.max(2, Math.round(s / 5));
      for (let yy = 0; yy < s; yy += q) {
        for (let xx = (yy / q) % 2 ? q : 0; xx < s; xx += q * 2) c.fillRect(px + xx, py + yy, q, q);
      }
    }
    c.globalAlpha = 1;
  }

  private glyph(ch: string, x: number, y: number, color: string, scale = 0.8, alpha = 1, font = this.theme.font, c = this.ctx) {
    const { cell } = this;
    // Pixel fonts run large; keep them inside the cell.
    const s = font.includes('Silkscreen') ? scale * 0.72 : scale;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    this.setFont(`700 ${Math.round(cell * s)}px ${font}`, c);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(ch, (x + 0.5) * cell, (y + 0.55) * cell);
    c.globalAlpha = 1;
  }

  /** Inverse video: a filled block with a glyph cut into it. */
  private inverse(ch: string, x: number, y: number, color: string, alpha = 1) {
    this.block(x, y, color, 'solid', alpha);
    this.glyph(ch, x, y, this.palette.bg, 0.75, alpha);
  }

  /** Pixel-art diamond for LCD-style food. */
  private diamond(x: number, y: number, color: string, alpha = 1) {
    const { ctx, cell } = this;
    const u = Math.max(1, Math.round(cell / 6));
    const cx = Math.round((x + 0.5) * cell);
    const cy = Math.round((y + 0.5) * cell);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(cx - u / 2, cy - u * 1.5, u, u);
    ctx.fillRect(cx - u * 1.5, cy - u / 2, u * 3, u);
    ctx.fillRect(cx - u / 2, cy + u / 2, u, u);
    ctx.globalAlpha = 1;
  }

  /** Tiny pixel-art mouse for the LCD themes (their pixel font has no lowercase 'm'). */
  private pixelMouse(x: number, y: number, facing: number, color: string, alpha = 1) {
    const { ctx, cell } = this;
    const u = Math.max(1, Math.round(cell / 7));
    const cx = Math.round((x + 0.5) * cell);
    const cy = Math.round((y + 0.5) * cell);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(cx - u * 2, cy - u, u * 4, u * 2); // body
    ctx.fillRect(cx + (facing > 0 ? u : -u * 2), cy - u * 2, u, u); // ear
    ctx.fillRect(cx + (facing > 0 ? u * 2 : -u * 3), cy - u, u, u); // snout
    ctx.fillRect(cx + (facing > 0 ? -u * 3 : u * 2), cy, u, u); // tail
    ctx.fillRect(cx + (facing > 0 ? -u * 4 : u * 3), cy - u, u, u);
    ctx.globalAlpha = 1;
  }

  /** Continuous rounded body through cell centres (soft family). One path, so alpha never beads. */
  private tube(pts: Vec[], color: string, width: number, alpha = 1, dash?: number[]) {
    if (!pts.length) return;
    const { ctx, cell } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = cell * width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash.map((d) => d * cell));
    ctx.beginPath();
    let prev: Vec | null = null;
    for (const p of pts) {
      const x = (p.x + 0.5) * cell;
      const y = (p.y + 0.5) * cell;
      if (!prev || Math.abs(prev.x - p.x) + Math.abs(prev.y - p.y) > 1.5) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.01, y);
      } else ctx.lineTo(x, y);
      prev = p;
    }
    ctx.stroke();
    ctx.restore();
  }

  private eyes(h: Vec, dir: Dir, white: string, pupil: string, spread = 0.2) {
    const { ctx, cell } = this;
    const d = DIRS[dir];
    const side = { x: -d.y, y: d.x };
    for (const s of [-1, 1]) {
      const ex = (h.x + 0.5 + d.x * 0.12 + side.x * spread * s) * cell;
      const ey = (h.y + 0.5 + d.y * 0.12 + side.y * spread * s) * cell;
      ctx.fillStyle = white;
      ctx.beginPath();
      ctx.arc(ex, ey, cell * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pupil;
      ctx.beginPath();
      ctx.arc(ex + d.x * cell * 0.035, ey + d.y * cell * 0.035, cell * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private circle(x: number, y: number, r: number, fill?: string, stroke?: string, lw = 1.5) {
    const { ctx, cell } = this;
    ctx.beginPath();
    ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, r * cell, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }

  private softLabel(text: string, x: number, y: number, color: string, scale = 0.6) {
    const { ctx, cell } = this;
    this.setFont(`800 ${Math.round(cell * scale)}px ${this.theme.font}`);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, (x + 0.5) * cell, (y + 0.53) * cell);
  }

  // ---------------------------------------------------------------- layers

  private drawWarnings(game: Game) {
    const p = this.palette;
    if (game.collapseWarning) {
      const next = game.ring + 1;
      const a = 0.25 + this.pulse(900) * 0.45;
      for (let y = 0; y < game.h; y++) {
        for (let x = 0; x < game.w; x++) {
          if (game.solid[y * game.w + x]) continue;
          if (x < next || y < next || x >= game.w - next || y >= game.h - next) this.block(x, y, this.soft ? p.danger : p.fg, 'outline', a);
        }
      }
    }
    if (game.pendingMaze) {
      const a = 0.2 + this.pulse(800) * 0.4;
      for (const w of game.pendingMaze) {
        if (this.soft) this.block(w.x, w.y, p.danger, 'outline', a);
        else this.glyph('#', w.x, w.y, p.fg, 0.8, a);
      }
    }
  }

  private drawWells(game: Game) {
    const { ctx, cell } = this;
    const p = this.palette;
    for (const w of game.wells) {
      if (!this.inView(w.x, w.y, 2)) continue;
      const t = (this.clock / 1100) % 1;
      for (let k = 0; k < 3; k++) {
        const f = (t + k / 3) % 1;
        const r = cell * (1.6 - f * 1.4);
        ctx.globalAlpha = 0.15 + f * 0.35;
        ctx.strokeStyle = this.soft ? p.rival : p.fg;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (this.soft) ctx.arc((w.x + 0.5) * cell, (w.y + 0.5) * cell, r / 2, 0, Math.PI * 2);
        else ctx.rect((w.x + 0.5) * cell - r / 2, (w.y + 0.5) * cell - r / 2, r, r);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (this.soft) this.circle(w.x, w.y, 0.18, p.rival);
      else this.glyph('O', w.x, w.y, p.bright, 0.8);
    }
  }

  private drawArrows(game: Game) {
    const { ctx, cell } = this;
    const p = this.palette;
    for (const a of game.arrows) {
      if (!this.inView(a.pos.x, a.pos.y)) continue;
      if (!this.soft) {
        this.block(a.pos.x, a.pos.y, p.faint);
        this.glyph(ARROW_GLYPH[a.dir], a.pos.x, a.pos.y, p.fg, 0.85, 0.7 + this.pulse(1400) * 0.3);
        continue;
      }
      const d = DIRS[a.dir];
      const side = { x: -d.y, y: d.x };
      const cx = (a.pos.x + 0.5) * cell;
      const cy = (a.pos.y + 0.5) * cell;
      ctx.strokeStyle = p.fg;
      ctx.globalAlpha = 0.55 + this.pulse(1400) * 0.3;
      ctx.lineWidth = Math.max(2, cell * 0.1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - d.x * cell * 0.15 + side.x * cell * 0.25, cy - d.y * cell * 0.15 + side.y * cell * 0.25);
      ctx.lineTo(cx + d.x * cell * 0.2, cy + d.y * cell * 0.2);
      ctx.lineTo(cx - d.x * cell * 0.15 - side.x * cell * 0.25, cy - d.y * cell * 0.15 - side.y * cell * 0.25);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawPortals(game: Game) {
    const p = this.palette;
    game.arena.portals.forEach((pair, i) => {
      for (const pt of pair) {
        if (!this.inView(pt.x, pt.y)) continue;
        const label = String.fromCharCode(65 + i);
        if (this.soft) {
          this.circle(pt.x, pt.y, 0.42, undefined, p.rival, 2);
          this.circle(pt.x, pt.y, 0.25 + this.pulse(1600, i) * 0.06, undefined, p.rival, 1);
          this.softLabel(label, pt.x, pt.y, p.rival, 0.5);
        } else {
          this.block(pt.x, pt.y, p.fg, 'outline', 0.6 + this.pulse(1600, i) * 0.4);
          this.glyph(label, pt.x, pt.y, p.bright, 0.7);
        }
      }
    });
  }

  private drawShedWalls(game: Game) {
    const { ctx, cell } = this;
    for (const w of game.shedWalls) {
      if (!this.inView(w.pos.x, w.pos.y)) continue;
      const alpha = w.ttl < 2000 ? 0.15 + (w.ttl / 2000) * 0.5 : 0.65 + (w.ttl / w.maxTtl) * 0.3;
      const color = this.playerColor(w.owner);
      if (!this.soft) {
        this.block(w.pos.x, w.pos.y, color, 'shade', alpha);
        continue;
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.roundRect(w.pos.x * cell + 2, w.pos.y * cell + 2, cell - 4, cell - 4, cell * 0.25);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = alpha * 0.18;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawMines(game: Game) {
    const { ctx, cell } = this;
    const p = this.palette;
    for (const m of game.mines) {
      if (!this.inView(m.pos.x, m.pos.y)) continue;
      const lit = game.mineLit(m);
      const warn = game.mineWarn(m);
      if (!this.soft) {
        if (lit) this.inverse('*', m.pos.x, m.pos.y, p.fg);
        else this.glyph('*', m.pos.x, m.pos.y, warn > 0 ? p.bright : p.dim, 0.9, 0.55 + warn * 0.45);
        continue;
      }
      const cx = (m.pos.x + 0.5) * cell;
      const cy = (m.pos.y + 0.5) * cell;
      const r = cell * (lit ? 0.3 : 0.24 + warn * 0.05);
      const color = lit || warn > 0 ? p.danger : p.dim;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, cell * 0.07);
      ctx.lineCap = 'round';
      ctx.globalAlpha = lit ? 1 : 0.55 + warn * 0.45;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ctx.moveTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
        ctx.lineTo(cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r * 1.4);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
      if (lit) {
        ctx.fillStyle = p.danger;
        ctx.fill();
      } else ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawPickups(game: Game) {
    const p = this.palette;
    for (const pk of game.pickups) {
      if (!this.inView(pk.pos.x, pk.pos.y)) continue;
      const ripening = game.ripensAt(pk.pos);
      const a = pk.ttl < 2000 ? 0.35 + (pk.ttl / 2000) * 0.65 : 1;
      const { x, y } = pk.pos;
      if (this.soft) this.softPickup(pk.kind, x, y, a, ripening ? Math.min(1, pk.age / 16000) : 0);
      else {
        switch (pk.kind) {
          case 'food': {
            const ripe = ripening ? Math.min(1, pk.age / 16000) : 0;
            if (this.theme.pixelFood) this.diamond(x, y, p.fg, a);
            else this.glyph('@', x, y, ripe > 0.5 ? p.bright : p.fg, 0.95 + ripe * 0.15, a);
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
      }
      if (Number.isFinite(pk.maxTtl) && pk.kind !== 'bit') {
        const { ctx, cell } = this;
        ctx.fillStyle = p.dim;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(x * cell + 3, (y + 1) * cell - 2.5, (cell - 6) * (pk.ttl / pk.maxTtl), 1.5);
        ctx.globalAlpha = 1;
      }
    }
  }

  private softPickup(kind: PickupKind, x: number, y: number, alpha: number, ripe: number) {
    const { ctx, cell } = this;
    const p = this.palette;
    const cx = (x + 0.5) * cell;
    const cy = (y + 0.5) * cell;
    const paper = this.theme.id === 'paper';
    ctx.globalAlpha = alpha;
    switch (kind) {
      case 'food': {
        const color = ripe > 0 ? mix(p.accent, p.gold, ripe) : p.accent;
        this.circle(x, y + 0.04, 0.3, color, paper ? p.fg : undefined, 1.2);
        // leaf
        ctx.strokeStyle = paper ? p.fg : '#5aa36a';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy - cell * 0.22);
        ctx.quadraticCurveTo(cx + cell * 0.12, cy - cell * 0.42, cx + cell * 0.24, cy - cell * 0.36);
        ctx.stroke();
        if (!paper) this.circle(x - 0.1, y - 0.06, 0.07, 'rgba(255,255,255,0.55)');
        break;
      }
      case 'bit':
        this.circle(x, y, 0.13, p.accent);
        break;
      case 'rot':
        this.circle(x, y, 0.27, mix(p.dim, '#7a6a3a', 0.5), paper ? p.fg : undefined, 1);
        break;
      case 'golden': {
        const s = cell * (0.36 + this.pulse(1200) * 0.03);
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          const r = k % 2 ? s * 0.48 : s;
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fillStyle = p.gold;
        ctx.fill();
        if (paper) {
          ctx.strokeStyle = p.fg;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        break;
      }
      default: {
        // Power-up: rounded tile with its letter.
        const s = cell * 0.36;
        ctx.beginPath();
        ctx.roundRect(cx - s, cy - s, s * 2, s * 2, s * 0.45);
        ctx.fillStyle = paper ? p.bg : p.fg;
        ctx.fill();
        ctx.strokeStyle = p.fg;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        this.softLabel(POWER_GLYPH[kind], x, y, paper ? p.fg : p.bg, 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawMice(game: Game) {
    const { ctx, cell } = this;
    const p = this.palette;
    const t = game.worldAlpha;
    for (const m of game.mice) {
      if (!this.inView(m.pos.x, m.pos.y)) continue;
      const jump = Math.abs(m.prev.x - m.pos.x) + Math.abs(m.prev.y - m.pos.y) > 1;
      const x = jump ? m.pos.x : lerp(m.prev.x, m.pos.x, t);
      const y = jump ? m.pos.y : lerp(m.prev.y, m.pos.y, t);
      const a = m.ttl < 2000 ? 0.35 + (m.ttl / 2000) * 0.65 : 1;
      if (!this.soft) {
        if (this.theme.pixelFood && !m.drone) this.pixelMouse(x, y, m.pos.x >= m.prev.x ? 1 : -1, p.fg, a);
        else this.glyph(m.drone ? 'w' : 'm', x, y, m.drone ? p.bright : p.fg, 0.95, a);
        if (m.stunned > 0) this.glyph('z', x + 0.35, y - 0.45, p.dim, 0.5);
        continue;
      }
      ctx.globalAlpha = a;
      const cx = (x + 0.5) * cell;
      const cy = (y + 0.5) * cell;
      if (m.drone) {
        ctx.fillStyle = p.rival;
        ctx.beginPath();
        ctx.moveTo(cx, cy - cell * 0.28);
        ctx.lineTo(cx + cell * 0.2, cy);
        ctx.lineTo(cx, cy + cell * 0.28);
        ctx.lineTo(cx - cell * 0.2, cy);
        ctx.closePath();
        ctx.fill();
      } else {
        const facing = m.pos.x >= m.prev.x ? 1 : -1;
        ctx.fillStyle = p.dim;
        ctx.beginPath();
        ctx.ellipse(cx, cy, cell * 0.28, cell * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + cell * 0.17 * facing, cy - cell * 0.17, cell * 0.09, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = p.dim;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - cell * 0.26 * facing, cy);
        ctx.quadraticCurveTo(cx - cell * 0.48 * facing, cy - cell * 0.28, cx - cell * 0.52 * facing, cy + cell * 0.05);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (m.stunned > 0) this.softLabel('z', x + 0.35, y - 0.45, p.dim, 0.45);
    }
  }

  private drawRival(game: Game) {
    const r = game.rival!;
    const p = this.palette;
    const pts = slide(r.body, r.prevBody, game.worldAlpha);
    if (this.soft) {
      this.tube(pts, p.rival, 0.62, r.stunned > 0 ? 0.5 : 1);
      this.eyes(pts[0], r.dir, '#ffffff', '#222222', 0.17);
      if (r.stunned > 0) this.softLabel('z', pts[0].x + 0.4, pts[0].y - 0.5, p.dim, 0.45);
      return;
    }
    for (let i = pts.length - 1; i >= 1; i--) this.block(pts[i].x, pts[i].y, p.dim, 'hatch', r.stunned > 0 ? 0.5 : 1);
    this.block(pts[0].x, pts[0].y, p.fg, 'hatch');
    this.glyph(ARROW_GLYPH[r.dir], pts[0].x, pts[0].y, p.bright, 0.7);
    if (r.stunned > 0) this.glyph('z', pts[0].x + 0.4, pts[0].y - 0.5, p.dim, 0.5);
  }

  private drawBoss(game: Game) {
    const b = game.boss!;
    const p = this.palette;
    const { ctx, cell } = this;
    const hurt = b.invuln > 0 ? this.pulse(220) : 0;
    if (b.kind === 'serpent') {
      const pts = slide(b.body, b.prevBody, game.worldAlpha);
      if (this.soft) {
        this.tube(pts, hurt > 0.5 ? p.gold : p.danger, 0.86);
        this.eyes(pts[0], b.dir, '#ffffff', '#222222', 0.22);
        // crown
        const h = pts[0];
        const cx = (h.x + 0.5) * cell;
        const cy = (h.y - 0.1) * cell;
        const w = cell * 0.5;
        ctx.fillStyle = p.gold;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy + cell * 0.14);
        ctx.lineTo(cx - w / 2, cy - cell * 0.08);
        ctx.lineTo(cx - w / 4, cy + cell * 0.04);
        ctx.lineTo(cx, cy - cell * 0.15);
        ctx.lineTo(cx + w / 4, cy + cell * 0.04);
        ctx.lineTo(cx + w / 2, cy - cell * 0.08);
        ctx.lineTo(cx + w / 2, cy + cell * 0.14);
        ctx.closePath();
        ctx.fill();
        if (b.stunned > 0) this.softLabel('z', h.x + 0.4, h.y - 0.6, p.dim, 0.45);
        return;
      }
      const color = hurt > 0.5 ? p.bright : p.fg;
      for (let i = pts.length - 1; i >= 1; i--) this.block(pts[i].x, pts[i].y, color, 'hatch');
      const h = pts[0];
      this.inverse('K', h.x, h.y, hurt > 0.5 ? p.fg : p.bright);
      if (b.stunned > 0) this.glyph('z', h.x + 0.4, h.y - 0.5, p.dim, 0.5);
      return;
    }
    const c = b.core;
    if (this.soft) {
      ctx.fillStyle = hurt > 0.5 ? p.gold : p.danger;
      ctx.beginPath();
      ctx.roundRect(c.x * cell + 3, c.y * cell + 3, cell * 2 - 6, cell * 2 - 6, cell * 0.5);
      ctx.fill();
      this.circle(c.x + 0.5, c.y + 0.5, 0.42, p.rival);
      this.circle(c.x + 0.5, c.y + 0.5, 0.18, p.bg);
    } else {
      const color = hurt > 0.5 ? p.bright : p.fg;
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
    }
    if (b.shield) {
      ctx.strokeStyle = this.soft ? '#6aa3d9' : p.fg;
      ctx.lineWidth = this.soft ? 2 : 1;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -this.clock / 80;
      ctx.beginPath();
      if (this.soft) ctx.arc((c.x + 1) * cell, (c.y + 1) * cell, cell * 1.5, 0, Math.PI * 2);
      else ctx.rect((c.x - 0.5) * cell, (c.y - 0.5) * cell, cell * 3, cell * 3);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      this.setFont(`${Math.round(cell * (this.soft ? 0.6 : 0.8))}px ${this.theme.display}`);
      ctx.fillStyle = p.bright;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`[${'#'.repeat(b.dronesEaten)}${'.'.repeat(4 - b.dronesEaten)}]`, (c.x + 1) * cell, (c.y - 0.95) * cell);
    }
  }

  private drawBossBar(game: Game) {
    const b = game.boss!;
    const { ctx, size, cell } = this;
    const p = this.palette;
    const name = this.soft ? (b.kind === 'serpent' ? 'Serpent King' : 'Swarm Queen') : b.kind === 'serpent' ? 'SERPENT_KING' : 'SWARM_QUEEN';
    const bar = `${name} [${'#'.repeat(b.hp)}${'.'.repeat(Math.max(0, b.maxHp - b.hp))}]`;
    const pixel = this.theme.display.includes('Silkscreen');
    this.setFont(`${this.soft ? '700 ' : ''}${Math.round(cell * (pixel ? 0.6 : 0.9))}px ${this.theme.display}`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(bar).width;
    ctx.fillStyle = p.bg;
    ctx.fillRect(size / 2 - w / 2 - 6, 2, w + 12, cell * 0.95);
    ctx.fillStyle = this.soft ? p.danger : p.bright;
    ctx.fillText(bar, size / 2, 3);
  }

  private drawProjectiles(game: Game) {
    const t = game.worldAlpha;
    for (const pr of game.projectiles) {
      const jump = Math.abs(pr.prev.x - pr.pos.x) + Math.abs(pr.prev.y - pr.pos.y) > 2;
      const x = jump ? pr.pos.x : lerp(pr.prev.x, pr.pos.x, t);
      const y = jump ? pr.pos.y : lerp(pr.prev.y, pr.pos.y, t);
      if (this.soft) this.circle(x, y, 0.16, '#6cbf5b');
      else this.glyph('*', x, y, this.palette.bright, 1);
    }
  }

  /** Darkness over the whole board, or (big boards) over the given cell rects only. */
  private drawDarkness(game: Game, rects?: [number, number, number, number][]) {
    const { ctx, cell, size } = this;
    const v = this.view;
    // Big boards draw the layer in screen space.
    const sx = (x: number) => (v ? (x - v.x) * cell * v.zoom + size / 2 : x * cell);
    const sy = (y: number) => (v ? (y - v.y) * cell * v.zoom + size / 2 : y * cell);
    const k = v ? v.zoom : 1;
    const l = this.lctx;
    l.save();
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, this.layer.width, this.layer.height);
    l.restore();
    l.fillStyle = this.soft ? '#1d2230' : this.palette.bg;
    l.globalAlpha = this.soft ? 0.9 : 0.95;
    if (rects) for (const [x, y, w, h] of rects) l.fillRect(sx(x), sy(y), w * cell * k, h * cell * k);
    else l.fillRect(0, 0, size, size);
    l.globalAlpha = 1;
    l.globalCompositeOperation = 'destination-out';
    for (const pl of game.players) {
      if (!pl.alive || !pl.body.length) continue;
      const h = slide(pl.body.slice(0, 1), pl.prevBody.slice(0, 1), game.alphaFor(pl))[0];
      const hx = sx(h.x + 0.5);
      const hy = sy(h.y + 0.5);
      const g = l.createRadialGradient(hx, hy, cell * 2 * k, hx, hy, cell * 5.5 * k);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g;
      l.fillRect(0, 0, size, size);
    }
    l.globalCompositeOperation = 'source-over';
    this.onScreen(() => ctx.drawImage(this.layer, 0, 0, size, size));
    const inDark = (q: Vec) => !rects || rects.some(([x, y, w, h]) => q.x >= x && q.y >= y && q.x < x + w && q.y < y + h);
    for (const pk of game.pickups) {
      if (!this.inView(pk.pos.x, pk.pos.y) || !inDark(pk.pos)) continue;
      const a = 0.3 + this.pulse(1600) * 0.3;
      if (this.soft) {
        ctx.globalAlpha = a;
        this.circle(pk.pos.x, pk.pos.y, 0.1, this.pickupColor(pk.kind));
        ctx.globalAlpha = 1;
      } else this.glyph('.', pk.pos.x, pk.pos.y, this.palette.fg, 1, a);
    }
  }

  private drawPlayer(game: Game, pl: Player) {
    if (!pl.body.length || (!pl.alive && game.status !== 'over')) return;
    const p = this.palette;
    const color = this.playerColor(pl.id);
    const phase = pl.effects.phase ?? 0;
    const dead = !pl.alive;
    const pts = game.status === 'over' ? pl.body : slide(pl.body, pl.prevBody, game.alphaFor(pl));
    const h = pts[0];
    let alphaMul = 1;
    if (phase && !dead && phase < 1500) alphaMul = 0.6 + this.pulse(500) * 0.4;
    const hexed = pl.hexed > 0 && !dead;
    const hexWarn = pl.hexWarn > 0 && !dead;
    if (hexed) alphaMul *= 0.6 + this.pulse(300) * 0.4;

    if (this.soft) {
      const a = (dead ? 0.4 : 1) * alphaMul;
      const paper = this.theme.id === 'paper';
      const hollow = (pl.id === 0 && this.skin === 'ghost') || paper;
      if (phase && !dead) this.tube(pts, color, 0.7, a, [0.25, 0.2]);
      else if (hollow) {
        this.tube(pts, color, 0.74, a);
        this.tube(pts, p.bg, paper ? 0.46 : 0.5, 1);
        if (paper && pl.id === 0 && this.skin === 'classic') this.tube(pts, color, 0.12, a * 0.5, [0.15, 0.3]);
      } else {
        this.tube(pts, color, 0.72, a);
        if (pl.id === 0 && this.skin === 'ember') this.tube(pts, p.bg, 0.16, 0.6, [0.3, 0.3]);
      }
      const headColor = pl.id === 0 && this.skin === 'gold' ? p.gold : color;
      this.circle(h.x, h.y, 0.4, paper ? p.bg : headColor, paper ? headColor : undefined, 2);
      if (dead) this.softLabel('x x', h.x, h.y, paper ? color : p.bg, 0.4);
      else this.eyes(h, pl.dir, paper ? p.bg : '#ffffff', paper ? color : '#1e2a2a', 0.17);
    } else {
      let style: BlockStyle = 'solid';
      if (pl.id === 0 && this.skin === 'ember') style = 'hatch';
      if (pl.id === 0 && this.skin === 'ghost') style = 'outline';
      if (phase && !dead) style = 'outline';
      const n = pts.length;
      for (let i = n - 1; i >= 1; i--) {
        const fade = this.theme.id === 'terminal' ? 1 - (i / Math.max(n, 6)) * 0.45 : 1;
        this.block(pts[i].x, pts[i].y, color, style, (dead ? 0.35 : fade) * alphaMul);
      }
      const headColor = pl.id === 0 && this.skin === 'gold' ? p.bright : color;
      this.block(h.x, h.y, headColor, 'solid', dead ? 0.5 : 1);
      this.glyph(dead ? 'x' : hexed ? '?' : ARROW_GLYPH[pl.dir], h.x, h.y, p.bg, 0.8);
    }

    if (hexWarn || hexed) {
      const hc = this.hexColor(pl.id);
      // The warning blinks fast; the hex itself swirls slowly around the head.
      const a = hexWarn ? (this.pulse(120) > 0.5 ? 1 : 0.2) : 0.8;
      if (this.soft) {
        this.ctx.globalAlpha = a;
        this.circle(h.x, h.y, hexWarn ? 0.75 : 0.6 + this.pulse(400) * 0.12, undefined, hc, 2.5);
        this.ctx.globalAlpha = 1;
        if (hexed) this.softLabel('hexed', h.x, h.y + 0.95, hc, 0.45);
      } else {
        this.block(h.x, h.y, hc, 'outline', a);
        if (hexed) this.glyph('HEX', h.x, h.y + 0.95, hc, 0.5);
      }
    }

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
        color: this.soft ? p.gold : p.dim,
      });
    }
    if (game.isHunkering(pl)) {
      if (this.soft) this.circle(h.x, h.y, 0.62 + this.pulse(600) * 0.06, undefined, color, 2);
      else {
        this.glyph('[', h.x - 0.75, h.y, p.bright, 0.9);
        this.glyph(']', h.x + 0.75, h.y, p.bright, 0.9);
      }
    }
    if (pl.armour > 0) {
      if (this.soft) this.circle(h.x, h.y, 0.52, undefined, p.gold, 2);
      else this.block(h.x, h.y, p.bright, 'outline', 0.6);
    }
    if (pl.effects.magnet) {
      const { ctx, cell } = this;
      ctx.strokeStyle = p.dim;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([2, 6]);
      ctx.lineDashOffset = this.clock / 60;
      ctx.beginPath();
      if (this.soft) ctx.arc((h.x + 0.5) * cell, (h.y + 0.5) * cell, cell * 6, 0, Math.PI * 2);
      else ctx.rect((h.x - 5.5) * cell, (h.y - 5.5) * cell, cell * 12, cell * 12);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.globalAlpha = 1;
    }
    if (game.players.length > 1) {
      if (this.soft) this.softLabel(`P${pl.id + 1}`, h.x, h.y - 0.85, color, 0.5);
      else this.glyph(`P${pl.id + 1}`, h.x, h.y - 0.85, color, 0.55);
    }
  }
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t));
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}
