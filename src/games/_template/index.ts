// Game template — copy this folder to `src/games/<your-id>/`, rename, and fill in.
//
// 1. Replace every "tpl" prefix with your game id (kebab-case).
// 2. Add an entry to `src/games/registry.ts` and a cover function in `src/ui/cover.ts`.
// 3. Read CONTRIBUTING.md → "Game mount contract" before changing the structure.
//
// This file is a minimal working game (tap to score) that already follows all the
// hard rules: no className wipe, setTransform for HiDPI, resize guard, touch on
// the wrap, leaderboard submit, vibrate, first-play hint.

import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { playSfx } from "../../lib/audio.js";
import { db } from "../../lib/storage.js";

const GAME_ID = "tpl";
const HUD_HEIGHT = 48;
const ROUND_SECONDS = 15;

type Phase = "idle" | "playing" | "gameover";

interface Target {
  x: number;
  y: number;
  r: number;
  ttl: number;
}

async function loadSeenHint(): Promise<boolean> {
  try {
    const row = await db.settings.get(`${GAME_ID}:seenHint`);
    return !!row;
  } catch { return false; }
}

async function markHintSeen(): Promise<void> {
  try { await db.settings.put({ key: `${GAME_ID}:seenHint`, value: "1" }); } catch { /* ok */ }
}

export function mount(container: HTMLElement): () => void {
  injectStyles();

  // RULE 1 — never replace container.className
  container.innerHTML = "";
  container.classList.add("tpl-root");
  const prevTouchAction = container.style.touchAction;
  // RULE 7 — disable browser touch behaviors
  container.style.touchAction = "none";

  const wrap = document.createElement("div");
  wrap.className = "tpl-wrap";
  container.appendChild(wrap);

  const hud = document.createElement("div");
  hud.className = "tpl-hud";
  hud.innerHTML = `
    <div>BEST <span id="tpl-best">0</span></div>
    <div>TIME <span id="tpl-time">${ROUND_SECONDS}</span></div>
    <div>SCORE <span id="tpl-score">0</span></div>
  `;
  wrap.appendChild(hud);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "tpl-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "tpl-canvas";
  canvasWrap.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx: CanvasRenderingContext2D = ctxRaw;

  let phase: Phase = "idle";
  let score = 0;
  let best = 0;
  let timeLeft = ROUND_SECONDS;
  let target: Target | null = null;
  let canvasW = 0;
  let canvasH = 0;
  let stateReady = false;
  let lastTime = 0;
  let rafId = 0;

  void personalBest(GAME_ID).then((b) => {
    best = b;
    const el = hud.querySelector<HTMLElement>("#tpl-best");
    if (el) el.textContent = String(best);
  });

  function spawnTarget(): void {
    if (canvasW < 40 || canvasH < 40) return;
    const r = 28;
    target = {
      x: r + Math.random() * (canvasW - r * 2),
      y: r + Math.random() * (canvasH - r * 2),
      r,
      ttl: 1.6,
    };
  }

  function startPlaying(): void {
    if (phase !== "idle") return;
    phase = "playing";
    score = 0;
    timeLeft = ROUND_SECONDS;
    spawnTarget();
    void markHintSeen();
    updateHud();
  }

  function endGame(): void {
    phase = "gameover";
    if ("vibrate" in navigator) navigator.vibrate([60, 40, 100]);
    playSfx("gameover");
    void submit(GAME_ID, score).then(() => {
      void personalBest(GAME_ID).then((b) => { best = Math.max(best, b); updateHud(); });
    });
    showOverlay();
  }

  function updateHud(): void {
    hud.querySelector<HTMLElement>("#tpl-score")!.textContent = String(score);
    hud.querySelector<HTMLElement>("#tpl-best")!.textContent = String(best);
    hud.querySelector<HTMLElement>("#tpl-time")!.textContent = String(Math.max(0, Math.ceil(timeLeft)));
  }

  function showOverlay(): void {
    const overlay = document.createElement("div");
    overlay.className = "tpl-overlay";
    overlay.innerHTML = `
      <div class="tpl-card">
        <h2>Time's up!</h2>
        <div class="tpl-final">${score}</div>
        <div class="tpl-sub">SCORE</div>
        <div class="tpl-actions">
          <button class="btn primary" id="tpl-replay">PLAY AGAIN</button>
          <button class="btn" id="tpl-menu">MENU</button>
        </div>
      </div>
    `;
    container.appendChild(overlay);
    overlay.querySelector("#tpl-replay")?.addEventListener("pointerup", () => {
      overlay.remove();
      phase = "idle";
      startPlaying();
    });
    overlay.querySelector("#tpl-menu")?.addEventListener("pointerup", () => navigate("/"));
  }

  // RULE 3 — resize guard. RULE 2 — setTransform (no scale).
  function onResize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvasWrap.clientWidth;
    const ch = canvasWrap.clientHeight;
    if (cw < 8 || ch < 8) return;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvasW = cw;
    canvasH = ch;
    stateReady = true;
    // RULE 4 — re-render inside resize. canvas.width = ... clears the canvas.
    drawFrame();
  }

  function loop(now: number): void {
    rafId = requestAnimationFrame(loop);
    if (!stateReady) return;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    if (phase === "playing") {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        endGame();
      }
      if (target) {
        target.ttl -= dt;
        if (target.ttl <= 0) {
          // missed — penalty
          target = null;
          spawnTarget();
        }
      } else {
        spawnTarget();
      }
      updateHud();
    }

    drawFrame();
  }

  function drawFrame(): void {
    if (!stateReady) return;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvasW, canvasH);

    if (phase === "playing" && target) {
      const a = Math.max(0, target.ttl / 1.6);
      ctx.fillStyle = `rgba(79, 195, 247, ${0.4 + a * 0.6})`;
      ctx.beginPath();
      ctx.arc(target.x, target.y, target.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (phase === "idle") {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px monospace";
      ctx.textAlign = "center";
      ctx.fillText("TAP TO START", canvasW / 2, canvasH / 2);
      ctx.textAlign = "left";
    }
  }

  // RULE 5 — pointer on the wrap, not on the canvas.
  function onPointerDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    if (phase === "idle") { startPlaying(); return; }
    if (phase !== "playing" || !target) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - target.x;
    const dy = y - target.y;
    if (dx * dx + dy * dy <= target.r * target.r) {
      score++;
      playSfx("score");
      if ("vibrate" in navigator) navigator.vibrate(8);
      target = null;
      spawnTarget();
    }
  }
  wrap.addEventListener("pointerdown", onPointerDown);

  function onKey(e: KeyboardEvent): void {
    if (e.key === " " || e.key === "Enter") {
      if (phase === "idle") startPlaying();
    }
  }
  document.addEventListener("keydown", onKey);

  // First-play hint
  void loadSeenHint().then((seen) => {
    if (!seen) {
      const tip = document.createElement("div");
      tip.className = "tpl-hint";
      tip.textContent = "Tap the circle before it fades.";
      wrap.appendChild(tip);
      setTimeout(() => tip.remove(), 5000);
    }
  });

  const ro = new ResizeObserver(onResize);
  ro.observe(canvasWrap);
  onResize();
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);

  return function cleanup(): void {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    document.removeEventListener("keydown", onKey);
    wrap.removeEventListener("pointerdown", onPointerDown);
    container.innerHTML = "";
    container.classList.remove("tpl-root");
    container.style.touchAction = prevTouchAction;
  };
}

