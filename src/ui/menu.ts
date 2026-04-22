import { GAMES, type GameEntry, type GameMode } from "../games/registry.js";
import { getProfile, setNickname, subscribe } from "../lib/auth.js";
import { navigate } from "../lib/router.js";
import { personalBest } from "../lib/leaderboard.js";
import { renderCover } from "./cover.js";

let root: HTMLElement | null = null;
let unsubAuth: (() => void) | null = null;

// ---------- render ----------

function nicknameEditorHTML(nick: string): string {
  return `<button class="nick-btn" id="nick-btn" aria-label="Change nickname" title="Tap to change nickname">
    <span class="nick-prefix">PLR&gt;</span>
    <span class="nick-val" id="nick-val">${nick}</span>
    <span class="nick-edit-icon">✎</span>
  </button>`;
}

const TROPHY_SVG = `<svg class="tile-trophy-icon" viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
  <path d="M6.5 17.5h7M10 14.5v3M13.5 3H16v3a2.5 2.5 0 01-2.5 2.5M6.5 3H4v3A2.5 2.5 0 006.5 8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M6.5 3h7v5.5a3.5 3.5 0 01-7 0V3z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const MODE_ICON: Record<GameMode, string> = {
  solo: "👤",
  local2p: "📱",
  remote2p: "🌐",
};

function modeBadges(modes: GameMode[]): string {
  if (modes.length <= 1) return "";
  const icons = modes
    .filter((m) => m !== "solo")
    .map((m) => `<span class="tile-mode-badge" title="${m}">${MODE_ICON[m]}</span>`)
    .join("");
  return icons ? `<div class="tile-modes">${icons}</div>` : "";
}

function tileHTML(g: GameEntry, best: number | undefined): string {
  const cover = renderCover(g);
  const bestBadge = best !== undefined
    ? `<div class="tile-best">BEST <span>${best}</span></div>`
    : "";
  const soonBadge = g.status === "soon"
    ? `<div class="tile-soon-badge">SOON</div>`
    : "";
  const trophyBtn = g.status === "ready"
    ? `<button class="tile-trophy-btn" data-scores-id="${g.id}" aria-label="View ${g.title} leaderboard">${TROPHY_SVG}</button>`
    : "";

  return `<article class="game-tile${g.status === "soon" ? " tile-soon" : ""}" data-id="${g.id}" data-status="${g.status}" role="button" tabindex="0" aria-label="${g.title}${g.status === "soon" ? " (coming soon)" : ""}">
      <div class="tile-cover">${cover}</div>
      ${soonBadge}
      ${trophyBtn}
      ${modeBadges(g.modes)}
      <div class="tile-info">
        <h3 class="tile-title">${g.title}</h3>
        <p class="tile-tagline">${g.tagline}</p>
        ${bestBadge}
      </div>
    </article>`;
}

async function buildSections(): Promise<string> {
  const readyGames = GAMES.filter((g) => g.status === "ready");
  const bestMap = new Map<string, number>();
  await Promise.all(readyGames.map(async (g) => {
    const b = await personalBest(g.id);
    if (b > 0) bestMap.set(g.id, b);
  }));

  const solo = GAMES.filter((g) => g.category === "solo");
  const company = GAMES.filter((g) => g.category === "company");

  function renderSection(label: string, subtitle: string, list: GameEntry[]): string {
    if (list.length === 0) return "";
    const tiles = list.map((g) => tileHTML(g, bestMap.get(g.id))).join("\n");
    return `<section class="menu-section">
      <header class="menu-section-head">
        <h2 class="menu-section-title">${label}</h2>
        <span class="menu-section-sub">${subtitle}</span>
      </header>
      <div class="game-grid-menu">${tiles}</div>
    </section>`;
  }

  return [
    renderSection("SOLITARI", "Gioca da solo", solo),
    renderSection("COMPAGNIA", "2 giocatori · locale o online", company),
  ].join("\n");
}

async function render(): Promise<void> {
  if (!root) return;
  const profile = getProfile();
  const sections = await buildSections();
  const readyCount = GAMES.filter((g) => g.status === "ready").length;
  const totalCount = GAMES.length;

  root.innerHTML = `
    <div class="menu-page">
      <header class="menu-header">
        <div class="logo-wrap">
          <div class="logo-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28">
              <rect width="32" height="32" rx="5" fill="#f6c24c" fill-opacity="0.15"/>
              <circle cx="16" cy="16" r="9" fill="none" stroke="#f6c24c" stroke-width="2"/>
              <rect x="14" y="9" width="4" height="14" rx="0.5" fill="#f6c24c"/>
            </svg>
          </div>
          <h1 class="logo-text">INSERT COIN</h1>
        </div>
        <div class="header-right">
          ${nicknameEditorHTML(profile.nickname)}
          <div class="game-count">${readyCount}/${totalCount} games</div>
        </div>
      </header>
      <main class="menu-main">
        ${sections}
      </main>
    </div>
  `;

  attachHandlers();
}

// ---------- event handling ----------

function attachHandlers(): void {
  if (!root) return;

  // Nick button
  const nickBtn = root.querySelector<HTMLElement>("#nick-btn");
  nickBtn?.addEventListener("pointerup", () => {
    openNickEditor();
  });

  // Trophy buttons — navigate to leaderboard without opening game
  root.querySelectorAll<HTMLElement>(".tile-trophy-btn").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    btn.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      const id = btn.dataset["scoresId"];
      if (id) navigate(`/scores/${id}`);
    });
  });

  // Game tiles
  root.querySelectorAll<HTMLElement>(".game-tile").forEach((tile) => {
    tile.addEventListener("pointerdown", () => {
      tile.classList.add("tile-pressed");
    });
    tile.addEventListener("pointerup", () => {
      tile.classList.remove("tile-pressed");
      const id = tile.dataset["id"];
      const status = tile.dataset["status"];
      if (!id) return;
      if (status === "soon") {
        showToast(`${tile.querySelector(".tile-title")?.textContent ?? "Game"} — Coming soon!`);
        return;
      }
      navigate(`/play/${id}`);
    });
    tile.addEventListener("pointerleave", () => {
      tile.classList.remove("tile-pressed");
    });
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tile.dispatchEvent(new PointerEvent("pointerup"));
      }
    });
  });
}

function openNickEditor(): void {
  const current = getProfile().nickname;
  const overlay = document.createElement("div");
  overlay.className = "nick-overlay";
  overlay.innerHTML = `
    <div class="nick-dialog" role="dialog" aria-modal="true" aria-label="Change nickname">
      <h2 class="nick-dialog-title">YOUR HANDLE</h2>
      <input id="nick-input" class="nick-input" type="text" maxlength="10"
        value="${current}" autocomplete="off" autocorrect="off" spellcheck="false"
        aria-label="Nickname (max 10 characters)"/>
      <div class="nick-dialog-hint">3–10 chars, arcade style. Enter to confirm.</div>
      <div class="nick-dialog-actions">
        <button class="btn btn-cancel" id="nick-cancel">CANCEL</button>
        <button class="btn btn-confirm primary" id="nick-confirm">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>("#nick-input");
  input?.focus();
  input?.select();

  const confirm = async (): Promise<void> => {
    const val = input?.value ?? "";
    if (val.trim().length < 1) return;
    await setNickname(val);
    overlay.remove();
  };

  const cancel = (): void => { overlay.remove(); };

  overlay.querySelector("#nick-confirm")?.addEventListener("pointerup", () => { void confirm(); });
  overlay.querySelector("#nick-cancel")?.addEventListener("pointerup", cancel);
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) cancel();
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { void confirm(); }
    if (e.key === "Escape") cancel();
  });
}

let toastTimeout = 0;
function showToast(msg: string): void {
  let toast = document.querySelector<HTMLElement>(".menu-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "menu-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast?.classList.remove("visible");
  }, 2200);
}

// ---------- public API ----------

export function mountMenu(container: HTMLElement): void {
  root = container;
  void render();

  unsubAuth = subscribe(() => {
    // Update nickname display without full re-render for responsiveness
    const nickVal = root?.querySelector<HTMLElement>("#nick-val");
    if (nickVal) nickVal.textContent = getProfile().nickname;
  });
}

export function unmountMenu(): void {
  unsubAuth?.();
  unsubAuth = null;
  if (root) root.innerHTML = "";
  root = null;
}
