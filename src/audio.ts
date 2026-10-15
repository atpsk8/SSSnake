import type { GameEvent } from './game/types';

/** Synthesised sound effects and a soft generative pad for Zen. No audio files. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicTimer: number | null = null;
  enabled = true;
  musicEnabled = true;

  /** Must be called from a user gesture before audio can play. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.25, slideTo?: number, delay = 0) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain = 0.3, from = 1800, to = 120) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  ui() {
    this.tone(660, 0.06, 'triangle', 0.15);
  }

  handle(events: GameEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'eat':
          if (e.kind === 'golden') {
            [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, 'square', 0.18, undefined, i * 0.05));
          } else {
            this.tone(e.kind === 'bit' ? 880 : 520 + Math.min(e.mult, 8) * 60, 0.08, 'square', 0.2, 1200);
          }
          break;
        case 'combo':
          this.tone(700 + e.combo * 120, 0.1, 'triangle', 0.2, undefined, 0.04);
          break;
        case 'power':
          this.tone(300, 0.25, 'sawtooth', 0.15, 1200);
          break;
        case 'shrink':
          this.tone(900, 0.2, 'triangle', 0.18, 300);
          break;
        case 'shed':
        case 'cut':
          this.noise(0.25, 0.25, 3000, 400);
          this.tone(220, 0.18, 'square', 0.15, 110);
          break;
        case 'mouse':
          this.tone(1400, 0.05, 'square', 0.15);
          this.tone(1800, 0.06, 'square', 0.15, undefined, 0.06);
          break;
        case 'portal':
          this.tone(200, 0.2, 'sine', 0.25, 900);
          break;
        case 'rivalEat':
          this.tone(260, 0.06, 'square', 0.08);
          break;
        case 'rivalDie':
          this.noise(0.35, 0.25, 2500, 200);
          if (e.byPlayer) this.tone(400, 0.25, 'square', 0.18, 1000);
          break;
        case 'shift':
        case 'collapse':
          this.tone(90, 0.4, 'sawtooth', 0.2, 60);
          break;
        case 'expire':
          this.tone(500, 0.12, 'triangle', 0.12, 250);
          break;
        case 'levelup':
          [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'square', 0.18, undefined, i * 0.08));
          break;
        case 'surge':
          this.tone(150, 0.3, 'sawtooth', 0.12, 600);
          break;
        case 'die':
          this.noise(0.7, 0.4);
          this.tone(300, 0.6, 'sawtooth', 0.2, 50);
          break;
      }
    }
  }

  startMusic() {
    this.stopMusic();
    if (!this.musicEnabled) return;
    const notes = [220, 247, 277, 330, 370, 440, 494, 554, 659];
    const play = () => {
      if (!this.ctx || !this.enabled) return;
      const f = notes[Math.floor(Math.random() * notes.length)];
      this.tone(f, 2.6, 'sine', 0.07);
      if (Math.random() < 0.5) this.tone(f * 1.5, 2.2, 'sine', 0.04, undefined, 0.4);
    };
    play();
    this.musicTimer = window.setInterval(play, 1400);
  }

  stopMusic() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}
