// Drop Stack — Suika-like orb-merge physics puzzle.
// Drop colorful orbs into a jar. Two same-type orbs that touch merge
// into the next tier. Score is sum of every merge (bigger = more).
// Game over when an orb rests over the danger line for >2s.
//
// Mobile-first, drag pointer X to aim, tap/release to drop.
// Matter.js handles physics. Canvas 2D renders on top.

import Matter from "matter-js";
import { submit } from "../../lib/leaderboard.js";
import { playSfx } from "../../lib/audio.js";

const GAME_ID = "drop-stack";
const DESIGN_W = 360;
const DESIGN_H = 640;

// ─── tiers ────────────────────────────────────────────────────────────────────
// 11 tiers. Radius + color + score-to-merge-into. Inspired by arcade
// classics but visuals are abstract orbs (not fruits) for originality.
interface Tier {
  radius: number;
  color: string;       // gradient inner
  shade: string;       // gradient rim
  accent: string;      // face / highlight dot
  score: number;       // score awarded when a pair of tier-1 merges → tier-2
}
const TIERS: Tier[] = [
  // 0 cherry-like
  { radius: 13, color: "#ff5177", shade: "#a8123b", accent: "#ffccdc", score: 1  },
  // 1 berry
  { radius: 17, color: "#ff8aa1", shade: "#b04560", accent: "#ffd5df", score: 3  },
  // 2 grape
  { radius: 22, color: "#a266ff", shade: "#5a20b8", accent: "#e0c8ff", score: 6  },
  // 3 lime
  { radius: 28, color: "#6ddc5a", shade: "#2a7a1a", accent: "#d7ffce", score: 10 },
  // 4 tangerine
  { radius: 35, color: "#ff9f3a", shade: "#b35c00", accent: "#ffdaa8", score: 15 },
  // 5 apple
  { radius: 44, color: "#ff4444", shade: "#8b1010", accent: "#ffc4c4", score: 21 },
  // 6 pear
  { radius: 54, color: "#e7e23a", shade: "#a89918", accent: "#fff7a6", score: 28 },
  // 7 peach
  { radius: 66, color: "#ffb59a", shade: "#c96a43", accent: "#fff0e6", score: 36 },
  // 8 pineapple
  { radius: 80, color: "#ffe066", shade: "#a07c00", accent: "#fff7bf", score: 45 },
  // 9 melon
  { radius: 96, color: "#7ed957", shade: "#2f6a1d", accent: "#d5ffbe", score: 55 },
  // 10 watermelon (top)
  { radius: 116, color: "#3cb371", shade: "#18522e", accent: "#bfe8cc", score: 120 },
];

// Tier above which "top score" celebration fires
const MAX_TIER = TIERS.length - 1;

// Preview queue size
const QUEUE_SIZE = 2;

// Walls / world dims (in design coords; rendered scaled into canvas)
const WALL_THICK = 18;
const JAR_TOP = 104;      // danger line y
const JAR_BOTTOM = DESIGN_H - 30;
const JAR_LEFT = 24;
const JAR_RIGHT = DESIGN_W - 24;
const DROP_Y = 60;        // where the held orb hovers before drop
const DANGER_HOLD_MS = 2500;

// ─── internal types ───────────────────────────────────────────────────────────
interface OrbData {
  tier: number;
  id: number;
  spawnedAt: number;
  merging?: boolean;
}

