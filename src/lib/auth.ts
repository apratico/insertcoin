import { db, type ProfileRow } from "./storage.js";
import { supabase, REMOTE_ENABLED } from "./supabase.js";

const NICKNAMES = [
  "ACE", "ZAP", "NEO", "REX", "KAI", "MAX", "JAX", "DEX",
  "VEX", "FOX", "IVY", "SKY", "RAY", "TAZ", "GUS", "ROK",
  "BLU", "ZED", "KOB", "ORB",
];

const PROFILE_ID = 1;

type Subscriber = (profile: ProfileRow) => void;
const subscribers: Subscriber[] = [];

let cached: ProfileRow | null = null;

function notify(p: ProfileRow): void {
  subscribers.forEach((cb) => cb(p));
}

function genDeviceId(): string {
  const c = crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function upsertRemoteProfile(p: ProfileRow): Promise<void> {
  if (!REMOTE_ENABLED || !supabase || !p.deviceId) return;
  try {
    await supabase.rpc("upsert_profile", {
      p_device_id: p.deviceId,
      p_nickname: p.nickname,
    });
  } catch { /* offline-tolerant */ }
}

export async function initAuth(): Promise<ProfileRow> {
  let row = await db.profile.get(PROFILE_ID);
  if (!row) {
    const nick = NICKNAMES[Math.floor(Math.random() * NICKNAMES.length)] ?? "ACE";
    row = { id: PROFILE_ID, nickname: nick, createdAt: Date.now(), deviceId: genDeviceId() };
    await db.profile.put(row);
  } else if (!row.deviceId) {
    row = { ...row, deviceId: genDeviceId() };
    await db.profile.put(row);
  }
  cached = row;
  void upsertRemoteProfile(row);
  return row;
}

export function getProfile(): ProfileRow {
  if (!cached) throw new Error("auth not initialised — call initAuth() first");
  return cached;
}

export async function setNickname(nick: string): Promise<void> {
  const trimmed = nick.trim().toUpperCase().slice(0, 10);
  if (!trimmed) return;
  const row: ProfileRow = {
    id: PROFILE_ID,
    nickname: trimmed,
    createdAt: cached?.createdAt ?? Date.now(),
    ...(cached?.deviceId ? { deviceId: cached.deviceId } : { deviceId: genDeviceId() }),
  };
  await db.profile.put(row);
  cached = row;
  notify(row);
  void upsertRemoteProfile(row);
}

export function subscribe(cb: Subscriber): () => void {
  subscribers.push(cb);
  return () => {
    const idx = subscribers.indexOf(cb);
    if (idx !== -1) subscribers.splice(idx, 1);
  };
}
