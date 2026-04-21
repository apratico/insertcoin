import Dexie, { type EntityTable } from "dexie";

export interface ProfileRow {
  id: number;
  nickname: string;
  createdAt: number;
  deviceId?: string;
}

export interface ScoreRow {
  id?: number;
  gameId: string;
  nickname: string;
  score: number;
  playedAt: number;
}

export interface SettingRow {
  key: string;
  value: string;
}

class InsertCoinDB extends Dexie {
  profile!: EntityTable<ProfileRow, "id">;
  scores!: EntityTable<ScoreRow, "id">;
  settings!: EntityTable<SettingRow, "key">;

  constructor() {
    super("insertcoin");
    this.version(1).stores({
      profile: "id, nickname",
      scores: "++id, gameId, playedAt, [gameId+score]",
      settings: "key",
    });
    this.version(2).stores({
      profile: "id, nickname, deviceId",
      scores: "++id, gameId, playedAt, [gameId+score]",
      settings: "key",
    });
  }
}

export const db = new InsertCoinDB();
