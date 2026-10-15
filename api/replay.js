// Fetch a leaderboard run's replay by id (see scores.js). Replays expire after 30 days.
import { json, redis, redisConfig } from './_lib.js';

export async function GET(request) {
  const cfg = redisConfig(process.env);
  if (!cfg) return json({ configured: false }, 503);
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[a-z0-9]{6,12}$/.test(id)) return json({ error: 'bad_id' }, 400);
  try {
    const [replay] = await redis(cfg, [['GET', `rp:${id}`]]);
    if (!replay) return json({ error: 'not_found' }, 404);
    return json({ configured: true, replay });
  } catch {
    return json({ error: 'store_error' }, 502);
  }
}
