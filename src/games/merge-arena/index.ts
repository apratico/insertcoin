import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";

// ---------- constants ----------

const COLS = 3;
const ROWS = 2;
const SLOT_COUNT = COLS * ROWS;
const BULLET_SPEED = 500; // px/s
const DT_CAP = 32; // ms
const WAVE_SIZE = 10;
const WAVE_PAUSE_MS = 3000;
const BASE_SPAWN_INTERVAL_MS = 1800;
const MIN_SPAWN_INTERVAL_MS = 400;
const SPAWN_STEP_MS = 50;
const WAVE_HP_MULT = 1.08;
const HINT_AUTO_DISMISS_MS = 6000;
const BUY_BASE_COST = 10;
const BUY_COST_MULT = 1.5;

// ---------- turret table ----------

interface TurretStats {
  color: string;
  damage: number;
  fireRate: number; // shots per second
  rangeMultiplier: number;
}

const TURRET_STATS: TurretStats[] = [
  { color: "#888888", damage: 2,    fireRate: 1.0, rangeMultiplier: 1.00 }, // lv1
  { color: "#44aaff", damage: 5,    fireRate: 1.2, rangeMultiplier: 1.05 }, // lv2
  { color: "#22cc22", damage: 10,   fireRate: 1.5, rangeMultiplier: 1.10 }, // lv3
  { color: "#ffcc00", damage: 20,   fireRate: 1.8, rangeMultiplier: 1.15 }, // lv4
  { color: "#ff6600", damage: 40,   fireRate: 2.2, rangeMultiplier: 1.20 }, // lv5
  { color: "#ff2222", damage: 80,   fireRate: 2.5, rangeMultiplier: 1.30 }, // lv6
  { color: "#ff00ff", damage: 150,  fireRate: 3.0, rangeMultiplier: 1.40 }, // lv7
  { color: "#aa00ff", damage: 280,  fireRate: 3.2, rangeMultiplier: 1.50 }, // lv8
  { color: "#00ffff", damage: 500,  fireRate: 3.5, rangeMultiplier: 1.60 }, // lv9
  { color: "#ffff00", damage: 1000, fireRate: 4.0, rangeMultiplier: 2.00 }, // lv10
];


// ---------- types ----------

type Phase = "playing" | "waveBreak" | "gameover" | "paused";

interface Turret {
  level: number;
  fireCooldown: number; // seconds until next shot
}

type Slot = Turret | null;

interface Enemy {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  kind: EnemyKind;
  alive: boolean;
  flashT: number;
  speed: number;
}

type EnemyKind = "grunt" | "runner" | "tank";

interface EnemyKindConfig {
  baseHp: number;
  speedMult: number;
  radius: number;
  color: string;
  glow: string;
  coins: number;
}

const ENEMY_CONFIG: Record<EnemyKind, EnemyKindConfig> = {
  grunt:  { baseHp: 10, speedMult: 1.0,  radius: 10, color: "#ff4444", glow: "#ff0000", coins: 2 },
  runner: { baseHp: 6,  speedMult: 1.5,  radius: 8,  color: "#ffcc00", glow: "#ffaa00", coins: 3 },
  tank:   { baseHp: 30, speedMult: 0.6,  radius: 16, color: "#aa44ff", glow: "#8800ff", coins: 6 },
};

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  alive: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  color: string;
  alive: boolean;
}

// ---------- helpers ----------

function vibrate(pattern: number | number[]): void {
  if ("vibrate" in navigator) navigator.vibrate?.(pattern);
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

function getFromPool<T extends { alive: boolean }>(pool: T[], factory: () => T): T {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i]!.alive) return pool[i]!;
  }
  const o = factory();
  pool.push(o);
  return o;
}

function turretStats(level: number): TurretStats {
  return TURRET_STATS[level - 1] ?? TURRET_STATS[0]!;
}

function buyCost(totalTurrets: number): number {
  return Math.round(BUY_BASE_COST * Math.pow(BUY_COST_MULT, totalTurrets));
}

function countTurrets(slots: Slot[]): number {
  return slots.filter((s) => s !== null).length;
}

function pickEnemyKind(wave: number): EnemyKind {
  const r = Math.random();
  if (wave >= 2 && r < 0.08) return "runner";
  if (wave >= 2 && (r < 0.25 || (wave >= 4 && r < 0.35))) return "tank";
  return "grunt";
}

// ---------- object factories ----------

function makeEnemy(): Enemy {
  return { x: 0, y: 0, hp: 0, maxHp: 0, kind: "grunt", alive: false, flashT: 0, speed: 0 };
}

function makeBullet(): Bullet {
  return { x: 0, y: 0, vx: 0, vy: 0, damage: 0, alive: false };
}

function makeParticle(): Particle {
  return { x: 0, y: 0, vx: 0, vy: 0, life: 0, decay: 0, color: "#fff", alive: false };
}

// ---------- spawn particle burst ----------

