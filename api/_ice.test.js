import { describe, expect, it } from 'vitest';
import { iceServersFor, normalizeIce } from './ice.js';

describe('/api/ice', () => {
  it('falls back to STUN only', async () => {
    const out = await iceServersFor({});
    expect(out.relay).toBeNull();
    expect(out.iceServers).toHaveLength(1);
  });

  it('uses a custom TURN server', async () => {
    const out = await iceServersFor({ TURN_URLS: 'turn:a.example:3478, turns:a.example:443', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p' });
    expect(out.relay).toBe('custom');
    expect(out.iceServers[1]).toEqual({ urls: ['turn:a.example:3478', 'turns:a.example:443'], username: 'u', credential: 'p' });
  });

  it('asks Cloudflare for short-lived credentials and drops port 53', async () => {
    let called = '';
    const fake = async (url, init) => {
      called = `${url} ${init.headers.Authorization}`;
      return new Response(
        JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'], username: 'x', credential: 'y' }] }),
        { status: 200 },
      );
    };
    const out = await iceServersFor({ CLOUDFLARE_TURN_KEY_ID: 'KID', CLOUDFLARE_TURN_KEY_API_TOKEN: 'TOK' }, fake);
    expect(called).toContain('/turn/keys/KID/credentials/generate-ice-servers');
    expect(called).toContain('Bearer TOK');
    expect(out.relay).toBe('cloudflare');
    expect(out.iceServers[1].urls).toEqual(['turn:turn.cloudflare.com:3478?transport=udp']);
  });

  it('normalizes a single object', () => {
    expect(normalizeIce({ urls: 'turn:x:3478', username: 'a', credential: 'b' })).toEqual([{ urls: ['turn:x:3478'], username: 'a', credential: 'b' }]);
  });
});
