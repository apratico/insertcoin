import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { playSfx } from "../../lib/audio.js";

// ---------- constants ----------

const COLS = 8;
const INIT_ROWS = 8;
const BUBBLE_COLORS = ["#e74c3c", "#00bcd4", "#f1c40f", "#2ecc71", "#9b59b6"] as const;
type BubbleColor = (typeof BUBBLE_COLORS)[number];

const HINT_KEY = "bubble-shooter:seenHint";
const ADVANCE_EVERY = 10; // shots before grid scrolls down 1 row
const GAMEOVER_LINE_FRAC = 0.82; // fraction of canvas height

// ---------- types ----------

interface FlyingBubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: BubbleColor;
}

type Phase = "playing" | "paused" | "gameover" | "won";

interface GameState {
  phase: Phase;
  score: number;
  best: number;
  shotCount: number;
  grid: Map<string, BubbleColor>; // key = "col,row"
  flying: FlyingBubble | null;
  currentColor: BubbleColor;
  nextColor: BubbleColor;
  aimAngle: number; // radians, from vertical; clipped to [-1.3, 1.3]
  aiming: boolean;
}

// ---------- hex grid math ----------
// Offset hex grid: even rows aligned, odd rows offset right by half a cell.
// r=0 is top of grid.

function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

function hexNeighbors(col: number, row: number): [number, number][] {
  const offset = row % 2 === 1 ? 1 : 0;
  return [
    [col - 1, row],
    [col + 1, row],
    [col + offset - 1, row - 1],
    [col + offset, row - 1],
    [col + offset - 1, row + 1],
    [col + offset, row + 1],
  ];
}

// Convert grid col/row to canvas pixel center
function bubbleCenter(col: number, row: number, r: number): { x: number; y: number } {
  const xOff = row % 2 === 1 ? r : 0;
  const x = r + col * r * 2 + xOff;
  const y = r + row * r * 1.72;
  return { x, y };
}

// Find nearest grid slot to a canvas point
function nearestSlot(
  px: number, py: number, r: number,
  grid: Map<string, BubbleColor>
): { col: number; row: number } {
  // Search in a reasonable band of rows
  const row = Math.round((py - r) / (r * 1.72));
  const clampedRow = Math.max(0, row);
  let best: { col: number; row: number } = { col: 0, row: clampedRow };
  let bestDist = Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    const tr = clampedRow + dr;
    if (tr < 0) continue;
    const xOff = tr % 2 === 1 ? r : 0;
    const col = Math.round((px - r - xOff) / (r * 2));
    const clamped = Math.max(0, Math.min(COLS - 1, col));
    const c = bubbleCenter(clamped, tr, r);
    const d = Math.hypot(c.x - px, c.y - py);
    // Only consider empty slots
    if (d < bestDist && !grid.has(cellKey(clamped, tr))) {
      bestDist = d;
      best = { col: clamped, row: tr };
    }
  }
  return best;
}

// ---------- grid generation ----------

function randomColor(): BubbleColor {
  return BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)]!;
}

function buildInitialGrid(): Map<string, BubbleColor> {
  const grid = new Map<string, BubbleColor>();
  for (let row = 0; row < INIT_ROWS; row++) {
    const density = 1 - row / INIT_ROWS * 0.4; // 100% at top, 60% at bottom
    for (let col = 0; col < COLS; col++) {
      if (Math.random() < density) {
        grid.set(cellKey(col, row), randomColor());
      }
    }
  }
  return grid;
}

function addTopRow(grid: Map<string, BubbleColor>): void {
  // Shift all rows down by 1
  const entries = Array.from(grid.entries());
  grid.clear();
  for (const [key, color] of entries) {
    const [c, r] = key.split(",").map(Number) as [number, number];
    grid.set(cellKey(c, r + 1), color);
  }
  // Add fresh random row at top (row 0)
  for (let col = 0; col < COLS; col++) {
    grid.set(cellKey(col, 0), randomColor());
  }
}

// ---------- flood fill: find connected same-color group ----------

function findGroup(grid: Map<string, BubbleColor>, startCol: number, startRow: number): Set<string> {
  const color = grid.get(cellKey(startCol, startRow));
  if (!color) return new Set();
  const visited = new Set<string>();
  const queue: [number, number][] = [[startCol, startRow]];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const [col, row] = item;
    const key = cellKey(col, row);
    if (visited.has(key)) continue;
    if (grid.get(key) !== color) continue;
    visited.add(key);
    for (const [nc, nr] of hexNeighbors(col, row)) {
      if (!visited.has(cellKey(nc, nr))) {
        queue.push([nc, nr]);
      }
    }
  }
  return visited;
}

