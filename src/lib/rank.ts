import { topGlobal, type RemoteScore } from "./leaderboard.js";
import { REMOTE_ENABLED } from "./supabase.js";

export interface RankInfo {
  rank: number;
  toBeat: { nickname: string; delta: number } | null;
}

export async function computeRank(gameId: string, score: number): Promise<RankInfo | null> {
  if (!REMOTE_ENABLED) return null;
  try {
    const rows: RemoteScore[] = await topGlobal(gameId, 100);
    if (rows.length === 0) return { rank: 1, toBeat: null };

    // rows are sorted best-first from the RPC
    const pos = rows.findIndex((r) => r.score <= score);
    const rank = pos === -1 ? rows.length + 1 : pos + 1;

    let toBeat: { nickname: string; delta: number } | null = null;
    if (rank > 1 && rank <= rows.length + 1) {
      const above = rows[rank - 2];
      if (above) {
        toBeat = { nickname: above.nickname, delta: above.score - score };
      }
    }

    return { rank: rank > 100 ? 101 : rank, toBeat };
  } catch {
    return null;
  }
}
