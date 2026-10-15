import type { NetMsg } from './lockstep';

/**
 * Browser-to-browser link for online Versus. Signaling (offer/answer exchange) goes through
 * /api/room once; after that all traffic is direct over a WebRTC data channel.
 */

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const POLL_MS = 1500;
const CONNECT_TIMEOUT_MS = 20000;
const ROOM_LIFETIME_MS = 10 * 60 * 1000;
const KINDS = new Set(['hello', 'start', 'in', 'hash', 'ready', 'ping', 'pong', 'bye']);

export class NetError extends Error {}

export class PeerLink {
  onmessage: (m: NetMsg) => void = () => {};
  onclose: () => void = () => {};
  private closed = false;

  constructor(
    private pc: RTCPeerConnection,
    private ch: RTCDataChannel,
  ) {
    ch.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as NetMsg;
        if (m && typeof m === 'object' && KINDS.has((m as { k: string }).k)) this.onmessage(m);
      } catch {
        /* ignore malformed messages */
      }
    };
    const down = () => this.shutdown();
    ch.onclose = down;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') down();
    };
  }

  get open() {
    return !this.closed && this.ch.readyState === 'open';
  }

  send(m: NetMsg) {
    if (this.open) this.ch.send(JSON.stringify(m));
  }

  close() {
    if (this.open) this.send({ k: 'bye' });
    this.shutdown();
  }

  private shutdown() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ch.close();
      this.pc.close();
    } catch {
      /* already closed */
    }
    this.onclose();
  }
}

async function api(method: 'GET' | 'POST', body?: unknown, code?: string): Promise<{ status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(method === 'GET' ? `/api/room?code=${encodeURIComponent(code ?? '')}` : '/api/room', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new NetError('Network error. Check your connection.');
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = isJson ? ((await res.json()) as Record<string, unknown>) : {};
  if (!isJson || data.configured === false) {
    throw new NetError('Online play needs the Upstash store connected to the Vercel project (see README).');
  }
  if (res.status === 429) throw new NetError('Too many attempts. Wait a minute and try again.');
  return { status: res.status, data };
}

/** Wait until ICE gathering finishes (or a short timeout) so the SDP carries the candidates. */
function gathered(pc: RTCPeerConnection, ms = 3000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(t);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function opened(ch: RTCDataChannel, signal?: AbortSignal): Promise<void> {
  if (ch.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new NetError("Couldn't connect directly. One of your networks may block peer-to-peer play.")),
      CONNECT_TIMEOUT_MS,
    );
    ch.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new NetError('Cancelled.'));
    });
  });
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new NetError('Cancelled.'));
    });
  });

export async function hostRoom(opts: { onCode(code: string): void; onStatus(text: string): void; signal: AbortSignal }): Promise<PeerLink> {
  if (typeof RTCPeerConnection === 'undefined') throw new NetError('This browser does not support online play.');
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const ch = pc.createDataChannel('sssnake', { ordered: true });
  let code = '';
  try {
    await pc.setLocalDescription(await pc.createOffer());
    opts.onStatus('gathering network routes...');
    await gathered(pc);
    const created = await api('POST', { action: 'create', offer: pc.localDescription?.sdp });
    if (created.status !== 200 || typeof created.data.code !== 'string') throw new NetError('Could not create a room.');
    code = created.data.code;
    opts.onCode(code);

    const deadline = Date.now() + ROOM_LIFETIME_MS;
    for (;;) {
      if (Date.now() > deadline) throw new NetError('Nobody joined within 10 minutes. The room has expired.');
      await sleep(POLL_MS, opts.signal);
      const got = await api('GET', undefined, code);
      if (got.status === 404) throw new NetError('The room expired.');
      if (typeof got.data.answer === 'string') {
        opts.onStatus('opponent found, connecting...');
        await pc.setRemoteDescription({ type: 'answer', sdp: got.data.answer });
        break;
      }
    }
    await opened(ch, opts.signal);
    void api('POST', { action: 'close', code }).catch(() => {});
    return new PeerLink(pc, ch);
  } catch (err) {
    pc.close();
    if (code) void api('POST', { action: 'close', code }).catch(() => {});
    throw err;
  }
}

export async function joinRoom(rawCode: string, opts: { onStatus(text: string): void; signal: AbortSignal }): Promise<PeerLink> {
  if (typeof RTCPeerConnection === 'undefined') throw new NetError('This browser does not support online play.');
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) throw new NetError('Codes are 4 characters, like K7QX.');
  const got = await api('GET', undefined, code);
  if (got.status === 404) throw new NetError(`No room ${code}. Codes expire after 10 minutes.`);
  if (got.status !== 200 || typeof got.data.offer !== 'string') throw new NetError('Could not read that room.');
  if (got.data.answer) throw new NetError('That room is already full.');

  const pc = new RTCPeerConnection({ iceServers: ICE });
  try {
    const channel = new Promise<RTCDataChannel>((resolve) => {
      pc.ondatachannel = (e) => resolve(e.channel);
    });
    await pc.setRemoteDescription({ type: 'offer', sdp: got.data.offer });
    await pc.setLocalDescription(await pc.createAnswer());
    opts.onStatus('gathering network routes...');
    await gathered(pc);
    const sent = await api('POST', { action: 'answer', code, answer: pc.localDescription?.sdp });
    if (sent.status === 409) throw new NetError('That room is already full.');
    if (sent.status !== 200) throw new NetError('Could not join that room.');
    opts.onStatus('connecting to host...');
    const ch = await Promise.race([
      channel,
      sleep(CONNECT_TIMEOUT_MS, opts.signal).then(() => {
        throw new NetError("Couldn't connect directly. One of your networks may block peer-to-peer play.");
      }),
    ]);
    await opened(ch, opts.signal);
    return new PeerLink(pc, ch);
  } catch (err) {
    pc.close();
    throw err;
  }
}
