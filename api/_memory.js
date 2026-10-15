// In-memory stand-in for the handful of Redis commands the API uses. Only active when
// SSSNAKE_DEV_MEMORY=1 (set by the Vite dev server) so `npm run dev` can exercise the
// leaderboard and online rooms without an Upstash store. Never used in production.

const strings = new Map(); // key -> { value, expires }
const zsets = new Map(); // key -> [{ score, member }]

const alive = (key) => {
  const e = strings.get(key);
  if (e && e.expires && e.expires < Date.now()) {
    strings.delete(key);
    return undefined;
  }
  return e;
};

function exec([cmd, key, ...args]) {
  switch (String(cmd).toUpperCase()) {
    case 'GET':
      return alive(key)?.value ?? null;
    case 'SET': {
      const opts = args.slice(1).map((a) => String(a).toUpperCase());
      if (opts.includes('NX') && alive(key)) return null;
      const exIdx = opts.indexOf('EX');
      const expires = exIdx >= 0 ? Date.now() + Number(args[exIdx + 2]) * 1000 : opts.includes('KEEPTTL') ? alive(key)?.expires : 0;
      strings.set(key, { value: String(args[0]), expires });
      return 'OK';
    }
    case 'DEL':
      return strings.delete(key) || zsets.delete(key) ? 1 : 0;
    case 'INCR': {
      const e = alive(key);
      const n = Number(e?.value ?? 0) + 1;
      strings.set(key, { value: String(n), expires: e?.expires ?? 0 });
      return n;
    }
    case 'EXPIRE': {
      const e = alive(key);
      if (!e) return 0;
      if (String(args[1] ?? '').toUpperCase() === 'NX' && e.expires) return 0;
      e.expires = Date.now() + Number(args[0]) * 1000;
      return 1;
    }
    case 'ZADD': {
      const z = zsets.get(key) ?? [];
      z.push({ score: Number(args[0]), member: String(args[1]) });
      zsets.set(key, z);
      return 1;
    }
    case 'ZREMRANGEBYRANK': {
      const z = [...(zsets.get(key) ?? [])].sort((a, b) => a.score - b.score);
      const stop = Number(args[1]);
      const end = stop < 0 ? z.length + stop : stop;
      zsets.set(key, z.slice(end + 1));
      return Math.max(0, end + 1);
    }
    case 'ZREVRANK': {
      const z = [...(zsets.get(key) ?? [])].sort((a, b) => b.score - a.score);
      const i = z.findIndex((e) => e.member === String(args[0]));
      return i < 0 ? null : i;
    }
    case 'ZRANGE': {
      const z = [...(zsets.get(key) ?? [])].sort((a, b) => b.score - a.score);
      return z.slice(Number(args[0]), Number(args[1]) + 1).flatMap((e) => [e.member, String(e.score)]);
    }
    default:
      throw new Error(`memory store: unsupported ${cmd}`);
  }
}

export function memoryPipeline(commands) {
  return commands.map(exec);
}