// ---------- orphan detection ----------
// Bubbles not connected (transitively) to row 0 are orphans.

function findOrphans(grid: Map<string, BubbleColor>): Set<string> {
  const anchored = new Set<string>();
  const queue: [number, number][] = [];

  // Seed from row 0
  for (const key of grid.keys()) {
    const [, r] = key.split(",").map(Number) as [number, number];
    if (r === 0) {
      anchored.add(key);
      const [c] = key.split(",").map(Number) as [number, number];
      queue.push([c, 0]);
    }
  }

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const [col, row] = item;
    for (const [nc, nr] of hexNeighbors(col, row)) {
      const nk = cellKey(nc, nr);
      if (!anchored.has(nk) && grid.has(nk)) {
        anchored.add(nk);
        queue.push([nc, nr]);
      }
    }
  }

  const orphans = new Set<string>();
  for (const key of grid.keys()) {
    if (!anchored.has(key)) orphans.add(key);
  }
  return orphans;
}

// ---------- score helpers ----------

function comboMult(size: number): number {
  if (size >= 6) return 3;
  if (size >= 5) return 2;
  if (size >= 4) return 1.5;
  return 1;
}

// ---------- canvas helpers ----------

function drawGlossyBubble(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  color: BubbleColor,
  alpha = 1
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Gloss
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r);
  grad.addColorStop(0, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.1)");
  grad.addColorStop(1, "rgba(0,0,0,0.15)");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.restore();
}

function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  color: string
): void {
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

// Compute aim ray with wall bounces (returns list of points)
function computeAimRay(
  startX: number, startY: number,
  angle: number, // from -pi/2 to pi/2 (0 = straight up)
  canvasW: number,
  maxBounces: number,
  stepLen: number
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [{ x: startX, y: startY }];
  let x = startX;
  let y = startY;
  let vx = Math.sin(angle);
  let vy = -Math.cos(angle); // negative = up
  let dist = 0;
  const maxDist = stepLen;
  let bounces = 0;

  while (dist < maxDist && bounces <= maxBounces && y > 0) {
    const speed = 3;
    x += vx * speed;
    y += vy * speed;
    dist += speed;
    if (x <= 0) { x = 0; vx = Math.abs(vx); bounces++; }
    if (x >= canvasW) { x = canvasW; vx = -Math.abs(vx); bounces++; }
    if (y <= 0) break;
    points.push({ x, y });
  }
  return points;
}

// ---------- rendering ----------

function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasW: number,
  canvasH: number,
  bubbleR: number
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, canvasH);
  bgGrad.addColorStop(0, "#001133");
  bgGrad.addColorStop(1, "#000a1f");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Grid bubbles
  for (const [key, color] of state.grid.entries()) {
    const parts = key.split(",").map(Number) as [number, number];
    const [col, row] = parts;
    const { x, y } = bubbleCenter(col, row, bubbleR);
    drawGlossyBubble(ctx, x, y, bubbleR - 1.5, color);
  }

  // Game over line
  const goLineY = canvasH * GAMEOVER_LINE_FRAC;
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = "rgba(255,60,60,0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, goLineY);
  ctx.lineTo(canvasW, goLineY);
  ctx.stroke();
  ctx.restore();

  // Cannon base
  const cannonX = canvasW / 2;
  const cannonY = canvasH - bubbleR * 3.5;

  // Aim ray
  if (state.phase === "playing") {
    const rayPoints = computeAimRay(
      cannonX, cannonY - bubbleR,
      state.aimAngle, canvasW,
      3, canvasW * 4
    );
    for (let i = 1; i < rayPoints.length; i++) {
      const a = rayPoints[i - 1]!;
      const b = rayPoints[i]!;
      drawDashedLine(ctx, a.x, a.y, b.x, b.y, "#00ccff");
    }
  }

  // Cannon body
  ctx.save();
  ctx.translate(cannonX, cannonY);
  ctx.rotate(state.aimAngle);
  // Barrel
  const bw = bubbleR * 0.65;
  const bh = bubbleR * 2.2;
  ctx.fillStyle = "#334466";
  ctx.beginPath();
  ctx.roundRect(-bw / 2, -bh, bw, bh, bw / 2);
  ctx.fill();
  ctx.strokeStyle = "#5588cc";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Cannon platform
  ctx.fillStyle = "#2a3a5a";
  ctx.beginPath();
  ctx.ellipse(cannonX, cannonY, bubbleR * 1.4, bubbleR * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#4466aa";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Current bubble on cannon tip
  const tipX = cannonX + Math.sin(state.aimAngle) * bh;
  const tipY = cannonY - Math.cos(state.aimAngle) * bh;
  if (!state.flying) {
    drawGlossyBubble(ctx, tipX, tipY, bubbleR - 2, state.currentColor);
  }

  // Next bubble preview (small, bottom-left)
  const prevX = canvasW * 0.15;
  const prevY = canvasH - bubbleR * 1.8;
  ctx.save();
  ctx.font = `${Math.round(bubbleR * 0.65)}px monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.textAlign = "center";
  ctx.fillText("NEXT", prevX, prevY - bubbleR * 1.1);
  ctx.restore();
  drawGlossyBubble(ctx, prevX, prevY, bubbleR * 0.75, state.nextColor);

  // Flying bubble
  if (state.flying) {
    drawGlossyBubble(ctx, state.flying.x, state.flying.y, bubbleR - 2, state.flying.color);
  }

  // Paused overlay
  if (state.phase === "paused") {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = "#00ccff";
    ctx.font = `bold ${Math.round(canvasH * 0.07)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", canvasW / 2, canvasH / 2);
    ctx.textAlign = "left";
  }
}

