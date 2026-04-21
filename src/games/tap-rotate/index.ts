import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";

// ---------- types ----------

type Phase = "waveIntro" | "playing" | "waveComplete" | "gameover" | "paused";

interface Vec2 { x: number; y: number }

interface Bullet {
  x: number; y: number;
  vx: number; vy: number;
  alive: boolean;
}

interface Enemy {
  x: number; y: number;
  vx: number; vy: number;
  hp: number;
  maxHp: number;
  kind: EnemyKind;
  alive: boolean;
  flashT: number; // flash timer after hit
  trailX: number[];
  trailY: number[];
}

type EnemyKind = "runner" | "tank" | "swifty";

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; // 0-1 remaining
  decay: number;
  color: string;
  alive: boolean;
}

interface TouchState {
  active: boolean;
  startX: number;
  startY: number;
  startT: number;
  curX: number;
  curY: number;
  pointerId: number;
  autoFireArmed: boolean;
  autoFireTimer: number;
  autoFireCooldown: number;
}

// ---------- constants ----------

const PLAYER_RADIUS = 14;
const BULLET_SPEED = 480; // px/s
const BULLET_RADIUS = 4;
const AUTO_FIRE_HOLD_MS = 400;
const AUTO_FIRE_BURST = 3;
const AUTO_FIRE_COOLDOWN_MS = 500;
const AUTO_FIRE_BURST_INTERVAL = 80; // ms between burst shots
const TAP_MAX_MS = 180;
const TAP_MAX_MOVE = 15; // px
const SHAKE_DURATION = 100; // ms
const COMBO_WINDOW_MS = 1000;
const WAVE_INTRO_DURATION = 1400; // ms banner visible
const WAVE_COMPLETE_DURATION = 2200; // ms pause between waves
const DT_CAP = 32; // ms max delta

const ENEMY_CONFIG: Record<EnemyKind, {
  hp: number; speed: number; radius: number;
  color: string; glow: string; scoreValue: number;
  shakeAmt: number;
}> = {
  runner: { hp: 1, speed: 90,  radius: 10, color: "#ff3333", glow: "#ff0000", scoreValue: 10, shakeAmt: 3 },
  tank:   { hp: 3, speed: 48,  radius: 17, color: "#9933cc", glow: "#cc00ff", scoreValue: 40, shakeAmt: 6 },
  swifty: { hp: 1, speed: 195, radius:  7, color: "#ffcc00", glow: "#ffee00", scoreValue: 25, shakeAmt: 2 },
};

// ---------- object pools ----------

function makeBullet(): Bullet { return { x:0, y:0, vx:0, vy:0, alive:false }; }
function makeEnemy(): Enemy {
  return { x:0, y:0, vx:0, vy:0, hp:1, maxHp:1, kind:"runner", alive:false,
           flashT:0, trailX:[], trailY:[] };
}
function makeParticle(): Particle {
  return { x:0, y:0, vx:0, vy:0, life:1, decay:0, color:"#fff", alive:false };
}

function getFromPool<T extends { alive: boolean }>(pool: T[], factory: () => T): T {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i]!.alive) return pool[i]!;
  }
  const obj = factory();
  pool.push(obj);
  return obj;
}

// ---------- helpers ----------

function angle(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax; const dy = by - ay;
  return dx * dx + dy * dy;
}

function lerpColor(a: string, b: string, t: number): string {
  const ra = parseInt(a.slice(1,3),16), ga = parseInt(a.slice(3,5),16), ba2 = parseInt(a.slice(5,7),16);
  const rb = parseInt(b.slice(1,3),16), gb = parseInt(b.slice(3,5),16), bb = parseInt(b.slice(5,7),16);
  const r = Math.round(ra + (rb-ra)*t), g = Math.round(ga + (gb-ga)*t), b2 = Math.round(ba2 + (bb-ba2)*t);
  return `rgb(${r},${g},${b2})`;
}

function vibrate(pattern: number | number[]): void {
  if ("vibrate" in navigator) navigator.vibrate?.(pattern);
}

// ---------- spawn logic ----------

function pickEnemyKind(wave: number): EnemyKind {
  const r = Math.random();
  if (wave >= 5 && r < 0.05) return "swifty";
  if (wave >= 3 && r < 0.20) return "tank";
  return "runner";
}

