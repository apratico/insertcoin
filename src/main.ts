import "./styles.css";
import { db } from "./lib/storage.js";
import { initAuth } from "./lib/auth.js";
import { onRoute, start, navigate } from "./lib/router.js";
import { getGame } from "./games/registry.js";
import { mountMenu, unmountMenu } from "./ui/menu.js";
import { mountScores, unmountScores } from "./ui/scores.js";
import { joinLobby, leaveLobby } from "./lib/presence.js";

await db.open();

await initAuth();

joinLobby();
window.addEventListener("beforeunload", () => leaveLobby());

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
  <div style="width:72px"></div>
`;
gameHost.appendChild(topbar);
topbar.querySelector("#back-btn")?.addEventListener("pointerup", () => {
  navigate("/");
});

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

    unmountMenu();
    menuHost.style.display = "none";
    gameHost.style.display = "";

    const titleEl = document.getElementById("topbar-title");
    if (titleEl) titleEl.textContent = entry.title;

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