// ---------- HUD ----------

function buildHUD(container: HTMLElement): {
  scoreEl: HTMLElement;
  bestEl: HTMLElement;
  pauseBtn: HTMLButtonElement;
  fsBtn: HTMLButtonElement;
  hud: HTMLElement;
} {
  const hud = document.createElement("div");
  hud.className = "bs-hud";
  hud.innerHTML = `
    <div class="bs-hud-scores">
      <span class="bs-label">SCORE</span>
      <span class="bs-val" id="bs-score">0</span>
      <span class="bs-label" style="margin-left:14px">BEST</span>
      <span class="bs-val" id="bs-best">0</span>
    </div>
    <div class="bs-hud-actions">
      <button class="btn bs-btn" id="bs-fs" aria-label="Fullscreen">⛶</button>
      <button class="btn bs-btn" id="bs-pause" aria-label="Pause">⏸</button>
    </div>
  `;
  container.appendChild(hud);
  return {
    hud,
    scoreEl: hud.querySelector("#bs-score") as HTMLElement,
    bestEl: hud.querySelector("#bs-best") as HTMLElement,
    pauseBtn: hud.querySelector("#bs-pause") as HTMLButtonElement,
    fsBtn: hud.querySelector("#bs-fs") as HTMLButtonElement,
  };
}

// ---------- end-game overlay ----------

