import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";
import { playSfx } from "../../lib/audio.js";
import { db } from "../../lib/storage.js";

// ---------- types ----------

type Phase = "idle" | "playing" | "upgrade" | "gameover";
type EnemyKind = "zombie" | "spectral" | "werewolf" | "bat" | "plant" | "boss-zombie" | "boss-ghost" | "boss-wolf";

interface Tank {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  treadFrame: number;
  hitFlash: number;
  fireCooldown: number;
  aimAngle: number; // radians, 0 = horizontal right, negative = up
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  pierceLeft: number;
  splash: number;
  fromBoss: boolean;
  life: number;
}

interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  w: number;
  h: number;
  bobPhase: number;
  hitFlash: number;
  attackCooldown: number;
  jumpVy: number;
  onGround: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  speed: number;
  alpha: number;
}

interface WolfSilhouette {
  x: number;
  y: number;
  scale: number;
  speed: number;
}

interface UpgradeOption {
  id: string;
  label: string;
  desc: string;
  apply: () => void;
}

// ---------- constants ----------

const HUD_HEIGHT = 48;
const TANK_X_FRAC = 0.22;
const TANK_W = 56;
const TANK_H = 32;
const TANK_BASE_FIRE_RATE = 2.8; // shots/sec
const TANK_BASE_DMG = 2;
const TANK_MAX_HP = 5;
const BULLET_SPEED = 720;
const BOSS_BULLET_SPEED = 280;
const ENEMY_BASE_SPEED = 80;
const HINT_KEY = "night-treads:seenHint";

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

// ---------- enemy factory ----------

function makeEnemy(kind: EnemyKind, canvasW: number, groundY: number, round: number): Enemy {
  const baseHp = 1 + Math.floor(round / 3);
  switch (kind) {
    case "zombie":
      return {
        kind, x: canvasW + 30, y: groundY, vx: -(ENEMY_BASE_SPEED + round * 4), vy: 0,
        hp: baseHp, maxHp: baseHp, w: 24, h: 36, bobPhase: Math.random() * 6, hitFlash: 0,
        attackCooldown: 0, jumpVy: 0, onGround: true,
      };
    case "spectral":
      return {
        kind, x: canvasW + 30, y: groundY - 80 - Math.random() * 80,
        vx: -(ENEMY_BASE_SPEED * 1.5 + round * 5), vy: 0,
        hp: Math.max(1, baseHp - 1), maxHp: Math.max(1, baseHp - 1), w: 28, h: 32,
        bobPhase: Math.random() * 6, hitFlash: 0, attackCooldown: 0, jumpVy: 0, onGround: false,
      };
    case "bat":
      return {
        kind, x: canvasW + 30, y: groundY - 100 - Math.random() * 80,
        vx: -(ENEMY_BASE_SPEED * 1.7 + round * 6), vy: 0,
        hp: 1, maxHp: 1, w: 26, h: 18,
        bobPhase: Math.random() * 6, hitFlash: 0, attackCooldown: 0, jumpVy: 0, onGround: false,
      };
    case "plant":
      return {
        kind, x: canvasW + 30, y: groundY, vx: -28, vy: 0,
        hp: baseHp + 1, maxHp: baseHp + 1, w: 28, h: 38,
        bobPhase: 0, hitFlash: 0, attackCooldown: 1.2, jumpVy: 0, onGround: true,
      };
    case "werewolf":
      return {
        kind, x: canvasW + 30, y: groundY, vx: -(ENEMY_BASE_SPEED * 1.3 + round * 6), vy: 0,
        hp: baseHp + 1, maxHp: baseHp + 1, w: 36, h: 28, bobPhase: 0, hitFlash: 0,
        attackCooldown: 1 + Math.random(), jumpVy: 0, onGround: true,
      };
    case "boss-zombie": {
      const hp = 12 + round * 5;
      return {
        kind, x: canvasW + 60, y: Math.max(110, groundY * 0.4), vx: -32 - round * 3, vy: 0,
        hp, maxHp: hp, w: 70, h: 90, bobPhase: 0, hitFlash: 0,
        attackCooldown: 2.4, jumpVy: 0, onGround: false,
      };
    }
    case "boss-ghost": {
      const hp = 16 + round * 6;
      return {
        kind, x: canvasW + 60, y: Math.max(120, groundY * 0.45), vx: -50, vy: 0,
        hp, maxHp: hp, w: 70, h: 80, bobPhase: 0, hitFlash: 0,
        attackCooldown: 1.8, jumpVy: 0, onGround: false,
      };
    }
    case "boss-wolf": {
      const hp = 18 + round * 7;
      return {
        kind, x: canvasW + 60, y: Math.max(140, groundY * 0.5), vx: -60 - round * 3, vy: 0,
        hp, maxHp: hp, w: 84, h: 60, bobPhase: 0, hitFlash: 0,
        attackCooldown: 2.6, jumpVy: 0, onGround: false,
      };
    }
  }
}

function isBoss(kind: EnemyKind): boolean {
  return kind === "boss-zombie" || kind === "boss-ghost" || kind === "boss-wolf";
}

// ---------- collision ----------

function bulletHitsEnemy(b: Bullet, e: Enemy): boolean {
  return b.x > e.x - e.w / 2 && b.x < e.x + e.w / 2 && b.y > e.y - e.h && b.y < e.y;
}

function enemyHitsTank(e: Enemy, tank: Tank): boolean {
  const tx0 = tank.x - TANK_W / 2;
  const tx1 = tank.x + TANK_W / 2;
  const ty0 = tank.y - TANK_H;
  const ty1 = tank.y;
  const ex0 = e.x - e.w / 2;
  const ex1 = e.x + e.w / 2;
  const ey0 = e.y - e.h;
  const ey1 = e.y;
  return ex0 < tx1 && ex1 > tx0 && ey0 < ty1 && ey1 > ty0;
}

