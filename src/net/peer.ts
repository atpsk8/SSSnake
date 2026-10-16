import type { NetMsg } from './lockstep';

/**
 * Browser-to-browser link for online Versus. Signaling (offer/answer exchange) goes through
 * /api/room once; after that all traffic is direct over a WebRTC data channel, or through a
 * TURN relay when /api/ice provides one and a direct path isn't possible.
 */

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const POLL_MS = 1500;
const CONNECT_TIMEOUT_MS = 20000;
const ROOM_LIFETIME_MS = 10 * 60 * 1000;
const DISCONNECT_GRACE_MS = 5000;
const KINDS = new Set(['hello', 'lobby', 'start', 'in', 'hash', 'ready', 'ping', 'pong', 'left', 'bye']);
/** A friend joining while another is mid-handshake waits this long for the room to free up. */
const JOIN_BUSY_MS = 30000;

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
    // 'disconnected' is often a brief network blip that recovers by itself; give it a moment.
    let blip: ReturnType<typeof setTimeout> | undefined;
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      clearTimeout(blip);
      if (s === 'failed' || s === 'closed') down();
      else if (s === 'disconnected') blip = setTimeout(down, DISCONNECT_GRACE_MS);
    };
  }

  get open() {
    return !this.closed && this.ch.readyState === 'open';
  }

  /** Whether traffic goes through a TURN relay (for the status line). */
  async relayed(): Promise<boolean> {
    try {
      const stats = await this.pc.getStats();
      let pairId = '';
      stats.forEach((r) => {
        if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
      });
      let localId = '';
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && (r.id === pairId || (!pairId && r.nominated))) localId = r.localCandidateId;
      });
      let relay = false;
      stats.forEach((r) => {
        if (r.id === localId && r.candidateType === 'relay') relay = true;
      });
      return relay;
    } catch {
      return false;
    }
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

// ---------------------------------------------------------------- server calls

async function call(path: string, init?: RequestInit): Promise<{ status: number; data: Record<string, unknown>; json: boolean }> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new NetError('Network error. Check your connection.');
  }
  const json = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = json ? ((await res.json()) as Record<string, unknown>) : {};
  return { status: res.status, data, json };
}

async function room(method: 'GET' | 'POST', body?: unknown, code?: string) {
  const r =
    method === 'GET'
      ? await call(`/api/room?code=${encodeURIComponent(code ?? '')}`)
      : await call('/api/room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.json || r.data.configured === false) {
    throw new NetError('Online play is not set up on this server yet (see docs/ONLINE_SETUP.md).');
  }
  if (r.status === 429) throw new NetError('Too many attempts. Wait a minute and try again.');
  return r;
}

let icePromise: Promise<{ servers: RTCIceServer[]; relay: string | null }> | null = null;

/** STUN plus a TURN relay if the server has one configured. Fetched once per page load. */
export function getIce(): Promise<{ servers: RTCIceServer[]; relay: string | null }> {
  icePromise ??= call('/api/ice')
    .then((r) => {
      const list = r.json && Array.isArray(r.data.iceServers) ? (r.data.iceServers as RTCIceServer[]) : STUN;
      return { servers: list.length ? list : STUN, relay: (r.data.relay as string | null) ?? null };
    })
    .catch(() => ({ servers: STUN, relay: null }));
  return icePromise;
}

export interface NetStatus {
  store: 'ok' | 'missing' | 'error';
  relay: string | null;
  waiting: number;
}

/** What `netcheck` reports: is matchmaking storage reachable, is there a relay. */
export async function netStatus(): Promise<NetStatus> {
  const ice = await getIce();
  let store: NetStatus['store'] = 'error';
  let waiting = 0;
  try {
    const r = await call('/api/room?stats=1');
    if (!r.json || r.data.configured === false) store = 'missing';
    else if (r.status === 200) {
      store = 'ok';
      waiting = Number(r.data.waiting) || 0;
    }
  } catch {
    store = 'error';
  }
  return { store, relay: ice.relay, waiting };
}

