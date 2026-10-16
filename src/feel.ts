import type { Dir, GameEvent } from './game/types';

/**
 * "Feel" extras: phone vibration and controller rumble on game events, plus gamepad input.
 */

const PATTERNS: Partial<Record<GameEvent['type'], number | number[]>> = {
  eat: 8,
  combo: 14,
  power: 25,
  shed: 30,
  hex: 30,
  hexed: 45,
  coil: [20, 40, 35],
  mouse: 10,
  rivalDie: [20, 30, 40],
  bossHit: 70,
  bossDie: [60, 40, 60, 40, 140],
  levelup: [20, 30, 20, 30, 60],
  armour: [40, 30, 40],
  die: [90, 50, 180],
};

export class Haptics {
  enabled = true;

  handle(events: GameEvent[], pads: Gamepad[]) {
    if (!this.enabled) return;
    let strongest: number | number[] | undefined;
    let weight = 0;
    for (const e of events) {
      const p = PATTERNS[e.type];
      if (p === undefined) continue;
      const w = Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : p;
      if (w > weight) {
        weight = w;
        strongest = p;
      }
    }
    if (strongest === undefined) return;
    // Phones only, and only after the player has touched the page (browsers block it before).
    const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
    if (activated && matchMedia('(pointer: coarse)').matches) {
      try {
        navigator.vibrate?.(strongest);
      } catch {
        /* not supported */
      }
    }
    for (const pad of pads) {
      const act = (pad as Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }).vibrationActuator;
      void act?.playEffect?.('dual-rumble', {
        duration: Math.min(300, weight),
        strongMagnitude: Math.min(1, weight / 200),
        weakMagnitude: Math.min(1, weight / 80),
      })?.catch(() => {});
    }
  }
}

export interface PadHandlers {
  turn(dir: Dir, player: number): void;
  shed(player: number): void;
  ability(held: boolean, player: number): void;
  pause(): void;
  confirm(): void;
  /** Two pads = two players in local versus. */
  twoPlayer(): boolean;
}

/**
 * Polls connected gamepads each frame (standard mapping): d-pad or left stick to turn,
 * A to shed, B / RB / RT to use the ability, Start to pause, A to confirm on menus.
 */
export class Gamepads {
  private prev = new Map<number, { buttons: boolean[]; dir: Dir | null }>();

  connected(): Gamepad[] {
    return (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected);
  }

  poll(h: PadHandlers) {
    const pads = this.connected();
    pads.forEach((pad, order) => {
      const player = h.twoPlayer() ? Math.min(order, 1) : 0;
      const last = this.prev.get(pad.index) ?? { buttons: [], dir: null };
      const pressed = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => pressed(i) && !last.buttons[i];
      const released = (i: number) => !pressed(i) && last.buttons[i];

      let dir: Dir | null = null;
      if (pressed(12)) dir = 'up';
      else if (pressed(13)) dir = 'down';
      else if (pressed(14)) dir = 'left';
      else if (pressed(15)) dir = 'right';
      else {
        const [x = 0, y = 0] = pad.axes;
        if (Math.max(Math.abs(x), Math.abs(y)) > 0.55) dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
      }
      if (dir && dir !== last.dir) h.turn(dir, player);

      if (edge(0)) {
        h.shed(player);
        h.confirm();
      }
      const abilityButtons = [1, 5, 7];
      if (abilityButtons.some(edge)) h.ability(true, player);
      if (abilityButtons.some(released) && !abilityButtons.some(pressed)) h.ability(false, player);
      if (edge(9)) h.pause();

      this.prev.set(pad.index, { buttons: pad.buttons.map((b) => b.pressed), dir });
    });
  }
}
