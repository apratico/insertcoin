import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";
import { playSfx } from "../../lib/audio.js";
import { db } from "../../lib/storage.js";

// ---------- types ----------

type Phase = "idle" | "playing" | "gameover";
type ObstacleKind = "wall" | "bar" | "gap";

interface Player {
  x: number;
  y: number;
  vy: number;
  sliding: boolean;
  slideTimer: number;
  jumpsLeft: number;
  runFrame: number;
  trail: { x: number; y: number; life: number }[];
}

interface Obstacle {
  kind: ObstacleKind;
  x: number;
  w: number;
  h: number;
  passed: boolean;
}

interface Coin {
  x: number;
  y: number;
  spin: number;
  taken: boolean;
}

interface Star {
  x: number;
  y: number;
  speed: number;
  size: number;
}

// ---------- constants ----------

const HUD_HEIGHT = 48;
const GROUND_FRAC = 0.78; // ground line as fraction of canvas height
const GRAVITY = 1900;
const JUMP_VY = -680;
const DOUBLE_JUMP_VY = -560;
const SLIDE_DURATION = 0.55; // seconds
const PLAYER_W = 28;
const PLAYER_H = 44;
const PLAYER_SLIDE_H = 22;
const BASE_SCROLL = 320;
const MAX_SCROLL = 720;
const SCROLL_GROW = 28; // px/s added per 200 score points
const SCORE_PER_PX = 0.1;
const COIN_VALUE = 5;
const SLIDE_HOLD_MS = 220;

const HINT_KEY = "neon-dash:seenHint";

// ---------- helpers ----------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

async function loadSeenHint(): Promise<boolean> {
  try {
    const row = await db.settings.get(HINT_KEY);
    return !!row;
  } catch { return false; }
}

async function markHintSeen(): Promise<void> {
  try { await db.settings.put({ key: HINT_KEY, value: "1" }); } catch { /* ok */ }
}

// ---------- world generation ----------

function spawnObstacle(canvasW: number, score: number): Obstacle {
  const r = Math.random();
  // bias toward gaps and bars at higher score
  const wallP = score < 100 ? 0.5 : 0.34;
  const barP = score < 100 ? 0.25 : 0.33;
  if (r < wallP) {
    return { kind: "wall", x: canvasW + 60, w: 22 + Math.floor(Math.random() * 16), h: 38 + Math.floor(Math.random() * 22), passed: false };
  } else if (r < wallP + barP) {
    return { kind: "bar", x: canvasW + 60, w: 60 + Math.floor(Math.random() * 40), h: 14, passed: false };
  } else {
    return { kind: "gap", x: canvasW + 60, w: 58 + Math.floor(Math.random() * 50), h: 0, passed: false };
  }
}

function maybeSpawnCoin(canvasW: number, groundY: number): Coin | null {
  if (Math.random() > 0.55) return null;
  const y = groundY - 60 - Math.random() * 120;
  return { x: canvasW + 80 + Math.random() * 40, y, spin: Math.random() * Math.PI * 2, taken: false };
}

// ---------- collision ----------