function injectStyles(): void {
  const id = "tpl-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    /* RULE 6 — flex chain. Don't add min-height anywhere. */
    .tpl-root { display: flex; flex-direction: column; flex: 1; min-height: 0; background: #0f172a; user-select: none; -webkit-user-select: none; }
    .tpl-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative; }
    .tpl-hud { display: flex; justify-content: space-between; align-items: center; height: ${HUD_HEIGHT}px; padding: 0 12px; font-family: monospace; color: #fff; background: rgba(0,0,0,0.32); box-sizing: border-box; }
    .tpl-canvas-wrap { flex: 1; min-height: 0; position: relative; overflow: hidden; }
    .tpl-canvas { display: block; touch-action: none; }
    .tpl-hint { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); padding: 8px 14px; background: rgba(0,0,0,0.6); color: #fff; font-family: monospace; font-size: 12px; pointer-events: none; }
    .tpl-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.7); z-index: 10; }
    .tpl-card { background: #1e293b; padding: 28px 24px; border: 2px solid #4fc3f7; text-align: center; font-family: monospace; color: #fff; min-width: 240px; }
    .tpl-card h2 { margin: 0 0 8px; }
    .tpl-final { font-size: 48px; font-weight: bold; }
    .tpl-sub { font-size: 11px; color: #aaa; letter-spacing: 2px; margin-bottom: 18px; }
    .tpl-actions { display: flex; gap: 12px; justify-content: center; }
  `;
  document.head.appendChild(style);
}
