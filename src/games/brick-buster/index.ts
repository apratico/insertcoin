import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";
import { playSfx } from "../../lib/audio.js";
import { db } from "../../lib/storage.js";

// ─── constants ────────────────────────────────────────────────────────────────

const GAME_ID = "brick-buster";
const HINT_KEY = "brick-buster:seenHint";

const COLS = 8;
const ROWS = 6;
const BRICK_GAP = 2;

const PADDLE_H = 12;
const PADDLE_W_BASE = 80;
const BALL_R = 7;
const BASE_SPEED = 260;
const SPEED_PER_LEVEL = 20;
const SPEED_CAP = 420;
const MAX_ANGLE_DEG = 60;
const LIVES_INIT = 3;
const LIVES_MAX = 5;
const HUD_H = 44;
const TRAIL_LEN = 6;
const LIFE_LOST_MS = 1000;
const LEVEL_CLEAR_MS = 1500;
const PARTICLES_PER_BREAK = 8;

// power-up constants
const PU_DROP_CHANCE = 0.12;
const PU_SIZE = 16;
const PU_SPEED_Y = 120; // px/s downward
const PU_WIDE_DURATION = 15000;
const PU_LASER_DURATION = 12000;
const PU_SLOW_DURATION = 10000;
const PU_SLOW_FACTOR = 0.6;
const PU_WIDE_FACTOR = 1.8;
const LASER_FIRE_INTERVAL = 250; // ms between auto-shots
const LASER_BULLET_SPEED = -540; // px/s upward
const MAX_BALLS = 5;

// brick row colours (6 rows, repeating)
const ROW_COLORS = ["#ff3333", "#ff8800", "#ffee00", "#22cc55", "#2277ff", "#aa33ff"];
// bricks in rows 4-5 (0-indexed) start with HP 2
const HP_BY_ROW = [1, 1, 1, 1, 2, 2];
// slightly darker shade for HP-1 bricks (hit once)
const ROW_COLORS_HIT = ["#991111", "#994400", "#998800", "#116633", "#114488", "#661199"];

// 5 hand-crafted level patterns (8 cols × 6 rows, . = empty, 1-6 = colour index)
// After level 5, levels are procedurally generated.
const HAND_CRAFTED: string[][] = [
  // Level 1 — simple full top 3 rows
  [
    "11111111",
    "22222222",
    "33333333",
    "........",
    "........",
    "........",
  ],
  // Level 2 — 4 rows
  [
    "11111111",
    "22222222",
    "33333333",
    "44444444",
    "........",
    "........",
  ],
  // Level 3 — checkerboard 5 rows
  [
    "12121212",
    "21212121",
    "34343434",
    "43434343",
    "56565656",
    "........",
  ],
  // Level 4 — diamond hole
  [
    "11111111",
    "2222.222",  // hole centre
    "333...33",
    "4444.444",
    "55555555",
    "66666666",
  ],
  // Level 5 — full grid
  [
    "11111111",
    "22222222",
    "33333333",
    "44444444",
    "55555555",
    "66666666",
  ],
];

// ─── types ────────────────────────────────────────────────────────────────────

interface Brick {
  col: number;
  row: number;
  colorIdx: number; // 0-5 index into ROW_COLORS
  hp: number;
  maxHp: number;
  alive: boolean;
}

interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  attached: boolean; // true = sitting on paddle before launch
}

interface TrailPt {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 0-1, counts down
  color: string;
  r: number;
}

type PowerUpKind = "WIDE" | "MULTI" | "LASER" | "SLOW" | "LIFE";

interface PowerUp {
  x: number;
  y: number;
  kind: PowerUpKind;
  alive: boolean;
}

interface LaserBullet {
  x: number;
  y: number;
  alive: boolean;
}

type Phase = "playing" | "lifelost" | "levelclear" | "gameover" | "paused";

// ─── helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function degToRad(d: number): number {
  return d * (Math.PI / 180);
}

// ─── level builder ────────────────────────────────────────────────────────────

function buildBricks(level: number, arenaW: number, arenaH: number): Brick[] {
  const pattern = level <= HAND_CRAFTED.length
    ? HAND_CRAFTED[level - 1]!
    : buildProceduralPattern(level);

  const brickW = (arenaW - BRICK_GAP * (COLS + 1)) / COLS;
  const brickH = (arenaH * 0.45 - BRICK_GAP * (ROWS + 1)) / ROWS;

  const bricks: Brick[] = [];
  for (let row = 0; row < ROWS; row++) {
    const rowStr = pattern[row] ?? "........";
    for (let col = 0; col < COLS; col++) {
      const ch = rowStr[col] ?? ".";
      if (ch === ".") continue;
      const colorIdx = (parseInt(ch, 10) - 1 + ROWS) % ROWS;
      const maxHp = HP_BY_ROW[row] ?? 1;
      bricks.push({
        col,
        row,
        colorIdx,
        hp: maxHp,
        maxHp,
        alive: true,
      });
    }
  }
  // store layout geometry on the brick array via closure — returned as is,
  // callers use brickRect() with the same arenaW/arenaH
  void brickW;
  void brickH;
  return bricks;
}

function buildProceduralPattern(level: number): string[] {
  // density ramps 0.6 → 1.0 as level grows
  const density = Math.min(1, 0.6 + (level - HAND_CRAFTED.length) * 0.04);
  return Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLS }, () =>
      Math.random() < density ? String(((row % ROWS) + 1)) : "."
    ).join("")
  );
}

function brickRect(
  col: number,
  row: number,
  arenaW: number,
  arenaH: number
): { x: number; y: number; w: number; h: number } {
  const brickW = (arenaW - BRICK_GAP * (COLS + 1)) / COLS;
  const brickH = (arenaH * 0.45 - BRICK_GAP * (ROWS + 1)) / ROWS;
  const x = BRICK_GAP + col * (brickW + BRICK_GAP);
  const y = BRICK_GAP + row * (brickH + BRICK_GAP);
  return { x, y, w: brickW, h: brickH };
}

// ─── physics ─────────────────────────────────────────────────────────────────

