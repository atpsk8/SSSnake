import type { Dir } from './game/types';

export interface InputHandlers {
  turn(dir: Dir, player: number): void;
  shed(player: number): void;
  ability(held: boolean, player: number): void;
  pause(): void;
  confirm(): void;
  /** Number keys 1-9 (menus, drafts). */
  digit(n: number): void;
  /** Any first interaction; used to unlock audio. */
  gesture(): void;
  /** Two players share the keyboard / screen. */
  versus(): boolean;
}

const SOLO_DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const P1_DIRS: Record<string, Dir> = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
const P2_DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

const SWIPE_PX = 22;
const HOLD_MS = 280;
const DOUBLE_TAP_MS = 300;

function capture(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* pointer already gone; capture is only a nicety */
  }
}

type KeyAction = { kind: 'turn'; dir: Dir; p: number } | { kind: 'shed' | 'ability'; p: number };

export function bindInput(stage: HTMLElement, h: InputHandlers) {
  const keyAction = (code: string): KeyAction | null => {
    if (h.versus()) {
      if (P1_DIRS[code]) return { kind: 'turn', dir: P1_DIRS[code], p: 0 };
      if (P2_DIRS[code]) return { kind: 'turn', dir: P2_DIRS[code], p: 1 };
      if (code === 'KeyQ' || code === 'Space') return { kind: 'shed', p: 0 };
      if (code === 'KeyE' || code === 'ShiftLeft') return { kind: 'ability', p: 0 };
      if (code === 'Slash' || code === 'ControlRight') return { kind: 'shed', p: 1 };
      if (code === 'Period' || code === 'ShiftRight') return { kind: 'ability', p: 1 };
      return null;
    }
    if (SOLO_DIRS[code]) return { kind: 'turn', dir: SOLO_DIRS[code], p: 0 };
    if (code === 'Space') return { kind: 'shed', p: 0 };
    if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyE') return { kind: 'ability', p: 0 };
    return null;
  };

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    h.gesture();
    const a = keyAction(e.code);
    if (a) {
      e.preventDefault();
      if (a.kind === 'turn') h.turn(a.dir, a.p);
      else if (e.repeat) return;
      else if (a.kind === 'shed') h.shed(a.p);
      else h.ability(true, a.p);
      return;
    }
    if (/^Digit[1-9]$/.test(e.code) && !e.repeat) {
      h.digit(Number(e.code.slice(5)));
      return;
    }
    switch (e.code) {
      case 'KeyP':
      case 'Escape':
        e.preventDefault();
        h.pause();
        break;
      case 'Enter':
      case 'KeyR':
        if (!e.repeat) h.confirm();
        break;
    }
  });
  window.addEventListener('keyup', (e) => {
    const a = keyAction(e.code);
    if (a?.kind === 'ability') h.ability(false, a.p);
  });
  window.addEventListener('blur', () => {
    h.ability(false, 0);
    h.ability(false, 1);
  });

  // Touch: swipe to turn (each time the finger travels SWIPE_PX the origin resets, so one
  // gesture can chain turns), two-finger tap to shed, double tap or press-and-hold for the
  // ability. In Versus each player owns half of the screen.
  interface Touch {
    x: number;
    y: number;
    moved: boolean;
    t: number;
    player: number;
    holdTimer: number | null;
    holding: boolean;
  }
  const active = new Map<number, Touch>();
  const lastTap = [0, 0];
  let multiStart = 0;

  const playerFor = (x: number, y: number) => {
    if (!h.versus()) return 0;
    const r = stage.getBoundingClientRect();
    return r.width >= r.height ? (x < r.left + r.width / 2 ? 0 : 1) : y < r.top + r.height / 2 ? 0 : 1;
  };
  const sameHalf = (player: number) => [...active.values()].filter((t) => t.player === player);

  stage.addEventListener('pointerdown', (e) => {
    // Only the play surface itself; overlay buttons inside it keep normal behaviour.
    if (e.pointerType === 'mouse' || !(e.target === stage || e.target instanceof HTMLCanvasElement)) return;
    h.gesture();
    e.preventDefault();
    capture(stage, e.pointerId);
    const player = playerFor(e.clientX, e.clientY);
    const t: Touch = { x: e.clientX, y: e.clientY, moved: false, t: performance.now(), player, holdTimer: null, holding: false };
    t.holdTimer = window.setTimeout(() => {
      if (!t.moved && active.get(e.pointerId) === t && sameHalf(player).length === 1) {
        t.holding = true;
        h.ability(true, player);
      }
    }, HOLD_MS);
    active.set(e.pointerId, t);
    if (sameHalf(player).length === 2) multiStart = performance.now();
  });

  stage.addEventListener('pointermove', (e) => {
    const s = active.get(e.pointerId);
    if (!s || sameHalf(s.player).length > 1) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
    s.moved = true;
    s.x = e.clientX;
    s.y = e.clientY;
    if (Math.abs(dx) > Math.abs(dy)) h.turn(dx > 0 ? 'right' : 'left', s.player);
    else h.turn(dy > 0 ? 'down' : 'up', s.player);
  });

  const end = (e: PointerEvent) => {
    const s = active.get(e.pointerId);
    if (!s) return;
    if (s.holdTimer !== null) window.clearTimeout(s.holdTimer);
    if (s.holding) h.ability(false, s.player);
    const group = sameHalf(s.player);
    const now = performance.now();
    if (group.length === 2 && now - multiStart < 350 && group.every((t) => !t.moved)) {
      h.shed(s.player);
      multiStart = 0;
      for (const t of group) t.moved = true; // don't also count as taps
    } else if (group.length === 1 && !s.moved && !s.holding && now - s.t < HOLD_MS) {
      if (now - lastTap[s.player] < DOUBLE_TAP_MS) {
        h.ability(true, s.player);
        h.ability(false, s.player);
        lastTap[s.player] = 0;
      } else lastTap[s.player] = now;
    }
    active.delete(e.pointerId);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}

/** Make a button fire on press (not release) for responsive touch play. */
export function pressButton(el: HTMLElement, onDown: () => void, onUp?: () => void) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    capture(el, e.pointerId);
    el.classList.add('pressed');
    onDown();
  });
  const up = () => {
    if (!el.classList.contains('pressed')) return;
    el.classList.remove('pressed');
    onUp?.();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  // Keyboard activation (Enter/Space on a focused button) still works via click.
  el.addEventListener('click', (e) => {
    if (e.detail === 0) {
      onDown();
      onUp?.();
    }
  });
}