function spawnEnemy(enemy: Enemy, arenaX: number, arenaY: number, arenaSize: number, wave: number): void {
  const kind = pickEnemyKind(wave);
  const cfg = ENEMY_CONFIG[kind];
  const side = Math.floor(Math.random() * 4);
  let x = 0, y = 0;
  const s = arenaSize / 2;
  const jitter = () => (Math.random() - 0.5) * arenaSize * 0.8;
  if (side === 0) { x = arenaX - s; y = arenaY + jitter(); }
  else if (side === 1) { x = arenaX + s; y = arenaY + jitter(); }
  else if (side === 2) { x = arenaX + jitter(); y = arenaY - s; }
  else { x = arenaX + jitter(); y = arenaY + jitter(); y = arenaY + s; }

  const dx = arenaX - x, dy = arenaY - y;
  const d = Math.sqrt(dx*dx + dy*dy) || 1;
  const speedVariance = 0.8 + Math.random() * 0.4;
  const waveBonus = 1 + (wave - 1) * 0.08;

  enemy.x = x; enemy.y = y;
  enemy.vx = (dx / d) * cfg.speed * speedVariance * waveBonus;
  enemy.vy = (dy / d) * cfg.speed * speedVariance * waveBonus;
  enemy.hp = cfg.hp; enemy.maxHp = cfg.hp;
  enemy.kind = kind; enemy.alive = true;
  enemy.flashT = 0;
  enemy.trailX.length = 0; enemy.trailY.length = 0;
}

// ---------- render ----------