function playerRect(player: Player): { x: number; y: number; w: number; h: number } {
  const h = player.sliding ? PLAYER_SLIDE_H : PLAYER_H;
  return { x: player.x - PLAYER_W / 2, y: player.y - h, w: PLAYER_W, h };
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function obstacleHit(player: Player, ob: Obstacle, groundY: number): boolean {
  const p = playerRect(player);
  if (ob.kind === "wall") {
    const r = { x: ob.x, y: groundY - ob.h, w: ob.w, h: ob.h };
    return rectsOverlap(p, r);
  }
  if (ob.kind === "bar") {
    const r = { x: ob.x, y: groundY - 70, w: ob.w, h: ob.h };
    return rectsOverlap(p, r);
  }
  // gap: only fail if player is on ground level over the gap
  if (ob.kind === "gap") {
    const overGap = p.x + p.w > ob.x && p.x < ob.x + ob.w;
    const onGround = player.y >= groundY - 1 && player.vy >= 0;
    return overGap && onGround;
  }
  return false;
}

// ---------- draw helpers ----------

function drawBackground(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  scroll: number,
  stars: Star[]
): void {
  // base gradient
  const grad = ctx.createLinearGradient(0, 0, 0, canvasH);
  grad.addColorStop(0, "#1a0a2e");
  grad.addColorStop(0.55, "#2d1450");
  grad.addColorStop(1, "#0f0420");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // scrolling stars
  ctx.fillStyle = "#c9a0dc";
  stars.forEach((s) => {
    const x = ((s.x - scroll * s.speed) % canvasW + canvasW) % canvasW;
    ctx.globalAlpha = 0.5 + s.speed * 0.5;
    ctx.fillRect(x, s.y, s.size, s.size);
  });
  ctx.globalAlpha = 1;

  // far skyline (silhouette buildings)
  const skyY = canvasH * 0.55;
  ctx.fillStyle = "rgba(232, 74, 138, 0.18)";
  for (let i = 0; i < 14; i++) {
    const bx = ((i * 90 - scroll * 0.18) % (canvasW + 90) + canvasW + 90) % (canvasW + 90) - 90;
    const bh = 50 + ((i * 37) % 60);
    ctx.fillRect(bx, skyY - bh, 60, bh);
  }
  // mid skyline
  ctx.fillStyle = "rgba(255, 45, 120, 0.28)";
  for (let i = 0; i < 18; i++) {
    const bx = ((i * 64 - scroll * 0.4) % (canvasW + 64) + canvasW + 64) % (canvasW + 64) - 64;
    const bh = 36 + ((i * 53) % 50);
    ctx.fillRect(bx, skyY + 30 - bh, 38, bh);
  }
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  groundY: number,
  scroll: number,
  obstacles: Obstacle[]
): void {
  // ground band fills viewport bottom — we'll then carve gaps
  ctx.fillStyle = "#0a041a";
  ctx.fillRect(0, groundY, canvasW, 999);

  // top neon line, broken at gaps
  const gaps = obstacles.filter((o) => o.kind === "gap");
  ctx.fillStyle = "#ff2d78";
  let cursor = 0;
  const segments: [number, number][] = [];
  // sort gaps by x
  const sorted = gaps.slice().sort((a, b) => a.x - b.x);
  sorted.forEach((g) => {
    if (g.x > cursor) segments.push([cursor, Math.max(cursor, g.x)]);
    cursor = Math.max(cursor, g.x + g.w);
  });
  segments.push([cursor, canvasW + 4]);
  segments.forEach(([x0, x1]) => {
    if (x1 > x0) {
      ctx.fillRect(x0, groundY - 2, x1 - x0, 2);
    }
  });

  // grid lines under ground (perspective hint)
  ctx.strokeStyle = "rgba(232, 74, 138, 0.22)";
  ctx.lineWidth = 1;
  const lineSpacing = 22;
  const offset = scroll % lineSpacing;
  ctx.beginPath();
  for (let gx = -offset; gx < canvasW + lineSpacing; gx += lineSpacing) {
    // skip if vertical line lands in a gap
    const inGap = gaps.some((g) => gx >= g.x && gx <= g.x + g.w);
    if (inGap) continue;
    ctx.moveTo(gx, groundY);
    ctx.lineTo(gx + 30, groundY + 60);
  }
  ctx.stroke();
  // horizontal lines
  ctx.beginPath();
  for (let i = 1; i <= 4; i++) {
    const ly = groundY + i * 16;
    ctx.moveTo(0, ly);
    ctx.lineTo(canvasW, ly);
  }
  ctx.stroke();
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  ob: Obstacle,
  groundY: number,
  tick: number
): void {
  if (ob.kind === "wall") {
    // tall block — magenta core + cyan top edge
    const x = ob.x, y = groundY - ob.h;
    ctx.fillStyle = "#3a1a60";
    ctx.fillRect(x, y, ob.w, ob.h);
    ctx.fillStyle = "#ff2d78";
    ctx.fillRect(x, y, ob.w, 4);
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(x, y - 2, ob.w, 2);
    // cross stripes
    ctx.fillStyle = "rgba(255, 45, 120, 0.4)";
    for (let i = 6; i < ob.h; i += 8) {
      ctx.fillRect(x + 2, y + i, ob.w - 4, 1);
    }
  } else if (ob.kind === "bar") {
    // floating low bar — pulse glow
    const x = ob.x, y = groundY - 70;
    const pulse = 0.5 + 0.5 * Math.sin(tick * 0.18);
    ctx.fillStyle = "#1a0a2e";
    ctx.fillRect(x, y, ob.w, ob.h);
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(x, y, ob.w, 2);
    ctx.fillRect(x, y + ob.h - 2, ob.w, 2);
    ctx.fillStyle = `rgba(0, 229, 255, ${0.3 + pulse * 0.5})`;
    ctx.fillRect(x + 2, y + 4, ob.w - 4, ob.h - 8);
    // support pegs to ground
    ctx.fillStyle = "rgba(0, 229, 255, 0.18)";
    ctx.fillRect(x + 4, y + ob.h, 2, groundY - (y + ob.h));
    ctx.fillRect(x + ob.w - 6, y + ob.h, 2, groundY - (y + ob.h));
  } else {
    // gap: draw glowing edges
    ctx.fillStyle = "#ff2d78";
    ctx.fillRect(ob.x - 2, groundY - 2, 2, 6);
    ctx.fillRect(ob.x + ob.w, groundY - 2, 2, 6);
    // void below — slight gradient
    const g = ctx.createLinearGradient(0, groundY, 0, groundY + 80);
    g.addColorStop(0, "rgba(255, 45, 120, 0.18)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(ob.x, groundY, ob.w, 80);
  }
}

function drawCoin(ctx: CanvasRenderingContext2D, coin: Coin, tick: number): void {
  const r = 7 + Math.sin(tick * 0.2 + coin.spin) * 1.5;
  const aspect = Math.abs(Math.cos(coin.spin + tick * 0.18));
  ctx.save();
  ctx.translate(coin.x, coin.y);
  ctx.shadowBlur = 14;
  ctx.shadowColor = "#f5c842";
  ctx.fillStyle = "#f5c842";
  ctx.beginPath();
  ctx.ellipse(0, 0, r * aspect + 1, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff5c0";
  ctx.fillRect(-1, -r + 2, 2, r - 2);
  ctx.restore();
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: Player,
  groundY: number,
  phase: Phase
): void {
  // trail
  player.trail.forEach((t) => {
    ctx.globalAlpha = t.life * 0.45;
    ctx.fillStyle = "#ff2d78";
    ctx.fillRect(t.x - 2, t.y - 2, 4, 4);
  });
  ctx.globalAlpha = 1;

  const r = playerRect(player);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;

  // body shadow
  if (player.y >= groundY - 1) {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(r.x - 2, groundY - 2, r.w + 4, 3);
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(r.x + 4, groundY - 2, r.w - 8, 2);
  }

  // body
  ctx.save();
  ctx.shadowBlur = 16;
  ctx.shadowColor = "#ff2d78";
  ctx.fillStyle = "#ff2d78";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.shadowBlur = 0;

  // visor (cyan band)
  ctx.fillStyle = "#00e5ff";
  if (player.sliding) {
    ctx.fillRect(r.x + 4, r.y + 4, r.w - 6, 5);
  } else {
    ctx.fillRect(r.x + 4, r.y + 8, r.w - 8, 6);
  }

  // pixel face details
  ctx.fillStyle = "#1a0a2e";
  ctx.fillRect(r.x + 6, r.y + (player.sliding ? 5 : 9), 3, 3);
  ctx.fillRect(r.x + r.w - 9, r.y + (player.sliding ? 5 : 9), 3, 3);

  // legs (running anim) — skip when sliding
  if (!player.sliding && phase !== "gameover") {
    const legPhase = Math.sin(player.runFrame * 0.6);
    ctx.fillStyle = "#c9a0dc";
    const onAir = player.y < groundY - 1;
    if (onAir) {
      ctx.fillRect(r.x + 4, r.y + r.h - 6, 7, 6);
      ctx.fillRect(r.x + r.w - 11, r.y + r.h - 8, 7, 6);
    } else {
      ctx.fillRect(r.x + 4, r.y + r.h - 6 + legPhase * 2, 7, 6);
      ctx.fillRect(r.x + r.w - 11, r.y + r.h - 6 - legPhase * 2, 7, 6);
    }
  }

  // body outline
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

  ctx.restore();
  void cx; void cy;
}

function drawHUD(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  score: number,
  best: number
): void {
  ctx.textAlign = "left";
  ctx.font = "bold 14px monospace";
  ctx.fillStyle = "#c9a0dc";
  ctx.fillText("BEST", 12, 22);
  ctx.fillStyle = "#f5c842";
  ctx.font = "bold 18px monospace";
  ctx.fillText(String(best), 12, 42);

  ctx.textAlign = "right";
  ctx.font = "bold 14px monospace";
  ctx.fillStyle = "#c9a0dc";
  ctx.fillText("SCORE", canvasW - 12, 22);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 24px monospace";
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#ff2d78";
  ctx.fillText(String(score), canvasW - 12, 46);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
}

function drawIdle(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  tick: number
): void {
  const a = 0.5 + 0.5 * Math.sin(tick * 0.08);
  ctx.textAlign = "center";
  ctx.font = "bold 22px monospace";
  ctx.fillStyle = `rgba(255, 45, 120, ${a})`;
  ctx.shadowBlur = 12;
  ctx.shadowColor = "#ff2d78";
  ctx.fillText("TAP TO RUN", canvasW / 2, canvasH * 0.42);
  ctx.shadowBlur = 0;
  ctx.font = "11px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("TAP = JUMP   SWIPE ↓ = SLIDE", canvasW / 2, canvasH * 0.42 + 24);
  ctx.fillText("AIR TAP = DOUBLE JUMP", canvasW / 2, canvasH * 0.42 + 40);
  ctx.textAlign = "left";
}

function drawScanlines(ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  for (let y = 0; y < canvasH; y += 3) {
    ctx.fillRect(0, y, canvasW, 1);
  }
}

// ---------- gameover overlay ----------

function buildRankCard(rank: RankInfo, gameId: string): string {
  const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="nd-rank-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta} pts</div>`
    : "";
  return `<div class="rank-card">
    <div class="rank-card-title">RANK ${rankLabel} GLOBAL</div>
    ${deltaHtml}
    <button class="btn rank-card-btn" data-scores-id="${gameId}">VIEW LEADERBOARD</button>
  </div>`;
}

function showGameoverOverlay(
  container: HTMLElement,
  score: number,
  best: number,
  onReplay: () => void
): { el: HTMLElement; addRank: (r: RankInfo) => void } {
  const isNew = score >= best && score > 0;
  const overlay = document.createElement("div");
  overlay.className = "nd-gameover";
  overlay.innerHTML = `
    <div class="nd-go-box">
      <h2 class="nd-go-title">CRASHED</h2>
      ${isNew ? `<div class="nd-go-new">NEW BEST!</div>` : ""}
      <div class="nd-go-score">${score}</div>
      <div class="nd-go-sublabel">DISTANCE</div>
      <div class="nd-go-best">BEST ${best}</div>
      <div class="nd-go-actions">
        <button class="btn primary nd-go-btn" id="nd-replay">RUN AGAIN</button>
        <button class="btn nd-go-btn" id="nd-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector("#nd-replay")?.addEventListener("pointerup", () => {
    overlay.remove();
    onReplay();
  });
  overlay.querySelector("#nd-menu")?.addEventListener("pointerup", () => {
    navigate("/");
  });

  function addRank(rank: RankInfo): void {
    const box = overlay.querySelector(".nd-go-box");
    if (!box || box.querySelector(".rank-card")) return;
    const actions = box.querySelector(".nd-go-actions");
    if (!actions) return;
    const card = document.createElement("div");
    card.innerHTML = buildRankCard(rank, "neon-dash");
    const cardEl = card.firstElementChild as HTMLElement | null;
    if (!cardEl) return;
    cardEl.querySelector<HTMLElement>(".rank-card-btn")?.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      navigate("/scores/neon-dash");
    });
    box.insertBefore(cardEl, actions);
  }

  return { el: overlay, addRank };
}

// ---------- mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("nd-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  const wrap = document.createElement("div");
  wrap.className = "nd-wrap";
  container.appendChild(wrap);

  const hud = document.createElement("div");
  hud.className = "nd-hud";
  hud.innerHTML = `
    <div class="nd-hud-left">
      <span class="nd-best-label">BEST</span>
      <span class="nd-best-val" id="nd-best">0</span>
    </div>
    <div class="nd-hud-right">
      <button class="btn nd-hud-btn" id="nd-fs" aria-label="Fullscreen">⛶</button>
      <button class="btn nd-hud-btn" id="nd-pause" aria-label="Pause">⏸</button>
    </div>
  `;
  wrap.appendChild(hud);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "nd-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "nd-canvas";
  canvasWrap.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx: CanvasRenderingContext2D = ctxRaw;

  const hint = document.createElement("div");
  hint.className = "nd-hint";
  hint.innerHTML = `
    <div class="nd-hint-card">
      <div class="nd-hint-title">NEON DASH</div>
      <div class="nd-hint-row"><strong>TAP</strong> jump</div>
      <div class="nd-hint-row"><strong>TAP IN AIR</strong> double jump</div>
      <div class="nd-hint-row"><strong>SWIPE ↓</strong> slide</div>
      <div class="nd-hint-foot">Tap to start</div>
    </div>
  `;
  hint.style.display = "none";
  wrap.appendChild(hint);

  // ---------- state ----------

  let phase: Phase = "idle";
  let score = 0;
  let best = 0;
  let paused = false;
  let rafId = 0;
  let lastTime = 0;
  let tick = 0;
  let canvasW = 0;
  let canvasH = 0;
  let stateReady = false;
  let groundY = 0;
  let scroll = 0;
  let scrollSpeed = BASE_SCROLL;
  let distancePx = 0;
  let nextSpawn = 0;
  let nextCoinSpawn = 0;
  let shake = 0;
  let flashAlpha = 0;
  let gameoverEl: { el: HTMLElement; addRank: (r: RankInfo) => void } | null = null;
  let player: Player = makePlayer(0, 0);
  let obstacles: Obstacle[] = [];
  let coins: Coin[] = [];
  let stars: Star[] = [];

  function makePlayer(cw: number, gy: number): Player {
    return {
      x: cw * 0.22,
      y: gy,
      vy: 0,
      sliding: false,
      slideTimer: 0,
      jumpsLeft: 2,
      runFrame: 0,
      trail: [],
    };
  }

  function makeStars(cw: number, ch: number): Star[] {
    const out: Star[] = [];
    for (let i = 0; i < 50; i++) {
      out.push({
        x: Math.random() * cw,
        y: Math.random() * ch * 0.55,
        speed: 0.1 + Math.random() * 0.5,
        size: Math.random() < 0.7 ? 1 : 2,
      });
    }
    return out;
  }

  void personalBest("neon-dash").then((b) => {
    best = b;
    const el = hud.querySelector<HTMLElement>("#nd-best");
    if (el) el.textContent = String(best);
  });

  // ---------- resize ----------

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
    groundY = Math.floor(canvasH * GROUND_FRAC);
    stateReady = true;
    onAfterResize();
  }

  function onAfterResize(): void {
    if (!stateReady) return;
    if (phase === "idle") resetForIdle();
    drawFrame();
  }

  function resetForIdle(): void {
    player = makePlayer(canvasW, groundY);
    obstacles = [];
    coins = [];
    stars = makeStars(canvasW, canvasH);
    scroll = 0;
    scrollSpeed = BASE_SCROLL;
    distancePx = 0;
    nextSpawn = 0;
    nextCoinSpawn = 1;
    shake = 0;
    flashAlpha = 0;
  }

  // ---------- input ----------

  function startPlaying(): void {
    if (phase !== "idle") return;
    phase = "playing";
    score = 0;
    coinBonus = 0;
    distancePx = 0;
    scrollSpeed = BASE_SCROLL;
    obstacles = [];
    coins = [];
    nextSpawn = 0.6;
    nextCoinSpawn = 1.2;
    hint.style.display = "none";
    void markHintSeen();
    doJump(true);
  }

  function doJump(initial = false): void {
    if (phase === "idle" && !initial) {
      startPlaying();
      return;
    }
    if (phase === "gameover" || paused) return;
    if (!initial && player.jumpsLeft <= 0) return;
    if (initial) {
      player.jumpsLeft = 1; // first action of run: small hop, then 2 jumps available next
      player.vy = JUMP_VY * 0.85;
    } else if (player.y >= groundY - 1) {
      player.vy = JUMP_VY;
      player.jumpsLeft = 1;
    } else {
      player.vy = DOUBLE_JUMP_VY;
      player.jumpsLeft = 0;
    }
    player.sliding = false;
    playSfx("jump");
    if ("vibrate" in navigator) navigator.vibrate(6);
  }

  function doSlide(): void {
    if (phase === "idle" || phase === "gameover" || paused) return;
    if (player.y < groundY - 1) {
      // fast-fall when sliding mid-air
      player.vy = Math.max(player.vy, 600);
    }
    player.sliding = true;
    player.slideTimer = SLIDE_DURATION;
    playSfx("slide");
    if ("vibrate" in navigator) navigator.vibrate(4);
  }

  // pointer + swipe detection
  let downX = 0, downY = 0, downT = 0, downActive = false, swipeUsed = false;
  function onPointerDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    downX = e.clientX; downY = e.clientY; downT = performance.now();
    downActive = true; swipeUsed = false;
    if (phase === "idle") {
      startPlaying();
    }
  }
  function onPointerMove(e: PointerEvent): void {
    if (!downActive || swipeUsed) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (dy > 30 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      doSlide();
      swipeUsed = true;
      downActive = false;
    }
  }
  function onPointerUp(e: PointerEvent): void {
    if (!downActive) return;
    const dt = performance.now() - downT;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    downActive = false;
    if (swipeUsed) return;
    // long-press swipe down even on release
    if (dy > 30 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      doSlide();
      return;
    }
    // tap = jump
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30 && dt < SLIDE_HOLD_MS + 200) {
      doJump(false);
    }
  }

  wrap.addEventListener("pointerdown", onPointerDown);
  wrap.addEventListener("pointermove", onPointerMove);
  wrap.addEventListener("pointerup", onPointerUp);
  wrap.addEventListener("pointercancel", () => { downActive = false; });

  function onKey(e: KeyboardEvent): void {
    if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      if (phase === "idle") { startPlaying(); return; }
      doJump(false);
    }
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      doSlide();
    }
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      if (phase === "playing") paused = !paused;
    }
  }
  document.addEventListener("keydown", onKey);

  // HUD buttons
  hud.querySelector<HTMLElement>("#nd-fs")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen().catch(() => {});
    }
  });
  hud.querySelector<HTMLElement>("#nd-pause")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    if (phase === "playing") paused = !paused;
  });

  // ---------- gameover ----------

  function triggerGameover(): void {
    if (phase !== "playing") return;
    phase = "gameover";
    flashAlpha = 1;
    shake = 18;
    playSfx("gameover");
    if ("vibrate" in navigator) navigator.vibrate([60, 40, 120]);
    void submit("neon-dash", score).then(() => {
      void personalBest("neon-dash").then((b) => {
        best = Math.max(best, b);
        const el = hud.querySelector<HTMLElement>("#nd-best");
        if (el) el.textContent = String(best);
      });
    });
    setTimeout(() => {
      if (phase !== "gameover") return;
      gameoverEl = showGameoverOverlay(container, score, best, restartGame);
      void computeRank("neon-dash", score).then((rank) => {
        if (rank && gameoverEl) gameoverEl.addRank(rank);
      });
    }, 600);
  }

  function restartGame(): void {
    phase = "idle";
    score = 0;
    paused = false;
    gameoverEl = null;
    if (stateReady) resetForIdle();
    lastTime = performance.now();
  }

  // ---------- loop ----------

  function loop(now: number): void {
    rafId = requestAnimationFrame(loop);
    if (!stateReady) return;
    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(rawDt, 0.05);
    tick++;
    if (!paused) update(dt);
    drawFrame();
  }

  function update(dt: number): void {
    // idle: just animate stars and drift player slightly
    if (phase === "idle") {
      scroll += BASE_SCROLL * 0.4 * dt;
      player.y = groundY;
      player.runFrame += dt * 14;
      return;
    }

    if (phase === "playing") {
      distancePx += scrollSpeed * dt;
      score = Math.floor(distancePx * SCORE_PER_PX) + coinBonus;

      // ramp speed
      const target = Math.min(MAX_SCROLL, BASE_SCROLL + Math.floor(score / 200) * SCROLL_GROW);
      scrollSpeed += (target - scrollSpeed) * Math.min(1, dt * 0.6);
      scroll += scrollSpeed * dt;

      // physics
      player.vy += GRAVITY * dt;
      player.vy = clamp(player.vy, -1000, 1400);
      player.y += player.vy * dt;
      if (player.y >= groundY) {
        player.y = groundY;
        if (player.vy > 0) player.vy = 0;
        player.jumpsLeft = 2;
      }
      // slide timer
      if (player.sliding) {
        player.slideTimer -= dt;
        if (player.slideTimer <= 0) player.sliding = false;
      }
      player.runFrame += dt * (12 + scrollSpeed * 0.02);

      // trail
      if (tick % 2 === 0) {
        const r = playerRect(player);
        player.trail.push({ x: r.x, y: r.y + r.h - 4, life: 1 });
        if (player.trail.length > 12) player.trail.shift();
      }
      player.trail.forEach((t) => { t.life -= dt * 2.5; t.x -= scrollSpeed * dt * 0.4; });
      player.trail = player.trail.filter((t) => t.life > 0);

      // scroll obstacles + coins
      obstacles.forEach((o) => { o.x -= scrollSpeed * dt; });
      coins.forEach((c) => { c.x -= scrollSpeed * dt; });
      obstacles = obstacles.filter((o) => o.x + Math.max(o.w, 60) > -20);
      coins = coins.filter((c) => c.x > -20 && !c.taken);

      // spawn
      nextSpawn -= dt;
      if (nextSpawn <= 0) {
        const ob = spawnObstacle(canvasW, score);
        // avoid spawning on top of last
        const last = obstacles[obstacles.length - 1];
        if (!last || ob.x - (last.x + last.w) > 90) {
          obstacles.push(ob);
        }
        // base interval shrinks with speed
        const baseInterval = clamp(1.4 - score / 600, 0.7, 1.6);
        nextSpawn = baseInterval + Math.random() * 0.4;
      }
      nextCoinSpawn -= dt;
      if (nextCoinSpawn <= 0) {
        const c = maybeSpawnCoin(canvasW, groundY);
        if (c) coins.push(c);
        nextCoinSpawn = 0.8 + Math.random() * 1.2;
      }

      // collision: obstacles
      for (const ob of obstacles) {
        if (ob.passed) continue;
        if (obstacleHit(player, ob, groundY)) {
          triggerGameover();
          return;
        }
        if (ob.x + ob.w < player.x - PLAYER_W) ob.passed = true;
      }
      // coins
      const pr = playerRect(player);
      for (const c of coins) {
        if (c.taken) continue;
        const dx = c.x - (pr.x + pr.w / 2);
        const dy = c.y - (pr.y + pr.h / 2);
        if (dx * dx + dy * dy < 22 * 22) {
          c.taken = true;
          coinBonus += COIN_VALUE;
          playSfx("coin");
          if ("vibrate" in navigator) navigator.vibrate(3);
        }
      }

      // update HUD best on the fly
      if (score > best) {
        best = score;
        const el = hud.querySelector<HTMLElement>("#nd-best");
        if (el) el.textContent = String(best);
      }
    }

    if (phase === "gameover") {
      // player keeps falling
      player.vy += GRAVITY * dt;
      player.y += player.vy * dt;
      shake = Math.max(0, shake - dt * 60);
      flashAlpha = Math.max(0, flashAlpha - dt * 2.5);
    }
  }

  let coinBonus = 0;

  // ---------- draw ----------

  function drawFrame(): void {
    if (!stateReady) return;
    ctx.save();
    // shake
    if (shake > 0) {
      const sx = (Math.random() - 0.5) * shake;
      const sy = (Math.random() - 0.5) * shake;
      ctx.translate(sx, sy);
    }

    drawBackground(ctx, canvasW, canvasH, scroll, stars);
    drawGround(ctx, canvasW, groundY, scroll, obstacles);

    obstacles.forEach((o) => drawObstacle(ctx, o, groundY, tick));
    coins.forEach((c) => drawCoin(ctx, c, tick));

    drawPlayer(ctx, player, groundY, phase);

    if (phase === "playing" || phase === "gameover") {
      drawHUD(ctx, canvasW, score, best);
    }
    if (phase === "idle") {
      drawIdle(ctx, canvasW, canvasH, tick);
    }
    drawScanlines(ctx, canvasW, canvasH);

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(255, 45, 120, ${flashAlpha})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
    ctx.restore();
  }

  // ---------- start ----------

  const ro = new ResizeObserver(onResize);
  ro.observe(canvasWrap);
  onResize();

  void loadSeenHint().then((seen) => {
    if (!seen && phase === "idle") hint.style.display = "flex";
    setTimeout(() => { hint.style.display = "none"; }, 5000);
  });

  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);

  return function cleanup(): void {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    document.removeEventListener("keydown", onKey);
    wrap.removeEventListener("pointerdown", onPointerDown);
    wrap.removeEventListener("pointermove", onPointerMove);
    wrap.removeEventListener("pointerup", onPointerUp);
    container.innerHTML = "";
    container.classList.remove("nd-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "nd-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .nd-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #1a0a2e;
      user-select: none;
      -webkit-user-select: none;
      position: relative;
      overflow: hidden;
    }
    .nd-wrap {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .nd-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: ${HUD_HEIGHT}px;
      min-height: ${HUD_HEIGHT}px;
      padding: 0 8px;
      font-family: monospace;
      color: #fff;
      background: rgba(0,0,0,0.32);
      border-bottom: 1px solid rgba(255, 45, 120, 0.4);
      box-sizing: border-box;
      z-index: 2;
    }
    .nd-hud-left, .nd-hud-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .nd-best-label {
      font-size: 10px;
      opacity: 0.75;
      letter-spacing: 1px;
      color: #c9a0dc;
    }
    .nd-best-val {
      font-size: 16px;
      font-weight: bold;
      min-width: 28px;
      color: #f5c842;
      text-shadow: 0 0 6px #f5c842;
    }
    .nd-hud-btn {
      min-width: 44px;
      min-height: 44px;
      font-size: 18px;
      background: transparent;
      border-color: rgba(255, 45, 120, 0.6);
      color: #ff2d78;
    }
    .nd-canvas-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }
    .nd-canvas {
      display: block;
      touch-action: none;
    }
    .nd-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 8;
    }
    .nd-hint-card {
      background: rgba(26, 10, 46, 0.92);
      border: 2px solid #ff2d78;
      padding: 18px 22px;
      font-family: monospace;
      color: #fff;
      text-align: center;
      max-width: 80%;
      box-shadow: 0 0 24px rgba(255, 45, 120, 0.4);
    }
    .nd-hint-title {
      font-weight: bold;
      color: #f5c842;
      letter-spacing: 3px;
      margin-bottom: 10px;
      font-size: 16px;
    }
    .nd-hint-row {
      font-size: 12px;
      letter-spacing: 1px;
      margin: 4px 0;
      color: #c9a0dc;
    }
    .nd-hint-row strong {
      color: #ff2d78;
    }
    .nd-hint-foot {
      margin-top: 12px;
      font-size: 10px;
      color: rgba(255,255,255,0.4);
      letter-spacing: 2px;
    }
    .nd-gameover {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(10, 4, 26, 0.78);
      z-index: 10;
    }
    .nd-go-box {
      text-align: center;
      padding: 28px 24px;
      background: #2d1450;
      border: 2px solid #ff2d78;
      min-width: 240px;
      font-family: monospace;
      box-shadow: 0 0 30px rgba(255, 45, 120, 0.5);
    }
    .nd-go-title {
      margin: 0 0 6px;
      font-size: 22px;
      color: #ff2d78;
      letter-spacing: 4px;
      text-shadow: 0 0 14px #ff2d78;
    }
    .nd-go-new {
      color: #f5c842;
      font-size: 12px;
      letter-spacing: 2px;
      margin-bottom: 6px;
      text-shadow: 0 0 8px #f5c842;
    }
    .nd-go-score {
      font-size: 56px;
      font-weight: bold;
      color: #fff;
      text-shadow: 0 0 18px #ff2d78;
      line-height: 1;
    }
    .nd-go-sublabel {
      font-size: 11px;
      color: #c9a0dc;
      letter-spacing: 2px;
      margin-bottom: 4px;
    }
    .nd-go-best {
      font-size: 13px;
      color: #f5c842;
      margin-bottom: 18px;
    }
    .nd-go-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
    }
    .nd-go-btn {
      min-width: 110px;
      min-height: 44px;
      font-family: monospace;
      font-size: 13px;
      letter-spacing: 1px;
    }
    .nd-rank-delta {
      font-size: 12px;
      color: #c9a0dc;
      margin: 4px 0;
    }
  `;
  document.head.appendChild(style);
}
