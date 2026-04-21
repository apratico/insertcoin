import { db, type ScoreRow } from "./storage.js";
import { getProfile } from "./auth.js";
import { supabase, REMOTE_ENABLED } from "./supabase.js";

export interface RemoteScore {
  nickname: string;
  score: number;
  played_at: string;
  device_id: string;
}

async function submitRemote(gameId: string, score: number): Promise<void> {
  if (!REMOTE_ENABLED || !supabase) return;
  const p = getProfile();
  if (!p.deviceId) return;
  try {
    await supabase.from("scores").insert({
      game_id: gameId,
      device_id: p.deviceId,
      nickname: p.nickname,
      score,
    });
  } catch { /* offline-tolerant */ }
}

export async function submit(gameId: string, score: number): Promise<void> {
  const { nickname } = getProfile();
  const row: ScoreRow = { gameId, nickname, score, playedAt: Date.now() };
  await db.scores.add(row);
  void submitRemote(gameId, score);
}

export async function top(gameId: string, n = 10): Promise<ScoreRow[]> {
  return db.scores
    .where("gameId")
    .equals(gameId)
    .reverse()
    .sortBy("score")
    .then((rows) => rows.slice(0, n));
}

export async function topGlobal(gameId: string, n = 10): Promise<RemoteScore[]> {
  if (!REMOTE_ENABLED || !supabase) return [];
  try {
    const { data, error } = await supabase.rpc("top_scores", { p_game_id: gameId, p_limit: n });
    if (error || !data) return [];
    return data as RemoteScore[];
  } catch {
    return [];
  }
}

export async function topGlobalToday(gameId: string, n = 10): Promise<RemoteScore[]> {
  if (!REMOTE_ENABLED || !supabase) return [];
  try {
    const { data, error } = await supabase.rpc("top_scores_today", { p_game_id: gameId, p_limit: n });
    if (error || !data) return [];
    return data as RemoteScore[];
  } catch {
    return [];
  }
}

export async function personalBest(gameId: string): Promise<number> {
  const { nickname } = getProfile();
  const rows = await db.scores
    .where("gameId")
    .equals(gameId)
    .filter((r) => r.nickname === nickname)
    .toArray();
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((r) => r.score));
}
