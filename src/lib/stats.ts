import { db } from "./storage.js";
import { supabase, REMOTE_ENABLED } from "./supabase.js";

export type PlayCounts = Map<string, number>;

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

// Merge: global wins, fallback local per game when global is zero/missing
export async function getMergedPlayCounts(): Promise<PlayCounts> {
  const [global, local] = await Promise.all([
    getGlobalPlayCounts(),
    getLocalPlayCounts(),
  ]);
  const merged: PlayCounts = new Map(global);
  for (const [gid, n] of local.entries()) {
    if (!merged.has(gid) || (merged.get(gid) ?? 0) === 0) merged.set(gid, n);
  }
  return merged;
}
