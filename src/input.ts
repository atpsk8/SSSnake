import type { Dir } from './game/types';

export interface InputHandlers {
  turn(dir: Dir): void;
  shed(): void;
  surge(held: boolean): void;
  pause(): void;
  confirm(): void;
  /** Any first interaction; used to unlock audio. */
  gesture(): void;
}

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const SWIPE_PX = 22;

function capture(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* pointer already gone; capture is only a nicety */
  }
}

export function bindInput(board: HTMLElement, h: InputHandlers) {
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    h.gesture();
    const dir = KEY_DIRS[e.code];
    if (dir) {
      e.preventDefault();
      h.turn(dir);
      return;
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!e.repeat) h.shed();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        h.surge(true);
        break;
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
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') h.surge(false);
  });
  window.addEventListener('blur', () => h.surge(false));

  // Swipe anywhere on the board. Each time the finger travels SWIPE_PX the origin resets,
  // so one continuous gesture can chain several turns.
  const active = new Map<number, { x: number; y: number; moved: boolean; t: number }>();
  let multiStart = 0;

  board.addEventListener('pointerdown', (e) => {
    // Only the play surface itself; overlay buttons inside it keep normal behaviour.
    if (e.pointerType === 'mouse' || !(e.target === board || e.target instanceof HTMLCanvasElement)) return;
    h.gesture();
    e.preventDefault();
    capture(board, e.pointerId);
    active.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false, t: performance.now() });
    if (active.size === 2) multiStart = performance.now();
  });

  board.addEventListener('pointermove', (e) => {
    const s = active.get(e.pointerId);
    if (!s || active.size > 1) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
    s.moved = true;
    s.x = e.clientX;
    s.y = e.clientY;
    if (Math.abs(dx) > Math.abs(dy)) h.turn(dx > 0 ? 'right' : 'left');
    else h.turn(dy > 0 ? 'down' : 'up');
  });

  const end = (e: PointerEvent) => {
    if (!active.has(e.pointerId)) return;
    // Two-finger tap = shed.
    if (active.size === 2 && performance.now() - multiStart < 350 && [...active.values()].every((s) => !s.moved)) {
      h.shed();
      multiStart = 0;
    }
    active.delete(e.pointerId);
  };
  board.addEventListener('pointerup', end);
  board.addEventListener('pointercancel', end);
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
