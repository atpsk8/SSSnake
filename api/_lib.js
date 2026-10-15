// Shared logic for the global leaderboard function. Files starting with "_" in /api are not
// deployed as their own endpoints.

export const BOARDS = ['classic', 'arcade', 'rhythm'];
export const CLASSES = ['racer', 'viper', 'cobra', 'python'];
export const TOP_N = 20;
export const KEEP_N = 100;

const DAY_MS = 86400000;
const isoDay = (d) => d.toISOString().slice(0, 10);

/** Fixed boards, or a Daily board within a day of the server's date (time zones differ). */
export function validBoard(board, now = new Date()) {
  if (typeof board !== 'string') return false;
  if (BOARDS.includes(board)) return true;
  const m = /^daily:(\d{4}-\d{2}-\d{2})$/.exec(board);
  if (!m) return false;
  const days = [-1, 0, 1].map((o) => isoDay(new Date(now.getTime() + o * DAY_MS)));
  return days.includes(m[1]);
}

export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.replace(/[^A-Za-z0-9 _\-.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n.length ? n : null;
}

/** Reject malformed or implausible scores. Returns { ok, entry } or { ok: false, error }. */
export function validateSubmission(body, now = new Date()) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad_body' };
  const { board, score, level, timeMs, cls } = body;
  if (!validBoard(board, now)) return { ok: false, error: 'bad_board' };
  const name = cleanName(body.name);
  if (!name) return { ok: false, error: 'bad_name' };
  if (!Number.isInteger(score) || score < 1 || score > 10000000) return { ok: false, error: 'bad_score' };
  if (!Number.isInteger(timeMs) || timeMs < 1000 || timeMs > 4 * 3600 * 1000) return { ok: false, error: 'bad_time' };
  if (!Number.isInteger(level) || level < 1 || level > 999) return { ok: false, error: 'bad_level' };
  if (!CLASSES.includes(cls)) return { ok: false, error: 'bad_class' };
  // Generous ceiling: nobody legitimately sustains more than ~300 points a second.
  if (score > 1000 + (timeMs / 1000) * 300) return { ok: false, error: 'implausible' };
  return { ok: true, entry: { board, name, score, level, cls, date: isoDay(now) } };
}

export function redisConfig(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

/** Run commands through Upstash's REST pipeline endpoint. */
export async function redis(cfg, commands) {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const out = await res.json();
  return out.map((r) => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

/** Turn ZRANGE ... WITHSCORES output into score rows. */
export function parseRange(flat) {
  const rows = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      const m = JSON.parse(flat[i]);
      rows.push({ name: m.n, level: m.l, cls: m.c, date: m.d, score: Number(flat[i + 1]) });
    } catch {
      /* skip malformed members */
    }
  }
  return rows;
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
