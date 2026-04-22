import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, REMOTE_ENABLED } from "./supabase.js";
import { getProfile } from "./auth.js";

type Listener = (count: number) => void;

let channel: RealtimeChannel | null = null;
let currentCount = 0;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((cb) => cb(currentCount));
}

function recompute(): void {
  if (!channel) { currentCount = 0; notify(); return; }
  const state = channel.presenceState();
  currentCount = Object.keys(state).length;
  notify();
}

export function getOnlineCount(): number {
  return currentCount;
}

export function subscribeOnline(cb: Listener): () => void {
  listeners.add(cb);
  cb(currentCount);
  return () => { listeners.delete(cb); };
}

export function joinLobby(): void {
  if (!REMOTE_ENABLED || !supabase || channel) return;
  let deviceId: string | undefined;
  try { deviceId = getProfile().deviceId; } catch { /* not ready yet */ }
  if (!deviceId) return;

  const ch = supabase.channel("lobby", { config: { presence: { key: deviceId } } });
  channel = ch;

  ch.on("presence", { event: "sync" }, recompute)
    .on("presence", { event: "join" }, recompute)
    .on("presence", { event: "leave" }, recompute)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try { await ch.track({ at: Date.now() }); } catch { /* offline */ }
      }
    });
}

export function leaveLobby(): void {
  if (!channel || !supabase) { channel = null; return; }
  try { void supabase.removeChannel(channel); } catch { /* ignore */ }
  channel = null;
  currentCount = 0;
  notify();
}
