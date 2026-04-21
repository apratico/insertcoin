import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";

// ---------- types ----------

type Dir = "U" | "D" | "L" | "R";
type Pt = { x: number; y: number };

type State =
  | { phase: "playing"; score: number; best: number }
  | { phase: "gameover"; score: number; best: number }
  | { phase: "paused"; score: number; best: number };

// ---------- constants ----------

const GRID = 20;
const BASE_TICK = 150;
const ACCEL_PER_FOOD = 2; // ms shaved per food

// ---------- canvas helpers ----------

function makeCanvas(container: HTMLElement): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cellSize: () => number;
} {
  const canvas = document.createElement("canvas");
  canvas.className = "game-canvas";
  canvas.style.touchAction = "none";
  container.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx: CanvasRenderingContext2D = ctxRaw;

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw < 8 || ch < 8) return;
    const side = Math.max(80, Math.min(cw, ch) - 8);
    canvas.style.width = `${side}px`;
    canvas.style.height = `${side}px`;
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function cellSize(): number {
    return parseFloat(canvas.style.width || "300") / GRID;
  }

  return { canvas, ctx, cellSize };
}

// ---------- game logic ----------

function randomFood(snake: Pt[]): Pt {
  const occupied = new Set(snake.map((p) => `${p.x},${p.y}`));
  let pos: Pt;
  do {
    pos = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
  } while (occupied.has(`${pos.x},${pos.y}`));
  return pos;
}

function initSnake(): Pt[] {
  const mid = Math.floor(GRID / 2);
  return [
    { x: mid + 1, y: mid },
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
  ];
}

// ---------- draw ----------

