import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { playSfx } from "../../lib/audio.js";

// ---------- types ----------

type Phase =
  | "aiming"    // waiting for player to drag and fire
  | "flying"    // bullet in motion
  | "levelwin"  // all targets hit
  | "levelfail" // bullet dead, targets remain
  | "paused";

interface Vec2 { x: number; y: number }

interface Wall {
  x: number; y: number; w: number; h: number;
}

interface Target {
  x: number; y: number;
  alive: boolean;
  hitT: number; // timestamp of hit (for animation), -1 = not hit
}

interface Hazard {
  x: number; y: number; w: number; h: number;
}

interface LevelDef {
  targets: ReadonlyArray<Readonly<Vec2>>;
  walls: ReadonlyArray<Readonly<Wall>>;
  hazards: ReadonlyArray<Readonly<Hazard>>;
  cannonX: number; // 0..1 fraction of arena width
  cannonY: number; // 0..1 fraction of arena height
}

interface Bullet {
  x: number; y: number;
  vx: number; vy: number;
  alive: boolean;
  bounces: number;
  trail: Vec2[];
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;   // 1..0
  decay: number;
  color: string;
  alive: boolean;
}

interface FloatLabel {
  x: number; y: number;
  vy: number;
  text: string;
  life: number;
  decay: number;
  alive: boolean;
}

// ---------- level data (hand-crafted, normalised 0..1) ----------
// All coords in unit space; will be scaled to arena px at runtime.

const LEVELS: ReadonlyArray<Readonly<LevelDef>> = [
  // 1 – open shot
  { cannonX: 0.5, cannonY: 0.88, targets: [{ x: 0.5, y: 0.25 }], walls: [], hazards: [] },
  // 2 – two targets, direct
  { cannonX: 0.5, cannonY: 0.88, targets: [{ x: 0.3, y: 0.25 }, { x: 0.7, y: 0.25 }], walls: [], hazards: [] },
  // 3 – one wall, ricochet needed
  { cannonX: 0.15, cannonY: 0.85,
    targets: [{ x: 0.75, y: 0.2 }],
    walls: [{ x: 0.35, y: 0.15, w: 0.08, h: 0.42 }],
    hazards: [] },
  // 4 – three targets, one wall
  { cannonX: 0.5, cannonY: 0.88,
    targets: [{ x: 0.2, y: 0.15 }, { x: 0.5, y: 0.18 }, { x: 0.8, y: 0.15 }],
    walls: [{ x: 0.32, y: 0.3, w: 0.36, h: 0.06 }],
    hazards: [] },
  // 5 – hazard in the way
  { cannonX: 0.5, cannonY: 0.88,
    targets: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.4 }],
    walls: [],
    hazards: [{ x: 0.4, y: 0.52, w: 0.2, h: 0.06 }] },
  // 6 – box trap: targets behind walls
  { cannonX: 0.5, cannonY: 0.9,
    targets: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }],
    walls: [
      { x: 0.15, y: 0.12, w: 0.25, h: 0.05 },
      { x: 0.60, y: 0.12, w: 0.25, h: 0.05 },
    ],
    hazards: [] },
  // 7 – centre wall, 4 targets corners
  { cannonX: 0.5, cannonY: 0.9,
    targets: [{ x: 0.15, y: 0.15 }, { x: 0.85, y: 0.15 }, { x: 0.15, y: 0.55 }, { x: 0.85, y: 0.55 }],
    walls: [{ x: 0.42, y: 0.25, w: 0.16, h: 0.35 }],
    hazards: [] },
  // 8 – bouncy corridor
  { cannonX: 0.1, cannonY: 0.5,
    targets: [{ x: 0.85, y: 0.5 }, { x: 0.85, y: 0.25 }],
    walls: [
      { x: 0.25, y: 0.0, w: 0.06, h: 0.40 },
      { x: 0.55, y: 0.35, w: 0.06, h: 0.55 },
    ],
    hazards: [] },
  // 9 – hazard diagonal
  { cannonX: 0.5, cannonY: 0.9,
    targets: [{ x: 0.15, y: 0.15 }, { x: 0.5, y: 0.15 }, { x: 0.85, y: 0.15 }],
    walls: [{ x: 0.30, y: 0.36, w: 0.40, h: 0.05 }],
    hazards: [{ x: 0.12, y: 0.54, w: 0.76, h: 0.04 }] },
  // 10 – five targets, maze
  { cannonX: 0.5, cannonY: 0.92,
    targets: [
      { x: 0.5, y: 0.10 },
      { x: 0.15, y: 0.30 }, { x: 0.85, y: 0.30 },
      { x: 0.15, y: 0.60 }, { x: 0.85, y: 0.60 },
    ],
    walls: [
      { x: 0.30, y: 0.18, w: 0.40, h: 0.05 },
      { x: 0.20, y: 0.44, w: 0.22, h: 0.05 },
      { x: 0.58, y: 0.44, w: 0.22, h: 0.05 },
    ],
    hazards: [] },
  // 11 – hazards funnel
  { cannonX: 0.5, cannonY: 0.92,
    targets: [{ x: 0.5, y: 0.12 }, { x: 0.25, y: 0.12 }, { x: 0.75, y: 0.12 }],
    walls: [{ x: 0.36, y: 0.28, w: 0.28, h: 0.06 }],
    hazards: [
      { x: 0.05, y: 0.48, w: 0.30, h: 0.05 },
      { x: 0.65, y: 0.48, w: 0.30, h: 0.05 },
    ] },
  // 12 – complex corridor + 5 targets
  { cannonX: 0.08, cannonY: 0.5,
    targets: [
      { x: 0.92, y: 0.15 }, { x: 0.92, y: 0.50 }, { x: 0.92, y: 0.85 },
      { x: 0.50, y: 0.15 }, { x: 0.50, y: 0.85 },
    ],
    walls: [
      { x: 0.28, y: 0.0,  w: 0.06, h: 0.38 },
      { x: 0.28, y: 0.50, w: 0.06, h: 0.50 },
      { x: 0.60, y: 0.12, w: 0.06, h: 0.38 },
      { x: 0.60, y: 0.60, w: 0.06, h: 0.40 },
    ],
    hazards: [{ x: 0.12, y: 0.65, w: 0.14, h: 0.04 }] },
  // 13 – 6 targets + hazard cluster
  { cannonX: 0.5, cannonY: 0.94,
    targets: [
      { x: 0.15, y: 0.10 }, { x: 0.38, y: 0.10 }, { x: 0.62, y: 0.10 }, { x: 0.85, y: 0.10 },
      { x: 0.25, y: 0.38 }, { x: 0.75, y: 0.38 },
    ],
    walls: [
      { x: 0.10, y: 0.22, w: 0.20, h: 0.05 },
      { x: 0.70, y: 0.22, w: 0.20, h: 0.05 },
    ],
    hazards: [
      { x: 0.36, y: 0.56, w: 0.28, h: 0.05 },
    ] },
  // 14 – 7 targets hard
  { cannonX: 0.5, cannonY: 0.94,
    targets: [
      { x: 0.12, y: 0.10 }, { x: 0.5, y: 0.10 }, { x: 0.88, y: 0.10 },
      { x: 0.12, y: 0.40 }, { x: 0.88, y: 0.40 },
      { x: 0.3,  y: 0.60 }, { x: 0.7,  y: 0.60 },
    ],
    walls: [
      { x: 0.22, y: 0.22, w: 0.56, h: 0.04 },
      { x: 0.22, y: 0.50, w: 0.24, h: 0.04 },
      { x: 0.54, y: 0.50, w: 0.24, h: 0.04 },
    ],
    hazards: [
      { x: 0.36, y: 0.68, w: 0.28, h: 0.04 },
      { x: 0.04, y: 0.68, w: 0.14, h: 0.04 },
      { x: 0.82, y: 0.68, w: 0.14, h: 0.04 },
    ] },
  // 15 – 7 targets + hazards final
  { cannonX: 0.5, cannonY: 0.96,
    targets: [
      { x: 0.1,  y: 0.08 }, { x: 0.3,  y: 0.08 }, { x: 0.5, y: 0.08 }, { x: 0.7, y: 0.08 }, { x: 0.9, y: 0.08 },
      { x: 0.2,  y: 0.35 }, { x: 0.8,  y: 0.35 },
    ],
    walls: [
      { x: 0.10, y: 0.18, w: 0.35, h: 0.04 },
      { x: 0.55, y: 0.18, w: 0.35, h: 0.04 },
      { x: 0.38, y: 0.45, w: 0.24, h: 0.04 },
    ],
    hazards: [
      { x: 0.05, y: 0.56, w: 0.22, h: 0.04 },
      { x: 0.35, y: 0.62, w: 0.30, h: 0.04 },
      { x: 0.73, y: 0.56, w: 0.22, h: 0.04 },
    ] },
];