function showEndOverlay(
  container: HTMLElement,
  phase: "gameover" | "won",
  score: number,
  best: number,
  onReplay: () => void
): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "bs-end-overlay";
  const isWin = phase === "won";
  const isBest = score >= best && score > 0;
  overlay.innerHTML = `
    <div class="bs-end-box">
      <h2 class="bs-end-title" style="color:${isWin ? "#2ecc71" : "#e74c3c"}">${isWin ? "YOU WIN!" : "GAME OVER"}</h2>
      ${isBest ? `<div class="bs-end-best">NEW BEST!</div>` : ""}
      <div class="bs-end-score">${score}</div>
      <div class="bs-end-label">SCORE</div>
      <div class="bs-end-actions">
        <button class="btn primary bs-end-btn" id="bs-replay">PLAY AGAIN</button>
        <button class="btn bs-end-btn" id="bs-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);
  overlay.querySelector("#bs-replay")?.addEventListener("pointerup", () => {
    overlay.remove();
    onReplay();
  });
  overlay.querySelector("#bs-menu")?.addEventListener("pointerup", () => {
    navigate("/");
  });
  return overlay;
}

// ---------- hint overlay ----------

function buildHintOverlay(): HTMLElement {
  const hint = document.createElement("div");
  hint.className = "bs-hint";
  hint.innerHTML = `
    <div class="bs-hint-box">
      <div class="bs-hint-title">AIM AND SHOOT</div>
      <div class="bs-hint-sub">Match 3+ same color to pop.</div>
    </div>
  `;
  return hint;
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "bs-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .bubble-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #001133;
      user-select: none;
      -webkit-user-select: none;
    }
    .bs-wrap {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      align-items: center;
      padding: 4px;
      box-sizing: border-box;
    }
    .bs-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-width: 440px;
      padding: 4px 8px;
      font-family: monospace;
      font-size: 12px;
      color: #00ccff;
      flex-shrink: 0;
    }
    .bs-hud-scores { display: flex; align-items: center; gap: 5px; }
    .bs-label { font-size: 10px; opacity: 0.65; letter-spacing: 1px; }
    .bs-val { font-size: 15px; font-weight: bold; min-width: 24px; }
    .bs-hud-actions { display: flex; gap: 6px; }
    .bs-btn {
      min-width: 44px; min-height: 44px;
      font-size: 17px;
      border-color: #00ccff;
      color: #00ccff;
      background: transparent;
    }
    .bs-canvas-wrap {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      max-width: 440px;
    }
    .bs-canvas-wrap canvas {
      display: block;
      touch-action: none;
    }
    .bs-end-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.80);
      z-index: 10;
    }
    .bs-end-box {
      text-align: center;
      padding: 32px 24px;
      background: #001133;
      border: 1px solid #00ccff;
      border-radius: 12px;
      min-width: 220px;
    }
    .bs-end-title {
      margin: 0 0 8px;
      font-family: monospace;
      font-size: 22px;
      letter-spacing: 3px;
      text-shadow: 0 0 12px currentColor;
    }
    .bs-end-best {
      color: #f1c40f;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 2px;
      margin-bottom: 6px;
      text-shadow: 0 0 8px #f1c40f;
    }
    .bs-end-score {
      font-family: monospace;
      font-size: 48px;
      font-weight: bold;
      color: #00ccff;
      text-shadow: 0 0 14px #00ccff;
      line-height: 1;
    }
    .bs-end-label {
      font-family: monospace;
      font-size: 10px;
      color: #336688;
      letter-spacing: 2px;
      margin-bottom: 20px;
    }
    .bs-end-actions { display: flex; gap: 12px; justify-content: center; }
    .bs-end-btn { min-width: 100px; min-height: 44px; font-family: monospace; font-size: 13px; }
    .bs-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 8;
    }
    .bs-hint-box {
      background: rgba(0,17,51,0.88);
      border: 1px solid #00ccff44;
      border-radius: 10px;
      padding: 18px 28px;
      text-align: center;
      color: #fff;
      font-family: monospace;
    }
    .bs-hint-title { font-size: 18px; font-weight: bold; color: #00ccff; letter-spacing: 2px; margin-bottom: 6px; }
    .bs-hint-sub { font-size: 13px; color: rgba(255,255,255,0.7); }
  `;
  document.head.appendChild(style);
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("bubble-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  const wrap = document.createElement("div");
  wrap.className = "bs-wrap";
  container.appendChild(wrap);

  const { scoreEl, bestEl, pauseBtn, fsBtn } = buildHUD(wrap);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "bs-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvasWrap.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  // Mutable layout metrics (set by resize)
  let canvasW = 0;
  let canvasH = 0;
  let bubbleR = 20;
  let cannonY = 0;
  let stateReady = false;

  // ---------- game state ----------

  let state: GameState = makeInitialState(0);
  let rafId = 0;
  let endOverlay: HTMLElement | null = null;
  let hintOverlay: HTMLElement | null = null;
  let hintTimer = 0;

  function makeInitialState(best: number): GameState {
    return {
      phase: "playing",
      score: 0,
      best,
      shotCount: 0,
      grid: buildInitialGrid(),
      flying: null,
      currentColor: randomColor(),
      nextColor: randomColor(),
      aimAngle: 0,
      aiming: false,
    };
  }

  // ---------- resize ----------

  function onAfterResize(): void {
    if (!stateReady) return;
    render(ctx, state, canvasW, canvasH, bubbleR);
  }

  const ro = new ResizeObserver(() => {
    const cw = canvasWrap.clientWidth;
    const ch = canvasWrap.clientHeight;
    if (cw < 8 || ch < 8) return;

    const dpr = window.devicePixelRatio || 1;
    // Fit portrait: width drives column spacing, height drives rows
    const maxW = Math.min(cw, 440);
    const rFromW = maxW / (COLS * 2 + 1);
    const rFromH = ch / (INIT_ROWS * 1.72 + 6);
    bubbleR = Math.floor(Math.min(rFromW, rFromH, 24));
    if (bubbleR < 8) bubbleR = 8;

    const w = bubbleR * (COLS * 2 + 1);
    const h = ch;
    canvasW = w;
    canvasH = h;
    cannonY = h - bubbleR * 3.5;

    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onAfterResize();
  });
  ro.observe(canvasWrap);

  // ---------- physics ----------

  const BUBBLE_SPEED = 10; // px per frame at 60fps

  function shoot(): void {
    if (state.flying || state.phase !== "playing") return;
    const cx = canvasW / 2;
    const speed = BUBBLE_SPEED;
    state.flying = {
      x: cx + Math.sin(state.aimAngle) * bubbleR * 2,
      y: cannonY - Math.cos(state.aimAngle) * bubbleR * 2,
      vx: Math.sin(state.aimAngle) * speed,
      vy: -Math.cos(state.aimAngle) * speed,
      color: state.currentColor,
    };
    state.shotCount++;
    playSfx("shoot");
    if ("vibrate" in navigator) navigator.vibrate(6);
    dismissHint();
  }

  function stepFlyingBubble(): void {
    const fb = state.flying;
    if (!fb) return;

    fb.x += fb.vx;
    fb.y += fb.vy;

    // Wall bounce
    if (fb.x - bubbleR < 0) {
      fb.x = bubbleR;
      fb.vx = Math.abs(fb.vx);
    } else if (fb.x + bubbleR > canvasW) {
      fb.x = canvasW - bubbleR;
      fb.vx = -Math.abs(fb.vx);
    }

    // Top wall: stick
    if (fb.y - bubbleR <= 0) {
      fb.y = bubbleR;
      landBubble(fb);
      return;
    }

    // Check collision with grid bubbles
    for (const [key] of state.grid.entries()) {
      const [col, row] = key.split(",").map(Number) as [number, number];
      const { x, y } = bubbleCenter(col, row, bubbleR);
      if (Math.hypot(fb.x - x, fb.y - y) < bubbleR * 1.8) {
        landBubble(fb);
        return;
      }
    }
  }

  function landBubble(fb: FlyingBubble): void {
    const slot = nearestSlot(fb.x, fb.y, bubbleR, state.grid);
    const key = cellKey(slot.col, slot.row);
    if (state.grid.has(key)) {
      // Try to find adjacent empty slot
      const neighbors = hexNeighbors(slot.col, slot.row);
      let placed = false;
      let minDist = Infinity;
      let bestSlot = slot;
      for (const [nc, nr] of neighbors) {
        if (nr < 0) continue;
        const nk = cellKey(nc, nr);
        if (!state.grid.has(nk)) {
          const { x, y } = bubbleCenter(nc, nr, bubbleR);
          const d = Math.hypot(fb.x - x, fb.y - y);
          if (d < minDist) { minDist = d; bestSlot = { col: nc, row: nr }; placed = true; }
        }
      }
      if (placed) {
        state.grid.set(cellKey(bestSlot.col, bestSlot.row), fb.color);
        popAndScore(bestSlot.col, bestSlot.row);
      }
    } else {
      state.grid.set(key, fb.color);
      popAndScore(slot.col, slot.row);
    }

    state.flying = null;
    state.currentColor = state.nextColor;
    state.nextColor = randomColor();

    // Advance grid every ADVANCE_EVERY shots
    if (state.shotCount > 0 && state.shotCount % ADVANCE_EVERY === 0) {
      addTopRow(state.grid);
    }

    checkGameOver();
    checkWin();

    // Advance HUD score display
    scoreEl.textContent = String(state.score);
    if (state.score > state.best) {
      state.best = state.score;
      bestEl.textContent = String(state.best);
    }
  }

  function popAndScore(col: number, row: number): void {
    const group = findGroup(state.grid, col, row);
    if (group.size < 3) return;

    // Pop group
    const mult = comboMult(group.size);
    state.score += Math.round(group.size * 10 * mult);
    for (const k of group) state.grid.delete(k);

    playSfx("pop");
    if ("vibrate" in navigator) navigator.vibrate(Math.min(50, 15 + group.size * 2));

    // Drop orphans
    const orphans = findOrphans(state.grid);
    if (orphans.size > 0) {
      state.score += orphans.size * 5;
      for (const k of orphans) state.grid.delete(k);
      if ("vibrate" in navigator) navigator.vibrate(10);
    }
  }

  function checkGameOver(): void {
    if (state.phase !== "playing") return;
    const goLineY = canvasH * GAMEOVER_LINE_FRAC;
    for (const [key] of state.grid.entries()) {
      const [col, row] = key.split(",").map(Number) as [number, number];
      const { y } = bubbleCenter(col, row, bubbleR);
      if (y + bubbleR > goLineY) {
        triggerEnd("gameover");
        return;
      }
    }
  }

  function checkWin(): void {
    if (state.phase !== "playing") return;
    if (state.grid.size === 0) {
      triggerEnd("won");
    }
  }

  function triggerEnd(phase: "gameover" | "won"): void {
    state.phase = phase;
    void submit("bubble-shooter", state.score);
    if (phase === "won") {
      playSfx("win");
      if ("vibrate" in navigator) navigator.vibrate([30, 60, 30, 60, 100]);
    } else {
      playSfx("gameover");
      if ("vibrate" in navigator) navigator.vibrate([50, 50, 100]);
    }
    endOverlay = showEndOverlay(container, phase, state.score, state.best, restartGame);
  }

  function restartGame(): void {
    endOverlay?.remove();
    endOverlay = null;
    const best = state.best;
    state = makeInitialState(best);
    void personalBest("bubble-shooter").then((b) => {
      if (b > state.best) {
        state.best = b;
        bestEl.textContent = String(b);
      }
    });
    scoreEl.textContent = "0";
  }

  // ---------- input ----------

  function angleFromPointer(clientX: number, clientY: number): number {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (canvasW / rect.width);
    const py = (clientY - rect.top) * (canvasH / rect.height);
    const cx = canvasW / 2;
    const cy = cannonY;
    const dx = px - cx;
    const dy = py - cy;
    const angle = Math.atan2(dx, -dy); // 0 = up
    return Math.max(-1.3, Math.min(1.3, angle));
  }

  function onPointerDown(e: PointerEvent): void {
    if (state.phase !== "playing") return;
    e.preventDefault();
    state.aiming = true;
    state.aimAngle = angleFromPointer(e.clientX, e.clientY);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!state.aiming || state.phase !== "playing") return;
    state.aimAngle = angleFromPointer(e.clientX, e.clientY);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!state.aiming || state.phase !== "playing") return;
    state.aiming = false;
    state.aimAngle = angleFromPointer(e.clientX, e.clientY);
    shoot();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", () => { state.aiming = false; });

  // Pause
  pauseBtn.addEventListener("pointerup", () => {
    if (state.phase === "playing") state.phase = "paused";
    else if (state.phase === "paused") state.phase = "playing";
  });

  // Fullscreen
  fsBtn.addEventListener("pointerup", () => {
    const target = (container.closest(".game-host") as HTMLElement | null) ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen().catch(() => {});
    }
  });

  // ---------- hint ----------

  function dismissHint(): void {
    if (!hintOverlay) return;
    hintOverlay.remove();
    hintOverlay = null;
    clearTimeout(hintTimer);
    void db.settings.put({ key: HINT_KEY, value: "1" });
  }

  async function maybeShowHint(): Promise<void> {
    const row = await db.settings.get(HINT_KEY);
    if (row) return;
    hintOverlay = buildHintOverlay();
    container.appendChild(hintOverlay);
    hintTimer = window.setTimeout(dismissHint, 5000);
  }

  // ---------- game loop ----------

  function loop(): void {
    if (state.phase === "playing") {
      stepFlyingBubble();
    }
    if (canvasW > 0 && canvasH > 0) {
      render(ctx, state, canvasW, canvasH, bubbleR);
    }
    rafId = requestAnimationFrame(loop);
  }

  // ---------- init ----------

  void personalBest("bubble-shooter").then((b) => {
    state.best = b;
    bestEl.textContent = String(b);
    stateReady = true;
    // Trigger a resize render now that state is known
    onAfterResize();
  });

  void maybeShowHint();

  rafId = requestAnimationFrame(loop);

  return function cleanup(): void {
    cancelAnimationFrame(rafId);
    clearTimeout(hintTimer);
    ro.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    endOverlay?.remove();
    hintOverlay?.remove();
    container.innerHTML = "";
    container.classList.remove("bubble-root");
    container.style.touchAction = prevTouchAction;
  };
}
