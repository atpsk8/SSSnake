import type { Game } from './game/engine';
import { FRAME_MS, applyInput, type Input, type Replay } from './replay';

/**
 * Drives a local game at a fixed 16 ms step regardless of screen refresh, so every run is a
 * deterministic replay: options + inputs per frame. Also keeps a few recent snapshots so an
 * instant replay can start a few seconds before a death.
 */
export class Runner {
  frame = 0;
  timeScale = 1;
  private acc = 0;
  private pending: Input[] = [];
  readonly log: { f: number; i: Input }[] = [];
  private keyframes: { f: number; g: Game }[] = [];
  /** Playback mode: inputs come from a script instead of the player. */
  private script: { f: number; i: Input }[] | null = null;
  private k = 0;

  constructor(
    public game: Game,
    private opts: { keyframes?: boolean; script?: { f: number; i: Input }[]; startFrame?: number } = {},
  ) {
    if (opts.script) {
      this.script = opts.script;
      this.frame = opts.startFrame ?? 0;
      while (this.k < this.script.length && this.script[this.k].f < this.frame) this.k++;
    }
  }

  get playback() {
    return this.script !== null;
  }

  input(i: Input) {
    if (this.script) return;
    if (this.game.status === 'draft' && i.t === 'draft') {
      // Answered immediately; recorded at the frame where the draft appeared.
      applyInput(this.game, i);
      this.log.push({ f: this.frame, i });
      return;
    }
    if (this.pending.length < 16) this.pending.push(i);
  }

  /** Advance by real elapsed time. Returns the number of frames simulated. */
  tick(dtMs: number, maxFrame = Infinity): number {
    const g = this.game;
    this.acc = Math.min(this.acc + dtMs * this.timeScale, FRAME_MS * 8);
    let n = 0;
    while (this.acc >= FRAME_MS && this.frame < maxFrame) {
      if (this.script) {
        while (this.k < this.script.length && this.script[this.k].f === this.frame) applyInput(g, this.script[this.k++].i);
      }
      if (g.status !== 'playing') break;
      if (this.opts.keyframes && this.frame % 60 === 0) {
        this.keyframes.push({ f: this.frame, g: g.clone() });
        if (this.keyframes.length > 12) this.keyframes.shift();
      }
      if (!this.script) {
        for (const i of this.pending) {
          applyInput(g, i);
          this.log.push({ f: this.frame, i });
        }
        this.pending = [];
      }
      g.update(FRAME_MS);
      this.frame++;
      this.acc -= FRAME_MS;
      n++;
    }
    return n;
  }

  /** The recorded run so far. */
  replay(base: Omit<Replay, 'frames' | 'inputs' | 'v'>): Replay {
    return { v: 1, ...base, frames: this.frame, inputs: [...this.log] };
  }

  /** A copy of the game about `seconds` before now, plus the frame it was taken at. */
  rewindPoint(seconds: number): { f: number; g: Game } | null {
    const target = this.frame - Math.round((seconds * 1000) / FRAME_MS);
    let best: { f: number; g: Game } | null = null;
    for (const kf of this.keyframes) if (kf.f <= target) best = kf;
    best ??= this.keyframes[0] ?? null;
    return best ? { f: best.f, g: best.g.clone() } : null;
  }
}