// ---------------------------------------------------------------- WebRTC helpers

/** Wait until ICE gathering finishes (or a short timeout) so the SDP carries the candidates. */
function gathered(pc: RTCPeerConnection, ms = 3500): Promise<void> {
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

const blocked = () =>
  new NetError("Couldn't connect. One of your networks blocks direct play and no relay is set up (see docs/ONLINE_SETUP.md).");

function opened(ch: RTCDataChannel, signal?: AbortSignal): Promise<void> {
  if (ch.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(blocked()), CONNECT_TIMEOUT_MS);
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

function needRtc() {
  if (typeof RTCPeerConnection === 'undefined') throw new NetError('This browser does not support online play.');
}

async function makeOffer(onStatus: (s: string) => void) {
  const ice = await getIce();
  const pc = new RTCPeerConnection({ iceServers: ice.servers });
  const ch = pc.createDataChannel('sssnake', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  onStatus('gathering network routes...');
  await gathered(pc);
  return { pc, ch, sdp: pc.localDescription?.sdp ?? '' };
}

/** Host side: poll the room until a guest answers, then wait for the channel to open. */
async function awaitGuest(
  pc: RTCPeerConnection,
  ch: RTCDataChannel,
  code: string,
  opts: { onStatus(s: string): void; signal: AbortSignal; token: string; keepOpen?: boolean },
) {
  const deadline = Date.now() + ROOM_LIFETIME_MS;
  for (;;) {
    if (Date.now() > deadline) throw new NetError('Nobody joined within 10 minutes. The room has expired.');
    await sleep(POLL_MS, opts.signal);
    const got = await room('GET', undefined, code);
    if (got.status === 404) throw new NetError('The room expired.');
    if (typeof got.data.answer === 'string') {
      opts.onStatus('opponent found, connecting...');
      await pc.setRemoteDescription({ type: 'answer', sdp: got.data.answer });
      break;
    }
  }
  await opened(ch, opts.signal);
  if (!opts.keepOpen) void room('POST', { action: 'close', code, token: opts.token }).catch(() => {});
  return new PeerLink(pc, ch);
}

/** Guest side: answer a host's offer and wait for their channel. */
async function answer(code: string, offer: string, opts: { onStatus(s: string): void; signal: AbortSignal; seq?: number }) {
  const ice = await getIce();
  const pc = new RTCPeerConnection({ iceServers: ice.servers });
  try {
    const channel = new Promise<RTCDataChannel>((resolve) => {
      pc.ondatachannel = (e) => resolve(e.channel);
    });
    await pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await pc.setLocalDescription(await pc.createAnswer());
    opts.onStatus('gathering network routes...');
    await gathered(pc);
    const sent = await room('POST', { action: 'answer', code, answer: pc.localDescription?.sdp, seq: opts.seq });
    if (sent.status === 409) throw new RoomBusy();
    if (sent.status === 404) throw new NetError('That room just expired.');
    if (sent.status !== 200) throw new NetError('Could not join that room.');
    opts.onStatus('connecting...');
    const ch = await Promise.race([
      channel,
      sleep(CONNECT_TIMEOUT_MS, opts.signal).then(() => {
        throw blocked();
      }),
    ]);
    await opened(ch, opts.signal);
    return new PeerLink(pc, ch);
  } catch (err) {
    pc.close();
    throw err;
  }
}

/** Someone else claimed the room's current offer first; fetch it again and retry. */
class RoomBusy extends NetError {
  constructor() {
    super('That room is busy.');
  }
}

// ---------------------------------------------------------------- public entry points

/**
 * An invite room that friends join one at a time: each gets its own connection offer. After a
 * friend connects, `nextGuest` posts a fresh offer under the same code for the next one.
 */
export class HostRoom {
  private constructor(
    readonly code: string,
    private token: string,
    private pending: { pc: RTCPeerConnection; ch: RTCDataChannel } | null,
  ) {}

  static async open(onStatus: (s: string) => void): Promise<HostRoom> {
    needRtc();
    const { pc, ch, sdp } = await makeOffer(onStatus);
    try {
      const created = await room('POST', { action: 'create', offer: sdp });
      if (created.status !== 200 || typeof created.data.code !== 'string' || typeof created.data.token !== 'string') {
        throw new NetError('Could not create a room.');
      }
      return new HostRoom(created.data.code, created.data.token, { pc, ch });
    } catch (err) {
      pc.close();
      throw err;
    }
  }

  /** Wait for the next friend to connect. The room stays open for more until `close`. */
  async nextGuest(opts: { onStatus(s: string): void; signal: AbortSignal }): Promise<PeerLink> {
    if (!this.pending) {
      const { pc, ch, sdp } = await makeOffer(() => {});
      const re = await room('POST', { action: 'reoffer', code: this.code, token: this.token, offer: sdp });
      if (re.status !== 200) {
        pc.close();
        throw new NetError(re.status === 404 ? 'The room expired.' : 'Could not reopen the room.');
      }
      this.pending = { pc, ch };
    }
    const { pc, ch } = this.pending;
    try {
      const link = await awaitGuest(pc, ch, this.code, { ...opts, token: this.token, keepOpen: true });
      this.pending = null;
      return link;
    } catch (err) {
      pc.close();
      this.pending = null;
      throw err;
    }
  }

  /** Stop taking friends: delete the room and drop any half-made connection. */
  close() {
    this.pending?.pc.close();
    this.pending = null;
    void room('POST', { action: 'close', code: this.code, token: this.token }).catch(() => {});
  }
}

export async function joinRoom(rawCode: string, opts: { onStatus(text: string): void; signal: AbortSignal }): Promise<PeerLink> {
  needRtc();
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) throw new NetError('Codes are 4 characters, like K7QX.');
  const deadline = Date.now() + JOIN_BUSY_MS;
  for (let waited = false; ; waited = true) {
    const got = await room('GET', undefined, code);
    if (got.status === 404) {
      throw new NetError(waited ? 'The room closed: the match may have started or be full.' : `No room ${code}. Codes expire after 10 minutes.`);
    }
    if (got.status !== 200 || typeof got.data.offer !== 'string') throw new NetError('Could not read that room.');
    // Someone else may be mid-join: then wait for the host to open the room up again.
    if (!got.data.answer) {
      try {
        return await answer(code, got.data.offer, { ...opts, seq: Number(got.data.seq) || 0 });
      } catch (err) {
        if (!(err instanceof RoomBusy)) throw err;
      }
    }
    if (Date.now() > deadline) throw new NetError('That room is full or busy. Try again in a moment.');
    if (!waited) opts.onStatus('someone else is joining, waiting a moment...');
    await sleep(POLL_MS, opts.signal);
  }
}

/** Public matchmaking: join whoever is waiting, or wait in the queue yourself. */
export async function quickMatch(opts: {
  onStatus(text: string): void;
  onWaiting(): void;
  signal: AbortSignal;
}): Promise<{ link: PeerLink; role: 'host' | 'guest' }> {
  needRtc();
  const { pc, ch, sdp } = await makeOffer(opts.onStatus);
  let code = '';
  let token = '';
  try {
    const res = await room('POST', { action: 'quick', offer: sdp });
    if (res.status !== 200 || typeof res.data.code !== 'string') throw new NetError('Matchmaking is busy. Try again.');
    if (res.data.role === 'guest' && typeof res.data.offer === 'string') {
      // Someone else's room: never close it from here.
      pc.close();
      opts.onStatus('found an opponent, connecting...');
      const link = await answer(res.data.code, res.data.offer, opts);
      return { link, role: 'guest' };
    }
    code = res.data.code;
    token = String(res.data.token ?? '');
    opts.onWaiting();
    const link = await awaitGuest(pc, ch, code, { ...opts, token });
    return { link, role: 'host' };
  } catch (err) {
    pc.close();
    if (code) void room('POST', { action: 'close', code, token }).catch(() => {});
    throw err;
  }
}
