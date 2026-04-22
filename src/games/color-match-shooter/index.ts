import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";

// ---------- types ----------

type Phase = "playing" | "gameover" | "paused";
type EnemyColor = "red" | "cyan" | "yellow";
type EnemyShape = "circle" | "square" | "triangle";

interface Enemy {
  x: number;
  y: number;
  vy: number;
  color: EnemyColor;
  shape: EnemyShape;
  alive: boolean;
  flashT: number; // wrong-color pass-through flash timer (0..1)
}

interface Bullet {
  x: number;
  y: number;
  vy: number;
  color: EnemyColor;
  alive: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;   // 1..0
  decay: number;  // life lost per second
  color: string;
  alive: boolean;
}

// ---------- constants ----------

const COLORS: Record<EnemyColor, { fill: string; glow: string }> = {
  red:    { fill: "#ff3333", glow: "#ff0000" },
  cyan:   { fill: "#00eeff", glow: "#00aaff" },
  yellow: { fill: "#ffe600", glow: "#ffcc00" },
};

const COLOR_ORDER: EnemyColor[] = ["red", "cyan", "yellow"];

const ENEMY_RADIUS    = 14;
const BULLET_W        = 6;
const BULLET_H        = 14;
const BULLET_SPEED    = 540;   // px/s upward
const SPAWN_INTERVAL_BASE = 1200; // ms
const SPAWN_INTERVAL_MIN  = 400;  // ms
const SPEED_BASE      = 80;    // px/s
const SPEED_INC_RATE  = 0.08;  // +8% per 10 s
const STAGE_DURATION  = 30000; // ms
const DT_CAP          = 32;    // ms max dt
const COMBO_WINDOW    = 1500;  // ms before combo resets
const AUTO_FIRE_HOLD  = 200;   // ms hold before auto-fire
const AUTO_FIRE_RATE  = 200;   // ms between auto-fire shots
const SHAKE_DUR       = 120;   // ms
const PARTICLE_COUNT  = 10;

// ---------- object pools ----------

function makeEnemy(): Enemy {
  return { x: 0, y: 0, vy: 0, color: "red", shape: "circle", alive: false, flashT: 0 };
}
function makeBullet(): Bullet {
  return { x: 0, y: 0, vy: 0, color: "red", alive: false };
}
function makeParticle(): Particle {
  return { x: 0, y: 0, vx: 0, vy: 0, life: 1, decay: 3.33, color: "#fff", alive: false };
}

function pool<T extends { alive: boolean }>(arr: T[], factory: () => T): T {
  for (let i = 0; i < arr.length; i++) {
    if (!arr[i]!.alive) return arr[i]!;
  }
  const obj = factory();
  arr.push(obj);
  return obj;
}

// ---------- helpers ----------