function drawBackground(
  ctx: CanvasRenderingContext2D,
  cw: number, ch: number,
  gridPulse: number
): void {
  const grad = ctx.createRadialGradient(cw/2, ch/2, 0, cw/2, ch/2, Math.max(cw,ch) * 0.7);
  grad.addColorStop(0, "#12122a");
  grad.addColorStop(1, "#0b0b1f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  const gridAlpha = 0.05 + gridPulse * 0.12;
  ctx.strokeStyle = `rgba(100,100,255,${gridAlpha})`;
  ctx.lineWidth = 0.5;
  const step = 32;
  for (let x = 0; x < cw; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
  }
  for (let y = 0; y < ch; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
  }
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  heading: number
): void {
  // glow ring
  ctx.save();
  ctx.shadowBlur = 18;
  ctx.shadowColor = "#4488ff";
  ctx.strokeStyle = "#4488ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // body fill
  ctx.fillStyle = "#1a3a8a";
  ctx.beginPath();
  ctx.arc(cx, cy, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // barrel
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading);
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#88aaff";
  ctx.fillStyle = "#88aaff";
  const bw = 6, bh = 18;
  ctx.fillRect(-bw/2, -PLAYER_RADIUS - bh + 4, bw, bh);
  ctx.shadowBlur = 0;
  ctx.restore();
  ctx.restore();
}

function drawEnemy(
  ctx: CanvasRenderingContext2D,
  enemy: Enemy
): void {
  const cfg = ENEMY_CONFIG[enemy.kind];
  const flashAlpha = enemy.flashT > 0 ? 0.9 : 0;
  const color = flashAlpha > 0 ? lerpColor(cfg.color, "#ffffff", flashAlpha) : cfg.color;

  // trail
  const tlen = enemy.trailX.length;
  for (let i = 0; i < tlen; i++) {
    const tx = enemy.trailX[i]!, ty = enemy.trailY[i]!;
    const a = (i / tlen) * 0.25;
    ctx.fillStyle = `rgba(${hexToRgb(cfg.color)},${a})`;
    ctx.beginPath();
    ctx.arc(tx, ty, cfg.radius * 0.6 * (i / tlen), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.shadowBlur = 10;
  ctx.shadowColor = cfg.glow;

  if (enemy.kind === "runner") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, cfg.radius, 0, Math.PI * 2);
    ctx.fill();
  } else if (enemy.kind === "tank") {
    ctx.fillStyle = color;
    const r = cfg.radius;
    ctx.beginPath();
    ctx.rect(enemy.x - r, enemy.y - r, r*2, r*2);
    ctx.fill();
    // HP bar
    const barW = r * 2;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(enemy.x - r, enemy.y - r - 5, barW, 3);
    ctx.fillStyle = "#cc44ff";
    ctx.fillRect(enemy.x - r, enemy.y - r - 5, barW * (enemy.hp / enemy.maxHp), 3);
  } else {
    // swifty: triangle
    ctx.fillStyle = color;
    const r = cfg.radius;
    ctx.beginPath();
    ctx.moveTo(enemy.x, enemy.y - r);
    ctx.lineTo(enemy.x + r * 0.87, enemy.y + r * 0.5);
    ctx.lineTo(enemy.x - r * 0.87, enemy.y + r * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

function drawBullet(ctx: CanvasRenderingContext2D, b: Bullet): void {
  ctx.save();
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(b.x, b.y, BULLET_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  ctx.globalAlpha = p.life;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawShakeOffset(shakeAmt: number, shakeDuration: number, shakeT: number): Vec2 {
  if (shakeT <= 0) return { x: 0, y: 0 };
  const intensity = shakeAmt * (shakeT / shakeDuration);
  return {
    x: (Math.random() - 0.5) * 2 * intensity,
    y: (Math.random() - 0.5) * 2 * intensity,
  };
}

// ---------- overlay UI ----------

function buildHUD(container: HTMLElement): {
  scoreEl: HTMLElement;
  bestEl: HTMLElement;
  waveEl: HTMLElement;
  comboEl: HTMLElement;
  pauseBtn: HTMLElement;
  fsBtn: HTMLElement;
} {
  const hud = document.createElement("div");
  hud.className = "tr-hud";
  hud.innerHTML = `
    <div class="tr-hud-left">
      <span class="tr-hud-label">SCORE</span>
      <span class="tr-hud-val" id="tr-score">0</span>
    </div>
    <div class="tr-hud-center">
      <span class="tr-hud-val" id="tr-wave">WAVE 1</span>
    </div>
    <div class="tr-hud-right">
      <span class="tr-hud-label">BEST</span>
      <span class="tr-hud-val" id="tr-best">0</span>
    </div>
  `;
  container.appendChild(hud);

  const controls = document.createElement("div");
  controls.className = "tr-hud-controls";
  controls.innerHTML = `
    <span id="tr-heart" class="tr-heart">&#10084;</span>
    <button class="btn tr-ctrl-btn" id="tr-fs" aria-label="Fullscreen">&#9638;</button>
    <button class="btn tr-ctrl-btn" id="tr-pause" aria-label="Pause">&#9646;&#9646;</button>
  `;
  container.appendChild(controls);

  const comboEl = document.createElement("div");
  comboEl.id = "tr-combo";
  comboEl.className = "tr-combo";
  comboEl.style.display = "none";
  container.appendChild(comboEl);

  return {
    scoreEl: hud.querySelector("#tr-score") as HTMLElement,
    bestEl: hud.querySelector("#tr-best") as HTMLElement,
    waveEl: hud.querySelector("#tr-wave") as HTMLElement,
    comboEl,
    pauseBtn: controls.querySelector("#tr-pause") as HTMLElement,
    fsBtn: controls.querySelector("#tr-fs") as HTMLElement,
  };
}

function buildRankCard(rank: RankInfo, gameId: string): string {
  const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="tr-rank-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta} pts</div>`
    : "";
  return `<div class="tr-rank-card">
    <div class="tr-rank-title">RANK ${rankLabel} GLOBAL</div>
    ${deltaHtml}
    <button class="btn tr-rank-btn" data-scores-id="${gameId}">VIEW LEADERBOARD</button>
  </div>`;
}

function showGameover(
  container: HTMLElement,
  score: number,
  best: number,
  wave: number,
  shots: number,
  hits: number,
  onReplay: () => void,
  rank?: RankInfo
): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "tr-gameover";
  const isNewBest = score >= best && score > 0;
  const accuracy = shots > 0 ? Math.round((hits / shots) * 100) : 0;
  const rankHtml = rank ? buildRankCard(rank, "tap-rotate") : "";
  overlay.innerHTML = `
    <div class="tr-go-box">
      <h2 class="tr-go-title">GAME OVER</h2>
      ${isNewBest ? `<div class="tr-go-best-flag">NEW BEST!</div>` : ""}
      <div class="tr-go-score">${score}</div>
      <div class="tr-go-label">SCORE</div>
      <div class="tr-go-stats">
        <span>WAVE ${wave}</span>
        <span>ACC ${accuracy}%</span>
      </div>
      ${rankHtml}
      <div class="tr-go-actions">
        <button class="btn primary tr-go-btn" id="tr-replay">PLAY AGAIN</button>
        <button class="btn tr-go-btn" id="tr-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector<HTMLElement>(".tr-rank-btn")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const id = (e.currentTarget as HTMLElement).dataset["scoresId"];
    if (id) navigate(`/scores/${id}`);
  });
  overlay.querySelector("#tr-replay")?.addEventListener("pointerup", () => {
    overlay.remove();
    onReplay();
  });
  overlay.querySelector("#tr-menu")?.addEventListener("pointerup", () => {
    navigate("/");
  });
  return overlay;
}

function showHint(container: HTMLElement, onDismiss: () => void): HTMLElement {
  const hint = document.createElement("div");
  hint.className = "tr-hint";
  hint.style.pointerEvents = "none";
  hint.innerHTML = `
    <div class="tr-hint-title">AIM WITH TOUCH</div>
    <div class="tr-hint-sub">TAP to shoot</div>
    <div class="tr-hint-arrow" id="tr-hint-arrow">&#8635;</div>
  `;
  container.appendChild(hint);

  let angle2 = 0;
  let rafId = 0;
  function animArrow(): void {
    angle2 += 0.03;
    const arrowEl = hint.querySelector<HTMLElement>("#tr-hint-arrow");
    if (arrowEl) arrowEl.style.transform = `rotate(${angle2}rad)`;
    rafId = requestAnimationFrame(animArrow);
  }
  rafId = requestAnimationFrame(animArrow);

  const timer = window.setTimeout(() => {
    cancelAnimationFrame(rafId);
    hint.remove();
    onDismiss();
  }, 5000);

  hint.dataset["rafId"] = String(rafId);
  hint.dataset["timer"] = String(timer);

  return hint;
}

// ---------- styles ----------

function injectStyles(): void {
  const id2 = "tr-styles";
  if (document.getElementById(id2)) return;
  const style = document.createElement("style");
  style.id = id2;
  style.textContent = `
    .taprotate-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #0b0b1f;
      user-select: none;
      -webkit-user-select: none;
      position: relative;
    }
    .tr-wrap {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .tr-canvas-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }
    .tr-canvas-wrap canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    .tr-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      font-family: monospace;
      color: #ffffff;
      background: rgba(0,0,0,0.4);
      flex-shrink: 0;
    }
    .tr-hud-left, .tr-hud-right { display: flex; flex-direction: column; align-items: flex-start; min-width: 60px; }
    .tr-hud-right { align-items: flex-end; }
    .tr-hud-center { text-align: center; }
    .tr-hud-label { font-size: 9px; opacity: 0.6; letter-spacing: 1px; }
    .tr-hud-val { font-size: 15px; font-weight: bold; }
    .tr-hud-controls {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 4px 12px;
      flex-shrink: 0;
    }
    .tr-heart { font-size: 20px; color: #ff3d68; flex: 1; }
    .tr-ctrl-btn {
      min-width: 44px; min-height: 44px;
      font-size: 16px;
      border-color: rgba(255,255,255,0.3);
      color: #ffffff;
      background: rgba(255,255,255,0.08);
    }
    .tr-combo {
      position: absolute;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      font-family: monospace;
      font-size: 26px;
      font-weight: bold;
      color: #ffcc00;
      text-shadow: 0 0 16px #ffcc00;
      letter-spacing: 3px;
      pointer-events: none;
      z-index: 5;
      animation: tr-combo-pulse 0.4s ease-out;
    }
    @keyframes tr-combo-pulse {
      0% { transform: translateX(-50%) scale(1.4); }
      100% { transform: translateX(-50%) scale(1); }
    }
    .tr-wave-banner {
      position: absolute;
      top: 35%;
      left: 50%;
      transform: translateX(-50%);
      font-family: monospace;
      font-size: 28px;
      font-weight: bold;
      color: #ff3d68;
      text-shadow: 0 0 20px #ff3d68;
      letter-spacing: 4px;
      pointer-events: none;
      z-index: 6;
      text-align: center;
    }
    .tr-wave-banner .tr-wave-sub {
      font-size: 14px;
      color: #ffffff;
      opacity: 0.8;
      margin-top: 8px;
    }
    .tr-gameover {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.85);
      z-index: 10;
    }
    .tr-go-box {
      text-align: center;
      padding: 28px 24px;
      background: #0b0b1f;
      border: 1px solid #ff3d68;
      border-radius: 12px;
      min-width: 230px;
      max-width: 320px;
      width: 90%;
    }
    .tr-go-title {
      margin: 0 0 8px;
      font-family: monospace;
      font-size: 22px;
      color: #ff3d68;
      letter-spacing: 3px;
      text-shadow: 0 0 12px #ff3d68;
    }
    .tr-go-best-flag {
      color: #ffcc00;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 2px;
      margin-bottom: 8px;
      text-shadow: 0 0 8px #ffcc00;
    }
    .tr-go-score {
      font-family: monospace;
      font-size: 48px;
      font-weight: bold;
      color: #ffffff;
      text-shadow: 0 0 16px #4488ff;
      line-height: 1;
    }
    .tr-go-label {
      font-family: monospace;
      font-size: 10px;
      color: rgba(255,255,255,0.5);
      letter-spacing: 2px;
      margin-bottom: 8px;
    }
    .tr-go-stats {
      display: flex;
      gap: 16px;
      justify-content: center;
      font-family: monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.6);
      margin-bottom: 16px;
    }
    .tr-go-actions { display: flex; gap: 12px; justify-content: center; margin-top: 16px; }
    .tr-go-btn { min-width: 100px; min-height: 44px; font-family: monospace; font-size: 12px; }
    .tr-rank-card {
      margin: 12px 0;
      padding: 10px 14px;
      background: rgba(68,136,255,0.12);
      border: 1px solid rgba(68,136,255,0.3);
      border-radius: 8px;
    }
    .tr-rank-title { font-family: monospace; font-size: 11px; color: #88aaff; letter-spacing: 1px; }
    .tr-rank-delta { font-family: monospace; font-size: 10px; color: rgba(255,255,255,0.7); margin-top: 4px; }
    .tr-rank-btn { margin-top: 8px; min-height: 36px; font-size: 10px; }
    .tr-hint {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 7;
    }
    .tr-hint-title {
      font-family: monospace;
      font-size: 22px;
      font-weight: bold;
      color: #ffffff;
      letter-spacing: 3px;
      text-shadow: 0 0 12px #4488ff;
      margin-bottom: 8px;
    }
    .tr-hint-sub {
      font-family: monospace;
      font-size: 14px;
      color: rgba(255,255,255,0.7);
      letter-spacing: 2px;
      margin-bottom: 20px;
    }
    .tr-hint-arrow {
      font-size: 48px;
      color: #ff3d68;
      text-shadow: 0 0 16px #ff3d68;
    }
    .tr-paused-overlay {
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
      color: #ffffff;
      letter-spacing: 4px;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("taprotate-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // Layout
  const wrap = document.createElement("div");
  wrap.className = "tr-wrap";
  container.appendChild(wrap);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "tr-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "game-canvas";
  canvasWrap.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx: CanvasRenderingContext2D = ctxRaw;

  const { scoreEl, bestEl, waveEl, comboEl, pauseBtn, fsBtn } = buildHUD(wrap);
  wrap.insertBefore(wrap.querySelector(".tr-hud")!, canvasWrap);

  // Canvas sizing
  let cw = 0, ch = 0;
  let dpr = 1;
  let arenaX = 0, arenaY = 0, arenaSize = 0;

  // Phase declared early so resize() can read it
  let phase: Phase = "waveIntro";

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
    arenaX = cw / 2;
    arenaY = ch / 2;
    arenaSize = Math.min(cw, ch) * 0.75;
    if (stateReady && phase !== "gameover") renderFrame(0);
  }

  let stateReady = false;
  const ro = new ResizeObserver(resize);
  ro.observe(canvasWrap);
  resize();
  let score = 0;
  let best = 0;
  let wave = 1;
  let heading = -Math.PI / 2; // pointing up

  const bullets: Bullet[] = [];
  const enemies: Enemy[] = [];
  const particles: Particle[] = [];

  let shots = 0;
  let hits = 0;
  let comboCount = 0;
  let comboTimer = 0;
  let comboHideTimer = 0;

  let gridPulse = 0;
  let shakeT = 0;
  let shakeAmt = 0;

  // Wave timing
  let waveTimer = 0;
  let waveDuration = 0;
  let spawnAccum = 0;
  let spawnInterval = 0;
  let waveBannerEl: HTMLElement | null = null;
  let waveBannerTimer = 0;
  let autoFireBurstCount = 0;
  let autoFireBurstTimer = 0;

  // Touch state
  const touch: TouchState = {
    active: false,
    startX: 0, startY: 0, startT: 0,
    curX: 0, curY: 0,
    pointerId: -1,
    autoFireArmed: false,
    autoFireTimer: 0,
    autoFireCooldown: 0,
  };

  let rafId = 0;
  let lastTime = 0;
  let gameoverOverlay: HTMLElement | null = null;
  let hintEl: HTMLElement | null = null;
  let pausedOverlay: HTMLElement | null = null;

  void personalBest("tap-rotate").then((b) => {
    best = b;
    bestEl.textContent = String(best);
  });

  // ---------- hint ----------

  async function checkHint(): Promise<void> {
    const row = await db.settings.get("tap-rotate:seenHint");
    if (row) return;
    hintEl = showHint(canvasWrap, () => {
      void db.settings.put({ key: "tap-rotate:seenHint", value: "1" });
      hintEl = null;
    });
  }
  void checkHint();

  function dismissHint(): void {
    if (!hintEl) return;
    const rafIdStr = hintEl.dataset["rafId"];
    const timerStr = hintEl.dataset["timer"];
    if (rafIdStr) cancelAnimationFrame(Number(rafIdStr));
    if (timerStr) clearTimeout(Number(timerStr));
    hintEl.remove();
    void db.settings.put({ key: "tap-rotate:seenHint", value: "1" });
    hintEl = null;
  }

  // ---------- wave management ----------

  function startWave(n: number): void {
    wave = n;
    phase = "waveIntro";
    waveEl.textContent = `WAVE ${wave}`;

    enemies.forEach((e) => { e.alive = false; });
    bullets.forEach((b) => { b.alive = false; });

    waveBannerEl?.remove();
    waveBannerEl = document.createElement("div");
    waveBannerEl.className = "tr-wave-banner";
    waveBannerEl.innerHTML = `WAVE ${wave}<div class="tr-wave-sub">GET READY</div>`;
    canvasWrap.appendChild(waveBannerEl);
    waveBannerTimer = WAVE_INTRO_DURATION;

    waveDuration = 8000 + wave * 1500;
    waveTimer = waveDuration;
    spawnInterval = Math.max(600, 2200 - wave * 180);
    spawnAccum = 0;
    autoFireBurstCount = 0;
    autoFireBurstTimer = 0;
  }

  function endWave(): void {
    phase = "waveComplete";
    score += wave * 50;
    scoreEl.textContent = String(score);
    vibrate([30, 30, 30]);

    waveBannerEl?.remove();
    waveBannerEl = document.createElement("div");
    waveBannerEl.className = "tr-wave-banner";
    const nextWave = wave + 1;
    waveBannerEl.innerHTML = `WAVE ${wave} CLEAR!<div class="tr-wave-sub">+${wave * 50} pts &nbsp;&nbsp; WAVE ${nextWave} in 3...</div>`;
    canvasWrap.appendChild(waveBannerEl);
    waveBannerTimer = WAVE_COMPLETE_DURATION;

    enemies.forEach((e) => { e.alive = false; });
  }

  // ---------- fire ----------

  function fireBullet(): void {
    if (phase !== "playing") return;
    const b = getFromPool(bullets, makeBullet);
    b.x = arenaX + Math.cos(heading) * (PLAYER_RADIUS + 5);
    b.y = arenaY + Math.sin(heading) * (PLAYER_RADIUS + 5);
    b.vx = Math.cos(heading) * BULLET_SPEED;
    b.vy = Math.sin(heading) * BULLET_SPEED;
    b.alive = true;
    shots++;
    vibrate(6);
  }

  function spawnBurstNext(): void {
    if (autoFireBurstCount <= 0) return;
    autoFireBurstCount--;
    fireBullet();
    if (autoFireBurstCount > 0) {
      autoFireBurstTimer = AUTO_FIRE_BURST_INTERVAL;
    } else {
      touch.autoFireCooldown = AUTO_FIRE_COOLDOWN_MS;
      touch.autoFireArmed = false;
    }
  }

  // ---------- touch ----------

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (touch.active) return;
    touch.active = true;
    touch.pointerId = e.pointerId;
    touch.startX = e.clientX;
    touch.startY = e.clientY;
    touch.startT = performance.now();
    touch.curX = e.clientX;
    touch.curY = e.clientY;
    touch.autoFireArmed = false;
    touch.autoFireTimer = 0;
    dismissHint();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!touch.active || e.pointerId !== touch.pointerId) return;
    touch.curX = e.clientX;
    touch.curY = e.clientY;

    // Update heading to finger position relative to canvas center
    const rect = canvasWrap.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    heading = angle(arenaX, arenaY, px, py);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!touch.active || e.pointerId !== touch.pointerId) return;
    const dt2 = performance.now() - touch.startT;
    const dx = e.clientX - touch.startX;
    const dy = e.clientY - touch.startY;
    const moved = Math.sqrt(dx*dx + dy*dy);

    touch.active = false;
    touch.autoFireArmed = false;

    if (dt2 < TAP_MAX_MS && moved < TAP_MAX_MOVE) {
      // tap → fire
      if (phase === "playing" && touch.autoFireCooldown <= 0) {
        fireBullet();
      }
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerId === touch.pointerId) {
      touch.active = false;
      touch.autoFireArmed = false;
    }
  }

  // Mouse aim (desktop)
  function onMouseMove(e: MouseEvent): void {
    if (touch.active) return;
    const rect = canvasWrap.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    heading = angle(arenaX, arenaY, px, py);
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (phase === "playing") fireBullet();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space") {
      e.preventDefault();
      if (phase === "playing") fireBullet();
    }
    if (e.code === "Escape" || e.key === "p") {
      pauseBtn.dispatchEvent(new PointerEvent("pointerup"));
    }
  }

  // ---------- update helpers ----------

  function updateCombo(dt: number): void {
    if (comboCount > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) {
        comboCount = 0;
        comboHideTimer = 600;
      }
    }
    if (comboHideTimer > 0) {
      comboHideTimer -= dt;
      if (comboHideTimer <= 0) {
        comboEl.style.display = "none";
      }
    }
  }

  function comboMultiplier(): number {
    if (comboCount <= 1) return 1;
    if (comboCount <= 3) return 1.5;
    if (comboCount <= 6) return 2;
    if (comboCount <= 10) return 3;
    return 5;
  }

  function onKill(enemy: Enemy, ex: number, ey: number): void {
    const cfg = ENEMY_CONFIG[enemy.kind];
    const prevMulti = comboMultiplier();
    comboCount++;
    comboTimer = COMBO_WINDOW_MS;
    const multi = comboMultiplier();

    const pts = Math.round(cfg.scoreValue * multi);
    score += pts;
    if (score > best) best = score;
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);

    // Combo UI
    if (multi > 1) {
      comboEl.textContent = `COMBO x${multi}`;
      comboEl.style.display = "block";
      void comboEl.offsetWidth; // reflow to restart animation
      comboEl.style.animation = "none";
      requestAnimationFrame(() => {
        comboEl.style.animation = "tr-combo-pulse 0.4s ease-out";
      });
      if (multi > prevMulti) vibrate(20);
    }

    // Particles
    for (let i = 0; i < 10; i++) {
      const p = getFromPool(particles, makeParticle);
      const a2 = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 120;
      p.x = ex; p.y = ey;
      p.vx = Math.cos(a2) * spd;
      p.vy = Math.sin(a2) * spd;
      p.life = 1;
      p.decay = 1 / 0.3; // fade in 300ms
      p.color = cfg.color;
      p.alive = true;
    }

    // Screen shake
    shakeAmt = cfg.shakeAmt;
    shakeT = SHAKE_DURATION;
    gridPulse = 1;

    vibrate(12);
  }

  function updateBullets(dt: number): void {
    const margin = arenaSize * 0.8;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i]!;
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (
        b.x < arenaX - margin || b.x > arenaX + margin ||
        b.y < arenaY - margin || b.y > arenaY + margin
      ) {
        b.alive = false;
        continue;
      }

      for (let j = 0; j < enemies.length; j++) {
        const en = enemies[j]!;
        if (!en.alive) continue;
        const cfg = ENEMY_CONFIG[en.kind];
        const hitR = cfg.radius + BULLET_RADIUS;
        if (dist2(b.x, b.y, en.x, en.y) < hitR * hitR) {
          b.alive = false;
          en.hp--;
          en.flashT = 1;
          hits++;
          if (en.hp <= 0) {
            en.alive = false;
            onKill(en, en.x, en.y);
          }
          break;
        }
      }
    }
  }

  function updateEnemies(dt: number): void {
    const playerR2 = PLAYER_RADIUS * PLAYER_RADIUS;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i]!;
      if (!en.alive) continue;

      en.flashT = Math.max(0, en.flashT - dt * 6);

      // Trail (keep last 5 positions)
      en.trailX.push(en.x); en.trailY.push(en.y);
      if (en.trailX.length > 5) { en.trailX.shift(); en.trailY.shift(); }

      en.x += en.vx * dt;
      en.y += en.vy * dt;

      if (dist2(en.x, en.y, arenaX, arenaY) < (playerR2 + ENEMY_CONFIG[en.kind].radius ** 2 * 0.8)) {
        triggerGameover();
        return;
      }
    }
  }

  function updateParticles(dt: number): void {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]!;
      if (!p.alive) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) p.alive = false;
    }
  }

  function updateSpawn(dt: number): void {
    if (phase !== "playing") return;
    spawnAccum += dt * 1000;
    while (spawnAccum >= spawnInterval) {
      spawnAccum -= spawnInterval;
      const en = getFromPool(enemies, makeEnemy);
      spawnEnemy(en, arenaX, arenaY, arenaSize, wave);
    }
  }

  function updateAutoFire(dt: number): void {
    if (!touch.active) return;
    if (touch.autoFireCooldown > 0) {
      touch.autoFireCooldown -= dt * 1000;
      return;
    }

    if (!touch.autoFireArmed) {
      touch.autoFireTimer += dt * 1000;
      if (touch.autoFireTimer >= AUTO_FIRE_HOLD_MS) {
        touch.autoFireArmed = true;
        autoFireBurstCount = AUTO_FIRE_BURST;
        autoFireBurstTimer = 0;
        spawnBurstNext();
      }
    } else if (autoFireBurstTimer > 0) {
      autoFireBurstTimer -= dt * 1000;
      if (autoFireBurstTimer <= 0) {
        spawnBurstNext();
      }
    }
  }

  function triggerGameover(): void {
    phase = "gameover";
    vibrate([50, 50, 100]);
    cancelAnimationFrame(rafId);
    void submit("tap-rotate", score);

    if (score > best) best = score;
    bestEl.textContent = String(best);

    gameoverOverlay = showGameover(container, score, best, wave, shots, hits, restartGame);

    void computeRank("tap-rotate", score).then((rank) => {
      if (!rank || !gameoverOverlay) return;
      const box = gameoverOverlay.querySelector(".tr-go-box");
      if (!box) return;
      if (box.querySelector(".tr-rank-card")) return;
      const actions = box.querySelector(".tr-go-actions");
      if (!actions) return;
      const div = document.createElement("div");
      div.innerHTML = buildRankCard(rank, "tap-rotate");
      const card = div.firstElementChild as HTMLElement | null;
      if (!card) return;
      card.querySelector<HTMLElement>(".tr-rank-btn")?.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        navigate("/scores/tap-rotate");
      });
      box.insertBefore(card, actions);
    });
  }

  function restartGame(): void {
    score = 0; shots = 0; hits = 0;
    comboCount = 0; comboTimer = 0; comboHideTimer = 0;
    comboEl.style.display = "none";
    heading = -Math.PI / 2;
    shakeT = 0; shakeAmt = 0; gridPulse = 0;
    touch.active = false; touch.autoFireArmed = false;
    touch.autoFireTimer = 0; touch.autoFireCooldown = 0;
    autoFireBurstCount = 0; autoFireBurstTimer = 0;
    bullets.forEach((b) => { b.alive = false; });
    enemies.forEach((e) => { e.alive = false; });
    particles.forEach((p) => { p.alive = false; });
    scoreEl.textContent = "0";
    void personalBest("tap-rotate").then((b) => {
      best = b;
      bestEl.textContent = String(best);
    });
    startWave(1);
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  // ---------- render ----------

  function renderFrame(shakeAmt2: number): void {
    if (cw < 8 || ch < 8) return;
    const off = drawShakeOffset(shakeAmt2, SHAKE_DURATION, shakeT);
    ctx.save();
    ctx.translate(off.x, off.y);

    drawBackground(ctx, cw, ch, gridPulse);

    // Arena border
    ctx.strokeStyle = "rgba(255,61,104,0.25)";
    ctx.lineWidth = 1;
    const hs = arenaSize / 2;
    ctx.strokeRect(arenaX - hs, arenaY - hs, arenaSize, arenaSize);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]!;
      if (p.alive) drawParticle(ctx, p);
    }

    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i]!;
      if (en.alive) drawEnemy(ctx, en);
    }

    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i]!;
      if (b.alive) drawBullet(ctx, b);
    }

    drawPlayer(ctx, arenaX, arenaY, heading);

    ctx.restore();
  }

  // ---------- game loop ----------

  function loop(now: number): void {
    const rawDt = now - lastTime;
    lastTime = now;
    const dt = Math.min(rawDt, DT_CAP) / 1000; // seconds, capped

    if (phase === "paused") {
      rafId = requestAnimationFrame(loop);
      return;
    }

    // Wave banner timing
    if (waveBannerTimer > 0) {
      waveBannerTimer -= rawDt;
      if (waveBannerTimer <= 0) {
        waveBannerEl?.remove();
        waveBannerEl = null;
        if (phase === "waveIntro") {
          phase = "playing";
        } else if (phase === "waveComplete") {
          startWave(wave + 1);
        }
      }
    }

    if (phase === "playing") {
      waveTimer -= rawDt;
      updateAutoFire(dt);
      updateSpawn(dt);
      updateBullets(dt);
      updateEnemies(dt);
      // phase may mutate to "gameover" inside updateEnemies via triggerGameover
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      if ((phase as Phase) === "gameover") return;
      updateParticles(dt);

      if (waveTimer <= 0) {
        endWave();
      }

      // Decay effects
      gridPulse = Math.max(0, gridPulse - dt * 3);
      shakeT = Math.max(0, shakeT - rawDt);
    } else {
      updateParticles(dt);
      gridPulse = Math.max(0, gridPulse - dt * 3);
      shakeT = Math.max(0, shakeT - rawDt);
    }

    updateCombo(rawDt);

    renderFrame(shakeAmt);

    rafId = requestAnimationFrame(loop);
  }

  // ---------- controls wiring ----------

  pauseBtn.addEventListener("pointerup", () => {
    if (phase === "gameover") return;
    if (phase === "playing" || phase === "waveIntro" || phase === "waveComplete") {
      phase = "paused";
      pausedOverlay = document.createElement("div");
      pausedOverlay.className = "tr-paused-overlay";
      pausedOverlay.textContent = "PAUSED";
      canvasWrap.appendChild(pausedOverlay);
    } else if (phase === "paused") {
      phase = "playing";
      pausedOverlay?.remove();
      pausedOverlay = null;
      lastTime = performance.now();
    }
  });

  fsBtn.addEventListener("pointerup", () => {
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (target.requestFullscreen) {
      void target.requestFullscreen().catch(() => {});
    }
  });

  wrap.addEventListener("pointerdown", onPointerDown);
  wrap.addEventListener("pointermove", onPointerMove);
  wrap.addEventListener("pointerup", onPointerUp);
  wrap.addEventListener("pointercancel", onPointerCancel);
  canvasWrap.addEventListener("mousemove", onMouseMove);
  canvasWrap.addEventListener("mousedown", onMouseDown);
  document.addEventListener("keydown", onKeyDown);

  // ---------- boot ----------

  stateReady = true;
  startWave(1);
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);

  // ---------- cleanup ----------

  return function cleanup(): void {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    wrap.removeEventListener("pointerdown", onPointerDown);
    wrap.removeEventListener("pointermove", onPointerMove);
    wrap.removeEventListener("pointerup", onPointerUp);
    wrap.removeEventListener("pointercancel", onPointerCancel);
    canvasWrap.removeEventListener("mousemove", onMouseMove);
    canvasWrap.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("keydown", onKeyDown);
    gameoverOverlay?.remove();
    hintEl?.remove();
    waveBannerEl?.remove();
    pausedOverlay?.remove();
    container.innerHTML = "";
    container.classList.remove("taprotate-root");
    container.style.touchAction = prevTouchAction;
  };
}
