import { Game } from './game/engine';
import { sanitizeLevel, type LevelData } from './game/levels';
import { dailySeed } from './game/rng';
import { DIR_LIST, type Dir, type ModeId, type SnakeClass } from './game/types';

/**
 * Replays. The engine is deterministic, so a run is fully described by its options plus the
 * inputs applied at each 16 ms simulation frame. Used for instant replays, watching
 * leaderboard runs, and server-side score verification (bundled into api/_engine.js).
 */

export const FRAME_MS = 16;
/** Hard cap so a malicious replay can't keep the server busy: 40 minutes of play. */
export const MAX_FRAMES = 150_000;

export type Input =
  | { p: number; t: 'turn'; d: Dir }
  | { p: number; t: 'shed' }
  | { p: number; t: 'hold'; on: boolean }
  | { p: number; t: 'draft'; i: number };

export interface Replay {
  v: 1;
  mode: ModeId;
  seed: number;
  classes: SnakeClass[];
  level?: LevelData;
  frames: number;
  inputs: { f: number; i: Input }[];
}

const MODES: ModeId[] = ['classic', 'arcade', 'daily', 'zen', 'rhythm', 'versus', 'custom'];
const CLASSES: SnakeClass[] = ['racer', 'viper', 'cobra', 'python'];
const DIR_CODE: Record<Dir, string> = { up: 'U', down: 'D', left: 'L', right: 'R' };
const CODE_DIR: Record<string, Dir> = { U: 'up', D: 'down', L: 'left', R: 'right' };

export function applyInput(g: Game, i: Input) {
  switch (i.t) {
    case 'turn':
      g.turn(i.d, i.p);
      break;
    case 'shed':
      g.shed(i.p);
      break;
    case 'hold':
      g.setHeld(i.p, i.on);
      break;
    case 'draft':
      g.chooseMutation(i.i);
      break;
  }
}

function inputCode(i: Input): string {
  const p = i.p === 1 ? '!' : '';
  switch (i.t) {
    case 'turn':
      return p + DIR_CODE[i.d];
    case 'shed':
      return `${p}S`;
    case 'hold':
      return p + (i.on ? 'H' : 'h');
    case 'draft':
      return `${p}#${i.i}`;
  }
}

function parseCode(c: string): Input | null {
  const p = c.startsWith('!') ? 1 : 0;
  const body = p ? c.slice(1) : c;
  if (CODE_DIR[body]) return { p, t: 'turn', d: CODE_DIR[body] };
  if (body === 'S') return { p, t: 'shed' };
  if (body === 'H' || body === 'h') return { p, t: 'hold', on: body === 'H' };
  const m = /^#([0-2])$/.exec(body);
  if (m) return { p, t: 'draft', i: Number(m[1]) };
  return null;
}

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** Compact text form: v1|mode|seed|classes|frames|level|inputs ("<delta><code>" joined by "."). */
export function encodeReplay(r: Replay): string {
  let last = 0;
  const inputs = r.inputs
    .map(({ f, i }) => {
      const d = f - last;
      last = f;
      return `${d}${inputCode(i)}`;
    })
    .join('.');
  const level = r.level ? b64url(JSON.stringify(r.level)) : '';
  return ['v1', r.mode, r.seed >>> 0, r.classes.join(','), r.frames, level, inputs].join('|');
}

export function decodeReplay(s: unknown): Replay | null {
  if (typeof s !== 'string' || s.length > 400_000) return null;
  const parts = s.split('|');
  if (parts.length !== 7 || parts[0] !== 'v1') return null;
  const [, mode, seedS, classesS, framesS, levelS, inputsS] = parts;
  if (!MODES.includes(mode as ModeId)) return null;
  const seed = Number(seedS);
  const frames = Number(framesS);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  if (!Number.isInteger(frames) || frames < 0 || frames > MAX_FRAMES) return null;
  const classes = classesS.split(',').filter((c): c is SnakeClass => CLASSES.includes(c as SnakeClass));
  if (!classes.length || classes.length > 2) return null;
  let level: LevelData | undefined;
  if (levelS) {
    try {
      level = sanitizeLevel(JSON.parse(unb64url(levelS))) ?? undefined;
    } catch {
      return null;
    }
    if (!level) return null;
  }
  const inputs: { f: number; i: Input }[] = [];
  let f = 0;
  if (inputsS) {
    for (const tok of inputsS.split('.')) {
      const m = /^(\d+)(.+)$/.exec(tok);
      if (!m) return null;
      f += Number(m[1]);
      const i = parseCode(m[2]);
      if (!i || f > frames) return null;
      inputs.push({ f, i });
    }
  }
  return { v: 1, mode: mode as ModeId, seed, classes, level, frames, inputs };
}

export function gameFor(r: Replay): Game {
  return new Game({ mode: r.mode, seed: r.seed, classes: r.classes, level: r.level });
}

/** Re-run a replay to the end. Returns the final game, or null if the replay is inconsistent. */
export function simulate(r: Replay): Game | null {
  const g = gameFor(r);
  let k = 0;
  for (let f = 0; f < r.frames; f++) {
    while (k < r.inputs.length && r.inputs[k].f === f) applyInput(g, r.inputs[k++].i);
    if (g.status === 'draft') return null; // a draft must be answered at the frame it appeared
    if (g.status === 'over') break;
    g.update(FRAME_MS);
  }
  return g;
}

export { DIR_LIST, dailySeed };

/** Server-side check for a leaderboard submission. */
export function verifyRun(
  replay: unknown,
  board: string,
  claimed: number,
): { ok: true; score: number; level: number; timeMs: number; cls: SnakeClass } | { ok: false; error: string } {
  const r = decodeReplay(replay);
  if (!r) return { ok: false, error: 'bad_replay' };
  if (r.level) return { ok: false, error: 'bad_mode' };
  const daily = /^daily:(\d{4}-\d{2}-\d{2})$/.exec(board);
  if (daily) {
    if (r.mode !== 'daily' || r.seed !== dailySeed(daily[1])) return { ok: false, error: 'wrong_seed' };
  } else if (r.mode !== board) return { ok: false, error: 'bad_mode' };
  const g = simulate(r);
  if (!g || g.status !== 'over') return { ok: false, error: 'replay_incomplete' };
  if (g.score !== claimed) return { ok: false, error: 'score_mismatch' };
  return { ok: true, score: g.score, level: g.level, timeMs: g.time, cls: g.p0.cls };
}