function ballSpeed(level: number): number {
  return Math.min(SPEED_CAP, BASE_SPEED + (level - 1) * SPEED_PER_LEVEL);
}

function initBall(paddleX: number, paddleY: number): BallState {
  return {
    x: paddleX,
    y: paddleY - BALL_R - 2,
    vx: 0,
    vy: 0,
    attached: true,
  };
}

function launchBall(ball: BallState, level: number): void {
  const speed = ballSpeed(level);
  // random angle 50–130 degrees (measuring from +x axis, counter-clockwise, so "up" = 90)
  const angleDeg = 50 + Math.random() * 80;
  const rad = degToRad(angleDeg);
  ball.vx = speed * Math.cos(rad);
  ball.vy = -speed * Math.sin(rad); // negative = up on canvas
  ball.attached = false;
}

function paddleBounce(
  ball: BallState,
  paddleCx: number,
  paddleW: number,
  level: number
): void {
  const speed = ballSpeed(level);
  const hitX = ball.x - paddleCx;
  const halfPaddle = paddleW / 2;
  const normalised = clamp(hitX / halfPaddle, -1, 1);
  const angleDeg = 90 + normalised * MAX_ANGLE_DEG; // 30–150 deg from +x axis
  const rad = degToRad(angleDeg);
  ball.vx = speed * Math.cos(rad);
  ball.vy = -Math.abs(speed * Math.sin(rad)); // always upward
}

// AABB collision: returns side hit or null
function ballVsRect(
  bx: number,
  by: number,
  prevBx: number,
  prevBy: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): "top" | "bottom" | "left" | "right" | null {
  // expand rect by ball radius
  const ex = rx - BALL_R;
  const ey = ry - BALL_R;
  const ew = rw + BALL_R * 2;
  const eh = rh + BALL_R * 2;

  if (bx < ex || bx > ex + ew || by < ey || by > ey + eh) return null;

  // determine side from previous position
  const overlapX = Math.min(bx - ex, ex + ew - bx);
  const overlapY = Math.min(by - ey, ey + eh - by);

  if (overlapX < overlapY) {
    // horizontal hit
    return prevBx < rx ? "left" : "right";
  }
  // vertical hit
  return prevBy < ry ? "top" : "bottom";
}

// ─── power-up helpers ─────────────────────────────────────────────────────────

const PU_WEIGHTS: [PowerUpKind, number][] = [
  ["WIDE", 25],
  ["MULTI", 20],
  ["LASER", 20],
  ["SLOW", 20],
  ["LIFE", 15],
];
const PU_TOTAL_WEIGHT = PU_WEIGHTS.reduce((s, [, w]) => s + w, 0);

function randomPowerUpKind(): PowerUpKind {
  let r = Math.random() * PU_TOTAL_WEIGHT;
  for (const [kind, w] of PU_WEIGHTS) {
    r -= w;
    if (r <= 0) return kind;
  }
  return "WIDE";
}

function puColor(kind: PowerUpKind): string {
  switch (kind) {
    case "WIDE":  return "#00eeff";
    case "MULTI": return "#ff00aa";
    case "LASER": return "#ff3333";
    case "SLOW":  return "#44ff66";
    case "LIFE":  return "#ffcc00";
  }
}

function puLabel(kind: PowerUpKind): string {
  switch (kind) {
    case "WIDE":  return "W";
    case "MULTI": return "M";
    case "LASER": return "L";
    case "SLOW":  return "S";
    case "LIFE":  return "+";
  }
}

// ─── particles ───────────────────────────────────────────────────────────────

function spawnParticles(
  particles: Particle[],
  cx: number,
  cy: number,
  color: string
): void {
  for (let i = 0; i < PARTICLES_PER_BREAK; i++) {
    const angle = (Math.PI * 2 * i) / PARTICLES_PER_BREAK + Math.random() * 0.4;
    const speed = 40 + Math.random() * 80;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      color,
      r: 2 + Math.random() * 2,
    });
  }
}

// ─── styles ──────────────────────────────────────────────────────────────────

function injectStyles(): void {
  const ID = "bb-styles";
  if (document.getElementById(ID)) return;
  const s = document.createElement("style");
  s.id = ID;
  s.textContent = `
    .bb-root { display:flex; flex-direction:column; flex:1; min-height:0; }
    .bb-wrap { display:flex; flex-direction:column; flex:1; min-height:0; background:#0a0a1a; }
    .bb-hud {
      display:flex; align-items:center; justify-content:space-between;
      height:${HUD_H}px; padding:0 10px; flex-shrink:0;
      background:rgba(0,0,0,0.5); border-bottom:1px solid #1a1a3a;
      font-family:'Press Start 2P',ui-monospace,monospace; color:#fff; font-size:8px;
    }
    .bb-hud-left { display:flex; gap:10px; align-items:center; }
    .bb-hud-right { display:flex; gap:6px; align-items:center; }
    .bb-hud-score { color:#ff6600; font-size:9px; }
    .bb-hud-lives { color:#ff4444; letter-spacing:2px; font-size:11px; }
    .bb-hud-level { color:#aaccff; }
    .bb-hud-btn {
      background:transparent; border:1px solid #333; color:#aaa;
      font-size:14px; padding:0; width:36px; height:36px; cursor:pointer;
      border-radius:4px; display:flex; align-items:center; justify-content:center;
    }
    .bb-hud-btn:active { background:#222; }
    .bb-canvas-wrap { flex:1; min-height:0; position:relative; overflow:hidden; display:flex; align-items:center; justify-content:center; }
    .bb-canvas { display:block; image-rendering:pixelated; }
    .bb-overlay {
      position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,0.72); z-index:10;
      font-family:'Press Start 2P',ui-monospace,monospace;
    }
    .bb-go-box {
      background:#0d0d28; border:2px solid #ff6600; border-radius:10px;
      padding:28px 24px; text-align:center; color:#fff; max-width:300px; width:90%;
      display:flex; flex-direction:column; gap:10px; align-items:center;
    }
    .bb-go-title { font-size:18px; color:#ff6600; margin:0; }
    .bb-go-new { font-size:9px; color:#ffee44; }
    .bb-go-score { font-size:32px; color:#ffffff; }
    .bb-go-sublabel { font-size:7px; color:#888; margin-top:-4px; }
    .bb-go-best { font-size:8px; color:#aaa; }
    .bb-go-level { font-size:8px; color:#aaccff; }
    .bb-go-actions { display:flex; gap:10px; margin-top:6px; }
    .bb-go-btn { font-family:'Press Start 2P',ui-monospace,monospace; font-size:8px; padding:10px 14px; cursor:pointer; border-radius:6px; }
    .bb-go-btn.primary { background:#ff6600; border:none; color:#fff; }
    .bb-go-btn:not(.primary) { background:transparent; border:1px solid #555; color:#aaa; }
    .bb-hint {
      position:absolute; inset:0; pointer-events:none; display:flex; flex-direction:column;
      align-items:center; justify-content:flex-end; padding-bottom:80px; gap:10px;
      font-family:'Press Start 2P',ui-monospace,monospace; font-size:9px; color:rgba(255,255,255,0.85);
      text-align:center; text-shadow:0 0 8px #000;
    }
    .rank-card {
      background:rgba(255,102,0,0.1); border:1px solid #ff6600; border-radius:6px;
      padding:8px 12px; font-size:7px; color:#ccc; text-align:center;
      width:100%; box-sizing:border-box;
    }
    .rank-card-title { color:#ff6600; margin-bottom:4px; font-size:8px; }
    .rank-card-delta { font-size:7px; margin-bottom:4px; }
    .rank-card-btn {
      font-family:'Press Start 2P',ui-monospace,monospace; font-size:6px;
      background:transparent; border:1px solid #ff6600; color:#ff6600;
      padding:4px 8px; border-radius:4px; cursor:pointer; margin-top:4px;
    }
  `;
  document.head.appendChild(s);
}

