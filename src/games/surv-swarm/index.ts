import { submit } from "../../lib/leaderboard.js";
import { playSfx } from "../../lib/audio.js";
import { db } from "../../lib/storage.js";

// ─── constants ────────────────────────────────────────────────────────────────

const GAME_ID = "surv-swarm";
const HUD_H = 44;
const DT_CAP = 33;

const PLAYER_RADIUS = 14;
const PLAYER_BASE_SPEED = 120;
const PLAYER_MAX_HP = 100;
const PLAYER_IFRAMES_MS = 400;
const PICKUP_RADIUS_BASE = 60;

const XP_PER_LEVEL_BASE = 10;
const XP_PER_LEVEL_STEP = 8;

const MAX_ENEMIES = 150;
const MAX_PARTICLES = 200;
const CAMERA_MARGIN = 0.1;

const BG_TILE = 64;

// ─── types ────────────────────────────────────────────────────────────────────

type Phase = "playing" | "levelup" | "gameover";

type EnemyKind = "zombie" | "bat" | "skeleton" | "elite" | "boss";
type GemKind = "blue" | "green" | "red";
type WeaponId = "sword" | "whip" | "aura" | "fireball" | "lightning" | "orbit";

interface Vec2 { x: number; y: number; }

interface Enemy {
  alive: boolean;
  kind: EnemyKind;
  wx: number; wy: number;       // world position
  vx: number; vy: number;
  hp: number; maxHp: number;
  radius: number;
  speed: number;
  iframes: number;
  wobblePhase: number;          // bat sine
  shootCooldown: number;        // skeleton ranged
  meleeCooldown: number;
  gemKind: GemKind;
  gemAmt: number;
  facing: number;               // angle
  // boss pattern
  attackPhase: number;
  attackTimer: number;
}

interface XpGem {
  alive: boolean;
  wx: number; wy: number;
  kind: GemKind;
  amt: number;
  flyTarget: boolean;
  bobPhase: number;
  vx: number; vy: number;
}

interface Projectile {
  alive: boolean;
  wx: number; wy: number;
  vx: number; vy: number;
  radius: number;
  damage: number;
  owner: "player" | "enemy";
  trailX: number[]; trailY: number[];
  life: number; maxLife: number;
}

interface Particle {
  alive: boolean;
  wx: number; wy: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  r: number; g: number; b: number;
  radius: number;
}

interface DamageNumber {
  alive: boolean;
  wx: number; wy: number;
  vy: number;
  value: number;
  life: number; maxLife: number;
  color: string;
}

interface LightningFx {
  alive: boolean;
  wx1: number; wy1: number;
  wx2: number; wy2: number;
  life: number;
}

interface WeaponState {
  id: WeaponId;
  level: number;      // 1–5
  cooldown: number;
  // sword/whip arc state
  swingTimer: number;
  swingAngle: number;
  swingDir: number;
  // orbit
  orbitAngle: number;
}

interface PlayerState {
  wx: number; wy: number;
  hp: number; maxHp: number;
  speed: number;
  iframes: number;
  facing: number;
  weapons: WeaponState[];
  xp: number;
  level: number;
  xpGainMult: number;
  pickupRadius: number;
}

interface UpgradeCard {
  id: string;
  title: string;
  desc: string;
  icon: string;
  apply: (ps: PlayerState, ws: WeaponState[]) => void;
}

// ─── object pools ────────────────────────────────────────────────────────────

function poolGet<T extends { alive: boolean }>(pool: T[], factory: () => T): T {
  for (const item of pool) {
    if (!item.alive) { item.alive = true; return item; }
  }
  const item = factory();
  item.alive = true;
  pool.push(item);
  return item;
}

// ─── background tile builder ─────────────────────────────────────────────────

function buildBgTile(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = BG_TILE; c.height = BG_TILE;
  const cx = c.getContext("2d")!;

  // dark stone base
  cx.fillStyle = "#0d0022";
  cx.fillRect(0, 0, BG_TILE, BG_TILE);

  // subtle grid stones
  const colors = ["#120028", "#0f001f", "#130030"];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const ci = (row + col) % colors.length;
      cx.fillStyle = colors[ci]!;
      cx.fillRect(col * 32 + 1, row * 32 + 1, 30, 30);
    }
  }

  // top/left border glow
  cx.fillStyle = "#1a003a";
  cx.fillRect(0, 0, BG_TILE, 1);
  cx.fillRect(0, 0, 1, BG_TILE);

  // scattered tiny stars
  cx.fillStyle = "#ffffff";
  const pts: [number, number][] = [[10, 7], [45, 18], [20, 50], [55, 40], [30, 30], [5, 55]];
  for (const [px, py] of pts) {
    cx.globalAlpha = 0.15;
    cx.fillRect(px, py, 1, 1);
  }
  cx.globalAlpha = 1;

  return c;
}

// ─── weapon helpers ───────────────────────────────────────────────────────────

function makeWeapon(id: WeaponId): WeaponState {
  return { id, level: 1, cooldown: 0, swingTimer: 0, swingAngle: 0, swingDir: 1, orbitAngle: 0 };
}

function weaponCooldownBase(id: WeaponId): number {
  switch (id) {
    case "sword":     return 1000;
    case "whip":      return 800;
    case "aura":      return 400;
    case "fireball":  return 1500;
    case "lightning": return 2000;
    case "orbit":     return 0; // continuous
    default:          return 1000;
  }
}

function weaponDamage(ws: WeaponState): number {
  const base: Record<WeaponId, number> = {
    sword: 20, whip: 30, aura: 5, fireball: 30, lightning: 50, orbit: 15,
  };
  return base[ws.id] * (1 + (ws.level - 1) * 0.2);
}

function weaponArea(ws: WeaponState): number {
  const base: Record<WeaponId, number> = {
    sword: 1, whip: 1.6, aura: 80, fireball: 10, lightning: 300, orbit: 60,
  };
  return base[ws.id] * (1 + (ws.level - 1) * 0.1);
}

function weaponCooldown(ws: WeaponState): number {
  return weaponCooldownBase(ws.id) * Math.pow(0.95, ws.level - 1);
}

// ─── XP helpers ──────────────────────────────────────────────────────────────

function xpForLevel(level: number): number {
  return XP_PER_LEVEL_BASE + level * XP_PER_LEVEL_STEP;
}

// ─── enemy factory ────────────────────────────────────────────────────────────

function spawnEnemy(
  pool: Enemy[],
  kind: EnemyKind,
  wx: number, wy: number
): void {
  const e = poolGet(pool, (): Enemy => ({
    alive: false, kind: "zombie",
    wx: 0, wy: 0, vx: 0, vy: 0,
    hp: 1, maxHp: 1, radius: 12, speed: 40,
    iframes: 0, wobblePhase: 0, shootCooldown: 0, meleeCooldown: 0,
    gemKind: "blue", gemAmt: 1, facing: 0,
    attackPhase: 0, attackTimer: 0,
  }));
  e.kind = kind;
  e.wx = wx; e.wy = wy;
  e.vx = 0; e.vy = 0;
  e.iframes = 0;
  e.wobblePhase = Math.random() * Math.PI * 2;
  e.shootCooldown = 1000 + Math.random() * 1000;
  e.meleeCooldown = 0;
  e.attackPhase = 0;
  e.attackTimer = 0;
  e.facing = 0;

  switch (kind) {
    case "zombie":
      e.hp = e.maxHp = 30; e.radius = 12; e.speed = 40;
      e.gemKind = "blue"; e.gemAmt = 1; break;
    case "bat":
      e.hp = e.maxHp = 20; e.radius = 10; e.speed = 90;
      e.gemKind = "blue"; e.gemAmt = 1; break;
    case "skeleton":
      e.hp = e.maxHp = 80; e.radius = 12; e.speed = 50;
      e.gemKind = "green"; e.gemAmt = 3; break;
    case "elite":
      e.hp = e.maxHp = 250; e.radius = 16; e.speed = 30;
      e.gemKind = "green"; e.gemAmt = 5; break;
    case "boss":
      e.hp = e.maxHp = 2000; e.radius = 28; e.speed = 25;
      e.gemKind = "red"; e.gemAmt = 5;
      e.attackTimer = 2000;
      break;
  }
}