// ---------- constants ----------

const BULLET_SPEED   = 400;   // px/s
const MAX_BOUNCES    = 6;
const TRAIL_LEN      = 20;
const PREVIEW_BOUNCES = 4;
const TARGET_R       = 14;    // px (logical, before DPR)
const CANNON_R       = 12;
const DT_CAP         = 32;    // ms
const HINT_DISMISS_MS = 5000;
const LEVEL_KEY      = "one-bullet:level";
const HINT_KEY       = "one-bullet:seenHint";
const TOTAL_LEVELS   = 15;

// ---------- helpers ----------

function pool<T extends { alive: boolean }>(arr: T[], factory: () => T): T {
  const dead = arr.find((e) => !e.alive);
  if (dead) return dead;
  const n = factory();
  arr.push(n);
  return n;
}

function spawnParticle(
  particles: Particle[],
  x: number, y: number,
  color: string,
  count: number
): void {
  for (let i = 0; i < count; i++) {
    const p = pool(particles, () => ({
      x: 0, y: 0, vx: 0, vy: 0, life: 1, decay: 0, color: "#fff", alive: false,
    }));
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    p.x = x; p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.life = 1;
    p.decay = 1.5 + Math.random() * 1.5;
    p.color = color;
    p.alive = true;
  }
}

function spawnFloat(floats: FloatLabel[], x: number, y: number, text: string): void {
  const f = pool(floats, () => ({
    x: 0, y: 0, vy: 0, text: "", life: 1, decay: 0, alive: false,
  }));
  f.x = x; f.y = y; f.vy = -50; f.text = text;
  f.life = 1; f.decay = 1.6; f.alive = true;
}

// ---------- physics helpers ----------

// Reflect a vector about a normal
function reflect(vx: number, vy: number, nx: number, ny: number): Vec2 {
  const dot = vx * nx + vy * ny;
  return { x: vx - 2 * dot * nx, y: vy - 2 * dot * ny };
}