export function mount(container: HTMLElement): () => void {
  container.classList.add("dropstack-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // ─── DOM ────────────────────────────────────────────────────────────────────
  const wrap = document.createElement("div");
  wrap.className = "dropstack-wrap";
  container.appendChild(wrap);

  // HUD top
  const hud = document.createElement("div");
  hud.className = "dropstack-hud";
  hud.innerHTML = `
    <div class="dropstack-hud-left">
      <div class="dropstack-score" id="ds-score">0</div>
      <div class="dropstack-best" id="ds-best">BEST 0</div>
    </div>
    <div class="dropstack-hud-right">
      <div class="dropstack-next" id="ds-next-label">NEXT</div>
      <canvas id="ds-next" width="48" height="48"></canvas>
    </div>
  `;
  wrap.appendChild(hud);

  // main canvas
  const canvas = document.createElement("canvas");
  canvas.className = "dropstack-canvas";
  wrap.appendChild(canvas);

  // game over overlay
  const over = document.createElement("div");
  over.className = "dropstack-over";
  over.style.display = "none";
  over.innerHTML = `
    <div class="dropstack-over-card">
      <div class="dropstack-over-title">GAME OVER</div>
      <div class="dropstack-over-score-label">SCORE</div>
      <div class="dropstack-over-score" id="ds-over-score">0</div>
      <button class="dropstack-over-btn" id="ds-again">PLAY AGAIN</button>
    </div>
  `;
  wrap.appendChild(over);

  // onboarding hint
  const hintKey = "drop-stack:seenHint";
  let seenHint = false;
  try { seenHint = !!localStorage.getItem(hintKey); } catch { /* ok */ }
  let hintEl: HTMLElement | null = null;
  if (!seenHint) {
    try { localStorage.setItem(hintKey, "1"); } catch { /* ok */ }
    hintEl = document.createElement("div");
    hintEl.className = "dropstack-hint";
    hintEl.innerHTML = `
      <div class="dropstack-hint-box">
        <div>TRASCINA PER MIRARE</div>
        <div class="sub">RILASCIA PER LASCIARE CADERE · MATCH 2 = FUSIONE</div>
      </div>
    `;
    wrap.appendChild(hintEl);
    setTimeout(() => hintEl?.remove(), 5000);
  }

  // ─── styles ─────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    .dropstack-root { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .dropstack-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, #0a1026 0%, #050713 100%);
      position: relative;
      overflow: hidden;
      min-height: 0;
    }
    .dropstack-hud {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      font-family: monospace;
      color: #fff;
      flex-shrink: 0;
    }
    .dropstack-hud-left { display: flex; flex-direction: column; }
    .dropstack-score { font-size: 26px; font-weight: bold; color: #ffcc33; text-shadow: 0 2px 6px rgba(255,204,51,0.4); }
    .dropstack-best { font-size: 10px; color: #8899bb; letter-spacing: 1px; }
    .dropstack-hud-right { display: flex; align-items: center; gap: 6px; }
    .dropstack-next { font-size: 9px; color: #8899bb; letter-spacing: 2px; }
    .dropstack-hud-right canvas { background: rgba(255,255,255,0.04); border-radius: 24px; }
    .dropstack-canvas {
      flex: 1;
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
    .dropstack-over {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.68);
      backdrop-filter: blur(4px);
    }
    .dropstack-over-card {
      background: #0a1026;
      padding: 20px 30px;
      border-radius: 14px;
      border: 2px solid #ff4466;
      text-align: center;
      color: #fff;
      font-family: monospace;
      min-width: 220px;
    }
    .dropstack-over-title { color: #ff4466; font-size: 22px; font-weight: bold; margin-bottom: 12px; }
    .dropstack-over-score-label { font-size: 10px; color: #8899bb; letter-spacing: 2px; }
    .dropstack-over-score { font-size: 36px; font-weight: bold; color: #ffcc33; margin: 4px 0 18px; }
    .dropstack-over-btn {
      background: #ff4466;
      color: #fff;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: monospace;
      font-weight: bold;
      font-size: 13px;
      cursor: pointer;
      min-width: 140px;
    }
    .dropstack-over-btn:active { transform: scale(0.96); }
    .dropstack-hint {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; z-index: 50;
    }
    .dropstack-hint-box {
      background: rgba(0,0,0,0.7);
      padding: 12px 20px;
      border-radius: 8px;
      color: #fff;
      font-family: monospace;
      font-size: 13px;
      font-weight: bold;
      text-align: center;
    }
    .dropstack-hint-box .sub {
      font-size: 9px;
      color: #aabbcc;
      margin-top: 4px;
      font-weight: normal;
    }
    .dropstack-popup {
      position: absolute;
      color: #ffee55;
      font-family: monospace;
      font-weight: bold;
      font-size: 16px;
      text-shadow: 0 0 8px rgba(255,204,51,0.8);
      pointer-events: none;
      z-index: 40;
      transition: transform 0.8s ease-out, opacity 0.8s ease-out;
    }
  `;
  wrap.appendChild(style);

  // ─── refs ───────────────────────────────────────────────────────────────────
  const scoreEl = hud.querySelector("#ds-score") as HTMLElement;
  const bestEl  = hud.querySelector("#ds-best")  as HTMLElement;
  const nextCanvas = hud.querySelector("#ds-next") as HTMLCanvasElement;
  const overEl = over;
  const overScoreEl = over.querySelector("#ds-over-score") as HTMLElement;
  const againBtn = over.querySelector("#ds-again") as HTMLButtonElement;
  const ctx = canvas.getContext("2d")!;
  const nextCtx = nextCanvas.getContext("2d")!;

  // ─── state ──────────────────────────────────────────────────────────────────
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  // juice state
  interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
  const particles: Particle[] = [];
  let shakeStrength = 0;
  let shakeTimer = 0;
  let flashAlpha = 0;
  let flashColor: [number, number, number] = [255, 255, 255];
  // combo
  let comboCount = 0;
  let comboTimer = 0;
  const COMBO_WINDOW = 900;

  // Matter world
  const engine = Matter.Engine.create();
  engine.gravity.y = 1.2;
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  const world = engine.world;

  // walls
  const wallLeft   = Matter.Bodies.rectangle(JAR_LEFT - WALL_THICK / 2, (JAR_TOP + JAR_BOTTOM) / 2, WALL_THICK, JAR_BOTTOM - JAR_TOP + 20, { isStatic: true });
  const wallRight  = Matter.Bodies.rectangle(JAR_RIGHT + WALL_THICK / 2, (JAR_TOP + JAR_BOTTOM) / 2, WALL_THICK, JAR_BOTTOM - JAR_TOP + 20, { isStatic: true });
  const wallBottom = Matter.Bodies.rectangle((JAR_LEFT + JAR_RIGHT) / 2, JAR_BOTTOM + WALL_THICK / 2, JAR_RIGHT - JAR_LEFT + WALL_THICK * 2, WALL_THICK, { isStatic: true });
  Matter.World.add(world, [wallLeft, wallRight, wallBottom]);

  // orbs
  const orbs = new Map<number, { body: Matter.Body; data: OrbData }>();
  let nextOrbId = 1;
  const queue: number[] = []; // tiers (0..4 for drops)
  let holdTier = 0;
  let holdX = DESIGN_W / 2;
  let canDrop = true;
  let score = 0;
  let best = 0;
  let dead = false;
  let dangerOrbId: number | null = null;
  let dangerStartMs = 0;
  let lastTime = performance.now();

  // load best
  try {
    const raw = localStorage.getItem("drop-stack:best");
    if (raw) best = parseInt(raw, 10) || 0;
  } catch { /* ok */ }
  bestEl.textContent = `BEST ${best}`;

  // seed queue
  function randomDropTier(): number {
    // Drop tiers 0-4 only, weighted toward smaller
    const r = Math.random();
    if (r < 0.42) return 0;
    if (r < 0.72) return 1;
    if (r < 0.90) return 2;
    if (r < 0.98) return 3;
    return 4;
  }
  for (let i = 0; i < QUEUE_SIZE; i++) queue.push(randomDropTier());
  holdTier = queue.shift()!;
  queue.push(randomDropTier());

  // ─── helpers ────────────────────────────────────────────────────────────────
  function addOrb(x: number, y: number, tier: number, velocity: { x: number; y: number } = { x: 0, y: 0 }): number {
    const t = TIERS[tier]!;
    const id = nextOrbId++;
    const body = Matter.Bodies.circle(x, y, t.radius, {
      restitution: 0.18,
      friction: 0.05,
      frictionStatic: 0.4,
      density: 0.0015 + tier * 0.0002,
      label: `orb-${id}`,
      slop: 0.04,
    });
    Matter.Body.setVelocity(body, velocity);
    Matter.World.add(world, body);
    orbs.set(id, { body, data: { tier, id, spawnedAt: performance.now() } });
    return id;
  }

  function removeOrb(id: number): void {
    const o = orbs.get(id);
    if (!o) return;
    Matter.World.remove(world, o.body);
    orbs.delete(id);
  }

  function mergePair(a: { body: Matter.Body; data: OrbData }, b: { body: Matter.Body; data: OrbData }): void {
    if (a.data.merging || b.data.merging) return;
    if (a.data.tier !== b.data.tier) return;
    a.data.merging = true;
    b.data.merging = true;
    const tier = a.data.tier;
    const basePts = TIERS[tier]!.score;

    // combo: if a merge happens within COMBO_WINDOW, count it
    const now = performance.now();
    if (now - comboTimer < COMBO_WINDOW) comboCount++;
    else comboCount = 1;
    comboTimer = now;
    const comboMult = comboCount >= 5 ? 3 : comboCount >= 3 ? 2 : comboCount >= 2 ? 1.5 : 1;
    const pts = Math.round(basePts * comboMult);
    score += pts;
    scoreEl.textContent = String(score);

    // fusion position midway
    const mx = (a.body.position.x + b.body.position.x) / 2;
    const my = (a.body.position.y + b.body.position.y) / 2;
    const vx = (a.body.velocity.x + b.body.velocity.x) / 2;
    const vy = (a.body.velocity.y + b.body.velocity.y) / 2;

    // particle burst tier-colored
    spawnMergeParticles(mx, my, tier);
    // camera shake proportional to tier
    addShake(2 + tier * 0.8, 180 + tier * 20);

    removeOrb(a.data.id);
    removeOrb(b.data.id);

    // score popup — combo-aware text/color
    const popupText = comboMult > 1 ? `+${pts} x${comboMult}` : `+${pts}`;
    showPopup(mx, my, popupText, comboMult > 1 ? "#ff66ff" : "#ffee55");

    if (tier < MAX_TIER) {
      addOrb(mx, my, tier + 1, { x: vx * 0.5, y: vy * 0.5 });
      playSfx(tier >= 6 ? "levelup" : "pop");
      if (navigator.vibrate) navigator.vibrate(8 + tier);
    } else {
      // top tier pair → spectacular celebration
      playSfx("fanfare");
      if (navigator.vibrate) navigator.vibrate([60, 40, 120, 40, 200]);
      score += 500;
      scoreEl.textContent = String(score);
      flashAlpha = 1;
      flashColor = [120, 255, 180];
      addShake(14, 500);
      // burst of confetti from center
      for (let i = 0; i < 80; i++) {
        spawnMergeParticles(mx + (Math.random() - 0.5) * 40, my + (Math.random() - 0.5) * 40, MAX_TIER);
      }
    }

    if (score > best) {
      best = score;
      bestEl.textContent = `BEST ${best}`;
      try { localStorage.setItem("drop-stack:best", String(best)); } catch { /* ok */ }
    }
  }

  function spawnMergeParticles(x: number, y: number, tier: number): void {
    const t = TIERS[tier]!;
    const count = 8 + tier * 2;
    const speedBase = 80 + tier * 12;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = speedBase * (0.5 + Math.random());
      const color = i % 3 === 0 ? t.accent : i % 3 === 1 ? t.color : "#ffffff";
      particles.push({
        x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 30,
        life: 0,
        maxLife: 400 + Math.random() * 400,
        color,
        size: 2 + Math.random() * 3,
      });
    }
    // center flash particle
    particles.push({
      x, y, vx: 0, vy: 0,
      life: 0, maxLife: 220,
      color: t.accent, size: t.radius * 0.8,
    });
  }

  function addShake(strength: number, duration: number): void {
    if (strength > shakeStrength) shakeStrength = strength;
    if (duration > shakeTimer) shakeTimer = duration;
  }

  function showPopup(designX: number, designY: number, text: string, color?: string): void {
    const p = document.createElement("div");
    p.className = "dropstack-popup";
    p.textContent = text;
    if (color) p.style.color = color;
    wrap.appendChild(p);
    const cssX = offsetX + designX * scale;
    const cssY = offsetY + designY * scale;
    p.style.left = `${cssX - 20}px`;
    p.style.top  = `${cssY}px`;
    requestAnimationFrame(() => {
      p.style.transform = "translateY(-38px)";
      p.style.opacity = "0";
    });
    setTimeout(() => p.remove(), 900);
  }

  // collision merge detection
  Matter.Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const aId = parseLabel(pair.bodyA.label);
      const bId = parseLabel(pair.bodyB.label);
      if (aId == null || bId == null) continue;
      const a = orbs.get(aId);
      const b = orbs.get(bId);
      if (!a || !b) continue;
      if (a.data.tier === b.data.tier && !a.data.merging && !b.data.merging) {
        mergePair(a, b);
      }
    }
  });

  function parseLabel(label: string): number | null {
    if (!label.startsWith("orb-")) return null;
    const n = parseInt(label.slice(4), 10);
    return Number.isFinite(n) ? n : null;
  }

  // ─── input ──────────────────────────────────────────────────────────────────
  function pointerToDesignX(px: number, py: number): number {
    const rect = canvas.getBoundingClientRect();
    void py;
    const cssX = px - rect.left;
    const x = (cssX - offsetX) / scale;
    return x;
  }

  function onPointerMove(e: PointerEvent): void {
    if (dead) return;
    const x = pointerToDesignX(e.clientX, e.clientY);
    const r = TIERS[holdTier]!.radius;
    holdX = Math.max(JAR_LEFT + r + 2, Math.min(JAR_RIGHT - r - 2, x));
  }
  function onPointerUp(e: PointerEvent): void {
    if (dead) return;
    if (!canDrop) return;
    const x = pointerToDesignX(e.clientX, e.clientY);
    const r = TIERS[holdTier]!.radius;
    holdX = Math.max(JAR_LEFT + r + 2, Math.min(JAR_RIGHT - r - 2, x));
    drop();
  }
  function drop(): void {
    canDrop = false;
    addOrb(holdX, DROP_Y + TIERS[holdTier]!.radius, holdTier);
    playSfx("tap");
    holdTier = queue.shift()!;
    queue.push(randomDropTier());
    renderNext();
    setTimeout(() => { canDrop = true; }, 420);
  }

  canvas.addEventListener("pointerdown", onPointerMove);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", (e) => { onPointerUp(e); });

  againBtn.addEventListener("click", () => { reset(); });
  againBtn.addEventListener("pointerdown", () => { reset(); });

  // ─── resize ─────────────────────────────────────────────────────────────────
  function resize(): void {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw < 8 || ch < 8) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width  = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    // FIT design into canvas (preserve aspect)
    const sx = cw / DESIGN_W;
    const sy = ch / DESIGN_H;
    scale = Math.min(sx, sy);
    offsetX = (cw - DESIGN_W * scale) / 2;
    offsetY = (ch - DESIGN_H * scale) / 2;
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

  // ─── render ─────────────────────────────────────────────────────────────────
  function drawOrb(x: number, y: number, tier: number, angle = 0): void {
    const t = TIERS[tier]!;
    const r = t.radius;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // shadow under
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.9, r * 0.85, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // body with radial gradient
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, t.accent);
    g.addColorStop(0.45, t.color);
    g.addColorStop(1, t.shade);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // outline
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.strokeStyle = t.shade;
    ctx.stroke();
    // specular highlight
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.28, r * 0.18, -0.5, 0, Math.PI * 2);
    ctx.fill();
    // cute face dots (scale with tier — biggest are watermelon-like with stripes)
    if (tier >= 8) {
      // stripes (melon/watermelon)
      ctx.strokeStyle = t.shade;
      ctx.lineWidth = r * 0.08;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.86, Math.PI * 0.5 + i * 0.25, Math.PI * 0.5 + i * 0.25 + 0.2);
        ctx.stroke();
      }
    }
    // tier dot marker
    ctx.fillStyle = t.accent;
    ctx.beginPath();
    ctx.arc(0, r * 0.35, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawJar(): void {
    // jar walls and rim
    const w = JAR_RIGHT - JAR_LEFT;
    const h = JAR_BOTTOM - JAR_TOP;
    // glass back
    ctx.fillStyle = "rgba(120,160,255,0.05)";
    ctx.fillRect(JAR_LEFT, JAR_TOP, w, h);
    // walls
    ctx.strokeStyle = "#1a2340";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(JAR_LEFT, JAR_TOP);
    ctx.lineTo(JAR_LEFT, JAR_BOTTOM);
    ctx.lineTo(JAR_RIGHT, JAR_BOTTOM);
    ctx.lineTo(JAR_RIGHT, JAR_TOP);
    ctx.stroke();
    // rim tops
    ctx.fillStyle = "#2b3866";
    ctx.fillRect(JAR_LEFT - 4, JAR_TOP - 4, 8, 8);
    ctx.fillRect(JAR_RIGHT - 4, JAR_TOP - 4, 8, 8);
    // danger line
    const danger = dangerOrbId != null ? "#ff3344" : "#5060a0";
    ctx.strokeStyle = danger;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(JAR_LEFT, JAR_TOP);
    ctx.lineTo(JAR_RIGHT, JAR_TOP);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawHeld(now: number): void {
    if (dead) return;
    const r = TIERS[holdTier]!.radius;
    // aim guide
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(holdX, DROP_Y + r);
    ctx.lineTo(holdX, JAR_BOTTOM - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    // hover pulse ring
    const pulse = 1 + Math.sin(now / 260) * 0.08;
    ctx.save();
    ctx.strokeStyle = TIERS[holdTier]!.accent;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(holdX, DROP_Y, r * 1.2 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // orb
    drawOrb(holdX, DROP_Y, holdTier);
  }

  function renderNext(): void {
    const nc = nextCtx;
    const w = nextCanvas.width;
    const h = nextCanvas.height;
    nc.clearRect(0, 0, w, h);
    const nextTier = queue[0]!;
    const t = TIERS[nextTier]!;
    // scale down to fit
    const maxR = Math.min(w, h) / 2 - 4;
    const r = Math.min(t.radius, maxR);
    nc.save();
    nc.translate(w / 2, h / 2);
    const g = nc.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, t.accent);
    g.addColorStop(0.45, t.color);
    g.addColorStop(1, t.shade);
    nc.fillStyle = g;
    nc.beginPath();
    nc.arc(0, 0, r, 0, Math.PI * 2);
    nc.fill();
    nc.fillStyle = "rgba(255,255,255,0.45)";
    nc.beginPath();
    nc.ellipse(-r * 0.35, -r * 0.4, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2);
    nc.fill();
    nc.restore();
  }
  renderNext();

  // ─── loop ───────────────────────────────────────────────────────────────────
  function loop(now: number): void {
    if (destroyed) return;
    const dt = Math.min(50, now - lastTime);
    lastTime = now;
    if (!dead) Matter.Engine.update(engine, dt);

    // update juice
    if (shakeTimer > 0) {
      shakeTimer -= dt;
      if (shakeTimer <= 0) { shakeStrength = 0; }
    }
    if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt / 500);
    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.life += dt;
      if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      p.vy += 260 * dt / 1000; // gravity on sparks
      p.vx *= 0.985;
    }
    // combo decay
    if (comboCount > 0 && now - comboTimer > COMBO_WINDOW) comboCount = 0;

    // render
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#050713";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // shake offset in design units
    const shakeX = shakeTimer > 0 ? (Math.random() - 0.5) * 2 * shakeStrength : 0;
    const shakeY = shakeTimer > 0 ? (Math.random() - 0.5) * 2 * shakeStrength : 0;

    // scale transform: DPR * design-fit + shake
    ctx.setTransform(
      dpr * scale, 0, 0,
      dpr * scale,
      dpr * (offsetX + shakeX * scale),
      dpr * (offsetY + shakeY * scale)
    );

    drawJar();

    orbs.forEach((o) => {
      drawOrb(o.body.position.x, o.body.position.y, o.data.tier, o.body.angle);
    });

    drawHeld(now);
    drawParticles();

    // flash overlay (screen-wide additive wash)
    if (flashAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = flashAlpha * 0.6;
      ctx.fillStyle = `rgb(${flashColor[0]},${flashColor[1]},${flashColor[2]})`;
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      ctx.restore();
    }

    // combo badge in HUD area (bottom of jar)
    if (comboCount >= 2) {
      const fade = Math.max(0, 1 - (now - comboTimer) / COMBO_WINDOW);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.font = "bold 22px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff66ff";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      const txt = `COMBO x${comboCount}`;
      ctx.strokeText(txt, DESIGN_W / 2, JAR_BOTTOM + 18);
      ctx.fillText(txt, DESIGN_W / 2, JAR_BOTTOM + 18);
      ctx.restore();
    }

    checkDanger(now);

    rafId = requestAnimationFrame(loop);
  }

  function drawParticles(): void {
    for (const p of particles) {
      const t = p.life / p.maxLife;
      const alpha = 1 - t;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function checkDanger(now: number): void {
    if (dead) return;
    let violator: number | null = null;
    orbs.forEach((o) => {
      const body = o.body;
      const t = TIERS[o.data.tier]!;
      const top = body.position.y - t.radius;
      const vy = Math.abs(body.velocity.y);
      const vx = Math.abs(body.velocity.x);
      const settled = vy < 0.5 && vx < 0.5;
      // age > 0.6s so freshly dropped orbs above the line don't insta-trigger
      const age = now - o.data.spawnedAt;
      if (top < JAR_TOP && settled && age > 600) {
        violator = o.data.id;
      }
    });
    if (violator != null) {
      if (dangerOrbId !== violator) {
        dangerOrbId = violator;
        dangerStartMs = now;
      } else if (now - dangerStartMs > DANGER_HOLD_MS) {
        triggerGameOver();
      }
    } else {
      dangerOrbId = null;
    }
  }

  function triggerGameOver(): void {
    if (dead) return;
    dead = true;
    playSfx("gameover");
    if (navigator.vibrate) navigator.vibrate([80, 60, 120]);
    overScoreEl.textContent = String(score);
    overEl.style.display = "flex";
    void submit(GAME_ID, score);
  }

  function reset(): void {
    // clear orbs
    orbs.forEach((o) => Matter.World.remove(world, o.body));
    orbs.clear();
    nextOrbId = 1;
    queue.length = 0;
    for (let i = 0; i < QUEUE_SIZE; i++) queue.push(randomDropTier());
    holdTier = queue.shift()!;
    queue.push(randomDropTier());
    score = 0;
    scoreEl.textContent = "0";
    dead = false;
    canDrop = true;
    dangerOrbId = null;
    overEl.style.display = "none";
    holdX = DESIGN_W / 2;
    particles.length = 0;
    shakeStrength = 0;
    shakeTimer = 0;
    flashAlpha = 0;
    comboCount = 0;
    comboTimer = 0;
    renderNext();
  }

  let rafId = 0;
  let destroyed = false;
  rafId = requestAnimationFrame(loop);

  // ─── cleanup ────────────────────────────────────────────────────────────────
  return (): void => {
    destroyed = true;
    cancelAnimationFrame(rafId);
    ro.disconnect();
    Matter.Engine.clear(engine);
    Matter.World.clear(world, false);
    canvas.removeEventListener("pointerdown", onPointerMove);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    wrap.remove();
    style.remove();
    container.classList.remove("dropstack-root");
    container.style.touchAction = prevTouchAction;
  };
}