// ─── particle helpers ─────────────────────────────────────────────────────────

function spawnParticles(
  pool: Particle[],
  wx: number, wy: number,
  count: number,
  rr: number, gg: number, bb: number,
  speed: number,
  life: number
): void {
  let spawned = 0;
  for (const p of pool) {
    if (p.alive) continue;
    if (spawned >= count) break;
    p.alive = true;
    p.wx = wx; p.wy = wy;
    const angle = Math.random() * Math.PI * 2;
    const spd = speed * (0.5 + Math.random() * 0.5);
    p.vx = Math.cos(angle) * spd;
    p.vy = Math.sin(angle) * spd;
    p.r = rr; p.g = gg; p.b = bb;
    p.radius = 1.5 + Math.random() * 2;
    p.life = p.maxLife = life * (0.7 + Math.random() * 0.3);
    spawned++;
  }
  for (let i = spawned; i < count; i++) {
    if (pool.length >= MAX_PARTICLES) break;
    const angle = Math.random() * Math.PI * 2;
    const spd = speed * (0.5 + Math.random() * 0.5);
    pool.push({
      alive: true,
      wx, wy,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      r: rr, g: gg, b: bb,
      radius: 1.5 + Math.random() * 2,
      life: life * (0.7 + Math.random() * 0.3),
      maxLife: life,
    });
  }
}

// ─── upgrade card definitions ─────────────────────────────────────────────────

const ALL_WEAPON_IDS: WeaponId[] = ["whip", "aura", "fireball", "lightning", "orbit"];

function buildUpgradeCards(player: PlayerState): UpgradeCard[] {
  const cards: UpgradeCard[] = [];

  // new weapon cards
  for (const wid of ALL_WEAPON_IDS) {
    if (!player.weapons.some((w) => w.id === wid)) {
      cards.push({
        id: `new:${wid}`,
        title: weaponName(wid),
        desc: weaponDesc(wid),
        icon: weaponIcon(wid),
        apply: (ps) => { ps.weapons.push(makeWeapon(wid)); },
      });
    }
  }

  // upgrade existing weapons
  for (const ws of player.weapons) {
    if (ws.level < 5) {
      cards.push({
        id: `up:${ws.id}`,
        title: `${weaponName(ws.id)} Lv.${ws.level + 1}`,
        desc: `+20% damage, +10% area, -5% cooldown`,
        icon: weaponIcon(ws.id),
        apply: (_, wss) => {
          const found = wss.find((w) => w.id === ws.id);
          if (found) found.level = Math.min(5, found.level + 1);
        },
      });
    }
  }

  // stat boosts
  cards.push(
    {
      id: "stat:hp",
      title: "+15% Max HP",
      desc: "Increase max health and heal a bit.",
      icon: "❤",
      apply: (ps) => {
        const bonus = Math.floor(ps.maxHp * 0.15);
        ps.maxHp += bonus;
        ps.hp = Math.min(ps.hp + bonus, ps.maxHp);
      },
    },
    {
      id: "stat:speed",
      title: "+10% Move Speed",
      desc: "Move faster across the arena.",
      icon: "⚡",
      apply: (ps) => { ps.speed *= 1.1; },
    },
    {
      id: "stat:xp",
      title: "+25% XP Gain",
      desc: "Gems worth more experience.",
      icon: "✦",
      apply: (ps) => { ps.xpGainMult *= 1.25; },
    },
    {
      id: "stat:pickup",
      title: "+20% Pickup Radius",
      desc: "Collect gems from farther away.",
      icon: "◎",
      apply: (ps) => { ps.pickupRadius *= 1.2; },
    },
  );

  return cards;
}

function weaponName(id: WeaponId): string {
  const n: Record<WeaponId, string> = {
    sword: "Sword Arc", whip: "Whip", aura: "Aura",
    fireball: "Fireball", lightning: "Lightning", orbit: "Orbiting Blade",
  };
  return n[id];
}

function weaponDesc(id: WeaponId): string {
  const d: Record<WeaponId, string> = {
    sword: "Melee arc in front of player.",
    whip: "Wide arc, more damage.",
    aura: "Damage ring around player.",
    fireball: "Projectile toward nearest enemy.",
    lightning: "Strikes random enemy in range.",
    orbit: "Two blades orbit the player.",
  };
  return d[id];
}

function weaponIcon(id: WeaponId): string {
  const icons: Record<WeaponId, string> = {
    sword: "⚔", whip: "〰", aura: "◯", fireball: "🔥", lightning: "⚡", orbit: "◎",
  };
  return icons[id];
}

// ─── screen shake ─────────────────────────────────────────────────────────────

interface Shake { dx: number; dy: number; life: number; maxLife: number; }

function addShake(shakes: Shake[], strength: number, life: number): void {
  shakes.push({
    dx: (Math.random() - 0.5) * strength * 2,
    dy: (Math.random() - 0.5) * strength * 2,
    life, maxLife: life,
  });
}

function getShakeOffset(shakes: Shake[]): Vec2 {
  let sx = 0, sy = 0;
  for (const s of shakes) {
    if (!s.life) continue;
    const t = s.life / s.maxLife;
    sx += s.dx * t;
    sy += s.dy * t;
  }
  return { x: sx, y: sy };
}