function bossBulletHitsTank(b: Bullet, tank: Tank): boolean {
  const tx0 = tank.x - TANK_W / 2 + 6;
  const tx1 = tank.x + TANK_W / 2 - 6;
  const ty0 = tank.y - TANK_H + 4;
  const ty1 = tank.y - 4;
  return b.x > tx0 && b.x < tx1 && b.y > ty0 && b.y < ty1;
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("nt-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  const wrap = document.createElement("div");
  wrap.className = "nt-wrap";
  container.appendChild(wrap);

  const hud = document.createElement("div");
  hud.className = "nt-hud";
  hud.innerHTML = `
    <div class="nt-hud-hp">
      <span class="nt-hp-label">HP</span>
      <span class="nt-hp-bar"><span class="nt-hp-fill" id="nt-hp-fill"></span></span>
    </div>
    <div class="nt-hud-round">ROUND <span id="nt-round">1</span></div>
    <div class="nt-hud-score">
      <span class="nt-hud-mini">SCORE</span>
      <span class="nt-hud-val" id="nt-score">0</span>
    </div>
    <div class="nt-hud-btns">
      <button class="btn nt-hud-btn" id="nt-fs" aria-label="Fullscreen">⛶</button>
      <button class="btn nt-hud-btn" id="nt-pause" aria-label="Pause">⏸</button>
    </div>
  `;
  wrap.appendChild(hud);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "nt-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "nt-canvas";
  canvasWrap.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx: CanvasRenderingContext2D = ctxRaw;

  const hint = document.createElement("div");
  hint.className = "nt-hint";
  hint.innerHTML = `
    <div class="nt-hint-card">
      <div class="nt-hint-title">NIGHT TREADS</div>
      <div class="nt-hint-row"><strong>DRAG</strong> move tank</div>
      <div class="nt-hint-row"><strong>AUTO-FIRE</strong> forward</div>
      <div class="nt-hint-row">Survive waves. Pick upgrade after boss.</div>
    </div>
  `;
  hint.style.display = "none";
  wrap.appendChild(hint);

  // ---------- state ----------

  let phase: Phase = "idle";
  let score = 0;
  let best = 0;
  let round = 1;
  let killsThisRound = 0;
  let killsToBoss = 8;
  let bossActive = false;
  let bossKind: EnemyKind = "boss-zombie";
  let paused = false;
  let rafId = 0;
  let lastTime = 0;
  let tick = 0;
  let canvasW = 0;
  let canvasH = 0;
  let stateReady = false;
  let groundY = 0;
  let scroll = 0;
  let lightningTimer = 3 + Math.random() * 8;
  let lightningFlash = 0;
  let shake = 0;
  let nextSpawn = 0.6;
  let gameoverEl: { el: HTMLElement; addRank: (r: RankInfo) => void } | null = null;

  // upgrades
  let dmg = TANK_BASE_DMG;
  let fireRate = TANK_BASE_FIRE_RATE;
  let pierce = 0;
  let splash = 0;
  let multiShot = 1;
  let coGunner = false;

  let tank: Tank = makeTank(0, 0);
  let bullets: Bullet[] = [];
  let enemies: Enemy[] = [];
  let particles: Particle[] = [];
  let clouds: Cloud[] = [];
  let stars: { x: number; y: number; size: number }[] = [];
  let wolves: WolfSilhouette[] = [];

  function makeTank(cw: number, gy: number): Tank {
    return {
      x: cw * TANK_X_FRAC,
      y: gy,
      hp: TANK_MAX_HP,
      maxHp: TANK_MAX_HP,
      treadFrame: 0,
      hitFlash: 0,
      fireCooldown: 0,
      aimAngle: 0,
    };
  }

  function rebuildBackground(): void {
    stars = [];
    for (let i = 0; i < 80; i++) {
      stars.push({ x: Math.random() * canvasW, y: Math.random() * groundY * 0.7, size: Math.random() < 0.85 ? 1 : 2 });
    }
    clouds = [];
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: Math.random() * canvasW, y: 30 + Math.random() * (groundY * 0.4),
        w: 80 + Math.random() * 120, speed: 0.06 + Math.random() * 0.18,
        alpha: 0.35 + Math.random() * 0.4,
      });
    }
    wolves = [
      { x: canvasW * 0.18, y: groundY - 12, scale: 0.7, speed: 0.04 },
      { x: canvasW * 0.62, y: groundY - 18, scale: 0.9, speed: 0.06 },
      { x: canvasW * 0.88, y: groundY - 10, scale: 0.6, speed: 0.03 },
    ];
  }

  void personalBest("night-treads").then((b) => { best = b; });

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
    groundY = Math.floor(canvasH * 0.84);
    stateReady = true;
    rebuildBackground();
    if (phase === "idle") {
      tank = makeTank(canvasW, groundY);
    } else {
      tank.x = canvasW * TANK_X_FRAC;
      tank.y = clamp(tank.y, groundY - canvasH * 0.55, groundY);
    }
    drawFrame();
  }

  // ---------- input ----------

  let dragActive = false;
  let dragOffsetY = 0;
  function onPointerDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    if (phase === "idle") { startPlaying(); return; }
    if (phase !== "playing") return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    dragActive = true;
    dragOffsetY = y - tank.y;
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragActive || phase !== "playing") return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const target = y - dragOffsetY;
    const minY = groundY - canvasH * 0.55;
    const maxY = groundY;
    tank.y = clamp(target, minY, maxY);
  }
  function onPointerUp(): void { dragActive = false; }

  wrap.addEventListener("pointerdown", onPointerDown);
  wrap.addEventListener("pointermove", onPointerMove);
  wrap.addEventListener("pointerup", onPointerUp);
  wrap.addEventListener("pointercancel", onPointerUp);

  function onKey(e: KeyboardEvent): void {
    if (e.key === " " || e.key === "Enter") {
      if (phase === "idle") { e.preventDefault(); startPlaying(); }
      else if (phase === "gameover" && gameoverEl) {
        e.preventDefault();
        gameoverEl.el.remove();
        gameoverEl = null;
        restartGame();
      }
    }
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      if (phase === "playing") tank.y = clamp(tank.y - 32, groundY - canvasH * 0.55, groundY);
    }
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (phase === "playing") tank.y = clamp(tank.y + 32, groundY - canvasH * 0.55, groundY);
    }
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      if (phase === "playing") paused = !paused;
    }
  }
  document.addEventListener("keydown", onKey);

  hud.querySelector<HTMLElement>("#nt-fs")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target.requestFullscreen().catch(() => {});
  });
  hud.querySelector<HTMLElement>("#nt-pause")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    if (phase === "playing") paused = !paused;
  });

  // ---------- game flow ----------

  function startPlaying(): void {
    if (phase !== "idle") return;
    phase = "playing";
    score = 0;
    round = 1;
    killsThisRound = 0;
    killsToBoss = 8;
    bossActive = false;
    enemies = [];
    bullets = [];
    particles = [];
    dmg = TANK_BASE_DMG;
    fireRate = TANK_BASE_FIRE_RATE;
    pierce = 0;
    splash = 0;
    multiShot = 1;
    coGunner = false;
    tank = makeTank(canvasW, groundY);
    nextSpawn = 0.4;
    hint.style.display = "none";
    void markHintSeen();
    updateHud();
  }

  function restartGame(): void {
    phase = "idle";
    score = 0;
    round = 1;
    paused = false;
    enemies = [];
    bullets = [];
    particles = [];
    bossActive = false;
    tank = makeTank(canvasW, groundY);
    updateHud();
    lastTime = performance.now();
  }

  function triggerGameover(): void {
    if (phase !== "playing") return;
    phase = "gameover";
    shake = 22;
    explodeAt(tank.x, tank.y - TANK_H / 2, 60, "#ff8a3c");
    playSfx("gameover");
    if ("vibrate" in navigator) navigator.vibrate([80, 50, 140]);
    void submit("night-treads", score).then(() => {
      void personalBest("night-treads").then((b) => { best = Math.max(best, b); });
    });
    setTimeout(() => {
      if (phase !== "gameover") return;
      gameoverEl = showGameoverOverlay(container, score, round, best, () => {
        gameoverEl = null;
        restartGame();
      });
      void computeRank("night-treads", score).then((rank) => {
        if (rank && gameoverEl) gameoverEl.addRank(rank);
      });
    }, 700);
  }

  function bossKindForRound(r: number): EnemyKind {
    const kinds: EnemyKind[] = ["boss-zombie", "boss-ghost", "boss-wolf"];
    return kinds[(r - 1) % kinds.length];
  }

  function spawnBoss(): void {
    bossKind = bossKindForRound(round);
    const e = makeEnemy(bossKind, canvasW, groundY, round);
    enemies.push(e);
    bossActive = true;
    if ("vibrate" in navigator) navigator.vibrate([12, 60, 80]);
    playSfx("levelup");
    shake = 12;
  }

  function nextRound(): void {
    round++;
    killsThisRound = 0;
    killsToBoss = 8 + round * 2;
    bossActive = false;
    showUpgradeOverlay();
    updateHud();
  }

  function showUpgradeOverlay(): void {
    phase = "upgrade";
    const options = pickUpgrades();
    const overlay = document.createElement("div");
    overlay.className = "nt-upgrade";
    overlay.innerHTML = `
      <div class="nt-upgrade-box">
        <div class="nt-upgrade-title">CHOOSE UPGRADE</div>
        <div class="nt-upgrade-cards">
          ${options.map((o, i) => `
            <button class="nt-card" data-i="${i}">
              <div class="nt-card-label">${o.label}</div>
              <div class="nt-card-desc">${o.desc}</div>
            </button>
          `).join("")}
        </div>
      </div>
    `;
    container.appendChild(overlay);
    overlay.querySelectorAll<HTMLButtonElement>(".nt-card").forEach((btn) => {
      btn.addEventListener("pointerup", () => {
        const i = parseInt(btn.dataset.i || "0", 10);
        options[i].apply();
        if ("vibrate" in navigator) navigator.vibrate(10);
        overlay.remove();
        phase = "playing";
        nextSpawn = 0.6;
      });
    });
  }

  function pickUpgrades(): UpgradeOption[] {
    const pool: UpgradeOption[] = [
      { id: "dmg", label: "+1 DAMAGE", desc: `Cannon damage ${dmg} → ${dmg + 1}`, apply: () => { dmg++; } },
      { id: "rate", label: "+30% FIRE RATE", desc: "Faster cannon", apply: () => { fireRate *= 1.3; } },
      { id: "pierce", label: "PIERCE +1", desc: "Bullets pass through more enemies", apply: () => { pierce++; } },
      { id: "splash", label: "+SPLASH", desc: "Bullets explode on impact", apply: () => { splash += 22; } },
      { id: "multi", label: "MULTI-SHOT", desc: `${multiShot} → ${multiShot + 1} bullets per fire`, apply: () => { multiShot++; } },
      { id: "hp", label: "REPAIR + MAX HP", desc: "Restore HP and +1 max", apply: () => { tank.maxHp++; tank.hp = tank.maxHp; updateHud(); } },
      { id: "co-gun", label: "CO-GUNNER", desc: "Adds a small auto-turret on top", apply: () => { coGunner = true; } },
    ];
    // shuffle and take 3
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3);
  }

  // ---------- update ----------

  function loop(now: number): void {
    rafId = requestAnimationFrame(loop);
    if (!stateReady) return;
    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(rawDt, 0.05);
    tick++;
    if (!paused && phase !== "upgrade") update(dt);
    drawFrame();
  }

  function update(dt: number): void {
    // bg always animates
    scroll += 60 * dt;
    clouds.forEach((c) => {
      c.x -= c.speed * 30 * dt;
      if (c.x + c.w < 0) { c.x = canvasW + c.w; c.y = 30 + Math.random() * (groundY * 0.4); }
    });
    wolves.forEach((w) => { w.x += w.speed * dt * 6; if (w.x > canvasW + 40) w.x = -40; });
    lightningTimer -= dt;
    if (lightningTimer <= 0) {
      lightningFlash = 1;
      lightningTimer = 4 + Math.random() * 9;
      if (Math.random() < 0.4) shake = Math.max(shake, 6);
    }
    lightningFlash = Math.max(0, lightningFlash - dt * 4);
    shake = Math.max(0, shake - dt * 60);

    if (phase === "idle") {
      tank.treadFrame += dt * 3;
      return;
    }
    if (phase === "gameover") {
      particles.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; p.life -= dt; });
      particles = particles.filter((p) => p.life > 0);
      return;
    }

    if (phase !== "playing") return;

    tank.treadFrame += dt * 6;
    tank.hitFlash = Math.max(0, tank.hitFlash - dt * 4);

    // pick aim target — prefer bosses, then highest non-ground threat, then nearest
    const aimTarget = pickAimTarget();
    let desiredAngle = 0;
    if (aimTarget) {
      const tx = aimTarget.x;
      const ty = aimTarget.y - aimTarget.h / 2;
      const ox = tank.x + TANK_W / 2;
      const oy = tank.y - TANK_H - 4;
      desiredAngle = clamp(Math.atan2(ty - oy, tx - ox), -1.45, 0.25);
    }
    tank.aimAngle += (desiredAngle - tank.aimAngle) * Math.min(1, dt * 10);

    // tank fire
    tank.fireCooldown -= dt;
    if (tank.fireCooldown <= 0 && aimTarget) {
      fireTank();
      tank.fireCooldown = 1 / fireRate;
    }

    // spawn waves
    if (!bossActive) {
      nextSpawn -= dt;
      if (nextSpawn <= 0 && killsThisRound < killsToBoss) {
        spawnWaveEnemy();
        const interval = clamp(1.4 - round * 0.06, 0.5, 1.6);
        nextSpawn = interval + Math.random() * 0.4;
      }
      if (killsThisRound >= killsToBoss && !bossActive) {
        // clear non-boss enemies (they "retreat") and spawn boss
        enemies.forEach((e) => { if (!isBoss(e.kind)) e.hp = 0; });
        enemies = enemies.filter((e) => e.hp > 0);
        spawnBoss();
      }
    }

    // bullets
    bullets.forEach((b) => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    });
    bullets = bullets.filter((b) => b.life > 0 && b.x > -40 && b.x < canvasW + 40 && b.y > -40 && b.y < canvasH + 40);

    // enemies
    enemies.forEach((e) => {
      e.bobPhase += dt * 5;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 5);
      if (e.kind === "spectral" || e.kind === "boss-ghost" || e.kind === "boss-zombie" || e.kind === "boss-wolf") {
        e.y += Math.sin(e.bobPhase) * 18 * dt;
      }
      if (e.kind === "bat") {
        // sinusoidal swoop pattern
        e.y += Math.sin(e.bobPhase * 1.2) * 80 * dt;
      }
      if (e.kind === "plant") {
        e.attackCooldown -= dt;
        if (e.attackCooldown <= 0 && e.x < canvasW - 30) {
          fireBossProjectile(e); // reuse aimed projectile
          e.attackCooldown = 1.8;
        }
      }
      if (e.kind === "werewolf") {
        if (e.onGround) {
          e.attackCooldown -= dt;
          if (e.attackCooldown <= 0 && e.x < canvasW * 0.7) {
            e.jumpVy = -360;
            e.onGround = false;
          }
        }
        if (!e.onGround) {
          e.jumpVy += 1100 * dt;
          e.y += e.jumpVy * dt;
          if (e.y >= groundY) {
            e.y = groundY;
            e.onGround = true;
            e.attackCooldown = 1 + Math.random() * 0.6;
          }
        }
      }
      if (isBoss(e.kind)) {
        e.attackCooldown -= dt;
        if (e.attackCooldown <= 0 && e.x < canvasW - 60) {
          fireBossProjectile(e);
          e.attackCooldown = e.kind === "boss-ghost" ? 1.1 : 1.8;
        }
      }
      e.x += e.vx * dt;
      // boss stops at right portion
      if (isBoss(e.kind) && e.x < canvasW * 0.62) e.x = canvasW * 0.62;
    });

    // bullet vs enemy
    for (const b of bullets) {
      if (b.fromBoss) continue;
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (bulletHitsEnemy(b, e)) {
          e.hp -= b.damage;
          e.hitFlash = 1;
          if (b.splash > 0) {
            // splash damage to nearby
            for (const e2 of enemies) {
              if (e2 === e || e2.hp <= 0) continue;
              const dx = e2.x - e.x, dy = (e2.y - e2.h / 2) - (e.y - e.h / 2);
              if (dx * dx + dy * dy < b.splash * b.splash) {
                e2.hp -= Math.max(1, Math.floor(b.damage / 2));
                e2.hitFlash = 1;
              }
            }
            spawnParticles(e.x, e.y - e.h / 2, "#ff8a3c", 8, 120);
          }
          spawnParticles(b.x, b.y, "#ffe0a0", 4, 80);
          if (b.pierceLeft > 0) { b.pierceLeft--; }
          else { b.life = 0; }
          if (e.hp <= 0) {
            killEnemy(e);
          }
          break;
        }
      }
    }
    enemies = enemies.filter((e) => e.hp > 0 && e.x > -60);

    // boss projectile vs tank
    for (const b of bullets) {
      if (!b.fromBoss) continue;
      if (bossBulletHitsTank(b, tank)) {
        b.life = 0;
        damageTank(1);
      }
    }

    // enemy vs tank — bosses never melee (they fly out of reach)
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      if (isBoss(e.kind)) continue;
      if (enemyHitsTank(e, tank)) {
        e.hp = 0;
        damageTank(1);
        spawnParticles(e.x, e.y - e.h / 2, "#a3c14a", 12, 140);
      }
    }
    enemies = enemies.filter((e) => e.hp > 0);

    // particles
    particles.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 280 * dt; p.life -= dt; });
    particles = particles.filter((p) => p.life > 0);
  }

  function pickAimTarget(): Enemy | null {
    let best: Enemy | null = null;
    let bestScore = -Infinity;
    for (const e of enemies) {
      if (e.hp <= 0 || e.x <= tank.x) continue;
      // priority: boss > closer + further-up > closer
      const dist = e.x - tank.x;
      const verticalThreat = (tank.y - e.y); // higher = more threat
      let score = 1000 - dist * 0.6 + verticalThreat * 0.3;
      if (isBoss(e.kind)) score += 5000;
      if (e.kind === "plant") score += 200;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  function fireTank(): void {
    // muzzle position at tip of barrel rotated by aimAngle
    const turretCx = tank.x;
    const turretCy = tank.y - TANK_H - 4;
    const barrelLen = 26;
    const baseX = turretCx + Math.cos(tank.aimAngle) * barrelLen;
    const baseY = turretCy + Math.sin(tank.aimAngle) * barrelLen;
    const spread = (multiShot - 1) * 0.06;
    for (let i = 0; i < multiShot; i++) {
      const t = multiShot === 1 ? 0 : (i / (multiShot - 1)) - 0.5;
      const angle = tank.aimAngle + t * spread;
      bullets.push({
        x: baseX, y: baseY,
        vx: Math.cos(angle) * BULLET_SPEED, vy: Math.sin(angle) * BULLET_SPEED,
        damage: dmg, pierceLeft: pierce, splash, fromBoss: false, life: 1.6,
      });
    }
    if (coGunner) {
      // small extra turret aimed slightly higher
      const cgAngle = tank.aimAngle - 0.2;
      bullets.push({
        x: baseX, y: baseY - 18,
        vx: Math.cos(cgAngle) * BULLET_SPEED * 0.85,
        vy: Math.sin(cgAngle) * BULLET_SPEED * 0.85,
        damage: Math.max(1, Math.floor(dmg / 2)), pierceLeft: pierce, splash: 0,
        fromBoss: false, life: 1.6,
      });
    }
    playSfx("shoot");
  }

  function fireBossProjectile(e: Enemy): void {
    const ox = e.x - e.w / 2;
    const oy = e.y - e.h * 0.6;
    const tx = tank.x + TANK_W / 2;
    const ty = tank.y - TANK_H / 2;
    const dx = tx - ox, dy = ty - oy;
    const len = Math.hypot(dx, dy) || 1;
    bullets.push({
      x: ox, y: oy,
      vx: (dx / len) * BOSS_BULLET_SPEED,
      vy: (dy / len) * BOSS_BULLET_SPEED,
      damage: 1, pierceLeft: 0, splash: 0, fromBoss: true, life: 4,
    });
    playSfx("hit");
  }

  function killEnemy(e: Enemy): void {
    spawnParticles(e.x, e.y - e.h / 2, isBoss(e.kind) ? "#ff8a3c" : "#a3c14a", isBoss(e.kind) ? 22 : 8, isBoss(e.kind) ? 220 : 130);
    const base = isBoss(e.kind) ? 50
      : e.kind === "spectral" ? 5
      : e.kind === "werewolf" ? 8
      : e.kind === "bat" ? 4
      : e.kind === "plant" ? 6
      : 3;
    score += base * round;
    killsThisRound++;
    playSfx(isBoss(e.kind) ? "fanfare" : "kill");
    if ("vibrate" in navigator) navigator.vibrate(isBoss(e.kind) ? [40, 40, 60] : 6);
    if (isBoss(e.kind)) {
      bossActive = false;
      tank.hp = Math.min(tank.maxHp, tank.hp + 1);
      shake = 14;
      explodeAt(e.x, e.y - e.h / 2, 70, "#ffd166");
      nextRound();
    }
    if (score > best) best = score;
    updateHud();
  }

  function damageTank(amount: number): void {
    tank.hp -= amount;
    tank.hitFlash = 1;
    shake = Math.max(shake, 10);
    playSfx("error");
    if ("vibrate" in navigator) navigator.vibrate(20);
    updateHud();
    if (tank.hp <= 0) triggerGameover();
  }

  function spawnWaveEnemy(): void {
    if (round === 1) {
      const r = Math.random();
      const kind: EnemyKind = r < 0.7 ? "zombie" : r < 0.9 ? "bat" : "plant";
      enemies.push(makeEnemy(kind, canvasW, groundY, round));
      return;
    }
    // round 2+: full mix
    const r = Math.random();
    let kind: EnemyKind = "zombie";
    if (r < 0.32) kind = "zombie";
    else if (r < 0.52) kind = "bat";
    else if (r < 0.66) kind = "spectral";
    else if (r < 0.78) kind = "plant";
    else if (r < 0.94) kind = "werewolf";
    else kind = round >= 3 ? "werewolf" : "bat";
    enemies.push(makeEnemy(kind, canvasW, groundY, round));
  }

  function spawnParticles(x: number, y: number, color: string, n: number, vmax: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = Math.random() * vmax;
      particles.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        life: 0.45 + Math.random() * 0.35,
        color, size: 2 + Math.random() * 2,
      });
    }
  }

  function explodeAt(x: number, y: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 100 + Math.random() * 280;
      particles.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120,
        life: 0.6 + Math.random() * 0.5,
        color, size: 2 + Math.random() * 3,
      });
    }
  }

  function updateHud(): void {
    const fill = hud.querySelector<HTMLElement>("#nt-hp-fill");
    if (fill) fill.style.width = `${(Math.max(0, tank.hp) / tank.maxHp) * 100}%`;
    const r = hud.querySelector<HTMLElement>("#nt-round");
    if (r) r.textContent = String(round);
    const s = hud.querySelector<HTMLElement>("#nt-score");
    if (s) s.textContent = String(score);
  }

  // ---------- draw ----------

  function drawFrame(): void {
    if (!stateReady) return;
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawSky();
    drawMoon();
    drawClouds();
    drawSilhouettes();
    drawGround();
    drawWolves();

    // bullets
    bullets.forEach(drawBullet);
    // enemies
    enemies.forEach(drawEnemy);
    // tank
    drawTank();
    // particles
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
    ctx.globalAlpha = 1;

    // boss HP bar
    const boss = enemies.find((e) => isBoss(e.kind) && e.hp > 0);
    if (boss) drawBossBar(boss);

    if (phase === "idle") drawIdle();

    if (lightningFlash > 0) {
      ctx.fillStyle = `rgba(220, 230, 255, ${lightningFlash * 0.5})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    ctx.restore();
  }

  function drawSky(): void {
    const g = ctx.createLinearGradient(0, 0, 0, groundY);
    g.addColorStop(0, "#04050f");
    g.addColorStop(0.55, "#0a0a25");
    g.addColorStop(1, "#1a1638");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvasW, canvasH);
    // stars
    ctx.fillStyle = "#dcd9ff";
    stars.forEach((s) => { ctx.globalAlpha = 0.6; ctx.fillRect(s.x, s.y, s.size, s.size); });
    ctx.globalAlpha = 1;
  }

  function drawMoon(): void {
    const cx = canvasW * 0.78;
    const cy = groundY * 0.28;
    const r = Math.min(canvasW, groundY) * 0.09;
    // halo
    const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 3);
    halo.addColorStop(0, "rgba(220, 230, 255, 0.35)");
    halo.addColorStop(1, "rgba(220, 230, 255, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);
    // disc
    ctx.fillStyle = "#e8e4ff";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // craters
    ctx.fillStyle = "rgba(120, 120, 150, 0.45)";
    ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.1, r * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.25, cy + r * 0.18, r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.05, cy - r * 0.35, r * 0.1, 0, Math.PI * 2); ctx.fill();
  }

  function drawClouds(): void {
    clouds.forEach((c) => {
      ctx.fillStyle = `rgba(20, 20, 40, ${c.alpha})`;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.w * 0.5, c.w * 0.16, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - c.w * 0.2, c.y + 4, c.w * 0.32, c.w * 0.14, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + c.w * 0.22, c.y + 6, c.w * 0.3, c.w * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawSilhouettes(): void {
    // distant mountains
    ctx.fillStyle = "#0c0a1a";
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    let x = 0;
    while (x < canvasW) {
      const peak = groundY * 0.55 + Math.sin(x * 0.04 + scroll * 0.001) * 30 + Math.sin(x * 0.13) * 20;
      ctx.lineTo(x, peak);
      x += 24;
    }
    ctx.lineTo(canvasW, groundY); ctx.closePath(); ctx.fill();
    // dead trees
    ctx.strokeStyle = "#06040d";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const tx = (i * 130 - (scroll * 0.2) % 130 + canvasW) % canvasW;
      const ty = groundY - 20;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx, ty - 36);
      ctx.moveTo(tx, ty - 22);
      ctx.lineTo(tx - 8, ty - 30);
      ctx.moveTo(tx, ty - 16);
      ctx.lineTo(tx + 8, ty - 26);
      ctx.stroke();
    }
  }

  function drawGround(): void {
    ctx.fillStyle = "#0a0612";
    ctx.fillRect(0, groundY, canvasW, canvasH - groundY);
    // moonlit road strip
    ctx.fillStyle = "rgba(180, 180, 220, 0.04)";
    ctx.fillRect(0, groundY + 2, canvasW, 8);
    // dirt rocks
    ctx.fillStyle = "#1a0e22";
    for (let i = 0; i < 12; i++) {
      const rx = ((i * 64 - scroll) % canvasW + canvasW) % canvasW;
      const ry = groundY + 14 + (i % 3) * 4;
      ctx.fillRect(rx, ry, 4, 2);
    }
  }

  function drawWolves(): void {
    wolves.forEach((w) => {
      const x = w.x;
      const y = w.y;
      const s = w.scale;
      ctx.fillStyle = "#04030a";
      // body
      ctx.fillRect(x, y - 10 * s, 14 * s, 8 * s);
      // legs
      ctx.fillRect(x + 1 * s, y - 2 * s, 2 * s, 4 * s);
      ctx.fillRect(x + 11 * s, y - 2 * s, 2 * s, 4 * s);
      // head howling up
      ctx.fillRect(x + 11 * s, y - 16 * s, 4 * s, 6 * s);
      // ears
      ctx.fillRect(x + 11 * s, y - 19 * s, 1.5 * s, 3 * s);
      ctx.fillRect(x + 13.5 * s, y - 19 * s, 1.5 * s, 3 * s);
      // tail
      ctx.fillRect(x - 2 * s, y - 12 * s, 3 * s, 2 * s);
      // glowing eye
      ctx.fillStyle = "#ff4040";
      ctx.fillRect(x + 12.5 * s, y - 14 * s, 1.4 * s, 1.4 * s);
    });
  }

  function drawTank(): void {
    const x = tank.x;
    const y = tank.y;
    const flash = tank.hitFlash;

    // tread
    ctx.fillStyle = flash > 0 ? "#ff5050" : "#1a2010";
    ctx.fillRect(x - TANK_W / 2, y - 10, TANK_W, 10);
    // tread cleats
    ctx.fillStyle = "#0a0c08";
    const treadOffset = (tank.treadFrame * 8) % 8;
    for (let i = -TANK_W / 2 + 2 - treadOffset; i < TANK_W / 2; i += 8) {
      ctx.fillRect(x + i, y - 8, 4, 6);
    }
    // hull (camo)
    ctx.fillStyle = flash > 0 ? "#ff7a7a" : "#3a4a22";
    ctx.fillRect(x - TANK_W / 2 + 4, y - TANK_H, TANK_W - 8, TANK_H - 10);
    // camo splotches
    ctx.fillStyle = "#2a3a18";
    ctx.fillRect(x - TANK_W / 2 + 8, y - TANK_H + 4, 10, 6);
    ctx.fillRect(x - 4, y - TANK_H + 10, 14, 6);
    ctx.fillRect(x + TANK_W / 2 - 16, y - TANK_H + 6, 8, 5);
    ctx.fillStyle = "#1a2810";
    ctx.fillRect(x - TANK_W / 2 + 18, y - TANK_H + 14, 8, 4);
    ctx.fillRect(x + 4, y - TANK_H + 4, 6, 4);

    // turret base (flat dome)
    ctx.fillStyle = flash > 0 ? "#ff9090" : "#3a4a22";
    ctx.fillRect(x - 10, y - TANK_H - 8, 20, 8);
    ctx.fillStyle = "#2a3a18";
    ctx.fillRect(x - 10, y - TANK_H - 8, 20, 2);

    // rotated barrel at aimAngle
    ctx.save();
    ctx.translate(x, y - TANK_H - 4);
    ctx.rotate(tank.aimAngle);
    ctx.fillStyle = "#2a3014";
    ctx.fillRect(0, -2, 26, 4);
    ctx.fillStyle = "#3a4a22";
    ctx.fillRect(0, -2, 4, 4);
    if (tank.fireCooldown > (1 / fireRate) * 0.78) {
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(24, -3, 5, 6);
      ctx.fillStyle = "#fff5b0";
      ctx.fillRect(26, -2, 3, 4);
    }
    ctx.restore();

    // co-gunner small turret on top
    if (coGunner) {
      ctx.save();
      ctx.translate(x, y - TANK_H - 14);
      ctx.rotate(tank.aimAngle - 0.2);
      ctx.fillStyle = "#2a3014";
      ctx.fillRect(-4, -3, 8, 6);
      ctx.fillRect(0, -1.5, 14, 3);
      ctx.restore();
    }
  }

  function drawBullet(b: Bullet): void {
    if (b.fromBoss) {
      ctx.fillStyle = "#ff5577";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 85, 119, 0.4)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#ffe082";
      ctx.fillRect(b.x - 6, b.y - 1.5, 8, 3);
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(b.x - 2, b.y - 1.5, 4, 3);
    }
  }

  function drawEnemy(e: Enemy): void {
    const flash = e.hitFlash;
    if (e.kind === "zombie") drawZombie(e, flash);
    else if (e.kind === "spectral") drawSpectral(e, flash);
    else if (e.kind === "werewolf") drawWerewolf(e, flash);
    else if (e.kind === "bat") drawBat(e, flash);
    else if (e.kind === "plant") drawPlant(e, flash);
    else if (e.kind === "boss-zombie") drawBossZombie(e, flash);
    else if (e.kind === "boss-ghost") drawBossGhost(e, flash);
    else if (e.kind === "boss-wolf") drawBossWolf(e, flash);
    // small hp pip
    if (!isBoss(e.kind) && e.hp < e.maxHp) {
      const w = e.w;
      const hp = e.hp / e.maxHp;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(e.x - w / 2, e.y - e.h - 8, w, 3);
      ctx.fillStyle = "#a3c14a";
      ctx.fillRect(e.x - w / 2, e.y - e.h - 8, w * hp, 3);
    }
  }

  function drawZombie(e: Enemy, flash: number): void {
    const x = e.x, y = e.y;
    const sway = Math.sin(e.bobPhase) * 1.5;
    // legs (brown torn pants)
    ctx.fillStyle = "#3a2a14";
    ctx.fillRect(x - 8, y - 14, 6, 14);
    ctx.fillRect(x + 2, y - 14, 6, 14);
    ctx.fillStyle = "#241808";
    ctx.fillRect(x - 8, y - 4, 6, 4);
    ctx.fillRect(x + 2, y - 4, 6, 4);
    // torso (torn black/brown shirt)
    ctx.fillStyle = flash > 0 ? "#ff6060" : "#2a1a08";
    ctx.fillRect(x - 10, y - 24, 20, 12);
    ctx.fillStyle = "#3a2a14";
    ctx.fillRect(x - 10, y - 22, 20, 2);
    // torn edges
    ctx.fillStyle = "#1a1004";
    ctx.fillRect(x - 9, y - 14 + sway, 3, 2);
    ctx.fillRect(x + 6, y - 14 - sway, 3, 2);
    // arms outstretched
    ctx.fillStyle = "#5a7a2a";
    ctx.fillRect(x - 14, y - 22, 4, 14);
    ctx.fillRect(x + 10, y - 22, 4, 14);
    // head (green skin)
    ctx.fillStyle = flash > 0 ? "#ff9090" : "#5a7a2a";
    ctx.fillRect(x - 7, y - 36, 14, 12);
    ctx.fillStyle = "#3a5a18";
    ctx.fillRect(x - 7, y - 36, 14, 2);
    // eyes
    ctx.fillStyle = "#ff3030";
    ctx.fillRect(x - 4, y - 32, 2, 2);
    ctx.fillRect(x + 2, y - 32, 2, 2);
    // mouth
    ctx.fillStyle = "#1a0a04";
    ctx.fillRect(x - 3, y - 28, 6, 2);
  }

  function drawSpectral(e: Enemy, flash: number): void {
    const x = e.x, y = e.y;
    const sway = Math.sin(e.bobPhase) * 4;
    ctx.globalAlpha = 0.65;
    // body (wisp)
    ctx.fillStyle = flash > 0 ? "#ff8080" : "#9aa8c8";
    ctx.beginPath();
    ctx.ellipse(x, y - 18, 14, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    // tail wisp
    ctx.fillStyle = "#7a88a8";
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 4 + sway);
    ctx.quadraticCurveTo(x, y + 4, x + 8, y - 4 - sway);
    ctx.quadraticCurveTo(x, y - 8, x - 8, y - 4 + sway);
    ctx.fill();
    ctx.globalAlpha = 1;
    // glowing eyes
    ctx.fillStyle = "#dffaff";
    ctx.fillRect(x - 5, y - 22, 2, 3);
    ctx.fillRect(x + 3, y - 22, 2, 3);
  }

  function drawWerewolf(e: Enemy, flash: number): void {
    const x = e.x, y = e.y;
    // legs
    ctx.fillStyle = "#1a0e08";
    ctx.fillRect(x - 14, y - 10, 6, 10);
    ctx.fillRect(x + 8, y - 10, 6, 10);
    // body
    ctx.fillStyle = flash > 0 ? "#ff7878" : "#3a2818";
    ctx.fillRect(x - 16, y - 22, 32, 14);
    ctx.fillStyle = "#2a1a10";
    ctx.fillRect(x - 16, y - 24, 32, 2);
    // head
    ctx.fillStyle = flash > 0 ? "#ff8888" : "#2a1808";
    ctx.fillRect(x - 22, y - 24, 10, 8);
    // ears
    ctx.fillRect(x - 21, y - 28, 2, 4);
    ctx.fillRect(x - 16, y - 28, 2, 4);
    // glowing eye
    ctx.fillStyle = "#ffd040";
    ctx.fillRect(x - 19, y - 22, 2, 2);
    // fang
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 22, y - 18, 2, 3);
    // tail
    ctx.fillStyle = "#1a0e08";
    ctx.fillRect(x + 16, y - 22, 4, 8);
  }

  function drawBat(e: Enemy, flash: number): void {
    const x = e.x, y = e.y;
    const flap = Math.sin(e.bobPhase * 6) * 4;
    // body
    ctx.fillStyle = flash > 0 ? "#ff7878" : "#1a0a14";
    ctx.fillRect(x - 4, y - 12, 8, 8);
    // wings (flap)
    ctx.fillStyle = flash > 0 ? "#ff8888" : "#241420";
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 8);
    ctx.lineTo(x - 14, y - 12 + flap);
    ctx.lineTo(x - 12, y - 4 + flap);
    ctx.lineTo(x - 4, y - 6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 4, y - 8);
    ctx.lineTo(x + 14, y - 12 + flap);
    ctx.lineTo(x + 12, y - 4 + flap);
    ctx.lineTo(x + 4, y - 6);
    ctx.closePath();
    ctx.fill();
    // ears
    ctx.fillStyle = "#1a0a14";
    ctx.fillRect(x - 3, y - 16, 1.6, 3);
    ctx.fillRect(x + 1.4, y - 16, 1.6, 3);
    // eyes
    ctx.fillStyle = "#ff3030";
    ctx.fillRect(x - 2.5, y - 11, 1.4, 1.4);
    ctx.fillRect(x + 1.1, y - 11, 1.4, 1.4);
  }

  function drawPlant(e: Enemy, flash: number): void {
    const x = e.x, y = e.y;
    // stem
    ctx.fillStyle = "#2a4018";
    ctx.fillRect(x - 2, y - 18, 4, 18);
    // leaves
    ctx.fillStyle = "#3a5a18";
    ctx.fillRect(x - 6, y - 14, 5, 4);
    ctx.fillRect(x + 1, y - 16, 5, 4);
    // bulb (red devil head)
    ctx.fillStyle = flash > 0 ? "#ffa0a0" : "#a4181a";
    ctx.fillRect(x - 10, y - 36, 20, 20);
    ctx.fillStyle = "#7a0a0c";
    ctx.fillRect(x - 10, y - 36, 20, 3);
    // petal points
    ctx.fillStyle = "#7a0a0c";
    ctx.fillRect(x - 12, y - 30, 2, 6);
    ctx.fillRect(x + 10, y - 30, 2, 6);
    ctx.fillRect(x - 4, y - 38, 3, 4);
    ctx.fillRect(x + 1, y - 38, 3, 4);
    // mouth (open, fanged)
    ctx.fillStyle = "#1a0408";
    ctx.fillRect(x - 6, y - 26, 12, 5);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 5, y - 26, 1.6, 3);
    ctx.fillRect(x + 3.4, y - 26, 1.6, 3);
    // eyes
    ctx.fillStyle = "#ffd040";
    ctx.fillRect(x - 6, y - 32, 2.5, 2.5);
    ctx.fillRect(x + 3.5, y - 32, 2.5, 2.5);
  }

  function drawBossZombie(e: Enemy, flash: number): void {
    const x = e.x, y = e.y;
    ctx.fillStyle = flash > 0 ? "#ff6060" : "#3a1a08";
    ctx.fillRect(x - 30, y - 70, 60, 50);
    ctx.fillStyle = "#5a3a14";
    ctx.fillRect(x - 30, y - 72, 60, 4);
    // head
    ctx.fillStyle = flash > 0 ? "#ff9090" : "#5a7a2a";
    ctx.fillRect(x - 22, y - 90, 44, 22);
    ctx.fillStyle = "#3a5a18";
    ctx.fillRect(x - 22, y - 90, 44, 4);
    // eyes
    ctx.fillStyle = "#ff3030";
    ctx.fillRect(x - 14, y - 82, 6, 5);
    ctx.fillRect(x + 8, y - 82, 6, 5);
    // mouth
    ctx.fillStyle = "#1a0a04";
    ctx.fillRect(x - 10, y - 74, 20, 4);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 8, y - 74, 2, 3);
    ctx.fillRect(x + 6, y - 74, 2, 3);
    // arms
    ctx.fillStyle = "#5a7a2a";
    ctx.fillRect(x - 38, y - 60, 8, 30);
    ctx.fillRect(x + 30, y - 60, 8, 30);
    // legs
    ctx.fillStyle = "#241808";
    ctx.fillRect(x - 16, y - 20, 12, 20);
    ctx.fillRect(x + 4, y - 20, 12, 20);
  }

  function drawBossGhost(e: Enemy, flash: number): void {
    const x = e.x, y = e.y;
    const t = Math.sin(e.bobPhase) * 6;
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = flash > 0 ? "#ff8080" : "#a4b0d0";
    ctx.beginPath();
    ctx.ellipse(x, y - 50, 36, 44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7080a8";
    // jagged tail
    ctx.beginPath();
    ctx.moveTo(x - 28, y - 12 + t);
    ctx.lineTo(x - 14, y);
    ctx.lineTo(x, y - 6 - t);
    ctx.lineTo(x + 14, y);
    ctx.lineTo(x + 28, y - 12 + t);
    ctx.lineTo(x + 28, y - 26);
    ctx.lineTo(x - 28, y - 26);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // crown
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(x - 16, y - 96, 32, 6);
    ctx.fillRect(x - 14, y - 100, 4, 6);
    ctx.fillRect(x - 2, y - 102, 4, 8);
    ctx.fillRect(x + 10, y - 100, 4, 6);
    // eyes
    ctx.fillStyle = "#dffaff";
    ctx.fillRect(x - 12, y - 60, 4, 6);
    ctx.fillRect(x + 8, y - 60, 4, 6);
    // mouth
    ctx.fillStyle = "#1a1430";
    ctx.fillRect(x - 8, y - 46, 16, 6);
  }

  function drawBossWolf(e: Enemy, flash: number): void {
    const x = e.x, y = e.y;
    // legs
    ctx.fillStyle = "#1a0e08";
    ctx.fillRect(x - 32, y - 18, 10, 18);
    ctx.fillRect(x + 22, y - 18, 10, 18);
    ctx.fillRect(x - 14, y - 16, 8, 16);
    ctx.fillRect(x + 6, y - 16, 8, 16);
    // body
    ctx.fillStyle = flash > 0 ? "#ff8a8a" : "#3a2818";
    ctx.fillRect(x - 36, y - 44, 72, 28);
    ctx.fillStyle = "#2a1a10";
    ctx.fillRect(x - 36, y - 46, 72, 4);
    // mane
    ctx.fillStyle = "#241408";
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(x - 36 + i * 4, y - 52 - (i % 2) * 3, 3, 6);
    }
    // head
    ctx.fillStyle = flash > 0 ? "#ff7a7a" : "#2a1808";
    ctx.fillRect(x - 50, y - 44, 18, 18);
    // ears
    ctx.fillRect(x - 50, y - 50, 4, 6);
    ctx.fillRect(x - 38, y - 50, 4, 6);
    // glowing eye
    ctx.fillStyle = "#ffd040";
    ctx.fillRect(x - 44, y - 38, 4, 4);
    // fangs
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 50, y - 30, 2, 4);
    ctx.fillRect(x - 36, y - 30, 2, 4);
    // tail
    ctx.fillStyle = "#1a0e08";
    ctx.fillRect(x + 36, y - 40, 8, 10);
  }

  function drawBossBar(e: Enemy): void {
    const w = canvasW * 0.7;
    const x = (canvasW - w) / 2;
    const y = 6;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 2, y - 2, w + 4, 12);
    ctx.fillStyle = "#3a1a18";
    ctx.fillRect(x, y, w, 8);
    ctx.fillStyle = "#ff5050";
    ctx.fillRect(x, y, w * (e.hp / e.maxHp), 8);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    const name = e.kind === "boss-zombie" ? "ROTSPAWN" : e.kind === "boss-ghost" ? "PALE KING" : "ALPHA HOWL";
    ctx.fillText(name, canvasW / 2, y + 7);
    ctx.textAlign = "left";
  }

  function drawIdle(): void {
    const a = 0.5 + 0.5 * Math.sin(tick * 0.06);
    ctx.textAlign = "center";
    ctx.font = "bold 24px monospace";
    ctx.fillStyle = `rgba(255, 220, 80, ${a})`;
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#ffd166";
    ctx.fillText("NIGHT TREADS", canvasW / 2, canvasH * 0.32);
    ctx.shadowBlur = 0;
    ctx.font = "12px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText("DRAG to move tank", canvasW / 2, canvasH * 0.32 + 26);
    ctx.fillText("AUTO-FIRE   /   Survive the night", canvasW / 2, canvasH * 0.32 + 42);
    ctx.font = "bold 14px monospace";
    ctx.fillStyle = `rgba(255, 80, 80, ${a})`;
    ctx.fillText("TAP TO START", canvasW / 2, canvasH * 0.32 + 70);
    ctx.textAlign = "left";
  }

  // ---------- start ----------

  const ro = new ResizeObserver(onResize);
  ro.observe(canvasWrap);
  onResize();

  void loadSeenHint().then((seen) => {
    if (!seen && phase === "idle") {
      hint.style.display = "flex";
      setTimeout(() => { hint.style.display = "none"; }, 6000);
    }
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
    container.classList.remove("nt-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ---------- gameover overlay ----------

function buildRankCard(rank: RankInfo, gameId: string): string {
  const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="nt-rank-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta} pts</div>`
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
  round: number,
  best: number,
  onReplay: () => void
): { el: HTMLElement; addRank: (r: RankInfo) => void } {
  const isNew = score >= best && score > 0;
  const overlay = document.createElement("div");
  overlay.className = "nt-gameover";
  overlay.innerHTML = `
    <div class="nt-go-box">
      <h2 class="nt-go-title">DESTROYED</h2>
      ${isNew ? `<div class="nt-go-new">NEW BEST!</div>` : ""}
      <div class="nt-go-score">${score}</div>
      <div class="nt-go-sublabel">SCORE — ROUND ${round}</div>
      <div class="nt-go-best">BEST ${best}</div>
      <div class="nt-go-actions">
        <button class="btn primary nt-go-btn" id="nt-replay">REDEPLOY</button>
        <button class="btn nt-go-btn" id="nt-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector("#nt-replay")?.addEventListener("pointerup", () => {
    overlay.remove();
    onReplay();
  });
  overlay.querySelector("#nt-menu")?.addEventListener("pointerup", () => navigate("/"));

  function addRank(rank: RankInfo): void {
    const box = overlay.querySelector(".nt-go-box");
    if (!box || box.querySelector(".rank-card")) return;
    const actions = box.querySelector(".nt-go-actions");
    if (!actions) return;
    const card = document.createElement("div");
    card.innerHTML = buildRankCard(rank, "night-treads");
    const cardEl = card.firstElementChild as HTMLElement | null;
    if (!cardEl) return;
    cardEl.querySelector<HTMLElement>(".rank-card-btn")?.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      navigate("/scores/night-treads");
    });
    box.insertBefore(cardEl, actions);
  }

  return { el: overlay, addRank };
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "nt-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .nt-root {
      display: flex; flex-direction: column; flex: 1; min-height: 0;
      background: #04050f; user-select: none; -webkit-user-select: none;
      position: relative; overflow: hidden;
    }
    .nt-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative; }
    .nt-hud {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; height: ${HUD_HEIGHT}px; min-height: ${HUD_HEIGHT}px;
      padding: 0 8px; font-family: monospace; color: #fff;
      background: rgba(0,0,0,0.5); border-bottom: 1px solid #2a1a08;
      box-sizing: border-box; z-index: 2;
    }
    .nt-hud-hp { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .nt-hp-label { font-size: 10px; color: #ffaaaa; letter-spacing: 1px; }
    .nt-hp-bar { display: inline-block; width: 60px; height: 8px; background: #2a0a0a; border: 1px solid #5a1a1a; }
    .nt-hp-fill { display: block; height: 100%; width: 100%; background: linear-gradient(to right, #ff5050, #ffaa50); transition: width 0.2s; }
    .nt-hud-round { font-size: 12px; color: #ffd166; letter-spacing: 1px; }
    .nt-hud-score { display: flex; flex-direction: column; line-height: 1; align-items: flex-end; }
    .nt-hud-mini { font-size: 9px; color: #aaa; letter-spacing: 1px; }
    .nt-hud-val { font-size: 14px; font-weight: bold; color: #fff; text-shadow: 0 0 6px #ffd166; }
    .nt-hud-btns { display: flex; gap: 4px; }
    .nt-hud-btn {
      min-width: 38px; min-height: 38px; font-size: 16px;
      background: transparent; border-color: rgba(255, 209, 102, 0.5); color: #ffd166;
    }
    .nt-canvas-wrap { flex: 1; min-height: 0; position: relative; overflow: hidden; }
    .nt-canvas { display: block; touch-action: none; }
    .nt-hint {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      pointer-events: none; z-index: 8;
    }
    .nt-hint-card {
      background: rgba(4, 5, 15, 0.94);
      border: 2px solid #ffd166;
      padding: 18px 22px; font-family: monospace; color: #fff; text-align: center;
      max-width: 80%;
      box-shadow: 0 0 24px rgba(255, 209, 102, 0.4);
    }
    .nt-hint-title { font-weight: bold; color: #ffd166; letter-spacing: 3px; margin-bottom: 10px; font-size: 16px; }
    .nt-hint-row { font-size: 12px; letter-spacing: 1px; margin: 4px 0; color: #c8c0aa; }
    .nt-hint-row strong { color: #ffd166; }
    .nt-upgrade {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(4, 5, 15, 0.85); z-index: 9; backdrop-filter: blur(2px);
    }
    .nt-upgrade-box { width: 92%; max-width: 460px; }
    .nt-upgrade-title {
      font-family: monospace; font-weight: bold; color: #ffd166; text-align: center;
      letter-spacing: 4px; font-size: 14px; margin-bottom: 14px;
      text-shadow: 0 0 12px rgba(255, 209, 102, 0.5);
    }
    .nt-upgrade-cards { display: flex; flex-direction: column; gap: 8px; }
    .nt-card {
      background: #1a1430; border: 2px solid #ffd166; padding: 14px 16px;
      color: #fff; font-family: monospace; text-align: left; cursor: pointer;
      transition: transform 0.1s, background 0.1s;
    }
    .nt-card:hover, .nt-card:active {
      background: #2a1f3f;
      transform: translateY(-1px);
    }
    .nt-card-label { font-weight: bold; color: #ffd166; letter-spacing: 2px; margin-bottom: 4px; font-size: 13px; }
    .nt-card-desc { font-size: 11px; color: #c8c0aa; }
    .nt-gameover {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.78); z-index: 10;
    }
    .nt-go-box {
      text-align: center; padding: 28px 24px; background: #1a1430;
      border: 2px solid #ff5050; min-width: 240px; font-family: monospace;
      box-shadow: 0 0 30px rgba(255, 80, 80, 0.5);
    }
    .nt-go-title {
      margin: 0 0 6px; font-size: 22px; color: #ff5050; letter-spacing: 4px;
      text-shadow: 0 0 14px #ff5050;
    }
    .nt-go-new {
      color: #ffd166; font-size: 12px; letter-spacing: 2px; margin-bottom: 6px;
      text-shadow: 0 0 8px #ffd166;
    }
    .nt-go-score {
      font-size: 56px; font-weight: bold; color: #fff;
      text-shadow: 0 0 18px #ffd166; line-height: 1;
    }
    .nt-go-sublabel { font-size: 11px; color: #c8c0aa; letter-spacing: 2px; margin-bottom: 4px; }
    .nt-go-best { font-size: 13px; color: #ffd166; margin-bottom: 18px; }
    .nt-go-actions { display: flex; gap: 12px; justify-content: center; }
    .nt-go-btn { min-width: 110px; min-height: 44px; font-family: monospace; font-size: 13px; letter-spacing: 1px; }
    .nt-rank-delta { font-size: 12px; color: #c8c0aa; margin: 4px 0; }
  `;
  document.head.appendChild(style);
}
