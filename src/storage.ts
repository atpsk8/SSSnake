import type { LevelData } from './game/levels';
import type { ModeId, SnakeClass } from './game/types';

export type PaletteId = 'green' | 'amber' | 'white';
export type TouchStyle = 'swipe' | 'dpad';
export type SkinId = 'classic' | 'ember' | 'ghost' | 'gold';
/** How strong the CRT effects are: scanlines, glow, flicker. */
export type CrtLevel = 'soft' | 'full' | 'off';

export interface Settings {
  palette: PaletteId;
  crt: CrtLevel;
  reducedMotion: boolean;
  sound: boolean;
  music: boolean;
  touch: TouchStyle;
  cls: SnakeClass;
  skin: SkinId;
  name: string;
}

export interface LocalScore {
  name: string;
  score: number;
  level: number;
  cls: SnakeClass;
  date: string;
}

export interface SaveData {
  best: Partial<Record<ModeId, number>>;
  daily: Record<string, number>;
  /** Best Daily run per date, encoded ghost trail. */
  ghosts: Record<string, string>;
  achievements: string[];
  levels: LevelData[];
  /** Local top-10 per board key ("arcade", "daily:2026-10-15", ...). */
  boards: Record<string, LocalScore[]>;
  settings: Settings;
}

const KEY = 'sssnake:v1';

function defaults(): SaveData {
  let reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    /* no matchMedia */
  }
  return {
    best: {},
    daily: {},
    ghosts: {},
    achievements: [],
    levels: [],
    boards: {},
    settings: {
      palette: 'green',
      crt: 'soft',
      reducedMotion: reduced,
      sound: true,
      music: true,
      touch: 'swipe',
      cls: 'racer',
      skin: 'classic',
      name: '',
    },
  };
}

export function load(): SaveData {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      best: { ...base.best, ...parsed.best },
      daily: { ...base.daily, ...parsed.daily },
      ghosts: { ...parsed.ghosts },
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
      levels: Array.isArray(parsed.levels) ? parsed.levels : [],
      boards: { ...parsed.boards },
      settings: migrate({ ...base.settings, ...parsed.settings }),
    };
  } catch {
    return base;
  }
}

/** Older saves used 'neon' / 'safe' colour schemes. */
function migrate(s: Settings): Settings {
  if (!['green', 'amber', 'white'].includes(s.palette)) s.palette = 'green';
  if (!['soft', 'full', 'off'].includes(s.crt)) s.crt = 'soft';
  return s;
}

function lastKeys<T>(rec: Record<string, T>, n: number): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(rec).sort().slice(-n)) out[k] = rec[k];
  return out;
}

export function save(data: SaveData) {
  // Keep daily data bounded: a month of scores, a week of ghosts and daily boards.
  data.daily = lastKeys(data.daily, 31);
  data.ghosts = lastKeys(data.ghosts, 7);
  const dailyBoards = Object.keys(data.boards).filter((k) => k.startsWith('daily:')).sort();
  for (const k of dailyBoards.slice(0, -7)) delete data.boards[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage blocked or full: drop ghosts (the largest item) and retry once.
    try {
      data.ghosts = {};
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* the game still works without saving */
    }
  }
}

/** Insert into a local top-10; returns the 1-based rank, or 0 if it didn't place. */
export function addLocalScore(data: SaveData, board: string, entry: LocalScore): number {
  const list = [...(data.boards[board] ?? []), entry].sort((a, b) => b.score - a.score).slice(0, 10);
  data.boards[board] = list;
  return list.indexOf(entry) + 1;
}