// Ray vs AABB: returns t of first hit (0..1 of step) or null
function rayAABB(
  px: number, py: number,
  dx: number, dy: number,
  bx: number, by: number,
  bw: number, bh: number
): { t: number; nx: number; ny: number } | null {
  // Slab method with epsilon to avoid re-entering on same face
  const eps = 0.001;
  let tMin = 0 + eps;
  let tMax = 1;
  let nx = 0;
  let ny = 0;

  // x slab
  if (Math.abs(dx) > 1e-9) {
    const t1 = (bx - px) / dx;
    const t2 = (bx + bw - px) / dx;
    const tEnter = Math.min(t1, t2);
    const tExit  = Math.max(t1, t2);
    if (tEnter > tMin) { tMin = tEnter; nx = t1 < t2 ? -1 : 1; ny = 0; }
    tMax = Math.min(tMax, tExit);
  } else {
    if (px < bx || px > bx + bw) return null;
  }

  // y slab
  if (Math.abs(dy) > 1e-9) {
    const t1 = (by - py) / dy;
    const t2 = (by + bh - py) / dy;
    const tEnterY = Math.min(t1, t2);
    const tExit   = Math.max(t1, t2);
    if (tEnterY > tMin) { tMin = tEnterY; nx = 0; ny = t1 < t2 ? -1 : 1; }
    tMax = Math.min(tMax, tExit);
  } else {
    if (py < by || py > by + bh) return null;
  }

  if (tMin > tMax) return null;
  return { t: tMin, nx, ny };
}

// Step bullet one frame; handles walls + arena bounds bouncing
function stepBullet(
  bullet: Bullet,
  dt: number,
  walls: Wall[],
  arenaW: number,
  arenaH: number,
  onBounce: (x: number, y: number, nx: number, ny: number) => void
): void {
  if (!bullet.alive) return;

  let remaining = dt;
  let px = bullet.x;
  let py = bullet.y;
  let vx = bullet.vx;
  let vy = bullet.vy;

  // Arena boundary walls (as virtual AABBs)
  const THICK = 20;
  const arenaWalls: Wall[] = [
    { x: -THICK, y: 0,       w: THICK,  h: arenaH },  // left
    { x: arenaW, y: 0,       w: THICK,  h: arenaH },  // right
    { x: 0,       y: -THICK, w: arenaW, h: THICK  },  // top
    { x: 0,       y: arenaH, w: arenaW, h: THICK  },  // bottom
  ];
  const allWalls = [...walls, ...arenaWalls];

  while (remaining > 1e-5 && bullet.alive) {
    const stepDx = vx * remaining;
    const stepDy = vy * remaining;

    let earliest: { t: number; nx: number; ny: number; } | null = null;

    for (const w of allWalls) {
      const hit = rayAABB(px, py, stepDx, stepDy, w.x, w.y, w.w, w.h);
      if (hit && (earliest === null || hit.t < earliest.t)) {
        earliest = hit;
      }
    }

    if (!earliest) {
      px += stepDx;
      py += stepDy;
      remaining = 0;
    } else {
      // Advance to hit
      px += stepDx * earliest.t;
      py += stepDy * earliest.t;
      remaining *= (1 - earliest.t);

      // Reflect
      const r = reflect(vx, vy, earliest.nx, earliest.ny);
      vx = r.x;
      vy = r.y;

      onBounce(px, py, earliest.nx, earliest.ny);
      bullet.bounces++;

      if (bullet.bounces >= MAX_BOUNCES) {
        bullet.alive = false;
        break;
      }
    }
  }

  bullet.x = px;
  bullet.y = py;
  bullet.vx = vx;
  bullet.vy = vy;

  // Store trail
  bullet.trail.push({ x: px, y: py });
  if (bullet.trail.length > TRAIL_LEN) bullet.trail.shift();
}

// Simulate preview path (no side-effects)
function simulatePreview(
  startX: number, startY: number,
  dirX: number, dirY: number,
  walls: Wall[],
  arenaW: number, arenaH: number
): Vec2[] {
  const pts: Vec2[] = [{ x: startX, y: startY }];
  let px = startX;
  let py = startY;
  let vx = dirX * BULLET_SPEED;
  let vy = dirY * BULLET_SPEED;

  const THICK = 20;
  const arenaWalls: Wall[] = [
    { x: -THICK, y: 0,       w: THICK,  h: arenaH },
    { x: arenaW, y: 0,       w: THICK,  h: arenaH },
    { x: 0,       y: -THICK, w: arenaW, h: THICK  },
    { x: 0,       y: arenaH, w: arenaW, h: THICK  },
  ];
  const allWalls = [...walls, ...arenaWalls];

  let bounces = 0;
  // We trace in time-steps rather than unit-distance for simplicity
  // Advance 5 steps at ~1/10s each for preview
  const TOTAL_TIME = 2.5; // seconds of preview
  const STEP = 0.016;
  let elapsed = 0;

  while (elapsed < TOTAL_TIME && bounces <= PREVIEW_BOUNCES) {
    const stepDx = vx * STEP;
    const stepDy = vy * STEP;

    let earliest: { t: number; nx: number; ny: number } | null = null;
    for (const w of allWalls) {
      const hit = rayAABB(px, py, stepDx, stepDy, w.x, w.y, w.w, w.h);
      if (hit && (earliest === null || hit.t < earliest.t)) earliest = hit;
    }

    if (!earliest) {
      px += stepDx;
      py += stepDy;
      elapsed += STEP;
      pts.push({ x: px, y: py });
    } else {
      px += stepDx * earliest.t;
      py += stepDy * earliest.t;
      pts.push({ x: px, y: py });
      const r = reflect(vx, vy, earliest.nx, earliest.ny);
      vx = r.x;
      vy = r.y;
      bounces++;
      elapsed += STEP * earliest.t;
    }
  }

  return pts;
}

// ---------- procedural level generator (level > 15) ----------

