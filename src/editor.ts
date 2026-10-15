import { Game } from './game/engine';
import { MODIFIER_INFO, MODIFIER_LIST, emptyLevel, sanitizeLevel, type LevelData } from './game/levels';
import { DIR_LIST, H, W, type Dir } from './game/types';
import type { Renderer } from './render';

type Tool = 'wall' | 'erase' | 'portal' | 'mine' | 'well' | 'arrow' | 'spawn';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'wall', label: 'Wall', hint: 'Drag to paint walls' },
  { id: 'erase', label: 'Erase', hint: 'Drag to clear cells' },
  { id: 'portal', label: 'Portal', hint: 'Click two cells to link a portal pair (max 4)' },
  { id: 'mine', label: 'Mine', hint: 'Click to toggle a mine' },
  { id: 'well', label: 'Well', hint: 'Click to toggle a gravity well (max 6)' },
  { id: 'arrow', label: 'Arrow', hint: 'Click to cycle an arrow tile: ↑ → ↓ ← off' },
  { id: 'spawn', label: 'Spawn', hint: 'Click to move the start; click it again to turn it' },
];

export interface EditorHost {
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  levels(): LevelData[];
  saveLevels(levels: LevelData[]): void;
  test(level: LevelData): void;
  share(level: LevelData): Promise<string>;
  exit(): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Editor {
  level: LevelData = emptyLevel();
  preview!: Game;
  private tool: Tool = 'wall';
  private pendingPortal: number | null = null;
  private painting = false;
  active = false;

  constructor(private host: EditorHost) {
    this.buildToolbar();
    this.bindOptions();
    this.bindPointer();
    this.rebuild();
  }

  open(level?: LevelData) {
    if (level) this.level = structuredClone(level);
    this.active = true;
    this.syncOptions();
    this.refreshLoadList();
    this.rebuild();
    this.status(TOOLS.find((t) => t.id === this.tool)!.hint);
  }

  close() {
    this.active = false;
    this.pendingPortal = null;
    this.host.renderer.marker = null;
  }

  private status(text: string) {
    $('edStatus').textContent = text;
  }

  /** Rebuild the preview game from the level data (cheap; done after every edit). */
  rebuild() {
    const clean = sanitizeLevel(this.level) ?? emptyLevel();
    this.preview = new Game({ mode: 'custom', seed: 1, level: { ...clean, goal: 0 } });
    this.preview.pickups = [];
    this.preview.mice = [];
    this.preview.update(0);
    const pp = this.pendingPortal;
    this.host.renderer.marker = pp === null ? null : { x: pp % W, y: Math.floor(pp / W) };
  }

  // ---------------------------------------------------------------- UI

  private buildToolbar() {
    const bar = $('editorTools');
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.title = t.hint;
      b.dataset.tool = t.id;
      b.className = 'tool';
      b.addEventListener('click', () => {
        this.tool = t.id;
        this.pendingPortal = null;
        this.rebuild();
        for (const o of bar.querySelectorAll('button')) o.classList.toggle('active', o === b);
        this.status(t.hint);
      });
      if (t.id === this.tool) b.classList.add('active');
      bar.appendChild(b);
    }
    const twists = $('edTwists');
    for (const m of MODIFIER_LIST) {
      const label = document.createElement('label');
      label.className = 'setting check';
      label.innerHTML = `<input type="checkbox" data-twist="${m}" /> <span>${MODIFIER_INFO[m].name}: ${MODIFIER_INFO[m].desc}</span>`;
      twists.appendChild(label);
    }
  }

