import type { Vec } from './game/types';

/** A recorded run: head position and length per step, keyed by game time. */
export interface Ghost {
  times: Uint32Array;
  xs: Uint8Array;
  ys: Uint8Array;
  lens: Uint8Array;
}

/** Pack a flattened [t, x, y, len, ...] trail into a compact base64 string (5 bytes/step). */
export function encodeGhost(trail: number[]): string {
  const n = Math.floor(trail.length / 4);
  const bytes = new Uint8Array(n * 5);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = trail[i * 4];
    const dt = Math.max(0, Math.min(65535, Math.round(t - prev)));
    prev += dt;
    bytes[i * 5] = dt & 255;
    bytes[i * 5 + 1] = dt >> 8;
    bytes[i * 5 + 2] = trail[i * 4 + 1];
    bytes[i * 5 + 3] = trail[i * 4 + 2];
    bytes[i * 5 + 4] = Math.min(255, trail[i * 4 + 3]);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function decodeGhost(s: string): Ghost | null {
  try {
    const bin = atob(s);
    const n = Math.floor(bin.length / 5);
    const g: Ghost = { times: new Uint32Array(n), xs: new Uint8Array(n), ys: new Uint8Array(n), lens: new Uint8Array(n) };
    let t = 0;
    for (let i = 0; i < n; i++) {
      t += bin.charCodeAt(i * 5) | (bin.charCodeAt(i * 5 + 1) << 8);
      g.times[i] = t;
      g.xs[i] = bin.charCodeAt(i * 5 + 2);
      g.ys[i] = bin.charCodeAt(i * 5 + 3);
      g.lens[i] = bin.charCodeAt(i * 5 + 4);
    }
    return n ? g : null;
  } catch {
    return null;
  }
}

/** The ghost's body (head first) at game time `t`, or null once the recording has ended. */
export function ghostBodyAt(g: Ghost, t: number): Vec[] | null {
  const n = g.times.length;
  if (!n || t > g.times[n - 1] + 400) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  if (g.times[lo] > t) return null;
  const len = g.lens[lo];
  const body: Vec[] = [];
  for (let i = lo; i > lo - len && i >= 0; i--) body.push({ x: g.xs[i], y: g.ys[i] });
  return body;
}
