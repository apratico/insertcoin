import { topGlobalToday, topGlobal, top, type RemoteScore } from "../lib/leaderboard.js";
import { getProfile } from "../lib/auth.js";
import { navigate } from "../lib/router.js";
import { getGame } from "../games/registry.js";
import { REMOTE_ENABLED } from "../lib/supabase.js";
import type { ScoreRow } from "../lib/storage.js";

type Tab = "today" | "alltime" | "local";

let root: HTMLElement | null = null;
let currentGameId = "";
let currentTab: Tab = "today";

// ---------- helpers ----------

function ago(ts: number | string): string {
  const now = Date.now();
  const then = typeof ts === "string" ? new Date(ts).getTime() : ts;
  const diff = Math.floor((now - then) / 1000);
  if (diff < 10) return "now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(then);
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

// ---------- skeleton ----------

function renderSkeleton(): string {
  return [1, 2, 3, 4].map(() => `
    <div class="sc-row sc-skeleton">
      <span class="sc-rank sc-skel-block sc-skel-sm"></span>
      <span class="sc-nick sc-skel-block sc-skel-lg"></span>
      <span class="sc-score sc-skel-block sc-skel-md"></span>
      <span class="sc-when sc-skel-block sc-skel-sm"></span>
    </div>
  `).join("");
}

// ---------- row renders ----------

function renderRemoteRows(rows: RemoteScore[], deviceId: string, userOutside?: { rank: number; score: number } | null): string {
  if (rows.length === 0) {
    return `<div class="sc-empty">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="17" stroke="var(--muted)" stroke-width="1.5"/>
        <path d="M13 20h14M20 13v14" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <div class="sc-empty-text">Be the first!</div>
    </div>`;
  }

  const rowsHtml = rows.map((r, i) => {
    const rank = i + 1;
    const highlighted = r.device_id === deviceId;
    return `<div class="sc-row${highlighted ? " sc-row-me" : ""}">
      <span class="sc-rank">${rank === 1 ? "&#x1F947;" : rank === 2 ? "&#x1F948;" : rank === 3 ? "&#x1F949;" : "#" + rank}</span>
      <span class="sc-nick">${escHtml(r.nickname)}</span>
      <span class="sc-score">${r.score.toLocaleString()}</span>
      <span class="sc-when">${ago(r.played_at)}</span>
    </div>`;
  }).join("");

  const outsideHtml = userOutside
    ? `<div class="sc-row sc-row-me sc-row-outside">
        <span class="sc-rank">#${userOutside.rank}</span>
        <span class="sc-nick">YOU</span>
        <span class="sc-score">${userOutside.score.toLocaleString()}</span>
        <span class="sc-when"></span>
      </div>`
    : "";

  return rowsHtml + outsideHtml;
}

function renderLocalRows(rows: ScoreRow[], nickname: string): string {
  if (rows.length === 0) {
    return `<div class="sc-empty">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="17" stroke="var(--muted)" stroke-width="1.5"/>
        <path d="M13 20h14M20 13v14" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <div class="sc-empty-text">No local scores yet.</div>
    </div>`;
  }

  return rows.map((r, i) => {
    const rank = i + 1;
    const highlighted = r.nickname === nickname;
    const ts = r.playedAt;
    return `<div class="sc-row${highlighted ? " sc-row-me" : ""}">
      <span class="sc-rank">${rank === 1 ? "&#x1F947;" : rank === 2 ? "&#x1F948;" : rank === 3 ? "&#x1F949;" : "#" + rank}</span>
      <span class="sc-nick">${escHtml(r.nickname)}</span>
      <span class="sc-score">${r.score.toLocaleString()}</span>
      <span class="sc-when">${ago(ts)}</span>
    </div>`;
  }).join("");
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- load & render ----------

async function loadAndRender(tab: Tab): Promise<void> {
  if (!root) return;
  const list = root.querySelector<HTMLElement>(".sc-list");
  if (!list) return;

  list.innerHTML = renderSkeleton();

  const profile = getProfile();
  const offline = !REMOTE_ENABLED;

  if ((tab === "today" || tab === "alltime") && offline) {
    list.innerHTML = `<div class="sc-empty"><div class="sc-empty-text">No data available offline.</div></div>`;
    return;
  }

  try {
    if (tab === "today") {
      const rows = await topGlobalToday(currentGameId, 20);
      if (!root) return;
      const inTop = rows.some((r) => r.device_id === profile.deviceId);
      let outside: { rank: number; score: number } | null = null;
      if (!inTop && profile.deviceId) {
        const all = await topGlobalToday(currentGameId, 1000);
        const idx = all.findIndex((r) => r.device_id === profile.deviceId);
        if (idx !== -1) outside = { rank: idx + 1, score: all[idx]!.score };
      }
      if (!root) return;
      list.innerHTML = renderRemoteRows(rows, profile.deviceId ?? "", outside);

    } else if (tab === "alltime") {
      const rows = await topGlobal(currentGameId, 20);
      if (!root) return;
      const inTop = rows.some((r) => r.device_id === profile.deviceId);
      let outside: { rank: number; score: number } | null = null;
      if (!inTop && profile.deviceId) {
        const all = await topGlobal(currentGameId, 1000);
        const idx = all.findIndex((r) => r.device_id === profile.deviceId);
        if (idx !== -1) outside = { rank: idx + 1, score: all[idx]!.score };
      }
      if (!root) return;
      list.innerHTML = renderRemoteRows(rows, profile.deviceId ?? "", outside);

    } else {
      const rows = await top(currentGameId, 20);
      if (!root) return;
      list.innerHTML = renderLocalRows(rows, profile.nickname);
    }
  } catch {
    if (!root) return;
    list.innerHTML = `<div class="sc-empty"><div class="sc-empty-text">Failed to load. Try refreshing.</div></div>`;
  }
}

// ---------- mount ----------

function render(gameId: string): void {
  if (!root) return;
  const entry = getGame(gameId);
  const title = entry?.title ?? gameId;
  const offline = !REMOTE_ENABLED;

  root.innerHTML = `
    <div class="sc-page">
      <header class="sc-header">
        <button class="btn sc-back-btn" id="sc-back" aria-label="Back">&#8592;</button>
        <div class="sc-header-title">
          <svg class="sc-trophy-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M8 21h8M12 17v4M17 3h3v4a3 3 0 01-3 3M7 3H4v4a3 3 0 003 3" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7 3h10v7a5 5 0 01-10 0V3z" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>${escHtml(title)} — SCORES</span>
        </div>
        <button class="btn sc-refresh-btn" id="sc-refresh" aria-label="Refresh">&#8635;</button>
      </header>
      ${offline ? `<div class="sc-offline-banner">Offline — global leaderboard unavailable</div>` : ""}
      <nav class="sc-tabs" role="tablist">
        <button class="sc-tab${currentTab === "today" ? " sc-tab-active" : ""}${offline ? " sc-tab-disabled" : ""}" data-tab="today" role="tab">TODAY</button>
        <button class="sc-tab${currentTab === "alltime" ? " sc-tab-active" : ""}${offline ? " sc-tab-disabled" : ""}" data-tab="alltime" role="tab">ALL-TIME</button>
        <button class="sc-tab${currentTab === "local" ? " sc-tab-active" : ""}" data-tab="local" role="tab">LOCAL</button>
      </nav>
      <div class="sc-list-wrap">
        <div class="sc-list" role="list"></div>
      </div>
    </div>
  `;

  root.querySelector("#sc-back")?.addEventListener("pointerup", () => { navigate("/"); });
  root.querySelector("#sc-refresh")?.addEventListener("pointerup", () => { void loadAndRender(currentTab); });

  root.querySelectorAll<HTMLElement>(".sc-tab:not(.sc-tab-disabled)").forEach((btn) => {
    btn.addEventListener("pointerup", () => {
      const tab = btn.dataset["tab"] as Tab | undefined;
      if (!tab || tab === currentTab) return;
      currentTab = tab;
      root?.querySelectorAll(".sc-tab").forEach((t) => t.classList.remove("sc-tab-active"));
      btn.classList.add("sc-tab-active");
      void loadAndRender(tab);
    });
  });

  // if offline, force local tab
  if (offline && currentTab !== "local") {
    currentTab = "local";
    root?.querySelectorAll(".sc-tab").forEach((t) => t.classList.remove("sc-tab-active"));
    root?.querySelector('[data-tab="local"]')?.classList.add("sc-tab-active");
  }

  void loadAndRender(currentTab);
}

export function mountScores(container: HTMLElement, gameId: string): void {
  root = container;
  currentGameId = gameId;
  if (!REMOTE_ENABLED && currentTab !== "local") {
    currentTab = "local";
  } else if (REMOTE_ENABLED && currentTab === "local") {
    currentTab = "today";
  }
  render(gameId);
}

export function unmountScores(): void {
  if (root) root.innerHTML = "";
  root = null;
}
