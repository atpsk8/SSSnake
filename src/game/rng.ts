/** Small seeded PRNG (mulberry32) so Daily Challenge runs are reproducible. */
export class Rng {
  private state_: number;

  constructor(seed: number) {
    this.state_ = seed >>> 0;
  }

  /** Raw state, so rewind snapshots can restore the exact random sequence. */
  get state(): number {
    return this.state_;
  }
  set state(v: number) {
    this.state_ = v >>> 0;
  }

  next(): number {
    this.state_ = (this.state_ + 0x6d2b79f5) >>> 0;
    let t = this.state_;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items[items.length - 1][0];
  }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Local calendar date as YYYY-MM-DD; the daily seed changes at the player's midnight. */
export function todayKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const dailySeed = (dateKey: string) => hashString(`sssnake:${dateKey}`);
