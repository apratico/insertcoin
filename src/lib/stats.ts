import { db } from "./storage.js";
import { supabase, REMOTE_ENABLED } from "./supabase.js";
import { getProfile } from "./auth.js";

export type PlayCounts = Map<string, number>;

/** Counts based on score submissions (gameover). Useful for scored games only. */
export async function getGlobalPlayCounts(): Promise<PlayCounts> {
  const out: PlayCounts = new Map();
  if (!REMOTE_ENABLED || !supabase) return out;
  try {
    const { data, error } = await supabase.rpc("plays_per_game");
    if (error || !data) return out;
    const rows = data as Array<{ game_id: string; plays: number }>;
    for (const r of rows) out.set(r.game_id, Number(r.plays));
  } catch { /* offline */ }
  return out;
}

/** Counts based on game-open events (every route enter). Fairer across all
 *  games including company games that don't submit scores. */
export async function getGlobalOpenCounts(): Promise<PlayCounts> {
  const out: PlayCounts = new Map();
  if (!REMOTE_ENABLED || !supabase) return out;
  try {
    const { data, error } = await supabase.rpc("opens_per_game");
    if (error || !data) return out;
    const rows = data as Array<{ game_id: string; opens: number }>;
    for (const r of rows) out.set(r.game_id, Number(r.opens));
  } catch { /* offline */ }
  return out;
}

export async function getLocalPlayCounts(): Promise<PlayCounts> {
  const out: PlayCounts = new Map();
  try {
    const rows = await db.scores.toArray();
    for (const r of rows) {
      out.set(r.gameId, (out.get(r.gameId) ?? 0) + 1);
    }
  } catch { /* ignore */ }
  return out;
}

/** Merge opens (primary) + plays (fallback) + local (final fallback). */
export async function getMergedPlayCounts(): Promise<PlayCounts> {
  const [opens, plays, local] = await Promise.all([
    getGlobalOpenCounts(),
    getGlobalPlayCounts(),
    getLocalPlayCounts(),
  ]);
  const merged: PlayCounts = new Map(opens);
  for (const [gid, n] of plays.entries()) {
    if (!merged.has(gid) || (merged.get(gid) ?? 0) === 0) merged.set(gid, n);
  }
  for (const [gid, n] of local.entries()) {
    if (!merged.has(gid) || (merged.get(gid) ?? 0) === 0) merged.set(gid, n);
  }
  return merged;
}

/** Log a game-open event to Supabase. Fire-and-forget, offline-tolerant. */
export async function logGameOpen(gameId: string): Promise<void> {
  if (!REMOTE_ENABLED || !supabase) return;
  let deviceId: string | undefined;
  try { deviceId = getProfile().deviceId; } catch { return; }
  try {
    await supabase.from("game_opens").insert({
      device_id: deviceId ?? null,
      game_id: gameId,
    });
  } catch { /* offline */ }
}