// ─── gameover overlay ─────────────────────────────────────────────────────────

function buildRankCard(rank: RankInfo): string {
  const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="rank-card-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta}</div>`
    : "";
  return `<div class="rank-card">
    <div class="rank-card-title">RANK ${rankLabel} GLOBAL</div>
    ${deltaHtml}
    <button class="rank-card-btn" data-scores-id="${GAME_ID}">VIEW LEADERBOARD</button>
  </div>`;
}

function showGameoverOverlay(
  container: HTMLElement,
  score: number,
  best: number,
  level: number,
  onReplay: () => void
): { el: HTMLElement; addRank: (r: RankInfo) => void } {
  const isNew = score >= best && score > 0;
  const overlay = document.createElement("div");
  overlay.className = "bb-overlay";
  overlay.innerHTML = `
    <div class="bb-go-box">
      <h2 class="bb-go-title">GAME OVER</h2>
      ${isNew ? `<div class="bb-go-new">NEW BEST!</div>` : ""}
      <div class="bb-go-score">${score}</div>
      <div class="bb-go-sublabel">SCORE</div>
      <div class="bb-go-best">BEST ${best}</div>
      <div class="bb-go-level">LEVEL ${level}</div>
      <div class="bb-go-actions">
        <button class="btn primary bb-go-btn" id="bb-replay">PLAY AGAIN</button>
        <button class="btn bb-go-btn" id="bb-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector("#bb-replay")?.addEventListener("pointerup", () => {
    overlay.remove();
    onReplay();
  });
  overlay.querySelector("#bb-menu")?.addEventListener("pointerup", () => {
    navigate("/");
  });

  function addRank(rank: RankInfo): void {
    const box = overlay.querySelector(".bb-go-box");
    if (!box || box.querySelector(".rank-card")) return;
    const actions = box.querySelector(".bb-go-actions");
    if (!actions) return;
    const div = document.createElement("div");
    div.innerHTML = buildRankCard(rank);
    const cardEl = div.firstElementChild as HTMLElement | null;
    if (!cardEl) return;
    cardEl.querySelector<HTMLElement>(".rank-card-btn")?.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      navigate(`/scores/${GAME_ID}`);
    });
    box.insertBefore(cardEl, actions);
  }

  return { el: overlay, addRank };
}

// ─── draw helpers ─────────────────────────────────────────────────────────────

function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0a0a1a");
  grad.addColorStop(1, "#0f0f2e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // subtle grid
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 0.5;
  const gridSize = 24;
  for (let gx = 0; gx < w; gx += gridSize) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
  }
  for (let gy = 0; gy < h; gy += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
  }
}

function drawBrick(
  ctx: CanvasRenderingContext2D,
  brick: Brick,
  arenaW: number,
  arenaH: number,
  flashBricks: Set<number>
): void {
  const key = brick.row * COLS + brick.col;
  const r = brickRect(brick.col, brick.row, arenaW, arenaH);
  const color = brick.hp < brick.maxHp
    ? ROW_COLORS_HIT[brick.colorIdx] ?? "#555"
    : ROW_COLORS[brick.colorIdx] ?? "#888";

  const isFlash = flashBricks.has(key);
  ctx.fillStyle = isFlash ? "#ffffff" : color;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 2);
  ctx.fill();

  if (!isFlash) {
    // top highlight
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(r.x + 2, r.y + 1, r.w - 4, 3);

    // bottom shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(r.x + 2, r.y + r.h - 3, r.w - 4, 3);

    // crack on HP < maxHp
    if (brick.hp < brick.maxHp) {
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.3, r.y + 2);
      ctx.lineTo(r.x + r.w * 0.55, r.y + r.h * 0.5);
      ctx.lineTo(r.x + r.w * 0.7, r.y + r.h - 2);
      ctx.stroke();
    }
  }
}

function drawPaddle(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  paddleW: number,
  flashPaddle: number,
  laserActive: boolean,
  laserFlash: number
): void {
  const glow = flashPaddle > 0 ? 18 : 8;
  ctx.save();
  ctx.shadowColor = laserActive ? "#ff3333" : "#ff6600";
  ctx.shadowBlur = glow;
  const grad = ctx.createLinearGradient(px - paddleW / 2, py, px - paddleW / 2, py + PADDLE_H);
  if (flashPaddle > 0) {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#ffaa44");
  } else if (laserActive) {
    grad.addColorStop(0, "#ff6644");
    grad.addColorStop(1, "#cc2200");
  } else {
    grad.addColorStop(0, "#ff8800");
    grad.addColorStop(1, "#cc4400");
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(px - paddleW / 2, py, paddleW, PADDLE_H, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // laser cannons on paddle edges
  if (laserActive) {
    const muzzleColor = laserFlash > 0 ? "#ffff44" : "#ff8833";
    ctx.shadowColor = muzzleColor;
    ctx.shadowBlur = laserFlash > 0 ? 14 : 6;

    // left cannon — small upward triangle
    const lx = px - paddleW / 2 + 4;
    ctx.fillStyle = muzzleColor;
    ctx.beginPath();
    ctx.moveTo(lx, py);
    ctx.lineTo(lx - 3, py + 6);
    ctx.lineTo(lx + 3, py + 6);
    ctx.closePath();
    ctx.fill();

    // right cannon
    const rx2 = px + paddleW / 2 - 4;
    ctx.beginPath();
    ctx.moveTo(rx2, py);
    ctx.lineTo(rx2 - 3, py + 6);
    ctx.lineTo(rx2 + 3, py + 6);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  ball: BallState,
  trail: TrailPt[],
  slowActive: boolean
): void {
  // trail
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i]!;
    const alphaRatio = (i + 1) / (trail.length + 1);
    const r = BALL_R * (0.4 + alphaRatio * 0.6);
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.fillStyle = slowActive
      ? `rgba(100,255,130,${(alphaRatio * 0.4).toFixed(2)})`
      : `rgba(255,255,255,${(alphaRatio * 0.4).toFixed(2)})`;
    ctx.fill();
  }
  // main ball
  ctx.save();
  const ballColor = slowActive ? "#88ffaa" : "#ffffff";
  ctx.shadowColor = ballColor;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = ballColor;
  ctx.fill();
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  for (const p of particles) {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawOverlayText(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  text: string,
  color: string
): void {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "bold 24px 'Press Start 2P', ui-monospace, monospace";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillText(text, w / 2, h / 2);
  ctx.restore();
}

function drawPowerUps(
  ctx: CanvasRenderingContext2D,
  powerups: PowerUp[],
  now: number
): void {
  for (const pu of powerups) {
    if (!pu.alive) continue;
    const color = puColor(pu.kind);
    const label = puLabel(pu.kind);
    const pulse = 6 + 4 * Math.sin(now * 0.006);

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = pulse;

    // gradient fill
    const half = PU_SIZE / 2;
    const grad = ctx.createLinearGradient(pu.x - half, pu.y - half, pu.x - half, pu.y + half);
    grad.addColorStop(0, lightenColor(color, 0.4));
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(pu.x - half, pu.y - half, PU_SIZE, PU_SIZE, 4);
    ctx.fill();

    // border
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // letter
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${PU_SIZE - 4}px 'Press Start 2P', ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, pu.x, pu.y + 1);

    ctx.restore();
  }
}

function drawLaserBullets(
  ctx: CanvasRenderingContext2D,
  bullets: LaserBullet[]
): void {
  ctx.save();
  ctx.strokeStyle = "#ff6600";
  ctx.shadowColor = "#ff4400";
  ctx.shadowBlur = 6;
  ctx.lineWidth = 2;
  for (const b of bullets) {
    if (!b.alive) continue;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x, b.y + 8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPowerUpHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  activeTimers: ActivePowerUpTimers,
  now: number
): void {
  // show active timed power-ups as small badges at top-centre
  type Badge = { label: string; color: string; remaining: number; total: number };
  const badges: Badge[] = [];

  if (activeTimers.wideUntil > now) {
    badges.push({ label: "W", color: "#00eeff", remaining: activeTimers.wideUntil - now, total: PU_WIDE_DURATION });
  }
  if (activeTimers.laserUntil > now) {
    badges.push({ label: "L", color: "#ff3333", remaining: activeTimers.laserUntil - now, total: PU_LASER_DURATION });
  }
  if (activeTimers.slowUntil > now) {
    badges.push({ label: "S", color: "#44ff66", remaining: activeTimers.slowUntil - now, total: PU_SLOW_DURATION });
  }
  if (activeTimers.multiActive) {
    badges.push({ label: "M", color: "#ff00aa", remaining: 1, total: 1 });
  }

  if (badges.length === 0) return;

  const badgeW = 22;
  const badgeH = 18;
  const gap = 4;
  const totalW = badges.length * (badgeW + gap) - gap;
  let bx = (w - totalW) / 2;
  const by = 4;

  ctx.save();
  for (const badge of badges) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = badge.color;
    ctx.beginPath();
    ctx.roundRect(bx, by, badgeW, badgeH, 3);
    ctx.fill();

    // timer bar (bottom strip)
    const barW = (badge.remaining / badge.total) * (badgeW - 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx + 1, by + badgeH - 4, badgeW - 2, 3);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(bx + 1, by + badgeH - 4, Math.max(0, barW), 3);

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.font = `bold 8px 'Press Start 2P', ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badge.label, bx + badgeW / 2, by + badgeH / 2 - 1);

    bx += badgeW + gap;
  }
  ctx.restore();
}