// ─── main mount ──────────────────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  container.classList.add("swarm-root");

  // Root wrapper
  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0;position:relative;background:#0a0018;";
  container.style.touchAction = "none";

  // HUD
  const hud = document.createElement("div");
  hud.style.cssText = `
    height:${HUD_H}px;min-height:${HUD_H}px;
    display:flex;align-items:center;justify-content:space-between;
    padding:0 8px;background:#0a0018;color:#fff;
    font:bold 11px/1 ui-monospace,monospace;flex-shrink:0;position:relative;z-index:2;
  `;

  const timeEl = document.createElement("span");
  timeEl.textContent = "00:00";

  const centerHud = document.createElement("div");
  centerHud.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;";
  const levelEl = document.createElement("span");
  levelEl.textContent = "LV 1";
  const xpBarOuter = document.createElement("div");
  xpBarOuter.style.cssText = "width:100px;height:5px;background:#333;border-radius:3px;overflow:hidden;";
  const xpBarInner = document.createElement("div");
  xpBarInner.style.cssText = "height:100%;background:#44aaff;border-radius:3px;width:0%;transition:width 0.1s;";
  xpBarOuter.appendChild(xpBarInner);
  centerHud.appendChild(levelEl);
  centerHud.appendChild(xpBarOuter);

  const killsEl = document.createElement("span");
  killsEl.textContent = "☠ 0";

  // Fullscreen button
  const fsBtn = document.createElement("button");
  fsBtn.textContent = "⛶";
  fsBtn.style.cssText = "background:none;border:none;color:#888;font-size:18px;cursor:pointer;min-width:32px;min-height:32px;padding:0;margin-left:4px;";
  fsBtn.addEventListener("click", () => {
    const host = container.closest(".game-host") as HTMLElement | null;
    if (host?.requestFullscreen) host.requestFullscreen().catch(() => { /* ignore */ });
  });

  hud.appendChild(timeEl);
  hud.appendChild(centerHud);
  hud.appendChild(killsEl);
  hud.appendChild(fsBtn);

  // Canvas
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;flex:1;min-height:0;touch-action:none;";

  root.appendChild(hud);
  root.appendChild(canvas);
  container.appendChild(root);

  const ctx2d = canvas.getContext("2d")!;
  let dpr = 1;
  let cw = 0, ch = 0; // css pixels
  let canvasReady = false;

  // Weapon icons HUD row
  const weaponHud = document.createElement("div");
  weaponHud.style.cssText = `
    position:absolute;bottom:6px;left:6px;display:flex;gap:3px;z-index:3;pointer-events:none;
  `;
  root.appendChild(weaponHud);

  // Onboarding hint
  const hint = document.createElement("div");
  hint.style.cssText = `
    position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
    pointer-events:none;text-align:center;color:#fff;
    font:bold 13px/1.5 ui-monospace,monospace;
    text-shadow:0 0 8px #ff2266;opacity:1;transition:opacity 0.5s;
    z-index:10;
  `;
  hint.innerHTML = "HOLD ANYWHERE TO MOVE<br><span style='color:#aaa;font-size:11px'>Survive. Level up. Choose power.</span>";
  root.appendChild(hint);

  // Level-up overlay
  const lvlOverlay = document.createElement("div");
  lvlOverlay.style.cssText = `
    position:absolute;inset:0;background:rgba(0,0,10,0.88);
    display:none;flex-direction:column;align-items:center;justify-content:center;
    z-index:20;gap:12px;padding:16px;box-sizing:border-box;
  `;
  const lvlTitle = document.createElement("div");
  lvlTitle.style.cssText = "color:#ff2266;font:bold 18px ui-monospace,monospace;text-shadow:0 0 16px #ff2266;";
  lvlTitle.textContent = "LEVEL UP!";
  const cardsRow = document.createElement("div");
  cardsRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;justify-content:center;";
  lvlOverlay.appendChild(lvlTitle);
  lvlOverlay.appendChild(cardsRow);
  root.appendChild(lvlOverlay);

  // Game over overlay
  const goOverlay = document.createElement("div");
  goOverlay.style.cssText = `
    position:absolute;inset:0;background:rgba(0,0,0,0.85);
    display:none;flex-direction:column;align-items:center;justify-content:center;
    z-index:20;gap:10px;color:#fff;font:bold 14px ui-monospace,monospace;
  `;
  root.appendChild(goOverlay);

  // ─── game state ─────────────────────────────────────────────────────────────

  const bgTile = buildBgTile();
  let bgPattern: CanvasPattern | null = null;

  const enemies: Enemy[] = [];
  const gems: XpGem[] = [];
  const projectiles: Projectile[] = [];
  const particles: Particle[] = [];
  const damageNums: DamageNumber[] = [];
  const lightnings: LightningFx[] = [];
  const shakes: Shake[] = [];

  let player: PlayerState = createPlayer();
  let phase: Phase = "playing";
  let timeSec = 0;
  let kills = 0;
  let bossesKilled = 0;
  let spawnTimer = 0;
  let bossTimer = 0;
  let bossNum = 0;
  let lightningFlash = 0;
  let hintDismissed = false;
  let hintTimer = 0;
  let pendingCards: UpgradeCard[] = [];
  let killSfxCounter = 0;
  let xpSfxDebounce = 0;
  let hitSfxDebounce = 0;

  // pointer input
  let pointerDown = false;
  let pointerTargetX = 0; // CSS px relative to canvas
  let pointerTargetY = 0;

  // hint
  void db.settings.get(`${GAME_ID}:seenHint`).then((row) => {
    if (row) { hint.style.display = "none"; hintDismissed = true; }
  });

  function createPlayer(): PlayerState {
    return {
      wx: 0, wy: 0,
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
      speed: PLAYER_BASE_SPEED,
      iframes: 0,
      facing: 0,
      weapons: [makeWeapon("sword")],
      xp: 0,
      level: 1,
      xpGainMult: 1,
      pickupRadius: PICKUP_RADIUS_BASE,
    };
  }

  function dismissHint(): void {
    if (hintDismissed) return;
    hintDismissed = true;
    hint.style.opacity = "0";
    void db.settings.put({ key: `${GAME_ID}:seenHint`, value: "1" });
  }

  // ─── resize ────────────────────────────────────────────────────────────────

  function onResize(): void {
    const rect = canvas.getBoundingClientRect();
    cw = rect.width; ch = rect.height;
    if (cw < 8 || ch < 8) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    // rebuild pattern
    bgPattern = ctx2d.createPattern(bgTile, "repeat");
    canvasReady = true;
    if (phase === "playing") render();
  }

  const ro = new ResizeObserver(() => { onResize(); });
  ro.observe(canvas);
  onResize();

  // ─── input ─────────────────────────────────────────────────────────────────

  function canvasPt(e: PointerEvent): Vec2 {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: PointerEvent): void {
    if (phase !== "playing") return;
    e.preventDefault();
    const pt = canvasPt(e);
    pointerDown = true;
    pointerTargetX = pt.x;
    pointerTargetY = pt.y;
    dismissHint();
  }
  function onPointerMove(e: PointerEvent): void {
    if (!pointerDown || phase !== "playing") return;
    e.preventDefault();
    const pt = canvasPt(e);
    pointerTargetX = pt.x;
    pointerTargetY = pt.y;
  }
  function onPointerUp(e: PointerEvent): void {
    e.preventDefault();
    pointerDown = false;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (phase !== "playing") return;
    const spd = 1;
    if (e.key === "ArrowLeft" || e.key === "a") { keyVx = -spd; }
    else if (e.key === "ArrowRight" || e.key === "d") { keyVx = spd; }
    else if (e.key === "ArrowUp" || e.key === "w") { keyVy = -spd; }
    else if (e.key === "ArrowDown" || e.key === "s") { keyVy = spd; }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === "ArrowLeft" || e.key === "a") { if (keyVx < 0) keyVx = 0; }
    else if (e.key === "ArrowRight" || e.key === "d") { if (keyVx > 0) keyVx = 0; }
    else if (e.key === "ArrowUp" || e.key === "w") { if (keyVy < 0) keyVy = 0; }
    else if (e.key === "ArrowDown" || e.key === "s") { if (keyVy > 0) keyVy = 0; }
  }

  let keyVx = 0, keyVy = 0;

  container.addEventListener("pointerdown", onPointerDown, { passive: false });
  container.addEventListener("pointermove", onPointerMove, { passive: false });
  container.addEventListener("pointerup", onPointerUp, { passive: false });
  container.addEventListener("pointercancel", onPointerUp, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // ─── update player movement ───────────────────────────────────────────────

  function updatePlayerMovement(dt: number): void {
    let dx = 0, dy = 0;

    if (pointerDown) {
      // convert pointer target (CSS px on canvas) to world delta
      const screenCX = cw / 2;
      const screenCY = ch / 2;
      const pdx = pointerTargetX - screenCX;
      const pdy = pointerTargetY - screenCY;
      const dist = Math.sqrt(pdx * pdx + pdy * pdy);
      if (dist > 4) {
        dx = pdx / dist;
        dy = pdy / dist;
      }
    } else if (keyVx !== 0 || keyVy !== 0) {
      const l = Math.sqrt(keyVx * keyVx + keyVy * keyVy);
      dx = keyVx / l;
      dy = keyVy / l;
    }

    if (dx !== 0 || dy !== 0) {
      player.wx += dx * player.speed * (dt / 1000);
      player.wy += dy * player.speed * (dt / 1000);
      player.facing = Math.atan2(dy, dx);
    }
  }

  // ─── enemy spawn logic ────────────────────────────────────────────────────

  function pickEnemyKind(): EnemyKind {
    const t = timeSec;
    const r = Math.random();
    if (t < 60) {
      return r < 0.9 ? "zombie" : "bat";
    } else if (t < 120) {
      if (r < 0.6) return "zombie";
      if (r < 0.9) return "bat";
      return "skeleton";
    } else if (t < 180) {
      if (r < 0.4) return "zombie";
      if (r < 0.75) return "bat";
      if (r < 0.95) return "skeleton";
      return "elite";
    } else {
      if (r < 0.35) return "zombie";
      if (r < 0.65) return "bat";
      if (r < 0.85) return "skeleton";
      return "elite";
    }
  }

  function spawnRate(): number {
    return Math.max(500, 2000 - timeSec * 10);
  }

  function countLiveEnemies(): number {
    let n = 0;
    for (const e of enemies) if (e.alive) n++;
    return n;
  }

  function doSpawn(): void {
    if (countLiveEnemies() >= MAX_ENEMIES) return;
    const kind = pickEnemyKind();
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.max(cw, ch) * 0.6 + 50;
    const wx = player.wx + Math.cos(angle) * dist;
    const wy = player.wy + Math.sin(angle) * dist;
    spawnEnemy(enemies, kind, wx, wy);
  }

  // ─── weapon update ────────────────────────────────────────────────────────

  function nearestEnemy(): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.wx - player.wx;
      const dy = e.wy - player.wy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = e; }
    }
    return best;
  }

  function hitEnemiesInArc(
    ws: WeaponState,
    angle: number,
    arcHalf: number,
    rangePx: number,
    dt: number
  ): void {
    const dmg = weaponDamage(ws);
    for (const e of enemies) {
      if (!e.alive || e.iframes > 0) continue;
      const dx = e.wx - player.wx;
      const dy = e.wy - player.wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > rangePx + e.radius) continue;
      const eAngle = Math.atan2(dy, dx);
      let diff = eAngle - angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) <= arcHalf) {
        damageEnemy(e, dmg, ws);
        e.iframes = 150;
      }
    }
    void dt;
  }

  function updateSword(ws: WeaponState, dt: number): void {
    ws.cooldown -= dt;
    if (ws.swingTimer > 0) {
      ws.swingTimer -= dt;
      const arcHalf = (Math.PI / 4) * (ws.id === "whip" ? 1.6 : 1.0);
      const range = 60 * (ws.id === "whip" ? 1.0 : 0.9) * weaponArea(ws);
      hitEnemiesInArc(ws, ws.swingAngle, arcHalf, range, dt);
      if (ws.swingTimer <= 0) playSfx("hit");
    }
    if (ws.cooldown <= 0) {
      const ne = nearestEnemy();
      const dir = ne
        ? Math.atan2(ne.wy - player.wy, ne.wx - player.wx)
        : player.facing;
      ws.swingAngle = dir;
      ws.swingTimer = 200;
      ws.cooldown = weaponCooldown(ws);
      playSfx("shoot");
    }
  }

  function updateAura(ws: WeaponState, dt: number): void {
    ws.cooldown -= dt;
    if (ws.cooldown <= 0) {
      ws.cooldown = weaponCooldown(ws);
      const radius = weaponArea(ws);
      const dmg = weaponDamage(ws);
      for (const e of enemies) {
        if (!e.alive || e.iframes > 0) continue;
        const dx = e.wx - player.wx;
        const dy = e.wy - player.wy;
        if (dx * dx + dy * dy <= (radius + e.radius) * (radius + e.radius)) {
          damageEnemy(e, dmg, ws);
          e.iframes = 100;
        }
      }
    }
  }

  function updateFireball(ws: WeaponState, dt: number): void {
    ws.cooldown -= dt;
    if (ws.cooldown <= 0) {
      ws.cooldown = weaponCooldown(ws);
      const ne = nearestEnemy();
      if (ne) {
        const dx = ne.wx - player.wx;
        const dy = ne.wy - player.wy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const speed = 280;
        const proj = poolGet(projectiles, (): Projectile => ({
          alive: false,
          wx: 0, wy: 0, vx: 0, vy: 0,
          radius: 6, damage: 0,
          owner: "player",
          trailX: [], trailY: [],
          life: 0, maxLife: 0,
        }));
        proj.wx = player.wx;
        proj.wy = player.wy;
        proj.vx = (dx / d) * speed;
        proj.vy = (dy / d) * speed;
        proj.radius = 6 + (ws.level - 1);
        proj.damage = weaponDamage(ws);
        proj.owner = "player";
        proj.trailX = [];
        proj.trailY = [];
        proj.life = proj.maxLife = 2000;
        playSfx("shoot");
      }
    }
  }

  function updateLightning(ws: WeaponState, dt: number): void {
    ws.cooldown -= dt;
    if (ws.cooldown <= 0) {
      ws.cooldown = weaponCooldown(ws);
      const range = weaponArea(ws);
      const targets: Enemy[] = [];
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = e.wx - player.wx;
        const dy = e.wy - player.wy;
        if (dx * dx + dy * dy <= range * range) targets.push(e);
      }
      if (targets.length > 0) {
        const target = targets[Math.floor(Math.random() * targets.length)]!;
        damageEnemy(target, weaponDamage(ws), ws);
        lightnings.push({
          alive: true,
          wx1: player.wx, wy1: player.wy,
          wx2: target.wx, wy2: target.wy,
          life: 150,
        });
        lightningFlash = 100;
        playSfx("shoot");
      }
    }
  }

  function updateOrbit(ws: WeaponState, dt: number): void {
    ws.orbitAngle += 2 * (dt / 1000);
    const radius = weaponArea(ws);
    const dmg = weaponDamage(ws);
    for (let blade = 0; blade < 2; blade++) {
      const angle = ws.orbitAngle + blade * Math.PI;
      const bx = player.wx + Math.cos(angle) * radius;
      const by = player.wy + Math.sin(angle) * radius;
      for (const e of enemies) {
        if (!e.alive || e.iframes > 0) continue;
        const dx = e.wx - bx;
        const dy = e.wy - by;
        if (dx * dx + dy * dy <= (8 + e.radius) * (8 + e.radius)) {
          damageEnemy(e, dmg, ws);
          e.iframes = 200;
        }
      }
    }
  }

  function damageEnemy(e: Enemy, dmg: number, _ws: WeaponState): void {
    if (!e.alive) return;
    // elite frontal damage reduction
    if (e.kind === "elite") {
      const dx = player.wx - e.wx;
      const dy = player.wy - e.wy;
      const angleToPlayer = Math.atan2(dy, dx);
      let diff = angleToPlayer - e.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < Math.PI / 2) dmg *= 0.5;
    }

    e.hp -= dmg;
    spawnParticles(particles, e.wx, e.wy, 3, 255, 100, 100, 80, 300);
    addDamageNumber(e.wx, e.wy, Math.round(dmg), "#ff8888");

    if (e.hp <= 0) {
      killEnemy(e);
    } else {
      e.iframes = 120;
    }
  }

  function killEnemy(e: Enemy): void {
    e.alive = false;
    kills++;

    // xp gem
    const gem = poolGet(gems, (): XpGem => ({
      alive: false, wx: 0, wy: 0, kind: "blue", amt: 1,
      flyTarget: false, bobPhase: Math.random() * Math.PI * 2,
      vx: 0, vy: 0,
    }));
    gem.wx = e.wx + (Math.random() - 0.5) * 8;
    gem.wy = e.wy + (Math.random() - 0.5) * 8;
    gem.kind = e.gemKind;
    gem.amt = e.gemAmt;
    gem.flyTarget = false;
    gem.vx = (Math.random() - 0.5) * 30;
    gem.vy = (Math.random() - 0.5) * 30;
    gem.bobPhase = Math.random() * Math.PI * 2;

    // particles
    const pc = e.kind === "boss" ? 20 : e.kind === "elite" ? 10 : 5;
    spawnParticles(particles, e.wx, e.wy, pc, 100, 255, 100, 100, 500);

    if (e.kind === "boss") {
      bossesKilled++;
      addShake(shakes, 12, 400);
      // bonus gems
      for (let i = 0; i < 4; i++) {
        const g2 = poolGet(gems, (): XpGem => ({
          alive: false, wx: 0, wy: 0, kind: "red", amt: 10,
          flyTarget: false, bobPhase: 0, vx: 0, vy: 0,
        }));
        g2.wx = e.wx + (Math.random() - 0.5) * 40;
        g2.wy = e.wy + (Math.random() - 0.5) * 40;
        g2.kind = "red"; g2.amt = 10;
        g2.flyTarget = false;
        g2.bobPhase = Math.random() * Math.PI * 2;
      }
    } else if (e.kind === "elite") {
      addShake(shakes, 5, 150);
    }

    killSfxCounter++;
    if (killSfxCounter % 5 === 0) playSfx("pop");
  }

  function addDamageNumber(wx: number, wy: number, value: number, color: string): void {
    damageNums.push({
      alive: true, wx, wy: wy - 10, vy: -40, value, color,
      life: 500, maxLife: 500,
    });
    // cap
    while (damageNums.length > 60) damageNums.shift();
  }

  // ─── enemy AI update ──────────────────────────────────────────────────────

  function updateEnemies(dt: number): void {
    for (const e of enemies) {
      if (!e.alive) continue;
      e.iframes = Math.max(0, e.iframes - dt);

      const dx = player.wx - e.wx;
      const dy = player.wy - e.wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      e.facing = Math.atan2(dy, dx);

      if (e.kind === "bat") {
        // wobble
        e.wobblePhase += dt / 200;
        const wobble = Math.sin(e.wobblePhase) * 25;
        const perpX = -dy / Math.max(dist, 1);
        const perpY = dx / Math.max(dist, 1);
        e.vx += (dx / Math.max(dist, 1)) * e.speed * (dt / 1000) * 2;
        e.vy += (dy / Math.max(dist, 1)) * e.speed * (dt / 1000) * 2;
        e.vx += perpX * wobble * (dt / 1000);
        e.vy += perpY * wobble * (dt / 1000);
        // dampen
        const vl = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
        if (vl > e.speed) { e.vx = (e.vx / vl) * e.speed; e.vy = (e.vy / vl) * e.speed; }
        e.wx += e.vx * (dt / 1000);
        e.wy += e.vy * (dt / 1000);
      } else if (e.kind === "skeleton") {
        if (dist > 120) {
          e.wx += (dx / Math.max(dist, 1)) * e.speed * (dt / 1000);
          e.wy += (dy / Math.max(dist, 1)) * e.speed * (dt / 1000);
        }
        e.shootCooldown -= dt;
        if (e.shootCooldown <= 0) {
          e.shootCooldown = 1500 + Math.random() * 1000;
          if (dist < 400) {
            const speed = 100;
            const proj = poolGet(projectiles, (): Projectile => ({
              alive: false, wx: 0, wy: 0, vx: 0, vy: 0,
              radius: 5, damage: 0, owner: "enemy",
              trailX: [], trailY: [], life: 0, maxLife: 0,
            }));
            proj.wx = e.wx; proj.wy = e.wy;
            proj.vx = (dx / Math.max(dist, 1)) * speed;
            proj.vy = (dy / Math.max(dist, 1)) * speed;
            proj.radius = 4;
            proj.damage = 10;
            proj.owner = "enemy";
            proj.trailX = []; proj.trailY = [];
            proj.life = proj.maxLife = 4000;
          }
        }
      } else if (e.kind === "boss") {
        if (dist > 50) {
          e.wx += (dx / Math.max(dist, 1)) * e.speed * (dt / 1000);
          e.wy += (dy / Math.max(dist, 1)) * e.speed * (dt / 1000);
        }
        // boss attack pattern
        e.attackTimer -= dt;
        if (e.attackTimer <= 0) {
          e.attackTimer = 2500;
          e.attackPhase = (e.attackPhase + 1) % 3;
          if (e.attackPhase === 0) {
            // melee stomp
            if (dist < 60) {
              hitPlayer(30);
            }
          } else {
            // 3-dir arrows
            for (let dir = -1; dir <= 1; dir++) {
              const aimAngle = e.facing + dir * (Math.PI / 6);
              const speed = 130;
              const proj = poolGet(projectiles, (): Projectile => ({
                alive: false, wx: 0, wy: 0, vx: 0, vy: 0,
                radius: 5, damage: 0, owner: "enemy",
                trailX: [], trailY: [], life: 0, maxLife: 0,
              }));
              proj.wx = e.wx; proj.wy = e.wy;
              proj.vx = Math.cos(aimAngle) * speed;
              proj.vy = Math.sin(aimAngle) * speed;
              proj.radius = 5;
              proj.damage = 18;
              proj.owner = "enemy";
              proj.trailX = []; proj.trailY = [];
              proj.life = proj.maxLife = 5000;
            }
          }
        }
      } else {
        // zombie / elite — chase
        e.wx += (dx / Math.max(dist, 1)) * e.speed * (dt / 1000);
        e.wy += (dy / Math.max(dist, 1)) * e.speed * (dt / 1000);
      }

      // contact melee damage
      if (e.kind !== "skeleton" && e.kind !== "boss") {
        const touchDist = PLAYER_RADIUS + e.radius;
        if (dist < touchDist) {
          e.meleeCooldown -= dt;
          if (e.meleeCooldown <= 0) {
            const dmg = e.kind === "zombie" ? 5 : e.kind === "bat" ? 4 : e.kind === "elite" ? 12 : 5;
            hitPlayer(dmg);
            e.meleeCooldown = 500;
          }
        }
      }
    }
  }

  function hitPlayer(dmg: number): void {
    if (player.iframes > 0) return;
    player.hp -= dmg;
    player.iframes = PLAYER_IFRAMES_MS;
    addShake(shakes, 4, 200);
    addDamageNumber(player.wx, player.wy, dmg, "#ff2266");
    playSfx("error");
    if (hitSfxDebounce <= 0) {
      navigator.vibrate?.(15);
      hitSfxDebounce = 300;
    }
    if (player.hp <= 0) {
      player.hp = 0;
      triggerGameOver();
    }
  }

  // ─── projectile update ────────────────────────────────────────────────────

  function updateProjectiles(dt: number): void {
    for (const p of projectiles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }

      // trail
      p.trailX.push(p.wx); p.trailY.push(p.wy);
      if (p.trailX.length > 5) { p.trailX.shift(); p.trailY.shift(); }

      p.wx += p.vx * (dt / 1000);
      p.wy += p.vy * (dt / 1000);

      if (p.owner === "player") {
        for (const e of enemies) {
          if (!e.alive || e.iframes > 0) continue;
          const dx = p.wx - e.wx;
          const dy = p.wy - e.wy;
          if (dx * dx + dy * dy <= (p.radius + e.radius) * (p.radius + e.radius)) {
            damageEnemy(e, p.damage, { id: "fireball", level: 1, cooldown: 0, swingTimer: 0, swingAngle: 0, swingDir: 1, orbitAngle: 0 });
            spawnParticles(particles, p.wx, p.wy, 6, 255, 120, 30, 120, 300);
            p.alive = false;
            break;
          }
        }
      } else {
        // enemy projectile
        const dx = p.wx - player.wx;
        const dy = p.wy - player.wy;
        if (dx * dx + dy * dy <= (p.radius + PLAYER_RADIUS) * (p.radius + PLAYER_RADIUS)) {
          hitPlayer(p.damage);
          p.alive = false;
        }
      }
    }
  }

  // ─── gem collection ───────────────────────────────────────────────────────

  function updateGems(dt: number): void {
    for (const g of gems) {
      if (!g.alive) continue;
      g.bobPhase += dt / 500;

      const dx = player.wx - g.wx;
      const dy = player.wy - g.wy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < player.pickupRadius || g.flyTarget) {
        g.flyTarget = true;
        const speed = 200;
        g.wx += (dx / Math.max(dist, 1)) * speed * (dt / 1000);
        g.wy += (dy / Math.max(dist, 1)) * speed * (dt / 1000);
        if (dist < PLAYER_RADIUS + 5) {
          g.alive = false;
          const gained = Math.round(g.amt * player.xpGainMult);
          player.xp += gained;
          if (xpSfxDebounce <= 0) {
            playSfx("coin");
            xpSfxDebounce = 80;
          }
          checkLevelUp();
        }
      } else {
        // slow drift
        g.wx += g.vx * (dt / 1000);
        g.wy += g.vy * (dt / 1000);
        g.vx *= 0.98;
        g.vy *= 0.98;
      }
    }
  }

  function checkLevelUp(): void {
    const needed = xpForLevel(player.level);
    if (player.xp >= needed) {
      player.xp -= needed;
      player.level++;
      triggerLevelUp();
    }
  }

  function triggerLevelUp(): void {
    phase = "levelup";
    playSfx("levelup");
    navigator.vibrate?.([30, 60, 30, 60, 100]);

    // build 3 cards
    const pool = buildUpgradeCards(player);
    // shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    pendingCards = pool.slice(0, 3);

    showLevelUpOverlay(pendingCards);
  }

  function showLevelUpOverlay(cards: UpgradeCard[]): void {
    lvlOverlay.style.display = "flex";
    cardsRow.innerHTML = "";
    for (const card of cards) {
      const el = document.createElement("button");
      el.style.cssText = `
        background:linear-gradient(160deg,#1a0030,#0a0018);
        border:1px solid #ff2266;border-radius:8px;
        padding:10px 8px;min-width:90px;max-width:110px;
        color:#fff;font:bold 10px ui-monospace,monospace;
        cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;
        min-height:44px;
      `;
      el.innerHTML = `<span style="font-size:20px">${card.icon}</span>
        <span style="color:#ff2266">${card.title}</span>
        <span style="color:#aaa;font-size:9px;line-height:1.2">${card.desc}</span>`;
      el.addEventListener("click", () => {
        card.apply(player, player.weapons);
        lvlOverlay.style.display = "none";
        phase = "playing";
        updateWeaponHud();
        playSfx("click");
      });
      cardsRow.appendChild(el);
    }
  }

  function updateWeaponHud(): void {
    weaponHud.innerHTML = "";
    for (const ws of player.weapons) {
      const box = document.createElement("div");
      box.style.cssText = `
        width:30px;height:30px;background:#1a003a;border:1px solid #ff2266;
        border-radius:4px;display:flex;flex-direction:column;align-items:center;
        justify-content:center;font:bold 8px ui-monospace,monospace;color:#fff;
      `;
      box.innerHTML = `<span style="font-size:14px">${weaponIcon(ws.id)}</span><span style="color:#ff2266">${ws.level}</span>`;
      weaponHud.appendChild(box);
    }
  }

  // ─── boss spawn ───────────────────────────────────────────────────────────

  function spawnBoss(): void {
    bossNum++;
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.max(cw, ch) * 0.65 + 80;
    const wx = player.wx + Math.cos(angle) * dist;
    const wy = player.wy + Math.sin(angle) * dist;
    const e = poolGet(enemies, (): Enemy => ({
      alive: false, kind: "boss",
      wx: 0, wy: 0, vx: 0, vy: 0,
      hp: 1, maxHp: 1, radius: 28, speed: 25,
      iframes: 0, wobblePhase: 0, shootCooldown: 0, meleeCooldown: 0,
      gemKind: "red", gemAmt: 5, facing: 0,
      attackPhase: 0, attackTimer: 2500,
    }));
    e.alive = true;
    e.kind = "boss";
    e.wx = wx; e.wy = wy;
    e.hp = e.maxHp = 2000 * bossNum;
    e.radius = 28; e.speed = 25;
    e.iframes = 0;
    e.gemKind = "red"; e.gemAmt = 5;
    e.attackPhase = 0; e.attackTimer = 2500;
    e.facing = Math.atan2(player.wy - wy, player.wx - wx);
    playSfx("go");
    navigator.vibrate?.([40, 40, 150]);
    addShake(shakes, 6, 300);
  }

  // ─── game over ────────────────────────────────────────────────────────────

  function triggerGameOver(): void {
    phase = "gameover";
    playSfx("gameover");
    navigator.vibrate?.([80, 80, 200]);

    const score = Math.floor(timeSec * 10 + kills * 1 + bossesKilled * 500);
    void submit(GAME_ID, score);

    goOverlay.innerHTML = "";
    goOverlay.style.display = "flex";

    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:24px;color:#ff2266;text-shadow:0 0 16px #ff2266;";
    titleEl.textContent = "GAME OVER";

    const scoreEl = document.createElement("div");
    scoreEl.style.cssText = "font-size:16px;color:#fff;";
    scoreEl.textContent = `Score: ${score.toLocaleString()}`;

    const statsEl = document.createElement("div");
    statsEl.style.cssText = "font-size:12px;color:#aaa;text-align:center;line-height:1.6;";
    const mm = String(Math.floor(timeSec / 60)).padStart(2, "0");
    const ss = String(Math.floor(timeSec % 60)).padStart(2, "0");
    statsEl.innerHTML = `Time: ${mm}:${ss}<br>Kills: ${kills}<br>Bosses: ${bossesKilled}`;

    const retryBtn = document.createElement("button");
    retryBtn.style.cssText = `
      margin-top:12px;padding:10px 24px;background:#ff2266;border:none;
      border-radius:6px;color:#fff;font:bold 14px ui-monospace,monospace;cursor:pointer;
      min-height:44px;min-width:120px;
    `;
    retryBtn.textContent = "RETRY";
    retryBtn.addEventListener("click", () => {
      goOverlay.style.display = "none";
      restartGame();
    });

    goOverlay.appendChild(titleEl);
    goOverlay.appendChild(scoreEl);
    goOverlay.appendChild(statsEl);
    goOverlay.appendChild(retryBtn);
  }

  function restartGame(): void {
    // reset all pools
    for (const e of enemies) e.alive = false;
    for (const g of gems) g.alive = false;
    for (const p of projectiles) p.alive = false;
    for (const p of particles) p.alive = false;
    damageNums.length = 0;
    lightnings.length = 0;
    shakes.length = 0;

    player = createPlayer();
    phase = "playing";
    timeSec = 0;
    kills = 0;
    bossesKilled = 0;
    spawnTimer = 0;
    bossTimer = 0;
    bossNum = 0;
    lightningFlash = 0;
    keyVx = 0; keyVy = 0;
    pointerDown = false;
    killSfxCounter = 0;
    xpSfxDebounce = 0;
    hitSfxDebounce = 0;

    updateWeaponHud();
  }

  // ─── main update ─────────────────────────────────────────────────────────

  function update(dt: number): void {
    if (phase !== "playing") return;

    timeSec += dt / 1000;
    hintTimer += dt;
    if (!hintDismissed && hintTimer > 5000) dismissHint();

    player.iframes = Math.max(0, player.iframes - dt);
    hitSfxDebounce = Math.max(0, hitSfxDebounce - dt);
    xpSfxDebounce = Math.max(0, xpSfxDebounce - dt);
    lightningFlash = Math.max(0, lightningFlash - dt);

    updatePlayerMovement(dt);

    // spawn
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = spawnRate();
      doSpawn();
    }

    // boss spawn
    if (timeSec >= 180) {
      bossTimer -= dt;
      if (bossTimer <= 0) {
        bossTimer = 120000;
        spawnBoss();
      }
    }

    // weapons
    for (const ws of player.weapons) {
      if (ws.id === "sword" || ws.id === "whip") updateSword(ws, dt);
      else if (ws.id === "aura") updateAura(ws, dt);
      else if (ws.id === "fireball") updateFireball(ws, dt);
      else if (ws.id === "lightning") updateLightning(ws, dt);
      else if (ws.id === "orbit") updateOrbit(ws, dt);
    }

    updateEnemies(dt);
    updateProjectiles(dt);
    updateGems(dt);

    // particles
    for (const p of particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.wx += p.vx * (dt / 1000);
      p.wy += p.vy * (dt / 1000);
      p.vx *= 0.95;
      p.vy *= 0.95;
    }

    // lightnings
    for (const l of lightnings) {
      if (!l.alive) continue;
      l.life -= dt;
      if (l.life <= 0) l.alive = false;
    }

    // damage numbers
    for (const n of damageNums) {
      if (!n.alive) continue;
      n.life -= dt;
      n.wy += n.vy * (dt / 1000);
      if (n.life <= 0) n.alive = false;
    }

    // shake
    for (const s of shakes) {
      if (s.life > 0) s.life = Math.max(0, s.life - dt);
    }

    updateHud();
  }

  function updateHud(): void {
    const mm = String(Math.floor(timeSec / 60)).padStart(2, "0");
    const ss = String(Math.floor(timeSec % 60)).padStart(2, "0");
    timeEl.textContent = `${mm}:${ss}`;
    killsEl.textContent = `☠ ${kills}`;
    levelEl.textContent = `LV ${player.level}`;
    const xpPct = Math.min(1, player.xp / xpForLevel(player.level));
    xpBarInner.style.width = `${Math.round(xpPct * 100)}%`;
  }

  // ─── rendering ────────────────────────────────────────────────────────────

  function worldToScreen(wx: number, wy: number, shakeOff: Vec2): Vec2 {
    return {
      x: cw / 2 + (wx - player.wx) + shakeOff.x,
      y: ch / 2 + (wy - player.wy) + shakeOff.y,
    };
  }

  function inView(sx: number, sy: number, margin: number): boolean {
    return sx > -margin && sx < cw + margin && sy > -margin && sy < ch + margin;
  }

  function render(): void {
    if (!canvasReady) return;
    const ctx = ctx2d;
    ctx.clearRect(0, 0, cw, ch);

    const shake = getShakeOffset(shakes);

    // background tile
    if (bgPattern) {
      ctx.save();
      const offX = ((-player.wx % BG_TILE) + BG_TILE + shake.x) % BG_TILE;
      const offY = ((-player.wy % BG_TILE) + BG_TILE + shake.y) % BG_TILE;
      ctx.translate(offX - BG_TILE, offY - BG_TILE);
      ctx.fillStyle = bgPattern;
      ctx.fillRect(0, 0, cw + BG_TILE * 2, ch + BG_TILE * 2);
      ctx.restore();
    }

    // lightning flash overlay
    if (lightningFlash > 0) {
      ctx.fillStyle = `rgba(220,240,255,${lightningFlash / 100 * 0.15})`;
      ctx.fillRect(0, 0, cw, ch);
    }

    const viewMargin = Math.max(cw, ch) * CAMERA_MARGIN + 60;

    // xp gems
    for (const g of gems) {
      if (!g.alive) continue;
      const s = worldToScreen(g.wx, g.wy + Math.sin(g.bobPhase) * 2, shake);
      if (!inView(s.x, s.y, viewMargin)) continue;
      const col = g.kind === "blue" ? "#44aaff" : g.kind === "green" ? "#44ffaa" : "#ff4444";
      ctx.save();
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 5);
      ctx.lineTo(s.x + 3, s.y);
      ctx.lineTo(s.x, s.y + 5);
      ctx.lineTo(s.x - 3, s.y);
      ctx.closePath();
      ctx.fill();
      // inner bright
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 2);
      ctx.lineTo(s.x + 1, s.y);
      ctx.lineTo(s.x, s.y + 2);
      ctx.lineTo(s.x - 1, s.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // particles
    for (const p of particles) {
      if (!p.alive) continue;
      const s = worldToScreen(p.wx, p.wy, shake);
      if (!inView(s.x, s.y, 30)) continue;
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, p.radius * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // projectiles
    for (const p of projectiles) {
      if (!p.alive) continue;
      const s = worldToScreen(p.wx, p.wy, shake);
      if (!inView(s.x, s.y, viewMargin)) continue;

      if (p.owner === "player") {
        // fireball — red glow
        for (let t = 0; t < p.trailX.length; t++) {
          const ts = worldToScreen(p.trailX[t]!, p.trailY[t]!, shake);
          const alpha = (t + 1) / p.trailX.length * 0.4;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = "#ff6600";
          ctx.beginPath();
          ctx.arc(ts.x, ts.y, p.radius * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ff2200";
        ctx.beginPath();
        ctx.arc(s.x, s.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffaa00";
        ctx.beginPath();
        ctx.arc(s.x, s.y, p.radius * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // enemy arrow
        ctx.fillStyle = "#ccaa44";
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-5, -2, 10, 4);
        ctx.fillStyle = "#ffee88";
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(2, -3);
        ctx.lineTo(2, 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    // lightnings
    for (const l of lightnings) {
      if (!l.alive) continue;
      const s1 = worldToScreen(l.wx1, l.wy1, shake);
      const s2 = worldToScreen(l.wx2, l.wy2, shake);
      const alpha = l.life / 150;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "#aaddff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      // jagged
      const segs = 5;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const mx = s1.x + (s2.x - s1.x) * t + (Math.random() - 0.5) * 12;
        const my = s1.y + (s2.y - s1.y) * t + (Math.random() - 0.5) * 12;
        ctx.lineTo(mx, my);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

    // enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      const s = worldToScreen(e.wx, e.wy, shake);
      if (!inView(s.x, s.y, viewMargin)) continue;
      const flash = e.iframes > 0 && Math.floor(e.iframes / 50) % 2 === 0;

      ctx.save();
      ctx.translate(s.x, s.y);
      drawEnemy(ctx, e, flash);

      // HP bar above (only if damaged)
      if (e.hp < e.maxHp) {
        const bw = e.radius * 2 + 4;
        const bh = 3;
        const by = -e.radius - 6;
        ctx.fillStyle = "#440000";
        ctx.fillRect(-bw / 2, by, bw, bh);
        ctx.fillStyle = e.kind === "boss" ? "#ff4400" : "#ff2266";
        ctx.fillRect(-bw / 2, by, bw * (e.hp / e.maxHp), bh);
      }
      ctx.restore();
    }

    // weapon effects
    for (const ws of player.weapons) {
      drawWeaponEffect(ctx, ws, shake);
    }

    // player
    {
      const s = worldToScreen(player.wx, player.wy, shake);
      ctx.save();
      ctx.translate(s.x, s.y);
      drawPlayer(ctx);
      ctx.restore();

      // player HP bar above player
      const hpPct = player.hp / player.maxHp;
      const bw = PLAYER_RADIUS * 2 + 8;
      ctx.fillStyle = "#440000";
      ctx.fillRect(s.x - bw / 2, s.y - PLAYER_RADIUS - 10, bw, 4);
      ctx.fillStyle = hpPct > 0.5 ? "#44ff44" : hpPct > 0.25 ? "#ffaa00" : "#ff2222";
      ctx.fillRect(s.x - bw / 2, s.y - PLAYER_RADIUS - 10, bw * hpPct, 4);
    }

    // damage numbers
    for (const n of damageNums) {
      if (!n.alive) continue;
      const s = worldToScreen(n.wx, n.wy, shake);
      const alpha = n.life / n.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = n.color;
      ctx.font = "bold 11px ui-monospace,monospace";
      ctx.textAlign = "center";
      ctx.fillText(`-${n.value}`, s.x, s.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  function drawPlayer(ctx: CanvasRenderingContext2D): void {
    const iframeFlash = player.iframes > 0 && Math.floor(player.iframes / 60) % 2 === 0;
    if (iframeFlash) { ctx.globalAlpha = 0.4; }

    // outer glow ring
    ctx.strokeStyle = "#4488ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS + 3, 0, Math.PI * 2);
    ctx.stroke();

    // body
    ctx.fillStyle = "#2255cc";
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // inner lighter
    ctx.fillStyle = "#5588ff";
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // direction dot
    const facingX = Math.cos(player.facing) * (PLAYER_RADIUS - 4);
    const facingY = Math.sin(player.facing) * (PLAYER_RADIUS - 4);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(facingX, facingY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, flash: boolean): void {
    if (flash) ctx.globalAlpha = 0.4;
    const r = e.radius;

    switch (e.kind) {
      case "zombie": {
        // body
        ctx.fillStyle = "#44aa44";
        ctx.fillRect(-7, -8, 14, 14);
        // head
        ctx.fillStyle = "#55bb55";
        ctx.fillRect(-5, -16, 10, 10);
        // red eyes
        ctx.fillStyle = "#ff2200";
        ctx.fillRect(-4, -13, 3, 2);
        ctx.fillRect(1, -13, 3, 2);
        // arms
        ctx.fillStyle = "#44aa44";
        ctx.fillRect(-10, -5, 4, 7);
        ctx.fillRect(6, -5, 4, 7);
        // legs
        ctx.fillStyle = "#336633";
        ctx.fillRect(-6, 6, 4, 6);
        ctx.fillRect(2, 6, 4, 6);
        break;
      }
      case "bat": {
        const wingSpread = r + 5;
        ctx.fillStyle = "#220033";
        ctx.beginPath();
        // body
        ctx.ellipse(0, 0, r, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        // wings
        ctx.fillStyle = "#440044";
        ctx.beginPath();
        ctx.moveTo(-r * 0.4, -1);
        ctx.quadraticCurveTo(-wingSpread, -r, -wingSpread - 2, 0);
        ctx.quadraticCurveTo(-wingSpread, 1, -r * 0.4, 1);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(r * 0.4, -1);
        ctx.quadraticCurveTo(wingSpread, -r, wingSpread + 2, 0);
        ctx.quadraticCurveTo(wingSpread, 1, r * 0.4, 1);
        ctx.closePath();
        ctx.fill();
        // eyes
        ctx.fillStyle = "#ff6600";
        ctx.fillRect(-3, -2, 2, 2);
        ctx.fillRect(1, -2, 2, 2);
        break;
      }
      case "skeleton": {
        // head
        ctx.fillStyle = "#eeeebb";
        ctx.fillRect(-4, -16, 9, 9);
        // eye holes
        ctx.fillStyle = "#000";
        ctx.fillRect(-3, -14, 2, 3);
        ctx.fillRect(2, -14, 2, 3);
        // teeth
        ctx.fillStyle = "#ccccaa";
        ctx.fillRect(-3, -8, 2, 2);
        ctx.fillRect(-1, -8, 2, 2);
        ctx.fillRect(1, -8, 2, 2);
        // spine/body
        ctx.fillStyle = "#ddddaa";
        ctx.fillRect(-2, -7, 4, 10);
        // ribs
        ctx.fillStyle = "#ccccaa";
        ctx.fillRect(-6, -5, 12, 2);
        ctx.fillRect(-5, -2, 10, 2);
        // arm extended holding bow
        ctx.fillStyle = "#ddddaa";
        ctx.fillRect(4, -8, 4, 7);
        // legs
        ctx.fillRect(-4, 3, 2, 8);
        ctx.fillRect(2, 3, 2, 8);
        break;
      }
      case "elite": {
        // bigger gold body
        ctx.fillStyle = "#886600";
        ctx.fillRect(-r, -r + 4, r * 2, r * 2 - 4);
        // shield front
        ctx.fillStyle = "#ccaa00";
        ctx.fillRect(-r - 4, -r + 2, 7, r * 2 - 4);
        // head
        ctx.fillStyle = "#aaa44a";
        ctx.fillRect(-r + 2, -r - 8, r * 2 - 4, 10);
        // visor
        ctx.fillStyle = "#ff8800";
        ctx.fillRect(-r + 4, -r - 5, r * 2 - 8, 3);
        break;
      }
      case "boss": {
        // large dark body
        ctx.fillStyle = "#330044";
        ctx.fillRect(-r, -r + 6, r * 2, r * 2 - 6);
        // armored chest
        ctx.fillStyle = "#550066";
        ctx.fillRect(-r + 4, -r + 8, r * 2 - 8, r - 4);
        // head
        ctx.fillStyle = "#220033";
        ctx.fillRect(-r + 6, -r - 4, r * 2 - 12, 14);
        // crown spikes
        ctx.fillStyle = "#ff00aa";
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 6, -r - 4);
          ctx.lineTo(i * 6 - 3, -r - 12);
          ctx.lineTo(i * 6 + 3, -r - 12);
          ctx.closePath();
          ctx.fill();
        }
        // glowing eyes
        ctx.fillStyle = "#ff0000";
        ctx.fillRect(-r + 10, -r + 2, 5, 4);
        ctx.fillRect(-r + 18, -r + 2, 5, 4);
        // HP% indicator
        const hpPct = e.hp / e.maxHp;
        ctx.fillStyle = "#000";
        ctx.fillRect(-r, -r - 20, r * 2, 5);
        ctx.fillStyle = "#ff0044";
        ctx.fillRect(-r, -r - 20, r * 2 * hpPct, 5);
        break;
      }
    }

    ctx.globalAlpha = 1;
  }

  function drawWeaponEffect(ctx: CanvasRenderingContext2D, ws: WeaponState, shake: Vec2): void {
    const ps = worldToScreen(player.wx, player.wy, shake);

    switch (ws.id) {
      case "sword":
      case "whip": {
        if (ws.swingTimer <= 0) break;
        const arcHalf = (Math.PI / 4) * (ws.id === "whip" ? 1.6 : 1.0);
        const range = 60 * (ws.id === "whip" ? 1.0 : 0.9) * weaponArea(ws);
        ctx.save();
        ctx.translate(ps.x, ps.y);
        const alpha = ws.swingTimer / 200;
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = ws.id === "whip" ? "#ff8844" : "#aaddff";
        ctx.lineWidth = ws.id === "whip" ? 4 : 3;
        ctx.beginPath();
        ctx.arc(0, 0, range, ws.swingAngle - arcHalf, ws.swingAngle + arcHalf);
        ctx.stroke();
        ctx.fillStyle = ws.id === "whip" ? "rgba(255,136,68,0.15)" : "rgba(170,221,255,0.15)";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, range, ws.swingAngle - arcHalf, ws.swingAngle + arcHalf);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case "aura": {
        ctx.save();
        ctx.translate(ps.x, ps.y);
        const radius = weaponArea(ws);
        const pulse = 0.8 + Math.sin(Date.now() / 300) * 0.2;
        ctx.globalAlpha = 0.12 * pulse;
        ctx.fillStyle = "#cc44ff";
        ctx.beginPath();
        ctx.arc(0, 0, radius * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.4 * pulse;
        ctx.strokeStyle = "#cc44ff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, radius * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "orbit": {
        const radius = weaponArea(ws);
        for (let blade = 0; blade < 2; blade++) {
          const angle = ws.orbitAngle + blade * Math.PI;
          const bx = ps.x + Math.cos(angle) * radius;
          const by = ps.y + Math.sin(angle) * radius;
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(angle);
          ctx.fillStyle = "#ccddff";
          ctx.beginPath();
          ctx.moveTo(0, -5);
          ctx.lineTo(4, 5);
          ctx.lineTo(-4, 5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        break;
      }
      default: break;
    }
    ctx.globalAlpha = 1;
  }

  // ─── loop ─────────────────────────────────────────────────────────────────

  let rafId = 0;
  let lastTime = 0;

  function loop(now: number): void {
    rafId = requestAnimationFrame(loop);
    const dt = Math.min(now - lastTime, DT_CAP);
    lastTime = now;
    if (dt <= 0) return;
    update(dt);
    if (canvasReady) render();
  }

  updateWeaponHud();
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);

  // ─── cleanup ──────────────────────────────────────────────────────────────

  return () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    container.classList.remove("swarm-root");
    container.style.touchAction = "";
    if (root.parentNode) root.parentNode.removeChild(root);
  };
}
