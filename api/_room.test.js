import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST, makeCode } from './room.js';

const req = (body) => new Request('https://x/api/room', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': '5.6.7.8' } });
const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
const ANSWER = 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n';

describe('/api/room', () => {
  beforeEach(() => vi.stubEnv('SSSNAKE_DEV_MEMORY', '1'));
  afterEach(() => vi.unstubAllEnvs());

  it('makes 4-character codes without look-alike characters', () => {
    for (let i = 0; i < 200; i++) expect(makeCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });

  it('runs the offer / answer handshake', async () => {
    const created = await (await POST(req({ action: 'create', offer: OFFER }))).json();
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);

    const got = await (await GET(new Request(`https://x/api/room?code=${created.code.toLowerCase()}`))).json();
    expect(got.offer).toBe(OFFER);
    expect(got.answer).toBeNull();

    expect((await POST(req({ action: 'answer', code: created.code, answer: ANSWER }))).status).toBe(200);
    const after = await (await GET(new Request(`https://x/api/room?code=${created.code}`))).json();
    expect(after.answer).toBe(ANSWER);

    // A second guest can't take the room.
    expect((await POST(req({ action: 'answer', code: created.code, answer: ANSWER }))).status).toBe(409);

    await POST(req({ action: 'close', code: created.code }));
    expect((await GET(new Request(`https://x/api/room?code=${created.code}`))).status).toBe(404);
  });

  it('rejects junk', async () => {
    expect((await POST(req({ action: 'create', offer: '<script>' }))).status).toBe(400);
    expect((await GET(new Request('https://x/api/room?code=0O1I'))).status).toBe(400);
    expect((await POST(req({ action: 'answer', code: 'ZZZZ', answer: ANSWER }))).status).toBe(404);
  });

  it('is off without a store', async () => {
    vi.unstubAllEnvs();
    expect((await GET(new Request('https://x/api/room?code=ABCD'))).status).toBe(503);
  });
});

describe('/api/room quick match', () => {
  beforeEach(() => vi.stubEnv('SSSNAKE_DEV_MEMORY', '1'));
  afterEach(() => vi.unstubAllEnvs());

  it('pairs the second player with the first and reports the queue', async () => {
    const a = await (await POST(req({ action: 'quick', offer: OFFER }))).json();
    expect(a.role).toBe('host');
    const stats = await (await GET(new Request('https://x/api/room?stats=1'))).json();
    expect(stats.waiting).toBeGreaterThanOrEqual(1);
    const b = await (await POST(req({ action: 'quick', offer: ANSWER }))).json();
    expect(b.role).toBe('guest');
    expect(b.code).toBe(a.code);
    expect(b.offer).toBe(OFFER);
  });

  it('skips rooms that were closed or expired', async () => {
    const a = await (await POST(req({ action: 'quick', offer: OFFER }))).json();
    await POST(req({ action: 'close', code: a.code }));
    const b = await (await POST(req({ action: 'quick', offer: OFFER }))).json();
    expect(b.role).toBe('host');
    expect(b.code).not.toBe(a.code);
    await POST(req({ action: 'close', code: b.code }));
  });
});