function vibrate(pattern: number | number[]): void {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

// ---------- styles ----------

function injectStyles(): void {
  const styleId = "hb-styles";
  if (document.getElementById(styleId)) return;
  const s = document.createElement("style");
  s.id = styleId;
  s.textContent = `
    .hue-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #0a0a2a;
      user-select: none;
      -webkit-user-select: none;
      position: relative;
    }
    .hb-wrap {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .hb-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 10px;
      font-family: monospace;
      color: #fff;
      background: rgba(0,0,0,0.45);
      flex-shrink: 0;
      gap: 4px;
    }
    .hb-hud-left, .hb-hud-right {
      display: flex;
      flex-direction: column;
      min-width: 56px;
    }
    .hb-hud-right { align-items: flex-end; }
    .hb-hud-center { text-align: center; }
    .hb-hud-label { font-size: 8px; opacity: 0.55; letter-spacing: 1px; }
    .hb-hud-val { font-size: 14px; font-weight: bold; line-height: 1.2; }
    .hb-ctrl-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      padding: 3px 10px;
      flex-shrink: 0;
    }
    .hb-hp {
      flex: 1;
      font-size: 18px;
      letter-spacing: 2px;
    }
    .hb-btn {
      min-width: 44px;
      min-height: 44px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 6px;
      color: #fff;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hb-canvas-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }
    .hb-canvas-wrap canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    .hb-combo {
      position: absolute;
      bottom: 8px;
      left: 50%;
      transform: translateX(-50%);
      font-family: monospace;
      font-size: 22px;
      font-weight: bold;
      color: #ffe600;
      text-shadow: 0 0 14px #ffe600;
      letter-spacing: 3px;
      pointer-events: none;
      z-index: 5;
      white-space: nowrap;
      animation: hb-combo-pop 0.35s ease-out;
    }
    @keyframes hb-combo-pop {
      0%   { transform: translateX(-50%) scale(1.5); }
      100% { transform: translateX(-50%) scale(1); }
    }
    .hb-color-bar {
      display: flex;
      flex-direction: row;
      justify-content: center;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      padding-bottom: max(8px, env(safe-area-inset-bottom, 8px));
      background: rgba(0,0,0,0.55);
      flex-shrink: 0;
    }
    .hb-color-btn {
      flex: 1;
      max-width: 100px;
      min-width: 72px;
      height: 56px;
      border-radius: 10px;
      border: 3px solid transparent;
      cursor: pointer;
      font-family: monospace;
      font-size: 11px;
      font-weight: bold;
      color: #000;
      letter-spacing: 1px;
      transition: transform 0.08s ease, box-shadow 0.1s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-tap-highlight-color: transparent;
    }
    .hb-color-btn[data-color="red"]    { background: #ff3333; }
    .hb-color-btn[data-color="cyan"]   { background: #00eeff; }
    .hb-color-btn[data-color="yellow"] { background: #ffe600; }
    .hb-color-btn.active {
      border-color: #ffffff;
      transform: scale(1.08);
      animation: hb-glow-pulse 1s ease-in-out infinite alternate;
    }
    .hb-color-btn[data-color="red"].active    { box-shadow: 0 0 18px 4px #ff3333; animation-name: hb-glow-red; }
    .hb-color-btn[data-color="cyan"].active   { box-shadow: 0 0 18px 4px #00eeff; animation-name: hb-glow-cyan; }
    .hb-color-btn[data-color="yellow"].active { box-shadow: 0 0 18px 4px #ffe600; animation-name: hb-glow-yellow; }
    @keyframes hb-glow-red    { from { box-shadow: 0 0 12px 2px #ff3333; } to { box-shadow: 0 0 24px 8px #ff3333; } }
    @keyframes hb-glow-cyan   { from { box-shadow: 0 0 12px 2px #00eeff; } to { box-shadow: 0 0 24px 8px #00eeff; } }
    @keyframes hb-glow-yellow { from { box-shadow: 0 0 12px 2px #ffe600; } to { box-shadow: 0 0 24px 8px #ffe600; } }
    .hb-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.82);
      z-index: 10;
    }
    .hb-go-box {
      text-align: center;
      padding: 28px 22px;
      background: #0a0a2a;
      border: 1px solid #22ffaa;
      border-radius: 12px;
      min-width: 230px;
      max-width: 310px;
      width: 88%;
    }
    .hb-go-title {
      margin: 0 0 8px;
      font-family: monospace;
      font-size: 22px;
      color: #22ffaa;
      letter-spacing: 3px;
      text-shadow: 0 0 12px #22ffaa;
    }
    .hb-go-best-flag {
      font-family: monospace;
      font-size: 11px;
      color: #ffe600;
      letter-spacing: 2px;
      text-shadow: 0 0 8px #ffe600;
      margin-bottom: 6px;
    }
    .hb-go-score {
      font-family: monospace;
      font-size: 48px;
      font-weight: bold;
      color: #ffffff;
      text-shadow: 0 0 16px #22ffaa;
      line-height: 1;
    }
    .hb-go-label {
      font-family: monospace;
      font-size: 9px;
      color: rgba(255,255,255,0.45);
      letter-spacing: 2px;
      margin-bottom: 8px;
    }
    .hb-go-stats {
      display: flex;
      gap: 14px;
      justify-content: center;
      font-family: monospace;
      font-size: 10px;
      color: rgba(255,255,255,0.6);
      margin-bottom: 14px;
    }
    .hb-go-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin-top: 14px;
    }
    .hb-go-btn {
      min-width: 96px;
      min-height: 44px;
      font-family: monospace;
      font-size: 11px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 8px;
      color: #fff;
      cursor: pointer;
      letter-spacing: 1px;
    }
    .hb-go-btn.primary {
      background: #22ffaa;
      color: #000;
      border-color: #22ffaa;
      font-weight: bold;
    }
    .hb-rank-card {
      margin: 10px 0;
      padding: 8px 12px;
      background: rgba(34,255,170,0.1);
      border: 1px solid rgba(34,255,170,0.3);
      border-radius: 8px;
    }
    .hb-rank-title { font-family: monospace; font-size: 10px; color: #22ffaa; letter-spacing: 1px; }
    .hb-rank-delta { font-family: monospace; font-size: 9px; color: rgba(255,255,255,0.65); margin-top: 3px; }
    .hb-rank-lb-btn { margin-top: 6px; min-height: 34px; font-size: 9px; }
    .hb-paused {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.6);
      z-index: 8;
      font-family: monospace;
      font-size: 28px;
      font-weight: bold;
      color: #fff;
      letter-spacing: 4px;
      pointer-events: none;
    }
    .hb-hint {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 7;
      pointer-events: none;
    }
    .hb-hint-title {
      font-family: monospace;
      font-size: 18px;
      font-weight: bold;
      color: #fff;
      letter-spacing: 2px;
      text-shadow: 0 0 12px #22ffaa;
      text-align: center;
      padding: 0 16px;
    }
    .hb-hint-sub {
      font-family: monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.65);
      letter-spacing: 1px;
      margin-top: 8px;
      text-align: center;
    }
    .hb-hint-btns {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }
    .hb-hint-btn {
      width: 52px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: monospace;
      font-size: 9px;
      font-weight: bold;
      color: #000;
      animation: hb-hint-pulse 0.6s ease-in-out infinite alternate;
    }
    .hb-hint-btn:nth-child(1) { background: #ff3333; animation-delay: 0s; }
    .hb-hint-btn:nth-child(2) { background: #00eeff; animation-delay: 0.2s; }
    .hb-hint-btn:nth-child(3) { background: #ffe600; animation-delay: 0.4s; }
    @keyframes hb-hint-pulse {
      from { transform: scale(0.9); opacity: 0.7; }
      to   { transform: scale(1.1); opacity: 1; }
    }
    .hb-stage-banner {
      position: absolute;
      top: 30%;
      left: 50%;
      transform: translateX(-50%);
      font-family: monospace;
      font-size: 24px;
      font-weight: bold;
      color: #22ffaa;
      text-shadow: 0 0 18px #22ffaa;
      letter-spacing: 3px;
      pointer-events: none;
      z-index: 6;
      text-align: center;
      white-space: nowrap;
    }
    .hb-stage-banner .hb-stage-sub {
      font-size: 13px;
      color: rgba(255,255,255,0.75);
      margin-top: 6px;
    }
  `;
  document.head.appendChild(s);
}

// ---------- build HUD ----------

interface HUD {
  scoreEl: HTMLElement;
  bestEl: HTMLElement;
  stageEl: HTMLElement;
  hpEl: HTMLElement;
  comboEl: HTMLElement;
  pauseBtn: HTMLElement;
  fsBtn: HTMLElement;
  colorBtns: HTMLElement[];
  canvasWrap: HTMLElement;
}

function buildLayout(container: HTMLElement): HUD {
  const wrap = document.createElement("div");
  wrap.className = "hb-wrap";
  container.appendChild(wrap);

  // Top HUD row
  const hud = document.createElement("div");
  hud.className = "hb-hud";
  hud.innerHTML = `
    <div class="hb-hud-left">
      <span class="hb-hud-label">SCORE</span>
      <span class="hb-hud-val" id="hb-score">0</span>
    </div>
    <div class="hb-hud-center">
      <span class="hb-hud-val" id="hb-stage">STAGE 1</span>
    </div>
    <div class="hb-hud-right">
      <span class="hb-hud-label">BEST</span>
      <span class="hb-hud-val" id="hb-best">0</span>
    </div>
  `;
  wrap.appendChild(hud);

  // Controls row (HP + pause/fs)
  const ctrlRow = document.createElement("div");
  ctrlRow.className = "hb-ctrl-row";
  ctrlRow.innerHTML = `
    <span class="hb-hp" id="hb-hp">&#10084;&#10084;&#10084;</span>
    <button class="hb-btn" id="hb-fs" aria-label="Fullscreen">&#9638;</button>
    <button class="hb-btn" id="hb-pause" aria-label="Pause">&#9646;&#9646;</button>
  `;
  wrap.appendChild(ctrlRow);

  // Canvas area
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "hb-canvas-wrap";
  wrap.appendChild(canvasWrap);

  // Combo display (inside canvas area)
  const comboEl = document.createElement("div");
  comboEl.className = "hb-combo";
  comboEl.style.display = "none";
  canvasWrap.appendChild(comboEl);

  // Color bar (bottom)
  const colorBar = document.createElement("div");
  colorBar.className = "hb-color-bar";
  colorBar.innerHTML = `
    <button class="hb-color-btn active" data-color="red">RED</button>
    <button class="hb-color-btn" data-color="cyan">CYAN</button>
    <button class="hb-color-btn" data-color="yellow">YELLOW</button>
  `;
  wrap.appendChild(colorBar);

  const colorBtns = Array.from(colorBar.querySelectorAll<HTMLElement>(".hb-color-btn"));

  return {
    scoreEl:  hud.querySelector<HTMLElement>("#hb-score")!,
    bestEl:   hud.querySelector<HTMLElement>("#hb-best")!,
    stageEl:  hud.querySelector<HTMLElement>("#hb-stage")!,
    hpEl:     ctrlRow.querySelector<HTMLElement>("#hb-hp")!,
    comboEl,
    pauseBtn: ctrlRow.querySelector<HTMLElement>("#hb-pause")!,
    fsBtn:    ctrlRow.querySelector<HTMLElement>("#hb-fs")!,
    colorBtns,
    canvasWrap,
  };
}

// ---------- render helpers ----------

function drawBackground(ctx: CanvasRenderingContext2D, cw: number, ch: number, gridPulse: number): void {
  const grad = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
  grad.addColorStop(0, "#14143a");
  grad.addColorStop(1, "#0a0a2a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  const a = 0.04 + gridPulse * 0.1;
  ctx.strokeStyle = `rgba(80,80,200,${a})`;
  ctx.lineWidth = 0.5;
  const step = 36;
  for (let x = 0; x < cw; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
  }
  for (let y = 0; y < ch; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, cx: number, cy: number, activeColor: EnemyColor): void {
  const col = COLORS[activeColor];
  ctx.save();

  // Body
  ctx.shadowBlur = 16;
  ctx.shadowColor = col.glow;
  ctx.strokeStyle = col.fill;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#0d0d2a";
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fill();

  // Cannon barrel (pointing up)
  ctx.fillStyle = col.fill;
  ctx.shadowColor = col.glow;
  ctx.shadowBlur = 10;
  ctx.fillRect(cx - 3, cy - 22, 6, 14);

  // Nozzle tip
  ctx.beginPath();
  ctx.arc(cx, cy - 22, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy): void {
  const col = COLORS[e.color];
  const flashAlpha = e.flashT > 0 ? e.flashT * 0.7 : 0;
  const fillColor = flashAlpha > 0
    ? `rgba(255,255,255,${0.3 + flashAlpha * 0.5})`
    : col.fill;

  ctx.save();
  ctx.shadowBlur = 12;
  ctx.shadowColor = col.glow;
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = col.fill;
  ctx.lineWidth = 1.5;

  const r = ENEMY_RADIUS;
  if (e.shape === "circle") {
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.shape === "square") {
    ctx.beginPath();
    ctx.rect(e.x - r, e.y - r, r * 2, r * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - r);
    ctx.lineTo(e.x + r * 0.866, e.y + r * 0.5);
    ctx.lineTo(e.x - r * 0.866, e.y + r * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBullet(ctx: CanvasRenderingContext2D, b: Bullet): void {
  const col = COLORS[b.color];
  ctx.save();
  ctx.shadowBlur = 10;
  ctx.shadowColor = col.glow;
  ctx.fillStyle = col.fill;
  ctx.beginPath();
  ctx.roundRect(b.x - BULLET_W / 2, b.y - BULLET_H, BULLET_W, BULLET_H, 3);
  ctx.fill();
  // trail
  ctx.globalAlpha = 0.3;
  ctx.fillRect(b.x - 2, b.y, 4, 8);
  ctx.restore();
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  ctx.globalAlpha = p.life;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3 * p.life, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------- gameover overlay ----------

function buildRankCard(rank: RankInfo, gameId: string): string {
  const label = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const delta = rank.toBeat
    ? `<div class="hb-rank-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta} pts</div>`
    : "";
  return `<div class="hb-rank-card">
    <div class="hb-rank-title">RANK ${label} GLOBAL</div>
    ${delta}
    <button class="hb-go-btn hb-rank-lb-btn" data-lb="${gameId}">VIEW LEADERBOARD</button>
  </div>`;
}

function showGameover(
  container: HTMLElement,
  score: number,
  best: number,
  stage: number,
  shots: number,
  kills: number,
  onReplay: () => void,
  rankInfo?: RankInfo
): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "hb-overlay";
  const isNewBest = score >= best && score > 0;
  const accuracy = shots > 0 ? Math.round((kills / shots) * 100) : 0;
  const rankHtml = rankInfo ? buildRankCard(rankInfo, "color-match-shooter") : "";
  overlay.innerHTML = `
    <div class="hb-go-box">
      <h2 class="hb-go-title">GAME OVER</h2>
      ${isNewBest ? `<div class="hb-go-best-flag">NEW BEST!</div>` : ""}
      <div class="hb-go-score">${score}</div>
      <div class="hb-go-label">SCORE</div>
      <div class="hb-go-stats">
        <span>STAGE ${stage}</span>
        <span>ACC ${accuracy}%</span>
      </div>
      ${rankHtml}
      <div class="hb-go-actions">
        <button class="hb-go-btn primary" id="hb-replay">PLAY AGAIN</button>
        <button class="hb-go-btn" id="hb-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector<HTMLElement>("[data-lb]")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    navigate("/scores/color-match-shooter");
  });
  overlay.querySelector("#hb-replay")?.addEventListener("pointerup", () => {
    overlay.remove();
    onReplay();
  });
  overlay.querySelector("#hb-menu")?.addEventListener("pointerup", () => {
    navigate("/");
  });
  return overlay;
}

// ---------- hint ----------

function showHint(container: HTMLElement, onDismiss: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "hb-hint";
  el.innerHTML = `
    <div class="hb-hint-title">SHOOT MATCHING COLORS</div>
    <div class="hb-hint-sub">Pick the color. Tap to fire.</div>
    <div class="hb-hint-btns">
      <div class="hb-hint-btn">RED</div>
      <div class="hb-hint-btn">CYAN</div>
      <div class="hb-hint-btn">YEL</div>
    </div>
  `;
  container.appendChild(el);
  const t = window.setTimeout(() => {
    el.remove();
    onDismiss();
  }, 5000);
  el.dataset["timer"] = String(t);
  return el;
}

// ---------- HP rendering ----------

function renderHP(el: HTMLElement, hp: number): void {
  el.innerHTML = "&#10084;".repeat(Math.max(0, hp)) + '<span style="opacity:0.2">&#10084;</span>'.repeat(Math.max(0, 5 - hp));
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("hue-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  const hud = buildLayout(container);
  const { scoreEl, bestEl, stageEl, hpEl, comboEl, pauseBtn, fsBtn, colorBtns, canvasWrap } = hud;

  // Create canvas
  const canvas = document.createElement("canvas");
  canvas.className = "game-canvas";
  canvasWrap.insertBefore(canvas, canvasWrap.firstChild);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx: CanvasRenderingContext2D = ctxRaw;

  // ---------- game state ----------
  let cw = 0, ch = 0;
  let dpr = 1;
  let playerX = 0, playerY = 0;

  let phase: Phase = "playing";
  let score = 0;
  let best = 0;
  let hp = 3;
  let stage = 1;
  let stageTimer = STAGE_DURATION;    // ms remaining in current stage
  let elapsedMs = 0;                  // total ms played

  let activeColor: EnemyColor = "red";
  let shots = 0;
  let kills = 0;

  let comboCount = 0;
  let comboTimer = 0;

  let gridPulse = 0;
  let shakeT = 0;
  let shakeAmt = 0;

  let spawnAccum = 0;
  let stageBannerEl: HTMLElement | null = null;
  let stageBannerTimer = 0;

  const enemies: Enemy[] = [];
  const bullets: Bullet[] = [];
  const particles: Particle[] = [];

  // Auto-fire state
  let pointerDown = false;
  let pointerDownOnGame = false;
  let autoFireAccum = 0;
  let autoFireArmed = false;
  let lastFireT = 0;

  let rafId = 0;
  let lastTime = 0;
  let stateReady = false;
  let gameoverOverlay: HTMLElement | null = null;
  let hintEl: HTMLElement | null = null;
  let pausedEl: HTMLElement | null = null;

  void personalBest("color-match-shooter").then((b) => {
    best = b;
    bestEl.textContent = String(best);
  });

  // ---------- resize ----------
  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    const w = canvasWrap.clientWidth;
    const h = canvasWrap.clientHeight;
    if (w < 8 || h < 8) return;
    cw = w; ch = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    playerX = cw / 2;
    playerY = ch - 28;
    if (stateReady && phase !== "gameover") renderFrame();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvasWrap);
  resize();

  // ---------- hint ----------
  async function checkHint(): Promise<void> {
    const row = await db.settings.get("color-match-shooter:seenHint");
    if (row) return;
    hintEl = showHint(canvasWrap, () => {
      void db.settings.put({ key: "color-match-shooter:seenHint", value: "1" });
      hintEl = null;
    });
  }
  void checkHint();

  function dismissHint(): void {
    if (!hintEl) return;
    const t = hintEl.dataset["timer"];
    if (t) clearTimeout(Number(t));
    hintEl.remove();
    void db.settings.put({ key: "color-match-shooter:seenHint", value: "1" });
    hintEl = null;
  }

  // ---------- color selection ----------
  function setActiveColor(c: EnemyColor): void {
    activeColor = c;
    colorBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset["color"] === c);
    });
    dismissHint();
  }

  // Wire color buttons — they stop propagation so taps here don't fire bullets
  colorBtns.forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const c = btn.dataset["color"] as EnemyColor | undefined;
      if (c && COLOR_ORDER.includes(c)) setActiveColor(c);
      vibrate(4);
    });
  });

  // ---------- auto-aim: find lowest enemy matching color ----------
  function findTarget(color: EnemyColor): Enemy | null {
    let best2: Enemy | null = null;
    for (const en of enemies) {
      if (!en.alive || en.color !== color) continue;
      if (!best2 || en.y > best2.y) best2 = en;
    }
    return best2;
  }

  // ---------- fire ----------
  function fireBullet(): void {
    if (phase !== "playing") return;
    const now = performance.now();
    if (now - lastFireT < 80) return; // rate-limit tap spam
    lastFireT = now;

    const target = findTarget(activeColor);
    const b = pool(bullets, makeBullet);
    b.x = playerX;
    b.y = playerY - 24;
    b.color = activeColor;
    b.alive = true;

    if (target) {
      const dx = target.x - b.x;
      const dy = target.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      // mix: 70% aim, 30% straight up — keeps it feeling responsive
      b.vy = (dy / d) * BULLET_SPEED * 0.7 + (-BULLET_SPEED) * 0.3;
      // we don't set vx in the spec — bullets are strictly vertical
      // but auto-aim means we snap bullet x toward target
      b.x = b.x + (dx / d) * Math.min(Math.abs(dx), 40);
    } else {
      b.vy = -BULLET_SPEED;
    }
    // Enforce: bullets travel upward only
    if (b.vy > -BULLET_SPEED * 0.3) b.vy = -BULLET_SPEED;

    shots++;
    vibrate(4);
  }

  // ---------- spawn ----------
  function spawnInterval(): number {
    const t = elapsedMs / 1000;
    const raw = SPAWN_INTERVAL_BASE - t * (SPAWN_INTERVAL_BASE - SPAWN_INTERVAL_MIN) / 90;
    return Math.max(SPAWN_INTERVAL_MIN, raw);
  }

  function enemySpeed(): number {
    const tenSecBlocks = Math.floor(elapsedMs / 10000);
    return SPEED_BASE * Math.pow(1 + SPEED_INC_RATE, tenSecBlocks);
  }

  const SHAPES: EnemyShape[] = ["circle", "square", "triangle"];

  function spawnEnemy(): void {
    const en = pool(enemies, makeEnemy);
    const pad = cw * 0.1;
    en.x = pad + Math.random() * (cw - pad * 2);
    en.y = -ENEMY_RADIUS - 4;
    en.vy = enemySpeed();
    en.color = COLOR_ORDER[Math.floor(Math.random() * 3)]!;
    en.shape = SHAPES[Math.floor(Math.random() * 3)]!;
    en.alive = true;
    en.flashT = 0;
  }

  // ---------- combo ----------
  function comboMultiplier(): number {
    if (comboCount < 4)  return 1;
    if (comboCount < 8)  return 2;
    if (comboCount < 15) return 3;
    return 5;
  }

  function updateComboUI(): void {
    const m = comboMultiplier();
    if (m > 1 && comboCount > 0) {
      comboEl.textContent = `COMBO x${m}`;
      comboEl.style.display = "block";
      void comboEl.offsetWidth;
      comboEl.style.animation = "none";
      requestAnimationFrame(() => { comboEl.style.animation = "hb-combo-pop 0.35s ease-out"; });
    } else {
      comboEl.style.display = "none";
    }
  }

  function onKill(en: Enemy): void {
    const prevM = comboMultiplier();
    comboCount++;
    comboTimer = COMBO_WINDOW;
    const m = comboMultiplier();
    const pts = 10 * m;
    score += pts;
    if (score > best) best = score;
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    kills++;

    // Particles
    const col = COLORS[en.color];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = pool(particles, makeParticle);
      const a = Math.random() * Math.PI * 2;
      const spd = 50 + Math.random() * 130;
      p.x = en.x; p.y = en.y;
      p.vx = Math.cos(a) * spd;
      p.vy = Math.sin(a) * spd;
      p.life = 1;
      p.decay = 1 / 0.3;
      p.color = col.fill;
      p.alive = true;
    }

    shakeAmt = 2;
    shakeT = SHAKE_DUR;
    gridPulse = 1;

    vibrate(10 + Math.min(comboCount * 2, 20));
    if (m > prevM) vibrate(20);

    updateComboUI();
  }

  function onPlayerHit(): void {
    hp--;
    renderHP(hpEl, hp);
    shakeAmt = 5;
    shakeT = SHAKE_DUR;
    vibrate([40, 40, 40]);
    if (hp <= 0) triggerGameover();
  }

  // ---------- stage progression ----------
  function startStageBanner(n: number, hpBonus: boolean): void {
    stageBannerEl?.remove();
    stageBannerEl = document.createElement("div");
    stageBannerEl.className = "hb-stage-banner";
    const bonusTxt = hpBonus ? " +1 HP" : "";
    stageBannerEl.innerHTML = `STAGE ${n} CLEAR!<div class="hb-stage-sub">${bonusTxt}</div>`;
    canvasWrap.appendChild(stageBannerEl);
    stageBannerTimer = 2000;
  }

  // ---------- update ----------
  function updateBullets(dt: number): void {
    for (const b of bullets) {
      if (!b.alive) continue;
      b.y += b.vy * dt;
      if (b.y < -BULLET_H - 10) { b.alive = false; continue; }

      for (const en of enemies) {
        if (!en.alive) continue;
        const dx = b.x - en.x;
        const dy = b.y - en.y;
        if (Math.sqrt(dx * dx + dy * dy) > ENEMY_RADIUS + BULLET_W / 2) continue;

        if (b.color === en.color) {
          // matching hit → kill
          b.alive = false;
          en.alive = false;
          onKill(en);
        } else {
          // wrong color → pass-through, flash enemy
          en.flashT = 1;
          // bullet continues — no break
        }
        break; // one collision per bullet per frame
      }
    }
  }

  function updateEnemies(dt: number): void {
    for (const en of enemies) {
      if (!en.alive) continue;
      if (en.flashT > 0) en.flashT = Math.max(0, en.flashT - dt * (1 / 0.06));

      en.y += en.vy * dt;

      // Reached player zone
      if (en.y >= playerY - ENEMY_RADIUS * 0.5) {
        en.alive = false;
        onPlayerHit();
        if (phase === "gameover") return;
      }
    }
  }

  function updateParticles(dt: number): void {
    for (const p of particles) {
      if (!p.alive) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) p.alive = false;
    }
  }

  function updateSpawn(dtMs: number): void {
    spawnAccum += dtMs;
    const interval = spawnInterval();
    while (spawnAccum >= interval) {
      spawnAccum -= interval;
      spawnEnemy();
    }
  }

  function updateComboTimer(dtMs: number): void {
    if (comboCount > 0) {
      comboTimer -= dtMs;
      if (comboTimer <= 0) {
        comboCount = 0;
        comboEl.style.display = "none";
      }
    }
  }

  function updateStage(dtMs: number): void {
    stageTimer -= dtMs;
    if (stageTimer <= 0) {
      stage++;
      stageTimer = STAGE_DURATION;
      stageEl.textContent = `STAGE ${stage}`;

      const hpBonus = hp < 5;
      if (hpBonus) {
        hp = Math.min(5, hp + 1);
        renderHP(hpEl, hp);
      }
      startStageBanner(stage, hpBonus);
      vibrate([30, 30, 30]);
    }

    if (stageBannerTimer > 0) {
      stageBannerTimer -= dtMs;
      if (stageBannerTimer <= 0) {
        stageBannerEl?.remove();
        stageBannerEl = null;
      }
    }
  }

  // ---------- render ----------
  function renderFrame(): void {
    if (cw < 8 || ch < 8) return;

    let ox = 0, oy = 0;
    if (shakeT > 0) {
      const intensity = shakeAmt * (shakeT / SHAKE_DUR);
      ox = (Math.random() - 0.5) * 2 * intensity;
      oy = (Math.random() - 0.5) * 2 * intensity;
    }

    ctx.save();
    ctx.translate(ox, oy);

    drawBackground(ctx, cw, ch, gridPulse);

    for (const p of particles) { if (p.alive) drawParticle(ctx, p); }
    for (const en of enemies)   { if (en.alive) drawEnemy(ctx, en); }
    for (const b of bullets)    { if (b.alive) drawBullet(ctx, b); }

    drawPlayer(ctx, playerX, playerY, activeColor);

    ctx.restore();
  }

  // ---------- game loop ----------
  function loop(now: number): void {
    const rawDt = now - lastTime;
    lastTime = now;
    const dt = Math.min(rawDt, DT_CAP) / 1000;
    const dtMs = Math.min(rawDt, DT_CAP);

    if (phase === "paused") {
      rafId = requestAnimationFrame(loop);
      return;
    }

    elapsedMs += dtMs;

    updateSpawn(dtMs);
    updateBullets(dt);
    updateEnemies(dt);
    if (phase === "gameover") return;
    updateParticles(dt);
    updateComboTimer(dtMs);
    updateStage(dtMs);

    gridPulse = Math.max(0, gridPulse - dt * 2.5);
    shakeT = Math.max(0, shakeT - dtMs);

    // Auto-fire: if pointer held over canvas, fire continuously
    if (pointerDown && pointerDownOnGame && phase === "playing") {
      autoFireAccum += dtMs;
      if (!autoFireArmed && autoFireAccum >= AUTO_FIRE_HOLD) {
        autoFireArmed = true;
      }
      if (autoFireArmed && autoFireAccum >= AUTO_FIRE_RATE) {
        autoFireAccum = 0;
        fireBullet();
      }
    }

    renderFrame();
    rafId = requestAnimationFrame(loop);
  }

  // ---------- gameover ----------
  function triggerGameover(): void {
    phase = "gameover";
    vibrate([50, 50, 100]);
    cancelAnimationFrame(rafId);
    void submit("color-match-shooter", score);
    if (score > best) best = score;
    bestEl.textContent = String(best);

    gameoverOverlay = showGameover(container, score, best, stage, shots, kills, restartGame);

    void computeRank("color-match-shooter", score).then((rank) => {
      if (!rank || !gameoverOverlay) return;
      const box = gameoverOverlay.querySelector<HTMLElement>(".hb-go-box");
      if (!box || box.querySelector(".hb-rank-card")) return;
      const actions = box.querySelector<HTMLElement>(".hb-go-actions");
      if (!actions) return;
      const div = document.createElement("div");
      div.innerHTML = buildRankCard(rank, "color-match-shooter");
      const card = div.firstElementChild as HTMLElement | null;
      if (!card) return;
      card.querySelector<HTMLElement>("[data-lb]")?.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        navigate("/scores/color-match-shooter");
      });
      box.insertBefore(card, actions);
    });
  }

  // ---------- restart ----------
  function restartGame(): void {
    score = 0; shots = 0; kills = 0;
    hp = 3; stage = 1; stageTimer = STAGE_DURATION; elapsedMs = 0;
    comboCount = 0; comboTimer = 0;
    gridPulse = 0; shakeT = 0; shakeAmt = 0;
    spawnAccum = 0;
    pointerDown = false; pointerDownOnGame = false;
    autoFireAccum = 0; autoFireArmed = false; lastFireT = 0;
    enemies.forEach((e) => { e.alive = false; });
    bullets.forEach((b) => { b.alive = false; });
    particles.forEach((p) => { p.alive = false; });
    stageBannerEl?.remove(); stageBannerEl = null;
    comboEl.style.display = "none";
    setActiveColor("red");
    scoreEl.textContent = "0";
    stageEl.textContent = "STAGE 1";
    renderHP(hpEl, hp);
    void personalBest("color-match-shooter").then((b) => {
      best = b;
      bestEl.textContent = String(best);
    });
    phase = "playing";
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  // ---------- input ----------
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // Check if target is inside the canvas wrap (game area), not the color bar
    const target = e.target as HTMLElement;
    const isGameArea = canvasWrap.contains(target) || target === canvasWrap;
    pointerDown = true;
    pointerDownOnGame = isGameArea;
    autoFireAccum = 0;
    autoFireArmed = false;
    dismissHint();
  }

  function onPointerUp(_e: PointerEvent): void {
    if (!pointerDown) return;
    const wasPDG = pointerDownOnGame;
    pointerDown = false;
    pointerDownOnGame = false;

    if (wasPDG && !autoFireArmed && phase === "playing") {
      fireBullet();
    }
    autoFireArmed = false;
    autoFireAccum = 0;
  }

  function onPointerCancel(): void {
    pointerDown = false;
    pointerDownOnGame = false;
    autoFireArmed = false;
    autoFireAccum = 0;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "1") { e.preventDefault(); setActiveColor("red"); vibrate(4); }
    if (e.key === "2") { e.preventDefault(); setActiveColor("cyan"); vibrate(4); }
    if (e.key === "3") { e.preventDefault(); setActiveColor("yellow"); vibrate(4); }
    if (e.code === "Space") { e.preventDefault(); fireBullet(); }
    if (e.code === "Escape" || e.key === "p") {
      pauseBtn.dispatchEvent(new PointerEvent("pointerup"));
    }
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    fireBullet();
  }

  // ---------- controls wiring ----------
  pauseBtn.addEventListener("pointerup", () => {
    if (phase === "gameover") return;
    if (phase === "playing") {
      phase = "paused";
      pausedEl = document.createElement("div");
      pausedEl.className = "hb-paused";
      pausedEl.textContent = "PAUSED";
      canvasWrap.appendChild(pausedEl);
    } else if (phase === "paused") {
      phase = "playing";
      pausedEl?.remove();
      pausedEl = null;
      lastTime = performance.now();
    }
  });

  fsBtn.addEventListener("pointerup", () => {
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen().catch(() => {});
    }
  });

  // Attach input to the wrap (not just canvas) per contract rule 7
  const wrap = container.querySelector<HTMLElement>(".hb-wrap")!;
  wrap.addEventListener("pointerdown", onPointerDown);
  wrap.addEventListener("pointerup", onPointerUp);
  wrap.addEventListener("pointercancel", onPointerCancel);
  canvasWrap.addEventListener("mousedown", onMouseDown);
  document.addEventListener("keydown", onKeyDown);

  // ---------- boot ----------
  stateReady = true;
  renderHP(hpEl, hp);
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);

  // ---------- cleanup ----------
  return function cleanup(): void {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    wrap.removeEventListener("pointerdown", onPointerDown);
    wrap.removeEventListener("pointerup", onPointerUp);
    wrap.removeEventListener("pointercancel", onPointerCancel);
    canvasWrap.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("keydown", onKeyDown);
    gameoverOverlay?.remove();
    hintEl?.remove();
    stageBannerEl?.remove();
    pausedEl?.remove();
    container.innerHTML = "";
    container.classList.remove("hue-root");
    container.style.touchAction = prevTouchAction;
  };
}