function generateLevel(level: number): LevelDef {
  const seed = level * 13337;
  function rng(i: number): number {
    const x = Math.sin(seed + i) * 43758.5453;
    return x - Math.floor(x);
  }

  // Gentle scaling: start with few targets, grow slowly
  const overLevel    = level - TOTAL_LEVELS;
  const targetCount  = Math.min(6, 2 + Math.floor(overLevel / 4));
  const wallCount    = Math.min(3, Math.floor(overLevel / 5));
  const hazardCount  = Math.min(2, Math.floor((overLevel - 5) / 4));

  const cannonX = 0.3 + rng(9999) * 0.4;
  const cannonY = 0.88 + rng(9998) * 0.04;

  // Place targets in the upper band, spaced so none sits behind a wall row
  const targets: Vec2[] = [];
  const cols = Math.min(targetCount, 4);
  for (let i = 0; i < targetCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const baseX = 0.15 + (col + 0.5) * (0.7 / cols);
    const baseY = 0.12 + row * 0.12;
    const jitterX = (rng(i * 2) - 0.5) * 0.06;
    const jitterY = (rng(i * 2 + 1) - 0.5) * 0.04;
    targets.push({ x: clamp01(baseX + jitterX), y: clamp01(baseY + jitterY) });
  }

  // Walls confined to mid-band so they create bounces without blocking cannon shots
  const walls: Wall[] = [];
  for (let i = 0; i < wallCount; i++) {
    const horiz = rng(100 + i) > 0.5;
    const w: Wall = {
      x: 0.15 + rng(200 + i) * 0.6,
      y: 0.4 + rng(300 + i) * 0.2,
      w: horiz ? 0.1 + rng(400 + i) * 0.15 : 0.04 + rng(500 + i) * 0.03,
      h: horiz ? 0.04 + rng(600 + i) * 0.02 : 0.1 + rng(700 + i) * 0.1,
    };
    // reject if wall is right in front of cannon (straight up path blocked)
    if (!(w.x <= cannonX && cannonX <= w.x + w.w && w.y > cannonY - 0.15)) {
      walls.push(w);
    }
  }

  // Hazards far from cannon path
  const hazards: Hazard[] = [];
  for (let i = 0; i < hazardCount; i++) {
    hazards.push({
      x: 0.1 + rng(800 + i) * 0.7,
      y: 0.65 + rng(900 + i) * 0.15,
      w: 0.08 + rng(1000 + i) * 0.06,
      h: 0.03,
    });
  }

  return { cannonX, cannonY, targets, walls, hazards };
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

// ---------- canvas setup ----------

function makeCanvas(container: HTMLElement): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr: () => number;
  cw: () => number;
  ch: () => number;
} {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;";
  container.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("no 2d context");
  const ctx = ctxRaw;

  function resize(): void {
    const d = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w < 4 || h < 4) return;
    canvas.width  = Math.round(w * d);
    canvas.height = Math.round(h * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  return {
    canvas,
    ctx,
    dpr: () => window.devicePixelRatio || 1,
    cw: () => canvas.width / (window.devicePixelRatio || 1),
    ch: () => canvas.height / (window.devicePixelRatio || 1),
  };
}

// ---------- render ----------

function drawBackground(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
  ctx.fillStyle = "#0a1210";
  ctx.fillRect(0, 0, cw, ch);

  // subtle grid
  ctx.strokeStyle = "rgba(217,248,228,0.04)";
  ctx.lineWidth = 0.5;
  const step = 32;
  for (let x = 0; x < cw; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
  }
  for (let y = 0; y < ch; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
  }
}

function drawWalls(ctx: CanvasRenderingContext2D, walls: Wall[]): void {
  for (const w of walls) {
    ctx.fillStyle = "#1a3a5c";
    ctx.fillRect(w.x, w.y, w.w, w.h);
    // top highlight
    ctx.fillStyle = "rgba(100,180,255,0.25)";
    ctx.fillRect(w.x, w.y, w.w, Math.min(3, w.h * 0.15));
  }
}

function drawHazards(ctx: CanvasRenderingContext2D, hazards: Hazard[], now: number): void {
  for (const h of hazards) {
    const blink = Math.sin(now * 0.006) > 0;
    ctx.fillStyle = "#5c0a0a";
    ctx.fillRect(h.x, h.y, h.w, h.h);
    ctx.strokeStyle = blink ? "#ff3333" : "#ff000080";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(h.x + 0.75, h.y + 0.75, h.w - 1.5, h.h - 1.5);
    // spike tops
    ctx.fillStyle = blink ? "#ff3333" : "#aa2222";
    const spikeW = Math.max(6, h.w / 6);
    const count = Math.floor(h.w / spikeW);
    for (let i = 0; i < count; i++) {
      const sx = h.x + i * spikeW;
      ctx.beginPath();
      ctx.moveTo(sx, h.y);
      ctx.lineTo(sx + spikeW / 2, h.y - 6);
      ctx.lineTo(sx + spikeW, h.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawTargets(ctx: CanvasRenderingContext2D, targets: Target[], now: number): void {
  for (const t of targets) {
    if (!t.alive) {
      // brief flash on hit
      const age = now - t.hitT;
      if (age < 300) {
        const alpha = 1 - age / 300;
        const r = TARGET_R * (1 + age / 200);
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(80,255,120,${alpha * 0.4})`;
        ctx.fill();
      }
      continue;
    }
    const pulse = 1 + 0.1 * Math.sin(now * 0.004);
    const r = TARGET_R * pulse;
    ctx.shadowBlur = 16;
    ctx.shadowColor = "#44ff88";
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#1a5c2a";
    ctx.fill();
    ctx.strokeStyle = "#44ff88";
    ctx.lineWidth = 2;
    ctx.stroke();
    // inner dot
    ctx.beginPath();
    ctx.arc(t.x, t.y, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = "#d9f8e4";
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawCannon(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  aimX: number, aimY: number,
  fired: boolean
): void {
  const angle = Math.atan2(aimY - cy, aimX - cx);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  // barrel
  ctx.fillStyle = fired ? "#d9f8e4" : "#ffd166";
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#ffd166";
  ctx.fillRect(0, -4, CANNON_R + 4, 8);
  ctx.shadowBlur = 0;

  ctx.restore();

  // base circle
  ctx.beginPath();
  ctx.arc(cx, cy, CANNON_R, 0, Math.PI * 2);
  ctx.fillStyle = "#2a4a3a";
  ctx.fill();
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawBullet(ctx: CanvasRenderingContext2D, bullet: Bullet): void {
  if (!bullet.alive) return;

  // trail
  const n = bullet.trail.length;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const prev = bullet.trail[i - 1];
    const curr = bullet.trail[i];
    if (!prev || !curr) continue;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.strokeStyle = `rgba(255,255,200,${t * 0.6})`;
    ctx.lineWidth = t * 3;
    ctx.stroke();
  }

  // bullet dot
  ctx.beginPath();
  ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);
  ctx.shadowBlur = 18;
  ctx.shadowColor = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawPreview(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  now: number
): void {
  if (pts.length < 2) return;

  // dashed pulsing line
  const dash = 6 + 2 * Math.sin(now * 0.01);
  ctx.setLineDash([dash, dash]);
  ctx.strokeStyle = "rgba(255,209,102,0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i]!.x, pts[i]!.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  for (const p of particles) {
    if (!p.alive) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * p.life, 0, Math.PI * 2);
    ctx.fillStyle = p.color + Math.round(p.life * 255).toString(16).padStart(2, "0");
    ctx.fill();
  }
}

function drawFloatLabels(ctx: CanvasRenderingContext2D, floats: FloatLabel[]): void {
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  for (const f of floats) {
    if (!f.alive) continue;
    ctx.globalAlpha = f.life;
    ctx.fillStyle = "#d9f8e4";
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#44ff88";
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// ---------- HUD ----------

function buildHUD(
  container: HTMLElement,
  levelNum: number,
  score: number,
  best: number
): {
  levelEl: HTMLElement;
  scoreEl: HTMLElement;
  bestEl: HTMLElement;
  pauseBtn: HTMLElement;
  fsBtn: HTMLElement;
  retryBtn: HTMLElement;
  skipBtn: HTMLElement;
} {
  const hud = document.createElement("div");
  hud.className = "ob-hud";
  hud.innerHTML = `
    <div class="ob-hud-left">
      <span class="ob-label">LV</span>
      <span class="ob-val" id="ob-level">${levelNum}</span>
    </div>
    <div class="ob-hud-center">
      <span class="ob-label">SC</span><span class="ob-val" id="ob-score">${score}</span>
      <span class="ob-label" style="margin-left:6px">B</span><span class="ob-val" id="ob-best">${best}</span>
    </div>
    <div class="ob-hud-right">
      <button class="btn ob-btn" id="ob-fs"    aria-label="Fullscreen">⛶</button>
      <button class="btn ob-btn" id="ob-skip"  aria-label="Skip level">⏭</button>
      <button class="btn ob-btn" id="ob-retry" aria-label="Retry">↺</button>
      <button class="btn ob-btn" id="ob-pause" aria-label="Pause">⏸</button>
    </div>
  `;
  container.appendChild(hud);

  return {
    levelEl:  hud.querySelector("#ob-level")  as HTMLElement,
    scoreEl:  hud.querySelector("#ob-score")  as HTMLElement,
    bestEl:   hud.querySelector("#ob-best")   as HTMLElement,
    pauseBtn: hud.querySelector("#ob-pause")  as HTMLElement,
    fsBtn:    hud.querySelector("#ob-fs")     as HTMLElement,
    retryBtn: hud.querySelector("#ob-retry")  as HTMLElement,
    skipBtn:  hud.querySelector("#ob-skip")   as HTMLElement,
  };
}

// ---------- overlays ----------

function showWin(
  container: HTMLElement,
  levelNum: number,
  levelScore: number,
  onNext: () => void,
  onMenu: () => void
): HTMLElement {
  const el = document.createElement("div");
  el.className = "ob-overlay";
  el.innerHTML = `
    <div class="ob-box">
      <div class="ob-box-title ob-win">LEVEL COMPLETE</div>
      <div class="ob-box-score">${levelScore > 0 ? "+" + levelScore : ""}</div>
      <div class="ob-box-sub">Level ${levelNum}</div>
      <div class="ob-box-actions">
        <button class="btn primary ob-box-btn" id="ob-next">NEXT LEVEL</button>
        <button class="btn ob-box-btn" id="ob-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(el);
  el.querySelector("#ob-next")?.addEventListener("pointerup", () => { el.remove(); onNext(); });
  el.querySelector("#ob-menu")?.addEventListener("pointerup", () => { el.remove(); onMenu(); });
  return el;
}

function showFail(
  container: HTMLElement,
  onRetry: () => void,
  onMenu: () => void
): HTMLElement {
  const el = document.createElement("div");
  el.className = "ob-overlay";
  el.innerHTML = `
    <div class="ob-box">
      <div class="ob-box-title ob-fail">MISSED</div>
      <div class="ob-box-sub">Target still standing…</div>
      <div class="ob-box-actions">
        <button class="btn primary ob-box-btn" id="ob-retry-btn">RETRY</button>
        <button class="btn ob-box-btn" id="ob-menu-btn">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(el);
  el.querySelector("#ob-retry-btn")?.addEventListener("pointerup", () => { el.remove(); onRetry(); });
  el.querySelector("#ob-menu-btn")?.addEventListener("pointerup",  () => { el.remove(); onMenu(); });
  return el;
}

// ---------- hint overlay ----------

function buildHintOverlay(container: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.className = "ob-hint";
  el.innerHTML = `
    <div class="ob-hint-line ob-hint-big">DRAG TO AIM, RELEASE TO FIRE</div>
    <div class="ob-hint-line">Hit ALL targets with ONE bullet.</div>
  `;
  container.appendChild(el);
  return el;
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "ob-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .oneshot-root {
      display: flex; flex-direction: column; flex: 1; min-height: 0;
      background: #0a1210; user-select: none; -webkit-user-select: none;
    }
    .ob-hud {
      display: flex; align-items: center; justify-content: space-between;
      padding: 4px 6px; gap: 4px;
      font-family: monospace; font-size: 11px; color: #d9f8e4;
      background: rgba(0,0,0,0.5); flex-shrink: 0;
      flex-wrap: nowrap;
    }
    .ob-hud-left, .ob-hud-center, .ob-hud-right { display: flex; align-items: center; gap: 3px; }
    .ob-hud-left, .ob-hud-center { min-width: 0; overflow: hidden; }
    .ob-label { font-size: 8px; opacity: 0.6; letter-spacing: 1px; }
    .ob-val   { font-size: 12px; font-weight: bold; min-width: 18px; white-space: nowrap; }
    .ob-btn   { min-width: 30px; min-height: 32px; font-size: 14px;
                border-color: #d9f8e4; color: #d9f8e4; background: transparent;
                padding: 0 4px; flex-shrink: 0; }
    .ob-canvas-wrap {
      flex: 1; min-height: 0; position: relative; overflow: hidden;
    }
    .ob-overlay {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.80); z-index: 10;
    }
    .ob-box {
      text-align: center; padding: 28px 24px; min-width: 220px;
      background: #0a1210; border: 1px solid #d9f8e4; border-radius: 10px;
      font-family: monospace;
    }
    .ob-box-title { font-size: 20px; letter-spacing: 3px; margin-bottom: 8px; }
    .ob-win  { color: #44ff88; text-shadow: 0 0 12px #44ff88; }
    .ob-fail { color: #ff3333; text-shadow: 0 0 12px #ff3333; }
    .ob-box-score { font-size: 36px; font-weight: bold; color: #ffd166;
                    text-shadow: 0 0 14px #ffd166; min-height: 44px; }
    .ob-box-sub   { font-size: 11px; color: #8ab09a; letter-spacing: 1px; margin-bottom: 16px; }
    .ob-box-actions { display: flex; gap: 10px; justify-content: center; }
    .ob-box-btn   { min-width: 100px; min-height: 44px; font-family: monospace;
                    font-size: 12px; letter-spacing: 1px; }
    .ob-hint {
      position: absolute; bottom: 80px; left: 0; right: 0;
      text-align: center; pointer-events: none; z-index: 5;
      font-family: monospace; color: #d9f8e4;
    }
    .ob-hint-big  { font-size: 15px; font-weight: bold; letter-spacing: 1px;
                    text-shadow: 0 0 8px #44ff88; margin-bottom: 4px; }
    .ob-hint-line { font-size: 12px; opacity: 0.85; }
  `;
  document.head.appendChild(style);
}

// ---------- score formula ----------

function calcLevelScore(levelNum: number, bouncesUsed: number, elapsedMs: number): number {
  const diff = 1 + (levelNum - 1) * 0.15;
  const raw = 1000 * diff - bouncesUsed * 50 - elapsedMs / 100;
  return Math.max(0, Math.round(raw));
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();
  container.innerHTML = "";
  container.classList.add("oneshot-root");
  const prevTouch = container.style.touchAction;
  container.style.touchAction = "none";

  // Layout: hud (top) + canvas (fill)
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0;";
  container.appendChild(wrap);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "ob-canvas-wrap";
  wrap.appendChild(canvasWrap);

  // State
  let currentLevel = 1;
  let totalScore = 0;
  let best = 0;
  let phase: Phase = "aiming";

  // We keep HUD reference and rebuild it on level change
  let hudRefs: ReturnType<typeof buildHUD> | null = null;
  let hintEl: HTMLElement | null = null;
  let hintDismissTimer = -1;
  let seenHint = false;
  let stateReady = false;

  // Per-level mutable state
  let targets: Target[] = [];
  let walls: Wall[] = [];
  let hazards: Hazard[] = [];
  let cannonPx = 0;
  let cannonPy = 0;
  let bullet: Bullet = { x: 0, y: 0, vx: 0, vy: 0, alive: false, bounces: 0, trail: [] };
  let particles: Particle[] = [];
  let floats: FloatLabel[] = [];
  let levelStartT = 0;
  let aimTarget: Vec2 = { x: 0, y: 0 };
  let isDragging = false;
  let previewPts: Vec2[] = [];
  let levelScore = 0;
  let bouncesUsedThisLevel = 0;
  let shakeAmt = 0;
  let shakeEnd = 0;
  let rafId = 0;
  let lastT = 0;

  const { canvas, ctx, cw, ch } = makeCanvas(canvasWrap);

  // Load persisted level + best
  void Promise.all([
    db.settings.get(LEVEL_KEY),
    personalBest("one-bullet"),
  ]).then(([lvlRow, pb]) => {
    if (lvlRow) {
      const n = parseInt(lvlRow.value, 10);
      if (!isNaN(n) && n >= 1) currentLevel = n;
    }
    best = pb;
    stateReady = true;
    loadLevel(currentLevel);
  });

  // Load hint state
  void db.settings.get(HINT_KEY).then((row) => {
    seenHint = !!row;
    if (!seenHint && stateReady) showHint();
  });

  function getLevelDef(n: number): LevelDef {
    if (n <= TOTAL_LEVELS) return LEVELS[n - 1]!;
    return generateLevel(n);
  }

  function loadLevel(n: number): void {
    if (!stateReady) return;
    currentLevel = n;
    phase = "aiming";

    const def = getLevelDef(n);
    const W = cw();
    const H = ch();

    cannonPx = def.cannonX * W;
    cannonPy = def.cannonY * H;
    aimTarget = { x: cannonPx, y: cannonPy - 60 };

    targets = def.targets.map((t) => ({
      x: t.x * W,
      y: t.y * H,
      alive: true,
      hitT: -1,
    }));

    walls = def.walls.map((w) => ({
      x: w.x * W,
      y: w.y * H,
      w: w.w * W,
      h: w.h * H,
    }));

    hazards = def.hazards.map((h) => ({
      x: h.x * W,
      y: h.y * H,
      w: h.w * W,
      h: h.h * H,
    }));

    bullet = { x: 0, y: 0, vx: 0, vy: 0, alive: false, bounces: 0, trail: [] };
    particles = [];
    floats = [];
    levelScore = 0;
    bouncesUsedThisLevel = 0;
    levelStartT = performance.now();
    previewPts = [];
    isDragging = false;

    rebuildHUD();

    if (!seenHint) showHint();
  }

  function rebuildHUD(): void {
    const existing = wrap.querySelector(".ob-hud");
    if (existing) existing.remove();

    hudRefs = buildHUD(wrap, currentLevel, totalScore, best);
    wrap.insertBefore(wrap.querySelector(".ob-hud")!, canvasWrap);

    hudRefs.fsBtn.addEventListener("pointerup", () => {
      const host = container.closest(".game-host") as HTMLElement | null ?? container;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void host.requestFullscreen().catch(() => {});
    });

    hudRefs.pauseBtn.addEventListener("pointerup", () => {
      if (phase === "aiming") {
        phase = "paused";
        hudRefs!.pauseBtn.textContent = "▶";
      } else if (phase === "paused") {
        phase = "aiming";
        hudRefs!.pauseBtn.textContent = "⏸";
        lastT = performance.now();
      }
    });

    hudRefs.retryBtn.addEventListener("pointerup", () => {
      loadLevel(currentLevel);
    });

    hudRefs.skipBtn.addEventListener("pointerup", () => {
      advanceLevel(0);
    });
  }

  function showHint(): void {
    if (hintEl) return;
    hintEl = buildHintOverlay(canvasWrap);
    if (hintDismissTimer !== -1) clearTimeout(hintDismissTimer);
    hintDismissTimer = window.setTimeout(dismissHint, HINT_DISMISS_MS);
  }

  function dismissHint(): void {
    hintEl?.remove();
    hintEl = null;
    if (!seenHint) {
      seenHint = true;
      void db.settings.put({ key: HINT_KEY, value: "1" });
    }
  }

  function advanceLevel(earned: number): void {
    totalScore += earned;
    void db.settings.put({ key: LEVEL_KEY, value: String(currentLevel + 1) });
    if (totalScore > best) {
      best = totalScore;
    }
    loadLevel(currentLevel + 1);
    if (hudRefs) {
      hudRefs.scoreEl.textContent = String(totalScore);
      hudRefs.bestEl.textContent = String(best);
    }
  }

  function fire(dirX: number, dirY: number): void {
    if (phase !== "aiming") return;
    dismissHint();

    const len = Math.hypot(dirX, dirY);
    if (len < 1e-6) return;

    const nx = dirX / len;
    const ny = dirY / len;

    bullet = {
      x: cannonPx,
      y: cannonPy,
      vx: nx * BULLET_SPEED,
      vy: ny * BULLET_SPEED,
      alive: true,
      bounces: 0,
      trail: [],
    };

    phase = "flying";
    levelStartT = performance.now();
    bouncesUsedThisLevel = 0;
    previewPts = [];

    playSfx("shoot");
    if ("vibrate" in navigator) navigator.vibrate(10);
  }

  function checkHazards(): boolean {
    for (const h of hazards) {
      if (
        bullet.x >= h.x && bullet.x <= h.x + h.w &&
        bullet.y >= h.y && bullet.y <= h.y + h.h
      ) {
        return true;
      }
    }
    return false;
  }

  function checkTargets(): void {
    for (const t of targets) {
      if (!t.alive) continue;
      if (Math.hypot(bullet.x - t.x, bullet.y - t.y) < TARGET_R + 4) {
        t.alive = false;
        t.hitT = performance.now();
        spawnParticle(particles, t.x, t.y, "#44ff88", 10);
        spawnFloat(floats, t.x, t.y - 20, "+100");
        levelScore += 100;
        playSfx("pop");
        if ("vibrate" in navigator) navigator.vibrate(15);
      }
    }
  }

  function onBulletBounce(bx: number, by: number, _nx: number, _ny: number): void {
    bouncesUsedThisLevel++;
    spawnParticle(particles, bx, by, "#ffd166", 4);
    playSfx("bounce");
    if ("vibrate" in navigator) navigator.vibrate(4);
    shakeAmt = 3;
    shakeEnd = performance.now() + 80;
  }

  // RAF game loop
  function loop(now: number): void {
    const dtRaw = lastT > 0 ? now - lastT : 16;
    lastT = now;
    const dt = Math.min(dtRaw, DT_CAP) / 1000;

    if (!stateReady) {
      rafId = requestAnimationFrame(loop);
      return;
    }

    const W = cw();
    const H = ch();

    // Update particles
    for (const p of particles) {
      if (!p.alive) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) p.alive = false;
    }
    for (const f of floats) {
      if (!f.alive) continue;
      f.y += f.vy * dt;
      f.life -= f.decay * dt;
      if (f.life <= 0) f.alive = false;
    }

    if (phase === "flying" && bullet.alive) {
      stepBullet(bullet, dt, walls, W, H, onBulletBounce);
      checkTargets();

      // Hazard check
      if (checkHazards()) {
        bullet.alive = false;
      }

      // Out-of-bounds check (sanity, walls should have caught it)
      if (
        bullet.x < -20 || bullet.x > W + 20 ||
        bullet.y < -20 || bullet.y > H + 20
      ) {
        bullet.alive = false;
      }

      if (!bullet.alive) {
        const allDead = targets.every((t) => !t.alive);
        if (allDead) {
          phase = "levelwin";
          const elapsed = performance.now() - levelStartT;
          const bonus = calcLevelScore(currentLevel, bouncesUsedThisLevel, elapsed);
          levelScore += bonus;
          playSfx("win");
          if ("vibrate" in navigator) navigator.vibrate([30, 60, 30, 60, 100]);
          void submit("one-bullet", totalScore + levelScore);
          setTimeout(() => {
            showWin(
              canvasWrap,
              currentLevel,
              levelScore,
              () => advanceLevel(levelScore),
              () => navigate("/")
            );
          }, 600);
        } else {
          phase = "levelfail";
          playSfx("lose");
          if ("vibrate" in navigator) navigator.vibrate([60, 60]);
          setTimeout(() => {
            showFail(
              canvasWrap,
              () => loadLevel(currentLevel),
              () => navigate("/")
            );
          }, 400);
        }
      }
    }

    // Check all targets hit while still alive (bullet passes through)
    if (phase === "flying" && bullet.alive) {
      if (targets.every((t) => !t.alive)) {
        bullet.alive = false;
        phase = "levelwin";
        const elapsed = performance.now() - levelStartT;
        const bonus = calcLevelScore(currentLevel, bouncesUsedThisLevel, elapsed);
        levelScore += bonus;
        playSfx("win");
        if ("vibrate" in navigator) navigator.vibrate([30, 60, 30, 60, 100]);
        void submit("one-bullet", totalScore + levelScore);
        setTimeout(() => {
          showWin(
            canvasWrap,
            currentLevel,
            levelScore,
            () => advanceLevel(levelScore),
            () => navigate("/")
          );
        }, 600);
      }
    }

    // --- Draw ---
    ctx.save();

    // Screen shake
    let sx = 0;
    let sy = 0;
    if (shakeAmt > 0 && now < shakeEnd) {
      const t = 1 - (now - (shakeEnd - 80)) / 80;
      sx = (Math.random() - 0.5) * shakeAmt * 2 * t;
      sy = (Math.random() - 0.5) * shakeAmt * 2 * t;
    }
    ctx.translate(sx, sy);

    drawBackground(ctx, W, H);
    drawWalls(ctx, walls);
    drawHazards(ctx, hazards, now);
    drawTargets(ctx, targets, now);

    // Preview while aiming
    if (phase === "aiming" && isDragging && previewPts.length > 1) {
      drawPreview(ctx, previewPts, now);
    }

    // Cannon always visible
    const aimX = isDragging ? aimTarget.x : cannonPx;
    const aimY = isDragging ? aimTarget.y : cannonPy - 1;
    drawCannon(ctx, cannonPx, cannonPy, aimX, aimY, phase === "flying");

    drawBullet(ctx, bullet);
    drawParticles(ctx, particles);
    drawFloatLabels(ctx, floats);

    ctx.restore();

    rafId = requestAnimationFrame(loop);
  }

  // ---------- input ----------

  // Convert pointer event to canvas-logical coords
  function toLogical(e: PointerEvent): Vec2 {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left),
      y: (e.clientY - rect.top),
    };
  }

  let activePointerId = -1;

  function onPointerDown(e: PointerEvent): void {
    if (phase !== "aiming") return;
    if (activePointerId !== -1) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    isDragging = true;
    const p = toLogical(e);
    aimTarget = p;
    updatePreview();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!isDragging || e.pointerId !== activePointerId) return;
    e.preventDefault();
    aimTarget = toLogical(e);
    updatePreview();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!isDragging || e.pointerId !== activePointerId) return;
    e.preventDefault();
    isDragging = false;
    activePointerId = -1;

    const dx = aimTarget.x - cannonPx;
    const dy = aimTarget.y - cannonPy;
    if (Math.hypot(dx, dy) > 8) {
      fire(dx, dy);
    }
    previewPts = [];
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerId !== activePointerId) return;
    isDragging = false;
    activePointerId = -1;
    previewPts = [];
  }

  function updatePreview(): void {
    if (!isDragging) return;
    const dx = aimTarget.x - cannonPx;
    const dy = aimTarget.y - cannonPy;
    const len = Math.hypot(dx, dy);
    if (len < 4) { previewPts = []; return; }
    previewPts = simulatePreview(
      cannonPx, cannonPy,
      dx / len, dy / len,
      walls,
      cw(), ch()
    );
  }

  canvas.addEventListener("pointerdown",   onPointerDown);
  canvas.addEventListener("pointermove",   onPointerMove);
  canvas.addEventListener("pointerup",     onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  // Keyboard shortcuts
  function onKey(e: KeyboardEvent): void {
    if (e.key === " " || e.key === "Space") {
      e.preventDefault();
      if (phase === "aiming") {
        // fire straight up
        fire(0, -1);
      }
    }
    if (e.key === "r" || e.key === "R") {
      loadLevel(currentLevel);
    }
    if (e.key === "n" || e.key === "N") {
      advanceLevel(0);
    }
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      hudRefs?.pauseBtn.dispatchEvent(new PointerEvent("pointerup"));
    }
  }
  document.addEventListener("keydown", onKey);

  // Resize: reload current level to rescale coordinates
  const resizeOb = new ResizeObserver(() => {
    if (stateReady) loadLevel(currentLevel);
  });
  resizeOb.observe(canvasWrap);

  lastT = performance.now();
  rafId = requestAnimationFrame(loop);

  return function cleanup(): void {
    cancelAnimationFrame(rafId);
    document.removeEventListener("keydown", onKey);
    canvas.removeEventListener("pointerdown",   onPointerDown);
    canvas.removeEventListener("pointermove",   onPointerMove);
    canvas.removeEventListener("pointerup",     onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
    resizeOb.disconnect();
    clearTimeout(hintDismissTimer);
    container.innerHTML = "";
    container.classList.remove("oneshot-root");
    container.style.touchAction = prevTouch;
  };
}
