import type { ModeId } from './game/types';

export type PaletteId = 'neon' | 'safe';
export type TouchStyle = 'swipe' | 'dpad';

export interface Settings {
  palette: PaletteId;
  reducedMotion: boolean;
  sound: boolean;
  music: boolean;
  touch: TouchStyle;
}

export interface SaveData {
  best: Partial<Record<ModeId, number>>;
  daily: Record<string, number>;
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
    settings: { palette: 'neon', reducedMotion: reduced, sound: true, music: true, touch: 'swipe' },
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
      settings: { ...base.settings, ...parsed.settings },
    };
  } catch {
    return base;
  }
}

export function save(data: SaveData) {
  // Only keep the most recent month of daily scores.
  const keys = Object.keys(data.daily).sort().slice(-31);
  const daily: Record<string, number> = {};
  for (const k of keys) daily[k] = data.daily[k];
  data.daily = daily;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage blocked or full; the game still works without it */
  }
}
