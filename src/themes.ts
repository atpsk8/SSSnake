import type { PaletteId } from './storage';

export type ThemeId = 'terminal' | 'nokia' | 'gameboy' | 'paper' | 'minimal';

/** Canvas colours. "fg" is the main ink, "bright" the strongest, "faint" the weakest. */
export interface Palette {
  bg: string;
  fg: string;
  bright: string;
  dim: string;
  faint: string;
  /** Second player. */
  alt: string;
  /** Food and highlights. */
  accent: string;
  gold: string;
  danger: string;
  rival: string;
  /** Background decoration (ruled lines, LCD grid). */
  lines: string;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  desc: string;
  /** grid: blocks + characters on a cell grid. soft: continuous bodies + drawn shapes. */
  family: 'grid' | 'soft';
  font: string;
  display: string;
  /** Gutter between cells as a fraction of a cell (grid family). */
  gap: number;
  background: 'dots' | 'lcd' | 'ruled' | 'subtle';
  /** Grid family: cut a '#' into wall blocks. */
  wallGlyph: boolean;
  /** Grid family: draw food as a pixel diamond instead of '@'. */
  pixelFood: boolean;
  palette(variant: PaletteId): Palette;
}

const TERMINAL: Record<PaletteId, Palette> = {
  green: {
    bg: '#0c1511',
    fg: '#86d9a0',
    bright: '#cdeed6',
    dim: '#4f8a62',
    faint: '#1b2b21',
    alt: '#e3b766',
    accent: '#cdeed6',
    gold: '#cdeed6',
    danger: '#cdeed6',
    rival: '#4f8a62',
    lines: '#1b2b21',
  },
  amber: {
    bg: '#15110b',
    fg: '#e2b468',
    bright: '#f4dcb0',
    dim: '#8e7140',
    faint: '#2d2416',
    alt: '#86d9a0',
    accent: '#f4dcb0',
    gold: '#f4dcb0',
    danger: '#f4dcb0',
    rival: '#8e7140',
    lines: '#2d2416',
  },
  white: {
    bg: '#11141a',
    fg: '#c9d2df',
    bright: '#eef2f7',
    dim: '#7a8494',
    faint: '#232a35',
    alt: '#e3b766',
    accent: '#eef2f7',
    gold: '#eef2f7',
    danger: '#eef2f7',
    rival: '#7a8494',
    lines: '#232a35',
  },
};

const PIXEL = '"Silkscreen", "VT323", ui-monospace, monospace';

export const THEMES: Record<ThemeId, ThemeDef> = {
  terminal: {
    id: 'terminal',
    name: 'terminal',
    desc: 'soft phosphor command line (set color green|amber|white, set crt soft|full|off)',
    family: 'grid',
    font: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
    display: '"VT323", "IBM Plex Mono", ui-monospace, monospace',
    gap: 0.06,
    background: 'dots',
    wallGlyph: true,
    pixelFood: false,
    palette: (v) => TERMINAL[v] ?? TERMINAL.green,
  },
  nokia: {
    id: 'nokia',
    name: 'nokia',
    desc: 'grey-green LCD and dark pixels, like the original',
    family: 'grid',
    font: PIXEL,
    display: PIXEL,
    gap: 0.1,
    background: 'lcd',
    wallGlyph: false,
    pixelFood: true,
    palette: () => ({
      bg: '#b4c191',
      fg: '#2c3a1e',
      bright: '#141c0c',
      dim: '#5f6f45',
      faint: '#a2af80',
      alt: '#5f6f45',
      accent: '#141c0c',
      gold: '#141c0c',
      danger: '#141c0c',
      rival: '#5f6f45',
      lines: '#aab78a',
    }),
  },
  gameboy: {
    id: 'gameboy',
    name: 'gameboy',
    desc: 'four shades of green, chunky pixels',
    family: 'grid',
    font: PIXEL,
    display: PIXEL,
    gap: 0.08,
    background: 'lcd',
    wallGlyph: false,
    pixelFood: true,
    palette: () => ({
      bg: '#9bbc0f',
      fg: '#0f380f',
      bright: '#0f380f',
      dim: '#306230',
      faint: '#8bac0f',
      alt: '#306230',
      accent: '#0f380f',
      gold: '#0f380f',
      danger: '#0f380f',
      rival: '#306230',
      lines: '#93b40f',
    }),
  },
  paper: {
    id: 'paper',
    name: 'paper',
    desc: 'ink doodles on warm ruled paper, light and calm',
    family: 'soft',
    font: '"Patrick Hand", "Comic Sans MS", cursive',
    display: '"Patrick Hand", "Comic Sans MS", cursive',
    gap: 0,
    background: 'ruled',
    wallGlyph: false,
    pixelFood: false,
    palette: () => ({
      bg: '#f7f2e4',
      fg: '#2f3e57',
      bright: '#1c2738',
      dim: '#8a93a3',
      faint: '#e4ddc9',
      alt: '#b5523b',
      accent: '#c45a3e',
      gold: '#c9971c',
      danger: '#b5523b',
      rival: '#6c7686',
      lines: '#cbd9e6',
    }),
  },
  minimal: {
    id: 'minimal',
    name: 'minimal',
    desc: 'pastel flat colours and a rounded snake',
    family: 'soft',
    font: '"Nunito", system-ui, sans-serif',
    display: '"Nunito", system-ui, sans-serif',
    gap: 0,
    background: 'subtle',
    wallGlyph: false,
    pixelFood: false,
    palette: () => ({
      bg: '#f2f4f7',
      fg: '#3a9188',
      bright: '#2a6d66',
      dim: '#a3aebb',
      faint: '#e2e7ed',
      alt: '#e2875a',
      accent: '#e8735a',
      gold: '#f0b443',
      danger: '#d9534f',
      rival: '#8e7cc3',
      lines: '#dde3ea',
    }),
  },
};

export const THEME_ORDER: ThemeId[] = ['terminal', 'nokia', 'gameboy', 'paper', 'minimal'];
