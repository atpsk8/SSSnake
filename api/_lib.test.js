import { describe, expect, it } from 'vitest';
import { cleanName, parseRange, redisConfig, validBoard, validateSubmission } from './_lib.js';

const now = new Date('2026-10-15T12:00:00Z');
const good = { board: 'arcade', name: 'Andrew', score: 4200, level: 6, timeMs: 240000, cls: 'racer' };

describe('leaderboard validation', () => {
  it('accepts fixed boards and nearby daily boards only', () => {
    expect(validBoard('arcade', now)).toBe(true);
    expect(validBoard('zen', now)).toBe(false);
    expect(validBoard('daily:2026-10-15', now)).toBe(true);
    expect(validBoard('daily:2026-10-14', now)).toBe(true);
    expect(validBoard('daily:2026-10-01', now)).toBe(false);
    expect(validBoard('lb:../../x', now)).toBe(false);
  });

  it('cleans names', () => {
    expect(cleanName('  Andrew <script>  ')).toBe('Andrew script');
    expect(cleanName('a'.repeat(40))).toHaveLength(16);
    expect(cleanName('!!!')).toBeNull();
  });

  it('accepts a plausible score', () => {
    const r = validateSubmission(good, now);
    expect(r.ok).toBe(true);
    expect(r.entry.date).toBe('2026-10-15');
  });

  it('rejects implausible or malformed scores', () => {
    expect(validateSubmission({ ...good, score: 999999, timeMs: 5000 }, now).error).toBe('implausible');
    expect(validateSubmission({ ...good, score: 12.5 }, now).error).toBe('bad_score');
    expect(validateSubmission({ ...good, cls: 'dragon' }, now).error).toBe('bad_class');
    expect(validateSubmission({ ...good, name: '' }, now).error).toBe('bad_name');
    expect(validateSubmission(null, now).ok).toBe(false);
  });

  it('reads either env var naming scheme', () => {
    expect(redisConfig({})).toBeNull();
    expect(redisConfig({ KV_REST_API_URL: 'https://x/', KV_REST_API_TOKEN: 't' })).toEqual({ url: 'https://x', token: 't' });
  });

  it('parses ranges', () => {
    const rows = parseRange([JSON.stringify({ n: 'A', l: 3, c: 'racer', d: '2026-10-15' }), '120', 'garbage', '5']);
    expect(rows).toEqual([{ name: 'A', level: 3, cls: 'racer', date: '2026-10-15', id: undefined, score: 120 }]);
  });
});
