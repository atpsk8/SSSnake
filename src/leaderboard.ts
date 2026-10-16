import type { SnakeClass } from './game/types';

export interface GlobalScore {
  name: string;
  score: number;
  level: number;
  cls: SnakeClass;
  date: string;
  id?: string;
}

export type FetchResult = { status: 'ok'; scores: GlobalScore[] } | { status: 'off' } | { status: 'error' };
export type SubmitResult = { status: 'ok'; rank: number | null } | { status: 'off' } | { status: 'error'; message: string };

const ERRORS: Record<string, string> = {
  implausible: 'That score looks off, so the server rejected it.',
  rate_limited: 'Too many submissions. Try again in a minute.',
  bad_name: 'Pick a name with letters or numbers.',
  bad_replay: "Your run couldn't be verified.",
  score_mismatch: "Your run couldn't be verified.",
  replay_incomplete: "Your run couldn't be verified.",
  wrong_seed: 'That daily run is from a different day.',
};

async function parse(res: Response): Promise<Record<string, unknown> | null> {
  // The Vite dev server answers unknown routes with HTML, so check before parsing.
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Boards with a global leaderboard (Zen, Endless, Versus and Custom stay local). */
export const globalBoard = (board: string) => /^(classic|arcade|rhythm|daily:\d{4}-\d{2}-\d{2})$/.test(board);

export async function fetchGlobal(board: string): Promise<FetchResult> {
  try {
    const res = await fetch(`/api/scores?board=${encodeURIComponent(board)}`);
    const body = await parse(res);
    if (!body || body.configured === false) return { status: 'off' };
    if (!res.ok) return { status: 'error' };
    return { status: 'ok', scores: (body.scores as GlobalScore[]) ?? [] };
  } catch {
    return { status: 'off' };
  }
}

export async function submitGlobal(entry: {
  board: string;
  name: string;
  score: number;
  level: number;
  timeMs: number;
  cls: SnakeClass;
  replay: string;
}): Promise<SubmitResult> {
  try {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, timeMs: Math.round(entry.timeMs) }),
    });
    const body = await parse(res);
    if (!body || body.configured === false) return { status: 'off' };
    if (!res.ok) return { status: 'error', message: ERRORS[String(body.error)] ?? 'Could not submit right now.' };
    return { status: 'ok', rank: (body.rank as number | null) ?? null };
  } catch {
    return { status: 'off' };
  }
}

/** A leaderboard run's replay (encoded), or null. */
export async function fetchReplay(id: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/replay?id=${encodeURIComponent(id)}`);
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null;
    const body = (await res.json()) as { replay?: string };
    return res.ok && typeof body.replay === 'string' ? body.replay : null;
  } catch {
    return null;
  }
}