function drawGame(
  ctx: CanvasRenderingContext2D,
  cellSize: number,
  snake: Pt[],
  food: Pt,
  state: State,
  tick: number
): void {
  const W = GRID * cellSize;
  const H = GRID * cellSize;

  // Background
  ctx.fillStyle = "#001a00";
  ctx.fillRect(0, 0, W, H);

  // Faint grid
  ctx.strokeStyle = "rgba(0,255,65,0.06)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * cellSize, 0); ctx.lineTo(i * cellSize, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cellSize); ctx.lineTo(W, i * cellSize); ctx.stroke();
  }

  // Food — pulsing size
  const pulse = 1 + 0.12 * Math.sin(tick * 0.15);
  const fr = (cellSize * 0.36) * pulse;
  ctx.shadowBlur = 12;
  ctx.shadowColor = "#ff3333";
  ctx.fillStyle = "#ff3333";
  ctx.beginPath();
  ctx.arc(
    (food.x + 0.5) * cellSize,
    (food.y + 0.5) * cellSize,
    fr, 0, Math.PI * 2
  );
  ctx.fill();
  ctx.shadowBlur = 0;

  // Snake
  const radius = cellSize * 0.2;
  snake.forEach((seg, i) => {
    const t = i / snake.length;
    const green = Math.round(255 - t * 100);
    ctx.fillStyle = i === 0 ? "#00ff41" : `rgb(0,${green},30)`;
    if (i === 0) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#00ff41";
    }
    const pad = cellSize * 0.08;
    const x = seg.x * cellSize + pad;
    const y = seg.y * cellSize + pad;
    const s = cellSize - pad * 2;
    roundRect(ctx, x, y, s, s, radius);
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // Eyes on head
  const head = snake[0];
  if (head) {
    ctx.fillStyle = "#001a00";
    const ew = cellSize * 0.15;
    const offsets: [number, number][] = [[0.3, 0.3], [0.7, 0.3]];
    offsets.forEach(([ox, oy]) => {
      ctx.beginPath();
      ctx.arc(
        head.x * cellSize + ox * cellSize,
        head.y * cellSize + oy * cellSize,
        ew, 0, Math.PI * 2
      );
      ctx.fill();
    });
  }

  // HUD overlay
  if (state.phase === "paused") {
    ctx.fillStyle = "rgba(0,26,0,0.75)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#00ff41";
    ctx.font = `bold ${cellSize * 1.4}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", W / 2, H / 2);
    ctx.textAlign = "left";
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ---------- overlay UI ----------

function buildHUD(container: HTMLElement, score: number, best: number): {
  scoreEl: HTMLElement;
  bestEl: HTMLElement;
  pauseBtn: HTMLElement;
  fsBtn: HTMLElement;
} {
  const hud = document.createElement("div");
  hud.className = "snake-hud";
  hud.innerHTML = `
    <div class="snake-hud-scores">
      <span class="snake-score-label">SCORE</span>
      <span class="snake-score-val" id="snake-score">${score}</span>
      <span class="snake-score-label" style="margin-left:16px">BEST</span>
      <span class="snake-score-val" id="snake-best">${best}</span>
    </div>
    <div class="snake-hud-actions">
      <button class="btn snake-pause-btn" id="snake-fs" aria-label="Fullscreen">⛶</button>
      <button class="btn snake-pause-btn" id="snake-pause" aria-label="Pause">⏸</button>
    </div>
  `;
  container.appendChild(hud);

  return {
    scoreEl: hud.querySelector("#snake-score") as HTMLElement,
    bestEl: hud.querySelector("#snake-best") as HTMLElement,
    pauseBtn: hud.querySelector("#snake-pause") as HTMLElement,
    fsBtn: hud.querySelector("#snake-fs") as HTMLElement,
  };
}

function buildDPad(container: HTMLElement): HTMLElement {
  const dpad = document.createElement("div");
  dpad.className = "snake-dpad";
  dpad.setAttribute("aria-label", "D-pad controls");
  dpad.innerHTML = `
    <div class="dpad-row">
      <button class="dpad-btn" data-dir="U" aria-label="Up">▲</button>
    </div>
    <div class="dpad-row">
      <button class="dpad-btn" data-dir="L" aria-label="Left">◀</button>
      <div class="dpad-center"></div>
      <button class="dpad-btn" data-dir="R" aria-label="Right">▶</button>
    </div>
    <div class="dpad-row">
      <button class="dpad-btn" data-dir="D" aria-label="Down">▼</button>
    </div>
  `;
  container.appendChild(dpad);
  return dpad;
}

function buildRankCard(rank: RankInfo, gameId: string): string {
  const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="rank-card-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta} pts</div>`
    : "";
  return `<div class="rank-card">
    <div class="rank-card-title">RANK ${rankLabel} GLOBAL</div>
    ${deltaHtml}
    <button class="btn rank-card-btn" data-scores-id="${gameId}">VIEW LEADERBOARD</button>
  </div>`;
}

function showGameover(
  container: HTMLElement,
  score: number,
  best: number,
  onReplay: () => void,
  rank?: RankInfo
): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "snake-gameover";
  const isNewBest = score >= best && score > 0;
  const rankHtml = rank ? buildRankCard(rank, "snake") : "";
  overlay.innerHTML = `
    <div class="snake-gameover-box">
      <h2 class="snake-go-title">GAME OVER</h2>
      ${isNewBest ? `<div class="snake-go-best-flag">NEW BEST!</div>` : ""}
      <div class="snake-go-score">${score}</div>
      <div class="snake-go-label">SCORE</div>
      ${rankHtml}
      <div class="snake-go-actions">
        <button class="btn primary snake-go-btn" id="go-replay">PLAY AGAIN</button>
        <button class="btn snake-go-btn" id="go-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector<HTMLElement>(".rank-card-btn")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const id = (e.currentTarget as HTMLElement).dataset["scoresId"];
    if (id) navigate(`/scores/${id}`);
  });

  overlay.querySelector("#go-replay")?.addEventListener("pointerup", () => {
    overlay.remove();
    onReplay();
  });
  overlay.querySelector("#go-menu")?.addEventListener("pointerup", () => {
    navigate("/");
  });

  return overlay;
}

// ---------- swipe detection ----------

function makeSwipeHandler(onSwipe: (dir: Dir) => void): {
  onTouchStart: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
} {
  let sx = 0;
  let sy = 0;

  return {
    onTouchStart(e: TouchEvent) {
      const t = e.changedTouches[0];
      if (!t) return;
      sx = t.clientX;
      sy = t.clientY;
    },
    onTouchEnd(e: TouchEvent) {
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      const MIN = 20;
      if (Math.abs(dx) < MIN && Math.abs(dy) < MIN) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        onSwipe(dx > 0 ? "R" : "L");
      } else {
        onSwipe(dy > 0 ? "D" : "U");
      }
    },
  };
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("snake-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  let snake: Pt[] = initSnake();
  let food: Pt = randomFood(snake);
  let dir: Dir = "R";
  let nextDir: Dir = "R";
  let score = 0;
  let best = 0;
  let state: State = { phase: "playing", score: 0, best: 0 };
  let tick = 0;
  let tickMs = BASE_TICK;
  let rafId = 0;
  let lastTickTime = 0;
  let gameoverOverlay: HTMLElement | null = null;

  // Layout: HUD top, canvas middle, dpad bottom
  const wrap = document.createElement("div");
  wrap.className = "snake-wrap";
  container.appendChild(wrap);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "snake-canvas-wrap";
  wrap.appendChild(canvasWrap);

  void personalBest("snake").then((b) => {
    best = b;
    state = { ...state, best };
    bestEl.textContent = String(best);
  });

  const { ctx, cellSize } = makeCanvas(canvasWrap);
  const { scoreEl, bestEl, pauseBtn, fsBtn } = buildHUD(wrap, score, best);
  wrap.insertBefore(wrap.querySelector(".snake-hud")!, canvasWrap);

  const dpad = buildDPad(wrap);

  fsBtn.addEventListener("pointerup", () => {
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (target.requestFullscreen) {
      void target.requestFullscreen().catch(() => {});
    }
  });

  // Pause button
  pauseBtn.addEventListener("pointerup", () => {
    if (state.phase === "playing") {
      state = { phase: "paused", score, best };
    } else if (state.phase === "paused") {
      state = { phase: "playing", score, best };
      lastTickTime = performance.now();
    }
  });

  // Keyboard
  function onKey(e: KeyboardEvent): void {
    const map: Record<string, Dir> = {
      ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
      w: "U", s: "D", a: "L", d: "R",
    };
    const d = map[e.key];
    if (d) {
      e.preventDefault();
      queueDir(d);
    }
    if (e.key === "p" || e.key === "Escape") {
      pauseBtn.dispatchEvent(new PointerEvent("pointerup"));
    }
  }
  document.addEventListener("keydown", onKey);

  // D-pad
  dpad.querySelectorAll<HTMLElement>(".dpad-btn").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const d = btn.dataset["dir"] as Dir | undefined;
      if (d) queueDir(d);
    });
  });

  const swipe = makeSwipeHandler(queueDir);
  wrap.addEventListener("touchstart", swipe.onTouchStart, { passive: true });
  wrap.addEventListener("touchend", swipe.onTouchEnd, { passive: true });

  function queueDir(d: Dir): void {
    if (state.phase !== "playing") return;
    const opposites: Record<Dir, Dir> = { U: "D", D: "U", L: "R", R: "L" };
    if (opposites[d] !== dir && d !== nextDir) {
      nextDir = d;
      if ("vibrate" in navigator) navigator.vibrate?.(12);
    }
  }

  // Game loop
  function update(now: number): void {
    if (state.phase === "playing" && now - lastTickTime >= tickMs) {
      lastTickTime = now;
      tick++;
      dir = nextDir;

      const head = snake[0];
      if (!head) return;
      const newHead: Pt = { x: head.x + (dir === "R" ? 1 : dir === "L" ? -1 : 0), y: head.y + (dir === "D" ? 1 : dir === "U" ? -1 : 0) };

      // Wall collision
      if (newHead.x < 0 || newHead.x >= GRID || newHead.y < 0 || newHead.y >= GRID) {
        endGame();
        return;
      }
      // Self collision (skip tail since it will move)
      if (snake.slice(0, -1).some((s) => s.x === newHead.x && s.y === newHead.y)) {
        endGame();
        return;
      }

      snake = [newHead, ...snake];

      if (newHead.x === food.x && newHead.y === food.y) {
        score++;
        if (score > best) best = score;
        tickMs = Math.max(60, BASE_TICK - score * ACCEL_PER_FOOD);
        food = randomFood(snake);
        scoreEl.textContent = String(score);
        bestEl.textContent = String(best);
        state = { phase: "playing", score, best };
        if ("vibrate" in navigator) navigator.vibrate?.(20);
      } else {
        snake = snake.slice(0, -1);
      }
    }

    const cs = cellSize();
    drawGame(ctx, cs, snake, food, state, tick);

    rafId = requestAnimationFrame(update);
  }

  function endGame(): void {
    state = { phase: "gameover", score, best };
    if ("vibrate" in navigator) navigator.vibrate?.([50, 50, 100]);
    void submit("snake", score);
    gameoverOverlay = showGameover(container, score, best, restartGame);
    void computeRank("snake", score).then((rank) => {
      if (!rank || !gameoverOverlay) return;
      const box = gameoverOverlay.querySelector(".snake-gameover-box");
      if (!box) return;
      const existing = box.querySelector(".rank-card");
      if (existing) return;
      const actions = box.querySelector(".snake-go-actions");
      if (!actions) return;
      const card = document.createElement("div");
      card.innerHTML = buildRankCard(rank, "snake");
      const cardEl = card.firstElementChild as HTMLElement | null;
      if (!cardEl) return;
      cardEl.querySelector<HTMLElement>(".rank-card-btn")?.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        navigate("/scores/snake");
      });
      box.insertBefore(cardEl, actions);
    });
  }

  function restartGame(): void {
    snake = initSnake();
    food = randomFood(snake);
    dir = "R";
    nextDir = "R";
    score = 0;
    tick = 0;
    tickMs = BASE_TICK;
    lastTickTime = performance.now();
    scoreEl.textContent = "0";
    state = { phase: "playing", score: 0, best };
    void personalBest("snake").then((b) => {
      best = b;
      bestEl.textContent = String(best);
    });
  }

  lastTickTime = performance.now();
  rafId = requestAnimationFrame(update);

  return function cleanup(): void {
    cancelAnimationFrame(rafId);
    document.removeEventListener("keydown", onKey);
    gameoverOverlay?.remove();
    container.innerHTML = "";
    container.classList.remove("snake-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "snake-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .snake-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #001a00;
      user-select: none;
      -webkit-user-select: none;
    }
    .snake-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-height: 0;
      padding: 8px;
      gap: 8px;
      box-sizing: border-box;
    }
    .snake-hud-actions { display: flex; gap: 8px; }
    .snake-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-width: 400px;
      font-family: monospace;
      font-size: 13px;
      color: #00ff41;
      padding: 4px 8px;
    }
    .snake-hud-scores { display: flex; align-items: center; gap: 6px; }
    .snake-score-label { font-size: 10px; opacity: 0.7; letter-spacing: 1px; }
    .snake-score-val { font-size: 16px; font-weight: bold; min-width: 28px; }
    .snake-pause-btn {
      min-width: 44px; min-height: 44px;
      font-size: 18px;
      border-color: #00ff41;
      color: #00ff41;
      background: transparent;
    }
    .snake-canvas-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      width: 100%;
    }
    .snake-canvas-wrap canvas {
      display: block;
      image-rendering: pixelated;
      border: 1px solid #00ff4133;
      border-radius: 4px;
    }
    .snake-dpad {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding-bottom: 8px;
    }
    .dpad-row {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .dpad-btn {
      width: 52px; height: 52px;
      background: rgba(0,255,65,0.08);
      border: 1px solid rgba(0,255,65,0.3);
      border-radius: 8px;
      font-size: 20px;
      color: #00ff41;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .dpad-btn:active { background: rgba(0,255,65,0.25); }
    .dpad-center { width: 52px; height: 52px; }
    .snake-gameover {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.82);
      z-index: 10;
    }
    .snake-gameover-box {
      text-align: center;
      padding: 32px 24px;
      background: #001a00;
      border: 1px solid #00ff41;
      border-radius: 12px;
      min-width: 220px;
    }
    .snake-go-title {
      margin: 0 0 8px;
      font-family: monospace;
      font-size: 22px;
      color: #ff3333;
      letter-spacing: 3px;
      text-shadow: 0 0 12px #ff3333;
    }
    .snake-go-best-flag {
      color: #f6c24c;
      font-family: monospace;
      font-size: 13px;
      letter-spacing: 2px;
      margin-bottom: 8px;
      text-shadow: 0 0 8px #f6c24c;
    }
    .snake-go-score {
      font-family: monospace;
      font-size: 48px;
      font-weight: bold;
      color: #00ff41;
      text-shadow: 0 0 16px #00ff41;
      line-height: 1;
    }
    .snake-go-label {
      font-family: monospace;
      font-size: 11px;
      color: #008822;
      letter-spacing: 2px;
      margin-bottom: 20px;
    }
    .snake-go-actions { display: flex; gap: 12px; justify-content: center; }
    .snake-go-btn {
      min-width: 100px; min-height: 44px;
      font-family: monospace; font-size: 13px;
      letter-spacing: 1px;
    }
  `;
  document.head.appendChild(style);
}