  private bindOptions() {
    const commit = () => {
      this.level.name = $<HTMLInputElement>('edName').value.slice(0, 32) || 'My level';
      this.level.goal = Math.max(0, Math.min(999, Math.floor(Number($<HTMLInputElement>('edGoal').value) || 0)));
      this.level.wrap = $<HTMLInputElement>('edWrap').checked;
      this.level.collapse = $<HTMLInputElement>('edCollapse').checked;
      this.level.rival = $<HTMLInputElement>('edRival').checked;
      this.level.mice = $<HTMLInputElement>('edMice').checked;
      this.level.powerUps = $<HTMLInputElement>('edPowers').checked;
      this.level.modifiers = MODIFIER_LIST.filter(
        (m) => document.querySelector<HTMLInputElement>(`[data-twist="${m}"]`)?.checked,
      );
      this.rebuild();
    };
    for (const id of ['edName', 'edGoal', 'edWrap', 'edCollapse', 'edRival', 'edMice', 'edPowers']) {
      $(id).addEventListener('change', commit);
    }
    $('edTwists').addEventListener('change', commit);

    $('edTest').addEventListener('click', () => this.host.test(structuredClone(this.level)));
    $('edSave').addEventListener('click', () => {
      const levels = this.host.levels().filter((l) => l.name !== this.level.name);
      levels.unshift(structuredClone(this.level));
      this.host.saveLevels(levels.slice(0, 20));
      this.refreshLoadList();
      this.status(`Saved "${this.level.name}" on this device.`);
    });
    $<HTMLSelectElement>('edLoad').addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      const found = this.host.levels().find((l) => l.name === sel.value);
      sel.value = '';
      if (!found) return;
      this.level = structuredClone(found);
      this.syncOptions();
      this.rebuild();
      this.status(`Loaded "${found.name}".`);
    });
    $('edShare').addEventListener('click', async () => {
      this.status(await this.host.share(structuredClone(this.level)));
    });
    $('edClear').addEventListener('click', () => {
      const name = this.level.name;
      this.level = { ...emptyLevel(), name };
      this.pendingPortal = null;
      this.syncOptions();
      this.rebuild();
      this.status('Cleared.');
    });
    $('edExit').addEventListener('click', () => this.host.exit());
  }

  private syncOptions() {
    $<HTMLInputElement>('edName').value = this.level.name;
    $<HTMLInputElement>('edGoal').value = String(this.level.goal);
    $<HTMLInputElement>('edWrap').checked = this.level.wrap;
    $<HTMLInputElement>('edCollapse').checked = this.level.collapse;
    $<HTMLInputElement>('edRival').checked = this.level.rival;
    $<HTMLInputElement>('edMice').checked = this.level.mice;
    $<HTMLInputElement>('edPowers').checked = this.level.powerUps;
    for (const m of MODIFIER_LIST) {
      const box = document.querySelector<HTMLInputElement>(`[data-twist="${m}"]`);
      if (box) box.checked = this.level.modifiers.includes(m);
    }
  }

  private refreshLoadList() {
    const sel = $<HTMLSelectElement>('edLoad');
    sel.innerHTML = '<option value="">Load…</option>';
    for (const l of this.host.levels()) {
      const o = document.createElement('option');
      o.value = l.name;
      o.textContent = l.name;
      sel.appendChild(o);
    }
  }

  // ---------------------------------------------------------------- painting

  private bindPointer() {
    const canvas = this.host.canvas;
    const cellAt = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * W);
      const y = Math.floor(((e.clientY - r.top) / r.height) * H);
      return x >= 0 && y >= 0 && x < W && y < H ? y * W + x : -1;
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      e.preventDefault();
      e.stopPropagation();
      const c = cellAt(e);
      if (c < 0) return;
      this.painting = this.tool === 'wall' || this.tool === 'erase';
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.apply(c);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active || !this.painting) return;
      const c = cellAt(e);
      if (c >= 0) this.apply(c);
    });
    const stop = () => {
      this.painting = false;
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  /** Cells the snake starts on (head + 3 behind); kept clear of walls. */
  private spawnCells(): number[] {
    const out = [this.level.spawn];
    const back: Record<Dir, number> = { up: W, down: -W, left: 1, right: -1 };
    for (let i = 1; i < 4; i++) {
      const c = this.level.spawn + back[this.level.spawnDir] * i;
      if (c >= 0 && c < W * H && Math.abs((c % W) - (this.level.spawn % W)) <= 3) out.push(c);
    }
    return out;
  }

  private clearCell(c: number) {
    const l = this.level;
    l.walls = l.walls.filter((i) => i !== c);
    l.mines = l.mines.filter((i) => i !== c);
    l.wells = l.wells.filter((i) => i !== c);
    l.arrows = l.arrows.filter(([i]) => i !== c);
    l.portals = l.portals.filter(([a, b]) => a !== c && b !== c);
  }

  apply(c: number) {
    const l = this.level;
    const isSpawn = this.spawnCells().includes(c);
    switch (this.tool) {
      case 'wall':
        if (isSpawn || l.walls.includes(c)) return;
        this.clearCell(c);
        l.walls.push(c);
        break;
      case 'erase':
        this.clearCell(c);
        break;
      case 'mine':
        if (isSpawn) return;
        if (l.mines.includes(c)) l.mines = l.mines.filter((i) => i !== c);
        else {
          this.clearCell(c);
          l.mines.push(c);
        }
        break;
      case 'well':
        if (l.wells.includes(c)) l.wells = l.wells.filter((i) => i !== c);
        else if (l.wells.length < 6) {
          this.clearCell(c);
          l.wells.push(c);
        } else this.status('Up to 6 wells.');
        break;
      case 'arrow': {
        const cur = l.arrows.find(([i]) => i === c);
        const order: (Dir | null)[] = ['up', 'right', 'down', 'left', null];
        const next = order[(order.indexOf(cur ? cur[1] : null) + 1) % order.length];
        this.clearCell(c);
        if (next) l.arrows.push([c, next]);
        break;
      }
      case 'portal':
        if (isSpawn) return;
        if (this.pendingPortal === null) {
          if (l.portals.length >= 4) {
            this.status('Up to 4 portal pairs. Erase one first.');
            return;
          }
          this.clearCell(c);
          this.pendingPortal = c;
          this.status('Now click where this portal should lead.');
        } else if (c !== this.pendingPortal) {
          this.clearCell(c);
          l.portals.push([this.pendingPortal, c]);
          this.pendingPortal = null;
          this.status('Portal pair linked.');
        }
        break;
      case 'spawn':
        if (c === l.spawn) l.spawnDir = DIR_LIST[(DIR_LIST.indexOf(l.spawnDir) + 1) % 4];
        else {
          l.spawn = c;
          for (const s of this.spawnCells()) this.clearCell(s);
        }
        break;
    }
    this.rebuild();
  }
}
