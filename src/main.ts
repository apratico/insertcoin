import "./styles.css";
import { db } from "./lib/storage.js";
import { initAuth } from "./lib/auth.js";
import { onRoute, start, navigate } from "./lib/router.js";
import { getGame } from "./games/registry.js";
import { mountMenu, unmountMenu } from "./ui/menu.js";
import { mountScores, unmountScores } from "./ui/scores.js";
import { joinLobby, leaveLobby } from "./lib/presence.js";
import { setupAutoUpdate, hardReset } from "./lib/update.js";
import { logVisit } from "./lib/visits.js";
import { logGameOpen } from "./lib/stats.js";
import { getInstructions, hasInstructions, type Lang } from "./lib/instructions.js";

await db.open();

await initAuth();

setupAutoUpdate();
joinLobby();
window.addEventListener("beforeunload", () => leaveLobby());
void logVisit();

// Escape hatch for stale caches on mobile.
// Visit /#reset or run window.hardReset() from console to fully clear SW + caches.
(window as unknown as { hardReset: () => Promise<void> }).hardReset = hardReset;
if (location.hash === "#reset") { void hardReset(); }

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

// Game host elements (created once, reused across plays)
const menuHost = document.createElement("div");
menuHost.className = "menu-host";
app.appendChild(menuHost);

const gameHost = document.createElement("div");
gameHost.className = "game-host";
gameHost.style.display = "none";
app.appendChild(gameHost);

const scoresHost = document.createElement("div");
scoresHost.className = "scores-host";
scoresHost.style.display = "none";
app.appendChild(scoresHost);

let cleanupGame: (() => void) | null = null;

// Build in-game topbar once
const topbar = document.createElement("div");
topbar.className = "game-topbar";
topbar.innerHTML = `
  <button class="btn" id="back-btn" aria-label="Back to menu">← MENU</button>
  <span class="game-topbar-title" id="topbar-title"></span>
  <button class="btn game-help-btn" id="help-btn" aria-label="How to play" style="display:none">?</button>
`;
gameHost.appendChild(topbar);
topbar.querySelector("#back-btn")?.addEventListener("pointerup", () => {
  navigate("/");
});

let currentGameIdForHelp: string | null = null;

topbar.querySelector("#help-btn")?.addEventListener("pointerup", () => {
  if (currentGameIdForHelp) showInstructions(currentGameIdForHelp);
});

const INSTRUCTIONS_LANG_KEY = "instructions:lang";

function showInstructions(gameId: string): void {
  const data = getInstructions(gameId);
  if (!data) return;

  let lang: Lang = (localStorage.getItem(INSTRUCTIONS_LANG_KEY) as Lang) ?? "it";
  if (lang !== "it" && lang !== "en") lang = "it";

  const overlay = document.createElement("div");
  overlay.className = "help-overlay";

  const render = (): void => {
    const lines = data[lang];
    overlay.innerHTML = `
      <div class="help-dialog" role="dialog" aria-modal="true">
        <div class="help-header">
          <h2 class="help-title">${data.title}</h2>
          <div class="help-lang">
            <button class="help-lang-btn${lang === "it" ? " active" : ""}" data-lang="it">IT</button>
            <button class="help-lang-btn${lang === "en" ? " active" : ""}" data-lang="en">EN</button>
          </div>
        </div>
        <ul class="help-list">
          ${lines.map((l) => `<li>${l}</li>`).join("")}
        </ul>
        <div class="help-actions">
          <button class="btn primary help-close">${lang === "it" ? "HO CAPITO" : "GOT IT"}</button>
        </div>
      </div>
    `;
    overlay.querySelectorAll<HTMLElement>(".help-lang-btn").forEach((b) => {
      b.addEventListener("pointerup", () => {
        const l = b.dataset["lang"] as Lang | undefined;
        if (!l || l === lang) return;
        lang = l;
        localStorage.setItem(INSTRUCTIONS_LANG_KEY, l);
        render();
      });
    });
    overlay.querySelector(".help-close")?.addEventListener("pointerup", close);
  };

  const close = (): void => overlay.remove();
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) close();
  });

  render();
  document.body.appendChild(overlay);
}

const gameContent = document.createElement("div");
gameContent.className = "game-content";
gameHost.appendChild(gameContent);

// Router
onRoute(async (route) => {
  // Always hide scores host unless we're on the scores route
  if (route.name !== "scores") {
    unmountScores();
    scoresHost.style.display = "none";
  }

  if (route.name === "menu") {
    // Unmount game if active
    if (cleanupGame) {
      cleanupGame();
      cleanupGame = null;
      gameContent.innerHTML = "";
    }
    gameHost.style.display = "none";
    menuHost.style.display = "";
    mountMenu(menuHost);
    return;
  }

  if (route.name === "play") {
    const entry = getGame(route.gameId);
    if (!entry || entry.status !== "ready" || !entry.load) {
      navigate("/");
      return;
    }
    void logGameOpen(entry.id);

    unmountMenu();
    menuHost.style.display = "none";
    gameHost.style.display = "";
    gameHost.dataset["orientation"] = entry.orientation ?? "any";

    const titleEl = document.getElementById("topbar-title");
    if (titleEl) titleEl.textContent = entry.title;

    // Show help button if instructions exist
    currentGameIdForHelp = entry.id;
    const helpBtn = document.getElementById("help-btn");
    if (helpBtn) {
      helpBtn.style.display = hasInstructions(entry.id) ? "" : "none";
    }

    gameContent.innerHTML = "";

    // Show loading shimmer
    const loader = document.createElement("div");
    loader.className = "game-loader";
    loader.textContent = "Loading…";
    gameContent.appendChild(loader);

    try {
      const mod = await entry.load();
      loader.remove();
      cleanupGame = mod.mount(gameContent);
    } catch (err) {
      loader.textContent = "Failed to load game.";
      console.error(err);
    }
    return;
  }

  if (route.name === "scores") {
    if (cleanupGame) {
      cleanupGame();
      cleanupGame = null;
      gameContent.innerHTML = "";
    }
    unmountMenu();
    menuHost.style.display = "none";
    gameHost.style.display = "none";
    scoresHost.style.display = "";
    mountScores(scoresHost, route.gameId);
  }
});

start();
