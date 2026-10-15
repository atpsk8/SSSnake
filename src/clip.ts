/**
 * Video clips. Records a canvas (2D or WebGL) plus the game's audio while the instant replay
 * plays, adds a small watermark, and hands back a video file to save or share.
 */

const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function clipSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && TYPES.some((t) => MediaRecorder.isTypeSupported?.(t)) && !!HTMLCanvasElement.prototype.captureStream;
}

export class ClipRecorder {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  readonly mime: string;
  private done: Promise<Blob>;

  constructor(
    private source: HTMLCanvasElement,
    audio: MediaStream | null,
    private label: () => string,
  ) {
    // Even dimensions, capped for sensible file sizes.
    const scale = Math.min(1, 1080 / Math.max(source.width, source.height));
    this.canvas.width = Math.max(2, Math.floor((source.width * scale) / 2) * 2);
    this.canvas.height = Math.max(2, Math.floor((source.height * scale) / 2) * 2);
    this.ctx = this.canvas.getContext('2d')!;
    this.mime = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
    const stream = this.canvas.captureStream(30);
    for (const track of audio?.getAudioTracks() ?? []) stream.addTrack(track);
    this.recorder = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 6_000_000 });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.done = new Promise((resolve) => {
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.mime.split(';')[0] }));
    });
    this.recorder.start(250);
  }

  /** Call once per rendered frame, right after the game draws. */
  capture() {
    const { ctx, canvas } = this;
    ctx.drawImage(this.source, 0, 0, canvas.width, canvas.height);
    const pad = Math.round(canvas.height * 0.025);
    const size = Math.round(canvas.height * 0.035);
    ctx.font = `700 ${size}px "Space Grotesk", "IBM Plex Mono", system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const text = this.label();
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(pad - size * 0.4, pad - size * 0.3, w + size * 0.8, size * 1.6);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, pad, pad);
  }

  async stop(): Promise<File> {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    const blob = await this.done;
    const ext = this.mime.includes('mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return new File([blob], `sssnake-${stamp}.${ext}`, { type: blob.type });
  }
}

/** Share on phones (native sheet), otherwise download. */
export async function deliverClip(file: File): Promise<'shared' | 'saved'> {
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ files: [file], title: 'SSSnake clip' });
      return 'shared';
    }
  } catch {
    /* cancelled; fall back to saving */
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
