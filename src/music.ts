/**
 * Adaptive soundtrack. A small step sequencer synthesises drums, bass, arpeggio and a pad on
 * the fly; `intensity` (0..1) brings layers in and out, so the music builds with your combo,
 * length and boss fights. A filter sweep marks level-ups. No audio files.
 */

const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const LOOKAHEAD = 0.12;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Music {
  private bus: GainNode;
  private filter: BiquadFilterNode;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private noiseBuf: AudioBuffer;
  intensity = 0;
  bpm = 112;
  playing = false;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 9000;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(this.filter).connect(out);
    const len = Math.floor(ctx.sampleRate * 0.2);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(this.bus.gain.value, now);
    this.bus.gain.linearRampToValueAtTime(0.55, now + 0.6);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Fade out (fast on death, like a tape stop). */
  stop(fast = false) {
    if (!this.playing) return;
    this.playing = false;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(this.bus.gain.value, now);
    this.bus.gain.linearRampToValueAtTime(0, now + (fast ? 0.35 : 0.8));
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Level-up "drop": close the filter and open it again over a bar. */
  drop() {
    const now = this.ctx.currentTime;
    const f = this.filter.frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(300, now);
    f.exponentialRampToValueAtTime(9000, now + (60 / this.bpm) * 4);
  }

  private schedule() {
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      this.play(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private play(step: number, t: number, len: number) {
    const k = this.intensity;
    const beat = step % 4 === 0;
    const bar = Math.floor(step / 16) % CHORDS.length;
    const chord = CHORDS[bar];

    if (beat) this.kick(t, 0.5 + k * 0.3);
    if (k > 0.25 && step % 8 === 4) this.snare(t, 0.12 + k * 0.1);
    if (k > 0.1 && step % 2 === 0) this.hat(t, 0.025 + k * 0.03, step % 4 === 2);
    if (k > 0.05 && (step % 8 === 0 || (k > 0.45 && step % 8 === 6))) this.bass(midi(chord[0] - 24), t, len * 2, 0.16);
    if (k > 0.4) {
      const arp = [0, 1, 2, 1];
      const note = chord[arp[step % 4]] + (step % 8 >= 4 ? 12 : 0);
      this.voice(midi(note), t, len * 0.9, 'square', 0.025 + (k - 0.4) * 0.05, 2400);
    }
    if (k > 0.7 && step % 16 === 0) {
      for (const n of chord) this.voice(midi(n + 12), t, len * 15, 'sawtooth', 0.018, 1600);
    }
  }

  private envGain(t: number, peak: number, dur: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.bus);
    return g;
  }

  private kick(t: number, gain: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(this.envGain(t, gain, 0.18));
    o.start(t);
    o.stop(t + 0.2);
  }

  private noiseHit(t: number, gain: number, dur: number, type: BiquadFilterType, freq: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.envGain(t, gain, dur));
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private snare(t: number, gain: number) {
    this.noiseHit(t, gain, 0.14, 'bandpass', 1800);
  }

  private hat(t: number, gain: number, open: boolean) {
    this.noiseHit(t, gain, open ? 0.08 : 0.03, 'highpass', 7000);
  }

  private bass(freq: number, t: number, dur: number, gain: number) {
    this.voice(freq, t, dur, 'triangle', gain, 900);
  }

  private voice(freq: number, t: number, dur: number, type: OscillatorType, gain: number, cutoff: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    o.connect(f).connect(this.envGain(t, gain, dur));
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
