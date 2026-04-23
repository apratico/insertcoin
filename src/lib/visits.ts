import { supabase, REMOTE_ENABLED } from "./supabase.js";
import { getProfile } from "./auth.js";

let logged = false;

async function detectCountry(): Promise<string | null> {
  try {
    const r = await fetch("https://ipapi.co/country/", { cache: "no-store" });
    if (!r.ok) return null;
    const txt = (await r.text()).trim();
    return txt.length === 2 ? txt : null;
  } catch { return null; }
}

export async function logVisit(): Promise<void> {
  if (logged) return;
  logged = true;
  if (!REMOTE_ENABLED || !supabase) return;

  let p;
  try { p = getProfile(); } catch { return; }

  const country = await detectCountry();

  const payload = {
    device_id: p.deviceId ?? null,
    nickname:  p.nickname,
    user_agent: navigator.userAgent.slice(0, 300),
    language: navigator.language ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    referrer: (document.referrer || "").slice(0, 200) || null,
    screen_w: window.screen?.width ?? null,
    screen_h: window.screen?.height ?? null,
    country,
    // IP left null here — could be filled by a CF Pages Function via req.cf.ip
    // later; we keep privacy-safe defaults for now.
  };

  try { await supabase.from("visits").insert(payload); } catch { /* offline */ }
}

export interface VisitTotals {
  dayTotal: number;
  monthTotal: number;
  yearTotal: number;
  allTotal: number;
}

export async function getVisitTotals(): Promise<VisitTotals> {
  const empty: VisitTotals = { dayTotal: 0, monthTotal: 0, yearTotal: 0, allTotal: 0 };
  if (!REMOTE_ENABLED || !supabase) return empty;
  try {
    const { data, error } = await supabase.rpc("visits_totals");
    if (error || !data || !Array.isArray(data) || data.length === 0) return empty;
    const r = data[0] as { day_total: number; month_total: number; year_total: number; all_total: number };
    return {
      dayTotal:   Number(r.day_total ?? 0),
      monthTotal: Number(r.month_total ?? 0),
      yearTotal:  Number(r.year_total ?? 0),
      allTotal:   Number(r.all_total ?? 0),
    };
  } catch { return empty; }
}

export interface DailyCount { day: string; n: number; }

export async function getVisitsDaily(days = 30): Promise<DailyCount[]> {
  if (!REMOTE_ENABLED || !supabase) return [];
  try {
    const { data, error } = await supabase.rpc("visits_daily", { p_days: days });
    if (error || !data) return [];
    return (data as Array<{ day: string; n: number }>)
      .map((r) => ({ day: r.day, n: Number(r.n) }));
  } catch { return []; }
}