// lighten a hex color by factor 0–1 (add white)
function lightenColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * factor));
  const lg = Math.min(255, Math.round(g + (255 - g) * factor));
  const lb = Math.min(255, Math.round(b + (255 - b) * factor));
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

// ─── active power-up timer state ──────────────────────────────────────────────

interface ActivePowerUpTimers {
  wideUntil: number;   // timestamp ms; 0 = inactive
  laserUntil: number;
  slowUntil: number;
  multiActive: boolean;
  // stored original speed components per ball to restore on slow expiry
  originalSpeeds: Map<BallState, number>; // stores original |speed| per ball
}

function makeTimers(): ActivePowerUpTimers {
  return {
    wideUntil: 0,
    laserUntil: 0,
    slowUntil: 0,
    multiActive: false,
    originalSpeeds: new Map(),
  };
}

// ─── mount ────────────────────────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.classList.add("bb-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // ── DOM structure ──
  const wrap = document.createElement("div");
  wrap.className = "bb-wrap";
  container.appendChild(wrap);

  const hud = document.createElement("div");
  hud.className = "bb-hud";
  hud.innerHTML = `
    <div class="bb-hud-left">
      <span class="bb-hud-score" id="bb-score">0</span>
      <span class="bb-hud-lives" id="bb-lives">❤❤❤</span>
      <span class="bb-hud-level" id="bb-level">LVL 1</span>
    </div>
    <div class="bb-hud-right">
      <button class="bb-hud-btn" id="bb-fs" aria-label="Fullscreen">⛶</button>
      <button class="bb-hud-btn" id="bb-pause" aria-label="Pause">⏸</button>
    </div>
  `;
  wrap.appendChild(hud);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "bb-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "bb-canvas";
  canvasWrap.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx: CanvasRenderingContext2D = ctxRaw;

  // ── onboarding hint ──
  let hintEl: HTMLElement | null = null;
  void db.settings.get(HINT_KEY).then((row) => {
    if (row) return;
    const el = document.createElement("div");
    el.className = "bb-hint";
    el.innerHTML = `<div>DRAG TO MOVE PADDLE</div><div>TAP TO LAUNCH BALL</div>`;
    canvasWrap.appendChild(el);
    hintEl = el;
    const dismiss = (): void => {
      if (!hintEl) return;
      hintEl.remove();
      hintEl = null;
      void db.settings.put({ key: HINT_KEY, value: "1" });
    };
    setTimeout(dismiss, 5000);
    canvas.addEventListener("pointerdown", dismiss, { once: true });
  });

  // ── state ──
  let canvasW = 0;
  let canvasH = 0;
  let stateReady = false;
  let phase: Phase = "playing";
  let paused = false;
  let rafId = 0;
  let lastTime = 0;

  let level = 1;
  let score = 0;
  let lives = LIVES_INIT;
  let best = 0;

  let paddleX = 0; // centre x
  let paddleY = 0;
  let paddleW = PADDLE_W_BASE;

  // balls array — replaces single ball; index 0 is always the "primary" ball
  let balls: BallState[] = [];
  // per-ball trails; parallel array indexed same as balls
  let trails: TrailPt[][] = [];

  let particles: Particle[] = [];
  let bricks: Brick[] = [];
  let powerups: PowerUp[] = [];
  let laserBullets: LaserBullet[] = [];

  let flashPaddle = 0; // countdown frames
  let flashBricks: Set<number> = new Set();
  let phaseTimer = 0; // ms for lifelost / levelclear
  let gameoverEl: { el: HTMLElement; addRank: (r: RankInfo) => void } | null = null;

  let timers: ActivePowerUpTimers = makeTimers();
  let laserFireAccum = 0; // ms accumulator for laser auto-fire
  let laserFlash = 0;     // frame countdown for muzzle flash

  // ── helpers that depend on closure state ──

  function primaryBall(): BallState | null {
    return balls[0] ?? null;
  }

  // HUD update helpers
  function updateHudScore(): void {
    const el = hud.querySelector<HTMLElement>("#bb-score");
    if (el) el.textContent = String(score);
  }
  function updateHudLives(): void {
    const el = hud.querySelector<HTMLElement>("#bb-lives");
    if (el) el.textContent = "❤".repeat(Math.max(0, lives));
  }
  function updateHudLevel(): void {
    const el = hud.querySelector<HTMLElement>("#bb-level");
    if (el) el.textContent = `LVL ${level}`;
  }

  // ── load best ──
  void personalBest(GAME_ID).then((b) => { best = b; });

  // ── resize & init ──
  function onResize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvasWrap.clientWidth;
    const ch = canvasWrap.clientHeight;
    if (cw < 8 || ch < 8) return;

    // viewport cap: fit 375×667 without overflow
    const maxW = Math.min(cw, 375);
    const maxH = Math.min(ch, 667);

    canvas.style.width = `${maxW}px`;
    canvas.style.height = `${maxH}px`;
    canvas.width = Math.round(maxW * dpr);
    canvas.height = Math.round(maxH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    canvasW = maxW;
    canvasH = maxH;
    stateReady = true;
    onAfterResize();
  }

  function onAfterResize(): void {
    if (!stateReady) return;
    // reposition paddle and primary ball
    paddleY = canvasH - 30;
    if (paddleX === 0) paddleX = canvasW / 2;
    paddleX = clamp(paddleX, paddleW / 2, canvasW - paddleW / 2);
    const pb = primaryBall();
    if (pb?.attached) {
      pb.x = paddleX;
      pb.y = paddleY - BALL_R - 2;
    }
    // rebuild bricks if size changed significantly
    bricks = buildBricks(level, canvasW, canvasH);
    drawFrame(0);
  }

  function clearPowerUpState(): void {
    powerups = [];
    laserBullets = [];
    laserFireAccum = 0;
    laserFlash = 0;
    timers = makeTimers();
    paddleW = PADDLE_W_BASE;
  }

  function startLevel(lv: number): void {
    level = lv;
    paddleX = canvasW / 2;
    paddleW = PADDLE_W_BASE;
    balls = [initBall(paddleX, paddleY)];
    trails = [[]];
    bricks = buildBricks(level, canvasW, canvasH);
    particles = [];
    flashBricks = new Set();
    flashPaddle = 0;
    clearPowerUpState();
    phase = "playing";
    updateHudLevel();
  }

  function resetGame(): void {
    score = 0;
    lives = LIVES_INIT;
    level = 1;
    gameoverEl = null;
    updateHudScore();
    updateHudLives();
    updateHudLevel();
    paddleX = canvasW / 2;
    paddleY = canvasH - 30;
    paddleW = PADDLE_W_BASE;
    balls = [initBall(paddleX, paddleY)];
    trails = [[]];
    bricks = buildBricks(level, canvasW, canvasH);
    particles = [];
    flashBricks = new Set();
    flashPaddle = 0;
    clearPowerUpState();
    phase = "playing";
    paused = false;
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  // ── input ──

  // pointer drag for paddle
  let pointerDown = false;

  function handlePointerMove(e: PointerEvent): void {
    if (!pointerDown) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasW / rect.width);
    paddleX = clamp(x, paddleW / 2, canvasW - paddleW / 2);
    const pb = primaryBall();
    if (pb?.attached) {
      pb.x = paddleX;
      pb.y = paddleY - BALL_R - 2;
    }
  }

  function handlePointerDown(e: PointerEvent): void {
    pointerDown = true;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasW / rect.width);
    paddleX = clamp(x, paddleW / 2, canvasW - paddleW / 2);
    const pb = primaryBall();
    if (pb?.attached) {
      pb.x = paddleX;
    }
  }

  function handlePointerUp(): void {
    pointerDown = false;
    if (phase !== "playing" || paused) return;
    const pb = primaryBall();
    if (pb?.attached) {
      doLaunch();
    }
  }

  function doLaunch(): void {
    const pb = primaryBall();
    if (!pb) return;
    launchBall(pb, level);
    playSfx("shoot");
    if ("vibrate" in navigator) navigator.vibrate(4);
    if (hintEl) {
      hintEl.remove();
      hintEl = null;
      void db.settings.put({ key: HINT_KEY, value: "1" });
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === " " || e.key === "Space") {
      e.preventDefault();
      const pb = primaryBall();
      if (phase === "playing" && !paused && pb?.attached) doLaunch();
    }
    if (e.key === "ArrowLeft") {
      paddleX = clamp(paddleX - 40, paddleW / 2, canvasW - paddleW / 2);
      const pb = primaryBall();
      if (pb?.attached) { pb.x = paddleX; pb.y = paddleY - BALL_R - 2; }
    }
    if (e.key === "ArrowRight") {
      paddleX = clamp(paddleX + 40, paddleW / 2, canvasW - paddleW / 2);
      const pb = primaryBall();
      if (pb?.attached) { pb.x = paddleX; pb.y = paddleY - BALL_R - 2; }
    }
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      togglePause();
    }
  }

  function togglePause(): void {
    if (phase !== "playing") return;
    paused = !paused;
    const btn = hud.querySelector<HTMLElement>("#bb-pause");
    if (btn) btn.textContent = paused ? "▶" : "⏸";
    if (!paused) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);
  window.addEventListener("keydown", handleKeyDown);

  hud.querySelector("#bb-pause")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    togglePause();
  });
  hud.querySelector("#bb-fs")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const host = container.closest<HTMLElement>(".game-host");
    if (host?.requestFullscreen) void host.requestFullscreen();
  });

  // ── power-up activation ──────────────────────────────────────────────────────

  function activatePowerUp(kind: PowerUpKind): void {
    const now = performance.now();

    switch (kind) {
      case "WIDE": {
        // reset timer; only scale paddleW once if not already wide
        const alreadyWide = timers.wideUntil > now;
        timers.wideUntil = now + PU_WIDE_DURATION;
        if (!alreadyWide) {
          paddleW = clamp(PADDLE_W_BASE * PU_WIDE_FACTOR, PADDLE_W_BASE, canvasW - 8);
          paddleX = clamp(paddleX, paddleW / 2, canvasW - paddleW / 2);
        }
        break;
      }

      case "MULTI": {
        // spawn up to 2 extra balls if we have room
        const launched = balls.filter((b) => !b.attached);
        if (launched.length === 0) break; // no flying ball to clone from

        const source = launched[0]!;
        const count = Math.min(2, MAX_BALLS - balls.length);
        for (let i = 0; i < count; i++) {
          const spread = degToRad((i === 0 ? -25 : 25) + (Math.random() * 10 - 5));
          const speed = Math.hypot(source.vx, source.vy);
          const baseAngle = Math.atan2(source.vy, source.vx);
          const newAngle = baseAngle + spread;
          const nb: BallState = {
            x: source.x,
            y: source.y,
            vx: Math.cos(newAngle) * speed,
            vy: Math.sin(newAngle) * speed,
            attached: false,
          };
          balls.push(nb);
          trails.push([]);
          // if slow is active, record original speed for new ball too
          if (timers.slowUntil > now) {
            timers.originalSpeeds.set(nb, speed / PU_SLOW_FACTOR);
          }
        }
        timers.multiActive = true;
        break;
      }

      case "LASER": {
        timers.laserUntil = now + PU_LASER_DURATION;
        break;
      }

      case "SLOW": {
        const alreadySlow = timers.slowUntil > now;
        timers.slowUntil = now + PU_SLOW_DURATION;
        if (!alreadySlow) {
          for (const b of balls) {
            if (b.attached) continue;
            const spd = Math.hypot(b.vx, b.vy);
            timers.originalSpeeds.set(b, spd);
            const factor = PU_SLOW_FACTOR / 1; // multiply velocity by ratio
            b.vx *= PU_SLOW_FACTOR;
            b.vy *= PU_SLOW_FACTOR;
            void factor;
          }
        }
        break;
      }

      case "LIFE": {
        lives = Math.min(LIVES_MAX, lives + 1);
        updateHudLives();
        playSfx("levelup");
        break;
      }
    }
  }

  function restoreWide(): void {
    paddleW = PADDLE_W_BASE;
    paddleX = clamp(paddleX, paddleW / 2, canvasW - paddleW / 2);
  }

  function restoreSlow(): void {
    for (const b of balls) {
      const orig = timers.originalSpeeds.get(b);
      if (orig === undefined) continue;
      const cur = Math.hypot(b.vx, b.vy);
      if (cur < 0.001) continue;
      const ratio = orig / cur;
      b.vx *= ratio;
      b.vy *= ratio;
    }
    timers.originalSpeeds.clear();
  }

  // ── game loop ──

  function loop(now: number): void {
    if (paused) return;
    const dt = Math.min(now - lastTime, 32) / 1000;
    lastTime = now;
    update(dt, now);
    drawFrame(dt);
    rafId = requestAnimationFrame(loop);
  }

  function update(dt: number, now: number): void {
    if (!stateReady) return;

    // ── particles ──
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt; // gravity on particles
      p.life -= dt * 2.5;
    }
    particles = particles.filter((p) => p.life > 0);

    // ── flash countdown ──
    if (flashPaddle > 0) flashPaddle--;
    if (laserFlash > 0) laserFlash--;
    if (flashBricks.size > 0) flashBricks = new Set(); // one-frame flash

    // ── timer-based phases ──
    if (phase === "lifelost" || phase === "levelclear") {
      phaseTimer -= dt * 1000;
      if (phaseTimer <= 0) {
        if (phase === "lifelost") {
          if (lives <= 0) {
            doGameover();
          } else {
            // reset to single ball on paddle, keep bricks
            balls = [initBall(paddleX, paddleY)];
            trails = [[]];
            clearPowerUpState();
            phase = "playing";
          }
        } else {
          // level clear
          startLevel(level + 1);
          lastTime = performance.now();
        }
      }
      return;
    }

    if (phase !== "playing") return;

    // ── power-up expiry ──
    if (timers.wideUntil > 0 && now >= timers.wideUntil) {
      timers.wideUntil = 0;
      restoreWide();
    }
    if (timers.slowUntil > 0 && now >= timers.slowUntil) {
      timers.slowUntil = 0;
      restoreSlow();
    }
    if (timers.laserUntil > 0 && now >= timers.laserUntil) {
      timers.laserUntil = 0;
      laserBullets = [];
      laserFireAccum = 0;
    }

    // ── laser auto-fire ──
    if (timers.laserUntil > now) {
      laserFireAccum += dt * 1000;
      if (laserFireAccum >= LASER_FIRE_INTERVAL) {
        laserFireAccum -= LASER_FIRE_INTERVAL;
        // spawn two bullets at paddle left/right edges
        const leftX = paddleX - paddleW / 2 + 4;
        const rightX = paddleX + paddleW / 2 - 4;
        laserBullets.push({ x: leftX, y: paddleY, alive: true });
        laserBullets.push({ x: rightX, y: paddleY, alive: true });
        laserFlash = 3;
        // debounce: sfx only occasionally
        if (Math.random() < 0.4) playSfx("shoot");
      }
    }

    // ── laser bullet movement + brick collision ──
    for (const bullet of laserBullets) {
      if (!bullet.alive) continue;
      bullet.y += LASER_BULLET_SPEED * dt;
      if (bullet.y < 0) { bullet.alive = false; continue; }

      for (const brick of bricks) {
        if (!brick.alive) continue;
        const r = brickRect(brick.col, brick.row, canvasW, canvasH);
        if (
          bullet.x >= r.x && bullet.x <= r.x + r.w &&
          bullet.y >= r.y && bullet.y <= r.y + r.h
        ) {
          bullet.alive = false;
          brick.hp--;
          if (brick.hp <= 0) {
            brick.alive = false;
            score += 10;
            const key = brick.row * COLS + brick.col;
            flashBricks.add(key);
            spawnParticles(particles, r.x + r.w / 2, r.y + r.h / 2, ROW_COLORS[brick.colorIdx] ?? "#fff");
            maybeDrop(r.x + r.w / 2, r.y + r.h / 2);
            playSfx("kill");
            if ("vibrate" in navigator) navigator.vibrate(10);
          } else {
            const key = brick.row * COLS + brick.col;
            flashBricks.add(key);
            score += 5;
          }
          updateHudScore();
          break;
        }
      }
    }
    laserBullets = laserBullets.filter((b) => b.alive);

    // ── falling power-ups movement + paddle collision ──
    for (const pu of powerups) {
      if (!pu.alive) continue;
      pu.y += PU_SPEED_Y * dt;
      if (pu.y > canvasH + PU_SIZE) {
        pu.alive = false;
        continue;
      }
      // paddle collision (AABB with paddle rect)
      const pLeft = paddleX - paddleW / 2;
      if (
        pu.x + PU_SIZE / 2 >= pLeft &&
        pu.x - PU_SIZE / 2 <= pLeft + paddleW &&
        pu.y + PU_SIZE / 2 >= paddleY &&
        pu.y - PU_SIZE / 2 <= paddleY + PADDLE_H
      ) {
        pu.alive = false;
        activatePowerUp(pu.kind);
        spawnParticles(particles, pu.x, pu.y, puColor(pu.kind));
        if (pu.kind !== "LIFE") playSfx("score");
        if ("vibrate" in navigator) navigator.vibrate(10);
      }
    }
    powerups = powerups.filter((p) => p.alive);

    // ── balls ──
    // if all balls are attached (should be only 1), nothing to move
    const anyFlying = balls.some((b) => !b.attached);
    if (!anyFlying) return;

    const deadBallIndices: number[] = [];

    for (let bi = 0; bi < balls.length; bi++) {
      const ball = balls[bi]!;
      const trail = trails[bi] ?? [];

      if (ball.attached) continue;

      const prevX = ball.x;
      const prevY = ball.y;

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // trail update
      trail.unshift({ x: prevX, y: prevY });
      if (trail.length > TRAIL_LEN) trail.pop();

      // wall collisions
      if (ball.x - BALL_R < 0) {
        ball.x = BALL_R;
        ball.vx = Math.abs(ball.vx);
      }
      if (ball.x + BALL_R > canvasW) {
        ball.x = canvasW - BALL_R;
        ball.vx = -Math.abs(ball.vx);
      }
      if (ball.y - BALL_R < 0) {
        ball.y = BALL_R;
        ball.vy = Math.abs(ball.vy);
      }

      // fallen below paddle
      if (ball.y - BALL_R > canvasH) {
        deadBallIndices.push(bi);
        continue;
      }

      // paddle collision
      const pLeft = paddleX - paddleW / 2;
      const side = ballVsRect(ball.x, ball.y, prevX, prevY, pLeft, paddleY, paddleW, PADDLE_H);
      if (side !== null && ball.vy > 0) {
        paddleBounce(ball, paddleX, paddleW, level);
        flashPaddle = 4;
        // restore slow speed after bounce (bounce resets speed to level default)
        if (timers.slowUntil > now) {
          ball.vx *= PU_SLOW_FACTOR;
          ball.vy *= PU_SLOW_FACTOR;
          timers.originalSpeeds.set(ball, ballSpeed(level));
        }
        if (bi === 0) {
          playSfx("bounce");
          if ("vibrate" in navigator) navigator.vibrate(4);
        }
      }

      // brick collisions
      for (const brick of bricks) {
        if (!brick.alive) continue;
        const r = brickRect(brick.col, brick.row, canvasW, canvasH);
        const bs = ballVsRect(ball.x, ball.y, prevX, prevY, r.x, r.y, r.w, r.h);
        if (bs === null) continue;

        // reflect
        if (bs === "top" || bs === "bottom") {
          ball.vy = -ball.vy;
          // re-apply slow factor after reflection
          if (timers.slowUntil > now) {
            const spd = Math.hypot(ball.vx, ball.vy);
            const target = ballSpeed(level) * PU_SLOW_FACTOR;
            if (Math.abs(spd - target) > 5) {
              const ratio = target / Math.max(spd, 1);
              ball.vx *= ratio;
              ball.vy *= ratio;
            }
          }
        } else {
          ball.vx = -ball.vx;
        }

        brick.hp--;
        if (brick.hp <= 0) {
          brick.alive = false;
          score += 10;
          const key = brick.row * COLS + brick.col;
          flashBricks.add(key);
          spawnParticles(particles, r.x + r.w / 2, r.y + r.h / 2, ROW_COLORS[brick.colorIdx] ?? "#fff");
          maybeDrop(r.x + r.w / 2, r.y + r.h / 2);
          playSfx("kill");
          if ("vibrate" in navigator) navigator.vibrate(10);
        } else {
          const key = brick.row * COLS + brick.col;
          flashBricks.add(key);
          score += 5;
          playSfx("pop");
          if ("vibrate" in navigator) navigator.vibrate(6);
        }
        updateHudScore();
        break; // one brick per frame per ball
      }
    }

    // remove dead balls
    if (deadBallIndices.length > 0) {
      // capture refs before filter so we can clean up the speed map
      const deadRefs = deadBallIndices.map((i) => balls[i]).filter((b): b is BallState => b !== undefined);
      const keepMask = balls.map((_, i) => !deadBallIndices.includes(i));
      balls = balls.filter((_, i) => keepMask[i]);
      trails = trails.filter((_, i) => keepMask[i]);
      for (const deadBall of deadRefs) {
        timers.originalSpeeds.delete(deadBall);
      }
    }

    // if all balls gone → life lost
    if (balls.length === 0) {
      triggerLifeLost();
      return;
    }

    // check level clear
    if (bricks.every((b) => !b.alive)) {
      triggerLevelClear();
    }
  }

  function maybeDrop(cx: number, cy: number): void {
    if (Math.random() >= PU_DROP_CHANCE) return;
    const kind = randomPowerUpKind();
    powerups.push({ x: cx, y: cy, kind, alive: true });
  }

  function triggerLifeLost(): void {
    lives--;
    updateHudLives();
    timers.multiActive = false;
    phase = "lifelost";
    phaseTimer = LIFE_LOST_MS;
    balls = [initBall(paddleX, paddleY)];
    trails = [[]];
    playSfx("error");
    if ("vibrate" in navigator) navigator.vibrate([30, 60, 30]);
  }

  function triggerLevelClear(): void {
    phase = "levelclear";
    phaseTimer = LEVEL_CLEAR_MS;
    playSfx("levelup");
    if ("vibrate" in navigator) navigator.vibrate([30, 60, 30, 60, 100]);
  }

  function doGameover(): void {
    phase = "gameover";
    playSfx("gameover");
    if ("vibrate" in navigator) navigator.vibrate([50, 50, 100]);
    void submit(GAME_ID, score).then(() => {
      void personalBest(GAME_ID).then((b) => { best = Math.max(best, b); });
    });
    cancelAnimationFrame(rafId);
    setTimeout(() => {
      if (phase !== "gameover") return;
      gameoverEl = showGameoverOverlay(container, score, best, level, resetGame);
      void computeRank(GAME_ID, score).then((rank) => {
        if (rank && gameoverEl) gameoverEl.addRank(rank);
      });
    }, 400);
  }

  // ── draw ──

  function drawFrame(_dt: number): void {
    if (!stateReady) return;
    const now = performance.now();
    ctx.clearRect(0, 0, canvasW, canvasH);

    drawBackground(ctx, canvasW, canvasH);

    // bricks
    for (const brick of bricks) {
      if (brick.alive) {
        drawBrick(ctx, brick, canvasW, canvasH, flashBricks);
      }
    }

    // falling power-ups
    drawPowerUps(ctx, powerups, now);

    // paddle
    const laserActive = timers.laserUntil > now;
    drawPaddle(ctx, paddleX, paddleY, paddleW, flashPaddle, laserActive, laserFlash);

    // laser bullets
    drawLaserBullets(ctx, laserBullets);

    // all balls
    const slowActive = timers.slowUntil > now;
    for (let bi = 0; bi < balls.length; bi++) {
      const b = balls[bi]!;
      const t = trails[bi] ?? [];
      drawBall(ctx, b, t, slowActive);
    }

    // particles
    drawParticles(ctx, particles);

    // active power-up HUD badges
    drawPowerUpHud(ctx, canvasW, timers, now);

    // phase overlays
    if (phase === "lifelost") {
      drawOverlayText(ctx, canvasW, canvasH, "LIFE LOST", "#ff4444");
    } else if (phase === "levelclear") {
      drawOverlayText(ctx, canvasW, canvasH, `LEVEL ${level} CLEAR!`, "#ffee44");
    } else if (phase === "paused") {
      drawOverlayText(ctx, canvasW, canvasH, "PAUSED", "#aaccff");
    }
  }

  // ── ResizeObserver ──
  const ro = new ResizeObserver(onResize);
  ro.observe(canvasWrap);
  onResize();

  // initialise balls array with primary ball
  balls = [initBall(paddleX, paddleY)];
  trails = [[]];

  // start game loop
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);

  // ── cleanup ──
  return () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointercancel", handlePointerUp);
    window.removeEventListener("keydown", handleKeyDown);
    container.style.touchAction = prevTouchAction;
    container.classList.remove("bb-root");
  };
}
