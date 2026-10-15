import { sanitizeLevel, type LevelData } from './game/levels';
import { H, W, type ModeId } from './game/types';

/** What a challenge link carries. Kept small so links stay short. */
export interface Challenge {
  kind: 'run' | 'level';
  mode: ModeId;
  seed: number;
  target: number;
  from: string;
  level?: LevelData;
}

const RUN_MODES: ModeId[] = ['classic', 'arcade', 'daily', 'zen', 'rhythm'];

function toB64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Walls as a bitset: 576 cells -> 96 base64 chars instead of a long number list. */
function wallsToBits(walls: number[]): string {
  const bytes = new Uint8Array((W * H) / 8);
  for (const i of walls) bytes[i >> 3] |= 1 << (i & 7);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function bitsToWalls(bits: string): number[] {
  const bin = atob(bits);
  const out: number[] = [];
  for (let i = 0; i < Math.min(bin.length * 8, W * H); i++) if (bin.charCodeAt(i >> 3) & (1 << (i & 7))) out.push(i);
  return out;
}

export function encodeChallenge(c: Challenge): string {
  const payload: Record<string, unknown> = { v: 1, k: c.kind, m: c.mode, s: c.seed, t: c.target, f: c.from.slice(0, 16) };
  if (c.level) {
    const { walls, ...rest } = c.level;
    payload.l = { ...rest, wb: wallsToBits(walls) };
  }
  return toB64Url(JSON.stringify(payload));
}

export function decodeChallenge(code: string): Challenge | null {
  try {
    const p = JSON.parse(fromB64Url(code)) as Record<string, unknown>;
    if (p.v !== 1) return null;
    const kind = p.k === 'level' ? 'level' : 'run';
    const seed = Number.isInteger(p.s) ? (p.s as number) >>> 0 : 1;
    const target = Number.isFinite(p.t) ? Math.max(0, Math.floor(p.t as number)) : 0;
    const from = typeof p.f === 'string' ? p.f.replace(/[^\w \-.]/g, '').slice(0, 16) : '';
    if (kind === 'level') {
      const raw = p.l as Record<string, unknown> | undefined;
      if (!raw) return null;
      const level = sanitizeLevel({ ...raw, walls: typeof raw.wb === 'string' ? bitsToWalls(raw.wb) : [] });
      if (!level) return null;
      return { kind, mode: 'custom', seed, target, from, level };
    }
    const mode = RUN_MODES.includes(p.m as ModeId) ? (p.m as ModeId) : 'arcade';
    return { kind, mode, seed, target, from };
  } catch {
    return null;
  }
}

export function challengeUrl(c: Challenge): string {
  return `${location.origin}${location.pathname}#c=${encodeChallenge(c)}`;
}

export function readChallengeFromHash(): Challenge | null {
  const m = /[#&]c=([\w-]+)/.exec(location.hash);
  return m ? decodeChallenge(m[1]) : null;
}

/** Share via the native sheet when available, else copy to the clipboard. */
export async function shareLink(url: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: 'SSSnake', text, url });
      return 'shared';
    }
  } catch {
    /* cancelled or unsupported; fall back to copying */
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