function spawnParticles(
  particles: Particle[],
  x: number, y: number,
  color: string,
  count: number,
  speed: number
): void {
  for (let i = 0; i < count; i++) {
    const p = getFromPool(particles, makeParticle);
    const a = Math.random() * Math.PI * 2;
    const spd = speed * (0.5 + Math.random() * 0.5);
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * spd;
    p.vy = Math.sin(a) * spd;
    p.life = 1;
    p.decay = 1 / 0.35;
    p.color = color;
    p.alive = true;
  }
}

// ---------- draw helpers ----------

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

function drawRoundRect(
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

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("merge-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // ---------- layout ----------
  // Outer wrapper: flex column, fills container
  const wrap = document.createElement("div");
  wrap.className = "ma-wrap";
  container.appendChild(wrap);

  // HUD bar (top)
  const hudEl = document.createElement("div");
  hudEl.className = "ma-hud";
  wrap.appendChild(hudEl);

  // Canvas for combat zone
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "ma-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "ma-canvas";
  canvasWrap.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx: CanvasRenderingContext2D = ctxRaw;

  // BUY bar
  const buyBarEl = document.createElement("div");
  buyBarEl.className = "ma-buy-bar";
  wrap.appendChild(buyBarEl);

  const buyBtn = document.createElement("button");
  buyBtn.className = "btn ma-buy-btn";
  buyBtn.id = "ma-buy";
  buyBarEl.appendChild(buyBtn);

  // Arsenal DOM grid
  const arsenalEl = document.createElement("div");
  arsenalEl.className = "ma-arsenal";
  wrap.appendChild(arsenalEl);

  // ---------- game state ----------
  let phase: Phase = "playing";
  let wave = 1;
  let score = 0;
  let best = 0;
  let coins = 0;
  let hp = 3;
  let kills = 0;
  let coinsSpent = 0;

  const slots: Slot[] = Array(SLOT_COUNT).fill(null);
  const enemies: Enemy[] = [];
  const bullets: Bullet[] = [];
  const particles: Particle[] = [];

  // Wave state
  let waveEnemiesSpawned = 0;
  let spawnAccum = 0;
  let waveBreakTimer = 0;
  let waveKills = 0;
  let waveBonus = 0;

  // Canvas geometry (set in resize)
  let cw = 0, ch = 0, dpr = 1;
  // Slot DOM rects cached per-resize
  const slotRects: DOMRect[] = [];

  // Drag state
  let dragFromSlot = -1;
  let dragGhostEl: HTMLElement | null = null;
  let dragPointerId = -1;

  // Overlay refs
  let gameoverOverlay: HTMLElement | null = null;
  let pausedOverlay: HTMLElement | null = null;
  let waveBannerEl: HTMLElement | null = null;
  let hintEl: HTMLElement | null = null;

  let rafId = 0;
  let lastTime = 0;
  let stateReady = false;

  void personalBest("merge-arena").then((b) => {
    best = b;
    updateHUD();
  });

  // ---------- HUD & Buy ----------

  function updateHUD(): void {
    const hearts = "♥".repeat(hp) + "♡".repeat(Math.max(0, 3 - hp));
    hudEl.innerHTML = `
      <div class="ma-hud-left">
        <span class="ma-hp">${hearts}</span>
        <span class="ma-wave">WAVE ${wave}</span>
      </div>
      <div class="ma-hud-right">
        <span class="ma-coins">&#9679; ${coins}</span>
        <span class="ma-score">&#9733; ${score}</span>
      </div>
      <div class="ma-hud-btns">
        <button class="btn ma-ctrl-btn" id="ma-fs" aria-label="Fullscreen">&#9638;</button>
        <button class="btn ma-ctrl-btn" id="ma-pause" aria-label="Pause">&#9646;&#9646;</button>
      </div>
    `;

    hudEl.querySelector("#ma-fs")?.addEventListener("pointerup", () => {
      const root = container.closest(".game-host") as HTMLElement | null;
      const target = root ?? container;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void target.requestFullscreen?.().catch(() => {});
    });

    hudEl.querySelector("#ma-pause")?.addEventListener("pointerup", () => {
      if (phase === "gameover") return;
      if (phase === "playing" || phase === "waveBreak") {
        phase = "paused";
        pausedOverlay = document.createElement("div");
        pausedOverlay.className = "ma-paused-overlay";
        pausedOverlay.innerHTML = `<div class="ma-paused-box">
          <div class="ma-paused-title">PAUSED</div>
          <button class="btn primary ma-paused-resume" id="ma-resume">RESUME</button>
        </div>`;
        canvasWrap.appendChild(pausedOverlay);
        pausedOverlay.querySelector("#ma-resume")?.addEventListener("pointerup", () => {
          pausedOverlay?.remove();
          pausedOverlay = null;
          phase = "playing";
          lastTime = performance.now();
        });
      }
    });

    updateBuyBtn();
  }

  function updateBuyBtn(): void {
    const total = countTurrets(slots);
    const cost = buyCost(total);
    const freeSlot = slots.findIndex((s) => s === null);
    const canBuy = freeSlot !== -1 && coins >= cost && phase !== "gameover";
    buyBtn.textContent = freeSlot === -1 ? "GRID FULL" : `BUY  ${cost} ●`;
    buyBtn.disabled = !canBuy;
  }

  // ---------- arsenal grid DOM ----------

  function buildArsenal(): void {
    arsenalEl.innerHTML = "";
    slotRects.length = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = document.createElement("div");
      cell.className = "ma-slot";
      cell.dataset["idx"] = String(i);
      arsenalEl.appendChild(cell);
    }
    renderArsenal();
  }

  function renderArsenal(): void {
    const cells = arsenalEl.querySelectorAll<HTMLElement>(".ma-slot");
    cells.forEach((cell, i) => {
      const slot = slots[i];
      cell.innerHTML = "";
      if (slot) {
        const stats = turretStats(slot.level);
        const tile = document.createElement("div");
        tile.className = "ma-turret-tile";
        tile.style.background = stats.color;
        tile.style.boxShadow = `0 0 10px 2px ${stats.color}88`;
        tile.innerHTML = `<span class="ma-turret-lv">LV${slot.level}</span>`;
        cell.appendChild(tile);
      }
    });
    updateBuyBtn();
  }

  function cacheSlotRects(): void {
    slotRects.length = 0;
    const cells = arsenalEl.querySelectorAll<HTMLElement>(".ma-slot");
    cells.forEach((cell) => {
      slotRects.push(cell.getBoundingClientRect());
    });
  }

  function hitTestSlots(clientX: number, clientY: number): number {
    for (let i = 0; i < slotRects.length; i++) {
      const r = slotRects[i]!;
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return i;
      }
    }
    return -1;
  }

  // ---------- drag ----------

  function startDrag(slotIdx: number, clientX: number, clientY: number, pointerId: number): void {
    if (slots[slotIdx] === null) return;
    dragFromSlot = slotIdx;
    dragPointerId = pointerId;

    const ghost = document.createElement("div");
    ghost.className = "ma-drag-ghost";
    const slot = slots[slotIdx]!;
    const stats = turretStats(slot.level);
    ghost.style.background = stats.color;
    ghost.style.boxShadow = `0 0 14px 4px ${stats.color}aa`;
    ghost.innerHTML = `<span class="ma-turret-lv">LV${slot.level}</span>`;
    positionGhost(ghost, clientX, clientY);
    container.appendChild(ghost);
    dragGhostEl = ghost;
  }

  function positionGhost(el: HTMLElement, clientX: number, clientY: number): void {
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function endDrag(clientX: number, clientY: number): void {
    dragGhostEl?.remove();
    dragGhostEl = null;

    if (dragFromSlot === -1) return;
    const toIdx = hitTestSlots(clientX, clientY);

    if (toIdx === -1 || toIdx === dragFromSlot) {
      dragFromSlot = -1;
      dragPointerId = -1;
      return;
    }

    const from = slots[dragFromSlot];
    const to = slots[toIdx];

    if (from === null) {
      dragFromSlot = -1;
      dragPointerId = -1;
      return;
    }

    if (to === null) {
      // move
      slots[toIdx] = from;
      slots[dragFromSlot] = null;
    } else if (to.level === from.level && from.level < 10) {
      // merge
      slots[toIdx] = { level: from.level + 1, fireCooldown: 0 };
      slots[dragFromSlot] = null;
      vibrate([15, 15, 30]);
      // merge particle burst at slot position
      const r = slotRects[toIdx];
      if (r) {
        const canvasRect = canvas.getBoundingClientRect();
        const cx2 = r.left + r.width / 2 - canvasRect.left;
        const cy2 = r.top + r.height / 2 - canvasRect.top;
        const stats = turretStats(slots[toIdx]!.level);
        spawnParticles(particles, cx2, cy2, stats.color, 18, 120);
      }
    } else {
      // reject — different levels or already max
      vibrate(5);
    }

    renderArsenal();
    dragFromSlot = -1;
    dragPointerId = -1;
  }

  // ---------- buy ----------

  buyBtn.addEventListener("pointerup", () => {
    if (phase === "gameover" || phase === "paused") return;
    const total = countTurrets(slots);
    const cost = buyCost(total);
    const freeSlots = slots.reduce<number[]>((acc, s, i) => (s === null ? [...acc, i] : acc), []);
    if (freeSlots.length === 0 || coins < cost) {
      vibrate(5);
      return;
    }
    coins -= cost;
    coinsSpent += cost;
    const idx = freeSlots[Math.floor(Math.random() * freeSlots.length)]!;
    slots[idx] = { level: 1, fireCooldown: 0 };
    renderArsenal();
    updateHUD();
    dismissHint();
  });

  // ---------- turret auto-fire ----------

  function fireFromTurret(slotIdx: number, target: Enemy, dt: number): void {
    const slot = slots[slotIdx];
    if (!slot) return;

    slot.fireCooldown -= dt;
    if (slot.fireCooldown > 0) return;

    const stats = turretStats(slot.level);
    slot.fireCooldown = 1 / stats.fireRate;

    // Slot position: approximate from cached rects
    const r = slotRects[slotIdx];
    const canvasRect = canvas.getBoundingClientRect();
    if (!r || canvasRect.width === 0) return;

    const ox = r.left + r.width / 2 - canvasRect.left;
    const oy = r.top + r.height / 2 - canvasRect.top;

    // Scale to canvas logical pixels
    const scaleX = cw / canvasRect.width;
    const scaleY = ch / canvasRect.height;
    const bx = ox * scaleX;
    const by = oy * scaleY;

    const dx = target.x - bx;
    const dy = target.y - by;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;

    const b = getFromPool(bullets, makeBullet);
    b.x = bx; b.y = by;
    b.vx = (dx / d) * BULLET_SPEED;
    b.vy = (dy / d) * BULLET_SPEED;
    b.damage = stats.damage;
    b.alive = true;
  }

  function findClosestEnemy(baselineY: number): Enemy | null {
    let best2: Enemy | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      if (!e.alive) continue;
      // Closest = smallest remaining distance to baseline
      const d = Math.abs(e.y - baselineY);
      if (d < bestDist) {
        bestDist = d;
        best2 = e;
      }
    }
    return best2;
  }

  function updateTurrets(dt: number): void {
    if (phase !== "playing") return;
    // baseline Y in canvas coords = top of arsenal (which is below canvas)
    // Use ch as baseline (enemies past it trigger damage)
    const baselineY = ch;
    const target = findClosestEnemy(baselineY);
    if (!target) {
      // tick cooldowns down even without target
      for (let i = 0; i < SLOT_COUNT; i++) {
        const s = slots[i];
        if (s) s.fireCooldown = Math.max(0, s.fireCooldown - dt);
      }
      return;
    }
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (slots[i]) fireFromTurret(i, target, dt);
    }
  }

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
    cacheSlotRects();
    if (stateReady && phase !== "gameover") renderFrame();
  }

  const ro = new ResizeObserver(() => {
    resize();
  });
  ro.observe(canvasWrap);
  ro.observe(arsenalEl);

  // ---------- enemy spawn ----------

  function spawnEnemy(): void {
    const kind = pickEnemyKind(wave);
    const cfg = ENEMY_CONFIG[kind];
    const waveScale = Math.pow(WAVE_HP_MULT, wave - 1);
    const hp2 = Math.round(cfg.baseHp * wave * waveScale);
    const speedScale = 1 + (wave - 1) * 0.08;
    const speed = (cfg.speedMult * 50 * speedScale);

    const e = getFromPool(enemies, makeEnemy);
    e.x = cfg.radius + Math.random() * (cw - cfg.radius * 2);
    e.y = -cfg.radius;
    e.hp = hp2;
    e.maxHp = hp2;
    e.kind = kind;
    e.alive = true;
    e.flashT = 0;
    e.speed = speed;
  }

  // ---------- game logic ----------

  function onEnemyReachBaseline(enemy: Enemy): void {
    enemy.alive = false;
    hp--;
    vibrate(15);
    updateHUD();
    if (hp <= 0) triggerGameover();
  }

  function onKill(enemy: Enemy): void {
    const cfg = ENEMY_CONFIG[enemy.kind];
    const gained = cfg.coins + wave;
    coins += gained;
    score += gained;
    kills++;
    waveKills++;
    enemy.alive = false;
    vibrate(10);
    spawnParticles(particles, enemy.x, enemy.y, cfg.color, 12, 100);
    updateHUD();
  }

  function updateEnemies(dt: number): void {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      if (!e.alive) continue;
      e.flashT = Math.max(0, e.flashT - dt * 5);
      e.y += e.speed * dt;
      if (e.y > ch + ENEMY_CONFIG[e.kind].radius) {
        onEnemyReachBaseline(e);
        if (phase === "gameover") return;
      }
    }
  }

  function updateBullets(dt: number): void {
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i]!;
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -50 || b.x > cw + 50 || b.y < -100 || b.y > ch + 100) {
        b.alive = false;
        continue;
      }
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j]!;
        if (!e.alive) continue;
        const cfg = ENEMY_CONFIG[e.kind];
        const hitR = cfg.radius + 4;
        if (dist2(b.x, b.y, e.x, e.y) < hitR * hitR) {
          b.alive = false;
          e.hp -= b.damage;
          e.flashT = 1;
          if (e.hp <= 0) onKill(e);
          break;
        }
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
    if (waveEnemiesSpawned >= WAVE_SIZE) return;
    const interval = Math.max(
      MIN_SPAWN_INTERVAL_MS,
      BASE_SPAWN_INTERVAL_MS - wave * SPAWN_STEP_MS
    ) / 1000;
    spawnAccum += dt;
    while (spawnAccum >= interval && waveEnemiesSpawned < WAVE_SIZE) {
      spawnAccum -= interval;
      spawnEnemy();
      waveEnemiesSpawned++;
    }
  }

  function allEnemiesDead(): boolean {
    return enemies.every((e) => !e.alive);
  }

  function startWaveBreak(): void {
    phase = "waveBreak";
    waveBreakTimer = WAVE_PAUSE_MS;
    waveBonus = wave * 50 + waveKills * 2;
    coins += wave * 5;
    score += waveBonus;
    vibrate(20);
    updateHUD();

    waveBannerEl?.remove();
    waveBannerEl = document.createElement("div");
    waveBannerEl.className = "ma-wave-banner";
    waveBannerEl.innerHTML = `
      <div class="ma-wave-clear">WAVE ${wave} CLEAR!</div>
      <div class="ma-wave-bonus">+${waveBonus} pts &nbsp; +${wave * 5} coins</div>
      <div class="ma-wave-next">WAVE ${wave + 1} in ${Math.round(WAVE_PAUSE_MS / 1000)}s</div>
    `;
    canvasWrap.appendChild(waveBannerEl);
  }

  function startNextWave(): void {
    wave++;
    waveEnemiesSpawned = 0;
    spawnAccum = 0;
    waveKills = 0;
    phase = "playing";
    waveBannerEl?.remove();
    waveBannerEl = null;
    updateHUD();
  }

  function triggerGameover(): void {
    phase = "gameover";
    vibrate([50, 50, 100]);
    cancelAnimationFrame(rafId);

    const finalScore = computeScore();
    if (finalScore > best) best = finalScore;

    void submit("merge-arena", finalScore);

    gameoverOverlay = showGameover(
      container, finalScore, best, wave, kills,
      () => { restartGame(); }
    );

    void computeRank("merge-arena", finalScore).then((rank) => {
      if (!rank || !gameoverOverlay) return;
      const box = gameoverOverlay.querySelector(".ma-go-box");
      if (!box || box.querySelector(".ma-rank-card")) return;
      const actions = box.querySelector(".ma-go-actions");
      if (!actions) return;
      const div = document.createElement("div");
      div.innerHTML = buildRankCard(rank, "merge-arena");
      const card = div.firstElementChild as HTMLElement | null;
      if (!card) return;
      card.querySelector<HTMLElement>(".ma-rank-btn")?.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        navigate("/scores/merge-arena");
      });
      box.insertBefore(card, actions);
    });
  }

  function computeScore(): number {
    return wave * 100 + kills + Math.floor(coinsSpent / 10);
  }

  function restartGame(): void {
    // reset state
    wave = 1;
    score = 0;
    hp = 3;
    coins = 0;
    kills = 0;
    coinsSpent = 0;
    waveEnemiesSpawned = 0;
    spawnAccum = 0;
    waveBreakTimer = 0;
    waveKills = 0;
    waveBonus = 0;
    phase = "playing";

    // clear pools
    enemies.forEach((e) => { e.alive = false; });
    bullets.forEach((b) => { b.alive = false; });
    particles.forEach((p) => { p.alive = false; });

    // clear slots
    for (let i = 0; i < SLOT_COUNT; i++) slots[i] = null;

    gameoverOverlay?.remove(); gameoverOverlay = null;
    pausedOverlay?.remove(); pausedOverlay = null;
    waveBannerEl?.remove(); waveBannerEl = null;

    void personalBest("merge-arena").then((b) => {
      best = b;
      updateHUD();
    });

    renderArsenal();
    updateHUD();
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  // ---------- pointer events on arsenal (drag) ----------

  function onArsenalPointerDown(e: PointerEvent): void {
    if (phase === "gameover" || phase === "paused") return;
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>(".ma-slot");
    if (!cell) return;
    const idx = Number(cell.dataset["idx"] ?? -1);
    if (idx < 0 || slots[idx] === null) return;
    e.preventDefault();
    arsenalEl.setPointerCapture(e.pointerId);
    cacheSlotRects();
    startDrag(idx, e.clientX, e.clientY, e.pointerId);
  }

  function onArsenalPointerMove(e: PointerEvent): void {
    if (dragFromSlot === -1 || e.pointerId !== dragPointerId) return;
    if (dragGhostEl) positionGhost(dragGhostEl, e.clientX, e.clientY);
  }

  function onArsenalPointerUp(e: PointerEvent): void {
    if (dragFromSlot === -1 || e.pointerId !== dragPointerId) return;
    endDrag(e.clientX, e.clientY);
  }

  arsenalEl.addEventListener("pointerdown", onArsenalPointerDown);
  arsenalEl.addEventListener("pointermove", onArsenalPointerMove);
  arsenalEl.addEventListener("pointerup", onArsenalPointerUp);
  arsenalEl.addEventListener("pointercancel", onArsenalPointerUp);

  // ---------- render ----------

  function renderFrame(): void {
    if (cw < 8 || ch < 8) return;
    ctx.clearRect(0, 0, cw, ch);

    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, "#120826");
    grad.addColorStop(1, "#1a0535");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);

    // Subtle grid
    ctx.strokeStyle = "rgba(255,0,170,0.06)";
    ctx.lineWidth = 0.5;
    const step = Math.round(Math.max(cw, ch) / 12);
    for (let x = 0; x <= cw; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
    }
    for (let y = 0; y <= ch; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
    }

    // Particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]!;
      if (!p.alive) continue;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Enemies
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      if (!e.alive) continue;
      drawEnemy(ctx, e);
    }

    // Bullets
    ctx.shadowBlur = 6;
    ctx.shadowColor = "#ffe066";
    ctx.fillStyle = "#ffe066";
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i]!;
      if (!b.alive) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawEnemy(ctx2: CanvasRenderingContext2D, e: Enemy): void {
    const cfg = ENEMY_CONFIG[e.kind];
    const flash = e.flashT > 0;
    const color = flash ? "#ffffff" : cfg.color;

    ctx2.save();
    ctx2.shadowBlur = flash ? 20 : 10;
    ctx2.shadowColor = cfg.glow;

    const r = cfg.radius;

    if (e.kind === "grunt") {
      ctx2.fillStyle = color;
      ctx2.beginPath();
      ctx2.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx2.fill();
    } else if (e.kind === "runner") {
      // triangle pointing down (moving fast)
      ctx2.fillStyle = color;
      ctx2.beginPath();
      ctx2.moveTo(e.x, e.y + r);
      ctx2.lineTo(e.x + r * 0.87, e.y - r * 0.5);
      ctx2.lineTo(e.x - r * 0.87, e.y - r * 0.5);
      ctx2.closePath();
      ctx2.fill();
    } else {
      // tank: square
      ctx2.fillStyle = color;
      drawRoundRect(ctx2, e.x - r, e.y - r, r * 2, r * 2, 3);
      ctx2.fill();
    }

    // HP bar for tank
    if (e.kind === "tank" && e.hp < e.maxHp) {
      const bw = r * 2.5;
      ctx2.shadowBlur = 0;
      ctx2.fillStyle = "rgba(0,0,0,0.6)";
      ctx2.fillRect(e.x - bw / 2, e.y - r - 6, bw, 4);
      ctx2.fillStyle = cfg.color;
      ctx2.fillRect(e.x - bw / 2, e.y - r - 6, bw * (e.hp / e.maxHp), 4);
    }

    // RGB decompose for rgba
    const rgb = hexToRgb(cfg.color);
    const levelGlow = 0.6 + 0.4 * (e.y / Math.max(ch, 1));
    ctx2.strokeStyle = `rgba(${rgb},${levelGlow.toFixed(2)})`;
    ctx2.lineWidth = 1;
    ctx2.shadowBlur = 0;
    ctx2.restore();
  }

  // ---------- game loop ----------

  function loop(now: number): void {
    const rawDt = now - lastTime;
    lastTime = now;
    const dt = Math.min(rawDt, DT_CAP) / 1000;

    if (phase === "paused") {
      rafId = requestAnimationFrame(loop);
      return;
    }

    if (phase === "waveBreak") {
      waveBreakTimer -= rawDt;
      if (waveBreakTimer <= 0) startNextWave();
      updateParticles(dt);
      renderFrame();
      rafId = requestAnimationFrame(loop);
      return;
    }

    if (phase === "playing") {
      updateSpawn(dt);
      updateTurrets(dt);
      updateBullets(dt);
      updateEnemies(dt);

      if ((phase as Phase) === "gameover") return;

      updateParticles(dt);

      // Check wave complete
      if (waveEnemiesSpawned >= WAVE_SIZE && allEnemiesDead()) {
        startWaveBreak();
      }
    }

    renderFrame();
    rafId = requestAnimationFrame(loop);
  }

  // ---------- hint ----------

  async function checkHint(): Promise<void> {
    const row = await db.settings.get("merge-arena:seenHint");
    if (row) return;
    hintEl = document.createElement("div");
    hintEl.className = "ma-hint";
    hintEl.style.pointerEvents = "none";
    hintEl.innerHTML = `
      <div class="ma-hint-text">BUY weapons.</div>
      <div class="ma-hint-text">DRAG same level to MERGE.</div>
      <div class="ma-hint-text">AUTO-FIRE does the rest.</div>
      <div class="ma-hint-anim">
        <div class="ma-hint-tile" style="background:#44aaff">LV2</div>
        <div class="ma-hint-plus">+</div>
        <div class="ma-hint-tile" style="background:#44aaff">LV2</div>
        <div class="ma-hint-arrow">&#8594;</div>
        <div class="ma-hint-tile" style="background:#22cc22;animation:ma-hint-pulse 0.6s infinite alternate">LV3</div>
      </div>
    `;
    canvasWrap.appendChild(hintEl);

    const timer = window.setTimeout(dismissHint, HINT_AUTO_DISMISS_MS);
    hintEl.dataset["timer"] = String(timer);
  }

  function dismissHint(): void {
    if (!hintEl) return;
    const t = Number(hintEl.dataset["timer"] ?? 0);
    if (t) clearTimeout(t);
    hintEl.remove();
    hintEl = null;
    void db.settings.put({ key: "merge-arena:seenHint", value: "1" });
  }

  // ---------- overlay helpers ----------

  function buildRankCard(rank: RankInfo, gameId: string): string {
    const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
    const deltaHtml = rank.toBeat
      ? `<div class="ma-rank-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta} pts</div>`
      : "";
    return `<div class="ma-rank-card">
      <div class="ma-rank-title">RANK ${rankLabel} GLOBAL</div>
      ${deltaHtml}
      <button class="btn ma-rank-btn" data-scores-id="${gameId}">VIEW LEADERBOARD</button>
    </div>`;
  }

  function showGameover(
    root: HTMLElement,
    finalScore: number,
    bestScore: number,
    waveReached: number,
    killCount: number,
    onReplay: () => void
  ): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "ma-gameover";
    const isNewBest = finalScore >= bestScore && finalScore > 0;
    overlay.innerHTML = `
      <div class="ma-go-box">
        <h2 class="ma-go-title">GAME OVER</h2>
        ${isNewBest ? `<div class="ma-go-best-flag">NEW BEST!</div>` : ""}
        <div class="ma-go-score">${finalScore}</div>
        <div class="ma-go-label">SCORE</div>
        <div class="ma-go-stats">
          <span>WAVE ${waveReached}</span>
          <span>KILLS ${killCount}</span>
        </div>
        <div class="ma-go-actions">
          <button class="btn primary ma-go-btn" id="ma-replay">PLAY AGAIN</button>
          <button class="btn ma-go-btn" id="ma-menu">MENU</button>
        </div>
      </div>
    `;
    root.appendChild(overlay);

    overlay.querySelector("#ma-replay")?.addEventListener("pointerup", () => {
      overlay.remove();
      onReplay();
    });
    overlay.querySelector("#ma-menu")?.addEventListener("pointerup", () => {
      navigate("/");
    });

    return overlay;
  }

  // ---------- boot ----------

  buildArsenal();
  resize();
  updateHUD();
  stateReady = true;
  void checkHint();
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);

  // ---------- cleanup ----------

  return function cleanup(): void {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    arsenalEl.removeEventListener("pointerdown", onArsenalPointerDown);
    arsenalEl.removeEventListener("pointermove", onArsenalPointerMove);
    arsenalEl.removeEventListener("pointerup", onArsenalPointerUp);
    arsenalEl.removeEventListener("pointercancel", onArsenalPointerUp);
    gameoverOverlay?.remove();
    pausedOverlay?.remove();
    waveBannerEl?.remove();
    hintEl?.remove();
    dragGhostEl?.remove();
    container.innerHTML = "";
    container.classList.remove("merge-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "ma-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .merge-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #120826;
      user-select: none;
      -webkit-user-select: none;
      position: relative;
    }
    .ma-wrap {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    /* HUD */
    .ma-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      font-family: monospace;
      font-size: 12px;
      color: #ffe066;
      background: rgba(0,0,0,0.5);
      flex-shrink: 0;
      gap: 4px;
    }
    .ma-hud-left  { display: flex; align-items: center; gap: 10px; }
    .ma-hud-right { display: flex; align-items: center; gap: 10px; }
    .ma-hud-btns  { display: flex; gap: 4px; }
    .ma-hp   { font-size: 16px; color: #ff4466; letter-spacing: 2px; }
    .ma-wave { font-size: 11px; opacity: 0.85; letter-spacing: 1px; }
    .ma-coins { font-size: 13px; font-weight: bold; color: #ffcc44; }
    .ma-score { font-size: 13px; font-weight: bold; color: #ffe066; }
    .ma-ctrl-btn {
      min-width: 40px; min-height: 40px;
      font-size: 15px;
      border-color: rgba(255,224,102,0.3);
      color: #ffe066;
      background: rgba(255,224,102,0.06);
      padding: 0;
    }
    /* Combat canvas */
    .ma-canvas-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }
    .ma-canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    /* Buy bar */
    .ma-buy-bar {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 5px 8px;
      background: rgba(0,0,0,0.45);
      flex-shrink: 0;
    }
    .ma-buy-btn {
      min-height: 44px;
      min-width: 180px;
      font-family: monospace;
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 1px;
      border-color: #ff00aa;
      color: #ff00aa;
      background: rgba(255,0,170,0.08);
    }
    .ma-buy-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .ma-buy-btn:not(:disabled):active {
      background: rgba(255,0,170,0.22);
    }
    /* Arsenal grid */
    .ma-arsenal {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(2, 1fr);
      gap: 6px;
      padding: 8px;
      background: rgba(0,0,0,0.55);
      flex-shrink: 0;
      touch-action: none;
    }
    .ma-slot {
      min-height: 60px;
      border: 1px dashed rgba(255,0,170,0.3);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(18,8,38,0.6);
      position: relative;
      cursor: pointer;
    }
    .ma-turret-tile {
      width: 100%;
      height: 100%;
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: monospace;
      font-size: 13px;
      font-weight: bold;
      color: #000;
      min-height: 58px;
      pointer-events: none;
    }
    .ma-turret-lv {
      font-family: monospace;
      font-size: 13px;
      font-weight: bold;
      color: rgba(0,0,0,0.75);
      pointer-events: none;
    }
    /* Drag ghost */
    .ma-drag-ghost {
      position: absolute;
      width: 54px;
      height: 54px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 50;
      transform: translate(-50%, -50%);
      opacity: 0.88;
      font-family: monospace;
      font-size: 13px;
      font-weight: bold;
      color: rgba(0,0,0,0.8);
    }
    /* Wave banner */
    .ma-wave-banner {
      position: absolute;
      top: 30%;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
      pointer-events: none;
      z-index: 8;
      font-family: monospace;
    }
    .ma-wave-clear {
      font-size: 26px;
      font-weight: bold;
      color: #ff00aa;
      text-shadow: 0 0 18px #ff00aa;
      letter-spacing: 3px;
    }
    .ma-wave-bonus {
      font-size: 13px;
      color: #ffe066;
      margin-top: 6px;
    }
    .ma-wave-next {
      font-size: 11px;
      color: rgba(255,255,255,0.55);
      margin-top: 4px;
    }
    /* Paused overlay */
    .ma-paused-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.7);
      z-index: 12;
    }
    .ma-paused-box {
      text-align: center;
      padding: 28px 24px;
      background: #120826;
      border: 1px solid #ff00aa;
      border-radius: 12px;
    }
    .ma-paused-title {
      font-family: monospace;
      font-size: 24px;
      color: #ffe066;
      letter-spacing: 4px;
      text-shadow: 0 0 12px #ffe066;
      margin-bottom: 20px;
    }
    .ma-paused-resume {
      min-width: 140px; min-height: 44px;
      font-family: monospace; font-size: 13px;
      letter-spacing: 1px;
    }
    /* Gameover */
    .ma-gameover {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.85);
      z-index: 14;
    }
    .ma-go-box {
      text-align: center;
      padding: 28px 24px;
      background: #120826;
      border: 1px solid #ff00aa;
      border-radius: 12px;
      min-width: 230px;
      max-width: 320px;
      width: 90%;
    }
    .ma-go-title {
      margin: 0 0 8px;
      font-family: monospace;
      font-size: 22px;
      color: #ff00aa;
      letter-spacing: 3px;
      text-shadow: 0 0 12px #ff00aa;
    }
    .ma-go-best-flag {
      color: #ffe066;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 2px;
      margin-bottom: 8px;
      text-shadow: 0 0 8px #ffe066;
    }
    .ma-go-score {
      font-family: monospace;
      font-size: 52px;
      font-weight: bold;
      color: #ffe066;
      text-shadow: 0 0 16px #ffe066;
      line-height: 1;
    }
    .ma-go-label {
      font-family: monospace;
      font-size: 10px;
      color: rgba(255,224,102,0.5);
      letter-spacing: 2px;
      margin-bottom: 8px;
    }
    .ma-go-stats {
      display: flex;
      gap: 16px;
      justify-content: center;
      font-family: monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.6);
      margin-bottom: 16px;
    }
    .ma-go-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: 16px;
    }
    .ma-go-btn {
      min-width: 100px; min-height: 44px;
      font-family: monospace; font-size: 12px;
      letter-spacing: 1px;
    }
    /* Rank card */
    .ma-rank-card {
      margin: 10px 0;
      padding: 10px 14px;
      background: rgba(255,0,170,0.1);
      border: 1px solid rgba(255,0,170,0.3);
      border-radius: 8px;
    }
    .ma-rank-title {
      font-family: monospace;
      font-size: 11px;
      color: #ff88cc;
      letter-spacing: 1px;
    }
    .ma-rank-delta {
      font-family: monospace;
      font-size: 10px;
      color: rgba(255,255,255,0.65);
      margin-top: 4px;
    }
    .ma-rank-btn {
      margin-top: 8px;
      min-height: 36px;
      font-size: 10px;
    }
    /* Hint overlay */
    .ma-hint {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 7;
      gap: 8px;
    }
    .ma-hint-text {
      font-family: monospace;
      font-size: 15px;
      font-weight: bold;
      color: #ffffff;
      text-shadow: 0 0 10px #ff00aa;
      letter-spacing: 1px;
    }
    .ma-hint-anim {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }
    .ma-hint-tile {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: monospace;
      font-size: 12px;
      font-weight: bold;
      color: rgba(0,0,0,0.8);
    }
    .ma-hint-plus, .ma-hint-arrow {
      font-family: monospace;
      font-size: 20px;
      color: #ffe066;
    }
    @keyframes ma-hint-pulse {
      from { box-shadow: 0 0 6px 2px #22cc22; }
      to   { box-shadow: 0 0 18px 6px #22cc22; }
    }
  `;
  document.head.appendChild(style);
}
