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
const PADDLE_W = 80;
const BALL_R = 7;
const BASE_SPEED = 260;
const SPEED_PER_LEVEL = 20;
const SPEED_CAP = 420;
const MAX_ANGLE_DEG = 60;
const LIVES_INIT = 3;
const HUD_H = 44;
const TRAIL_LEN = 6;
const LIFE_LOST_MS = 1000;
const LEVEL_CLEAR_MS = 1500;
const PARTICLES_PER_BREAK = 8;

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
  level: number
): void {
  const speed = ballSpeed(level);
  const hitX = ball.x - paddleCx;
  const halfPaddle = PADDLE_W / 2;
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
  flashPaddle: number
): void {
  const alpha = flashPaddle > 0 ? 1 : 1;
  const glow = flashPaddle > 0 ? 18 : 8;
  ctx.save();
  ctx.shadowColor = "#ff6600";
  ctx.shadowBlur = glow;
  const grad = ctx.createLinearGradient(px - PADDLE_W / 2, py, px - PADDLE_W / 2, py + PADDLE_H);
  if (flashPaddle > 0) {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#ffaa44");
  } else {
    grad.addColorStop(0, "#ff8800");
    grad.addColorStop(1, "#cc4400");
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(px - PADDLE_W / 2, py, PADDLE_W, PADDLE_H, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  void alpha;
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  ball: BallState,
  trail: TrailPt[]
): void {
  // trail
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i]!;
    const alphaRatio = (i + 1) / (trail.length + 1);
    const r = BALL_R * (0.4 + alphaRatio * 0.6);
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${(alphaRatio * 0.4).toFixed(2)})`;
    ctx.fill();
  }
  // main ball
  ctx.save();
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
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

  let ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, attached: true };
  let trail: TrailPt[] = [];
  let particles: Particle[] = [];
  let bricks: Brick[] = [];

  let flashPaddle = 0; // countdown frames
  let flashBricks: Set<number> = new Set();
  let phaseTimer = 0; // ms for lifelost / levelclear
  let gameoverEl: { el: HTMLElement; addRank: (r: RankInfo) => void } | null = null;

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
    // reposition paddle and ball
    paddleY = canvasH - 30;
    if (paddleX === 0) paddleX = canvasW / 2;
    paddleX = clamp(paddleX, PADDLE_W / 2, canvasW - PADDLE_W / 2);
    if (ball.attached) {
      ball.x = paddleX;
      ball.y = paddleY - BALL_R - 2;
    }
    // rebuild bricks if size changed significantly
    bricks = buildBricks(level, canvasW, canvasH);
    drawFrame(0);
  }

  function startLevel(lv: number): void {
    level = lv;
    paddleX = canvasW / 2;
    ball = initBall(paddleX, paddleY);
    trail = [];
    bricks = buildBricks(level, canvasW, canvasH);
    particles = [];
    flashBricks = new Set();
    flashPaddle = 0;
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
    ball = initBall(paddleX, paddleY);
    trail = [];
    bricks = buildBricks(level, canvasW, canvasH);
    particles = [];
    flashBricks = new Set();
    flashPaddle = 0;
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
    paddleX = clamp(x, PADDLE_W / 2, canvasW - PADDLE_W / 2);
    if (ball.attached) {
      ball.x = paddleX;
      ball.y = paddleY - BALL_R - 2;
    }
  }

  function handlePointerDown(e: PointerEvent): void {
    pointerDown = true;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasW / rect.width);
    paddleX = clamp(x, PADDLE_W / 2, canvasW - PADDLE_W / 2);
    if (ball.attached) {
      ball.x = paddleX;
    }
  }

  function handlePointerUp(): void {
    pointerDown = false;
    if (phase !== "playing" || paused) return;
    if (ball.attached) {
      doLaunch();
    }
  }

  function doLaunch(): void {
    launchBall(ball, level);
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
      if (phase === "playing" && !paused && ball.attached) doLaunch();
      if (phase === "playing" && !paused && !ball.attached) {/* space does nothing mid-play */}
    }
    if (e.key === "ArrowLeft") {
      paddleX = clamp(paddleX - 40, PADDLE_W / 2, canvasW - PADDLE_W / 2);
      if (ball.attached) { ball.x = paddleX; ball.y = paddleY - BALL_R - 2; }
    }
    if (e.key === "ArrowRight") {
      paddleX = clamp(paddleX + 40, PADDLE_W / 2, canvasW - PADDLE_W / 2);
      if (ball.attached) { ball.x = paddleX; ball.y = paddleY - BALL_R - 2; }
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

  // ── game loop ──

  function loop(now: number): void {
    if (paused) return;
    const dt = Math.min(now - lastTime, 32) / 1000;
    lastTime = now;
    update(dt);
    drawFrame(dt);
    rafId = requestAnimationFrame(loop);
  }

  function update(dt: number): void {
    if (!stateReady) return;

    // update particles always
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt; // gravity on particles
      p.life -= dt * 2.5;
    }
    particles = particles.filter((p) => p.life > 0);

    // flash countdown
    if (flashPaddle > 0) flashPaddle--;
    if (flashBricks.size > 0) flashBricks = new Set(); // one-frame flash

    // timer-based phases
    if (phase === "lifelost" || phase === "levelclear") {
      phaseTimer -= dt * 1000;
      if (phaseTimer <= 0) {
        if (phase === "lifelost") {
          if (lives <= 0) {
            doGameover();
          } else {
            // reset ball on paddle, keep bricks
            ball = initBall(paddleX, paddleY);
            trail = [];
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

    // move ball
    if (ball.attached) return;

    const prevX = ball.x;
    const prevY = ball.y;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // trail
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
      triggerLifeLost();
      return;
    }

    // paddle collision
    const pLeft = paddleX - PADDLE_W / 2;
    const side = ballVsRect(ball.x, ball.y, prevX, prevY, pLeft, paddleY, PADDLE_W, PADDLE_H);
    if (side !== null && ball.vy > 0) {
      // only bounce when moving down (prevent sticky)
      paddleBounce(ball, paddleX, level);
      flashPaddle = 4;
      playSfx("bounce");
      if ("vibrate" in navigator) navigator.vibrate(4);
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
      break; // one brick per frame
    }

    // check level clear
    if (bricks.every((b) => !b.alive)) {
      triggerLevelClear();
    }
  }

  function triggerLifeLost(): void {
    lives--;
    updateHudLives();
    phase = "lifelost";
    phaseTimer = LIFE_LOST_MS;
    ball = initBall(paddleX, paddleY);
    trail = [];
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
    ctx.clearRect(0, 0, canvasW, canvasH);

    drawBackground(ctx, canvasW, canvasH);

    // bricks
    for (const brick of bricks) {
      if (brick.alive) {
        drawBrick(ctx, brick, canvasW, canvasH, flashBricks);
      }
    }

    // paddle
    drawPaddle(ctx, paddleX, paddleY, flashPaddle);

    // ball
    drawBall(ctx, ball, trail);

    // particles
    drawParticles(ctx, particles);

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
