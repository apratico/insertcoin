// Liquid Merge — paint-mix physics puzzle.
// Drop colored liquid blobs. Same color touch = merge (bigger, score).
// Different colors touch = mix (RGB blend, visual only, no direct score).
// Grow blobs to MAX size → pop for big bonus.
//
// Canvas 2D + Matter.js (rigid circle physics, area-preserving merges).
// Mobile-first portrait. Tap palette → choose next color. Drag to aim.

import Matter from "matter-js";
import { submit } from "../../lib/leaderboard.js";
import { playSfx } from "../../lib/audio.js";

const GAME_ID = "liquid-merge";
const DESIGN_W = 360;
const DESIGN_H = 640;

// Jar geometry
const JAR_LEFT = 24;
const JAR_RIGHT = DESIGN_W - 24;
const JAR_TOP = 150;
const JAR_BOTTOM = DESIGN_H - 120;
const WALL_THICK = 18;
const DROP_Y = 110;
const DANGER_HOLD_MS = 2000;

// Drop mechanics
const BASE_RADIUS = 18;
const POP_RADIUS = 64;        // radius at which a blob auto-pops for big bonus

// ─── palette ──────────────────────────────────────────────────────────────────
interface Paint {
  name: string;
  r: number; g: number; b: number;
}
const PALETTE: Paint[] = [
  { name: "ROSSO",  r: 255, g: 60,  b: 80  },
  { name: "GIALLO", r: 255, g: 220, b: 40  },
  { name: "BLU",    r: 60,  g: 120, b: 255 },
  { name: "VERDE",  r: 70,  g: 210, b: 100 },
];

interface BlobData {
  id: number;
  r: number;
  rgb: [number, number, number];
  spawnedAt: number;
  merging?: boolean;
  popping?: boolean;
}

export function mount(container: HTMLElement): () => void {
  container.classList.add("lmerge-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // ─── DOM ────────────────────────────────────────────────────────────────────
  const wrap = document.createElement("div");
  wrap.className = "lmerge-wrap";
  container.appendChild(wrap);

  const hud = document.createElement("div");
  hud.className = "lmerge-hud";
  hud.innerHTML = `
    <div class="lmerge-hud-left">
      <div class="lmerge-score" id="lm-score">0</div>
      <div class="lmerge-best" id="lm-best">BEST 0</div>
    </div>
    <div class="lmerge-hud-right">
      <div class="lmerge-combo" id="lm-combo"></div>
    </div>
  `;
  wrap.appendChild(hud);

  const canvas = document.createElement("canvas");
  canvas.className = "lmerge-canvas";
  wrap.appendChild(canvas);

  // palette tray (overlayed on canvas area via absolute pos)
  const tray = document.createElement("div");
  tray.className = "lmerge-tray";
  tray.innerHTML = PALETTE.map((p, i) => `
    <button class="lmerge-swatch" data-idx="${i}" style="background: rgb(${p.r},${p.g},${p.b})">
      <span>${p.name}</span>
    </button>
  `).join("");
  wrap.appendChild(tray);

  const over = document.createElement("div");
  over.className = "lmerge-over";
  over.style.display = "none";
  over.innerHTML = `
    <div class="lmerge-over-card">
      <div class="lmerge-over-title">OVERFLOW</div>
      <div class="lmerge-over-score-label">SCORE</div>
      <div class="lmerge-over-score" id="lm-over-score">0</div>
      <button class="lmerge-over-btn" id="lm-again">PLAY AGAIN</button>
    </div>
  `;
  wrap.appendChild(over);

  // hint
  const hintKey = "liquid-merge:seenHint";
  let seenHint = false;
  try { seenHint = !!localStorage.getItem(hintKey); } catch { /* ok */ }
  if (!seenHint) {
    try { localStorage.setItem(hintKey, "1"); } catch { /* ok */ }
    const hint = document.createElement("div");
    hint.className = "lmerge-hint";
    hint.innerHTML = `
      <div class="lmerge-hint-box">
        <div>TAP COLORE → SCELTA</div>
        <div class="sub">TRASCINA IN ALTO · RILASCIA PER DROP · STESSI COLORI FONDONO</div>
      </div>
    `;
    wrap.appendChild(hint);
    setTimeout(() => hint.remove(), 5000);
  }

  // ─── styles ─────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    .lmerge-root { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .lmerge-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, #131526 0%, #060810 100%);
      position: relative;
      overflow: hidden;
      min-height: 0;
    }
    .lmerge-hud {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      font-family: monospace;
      color: #fff;
      flex-shrink: 0;
    }
    .lmerge-hud-left { display: flex; flex-direction: column; }
    .lmerge-score { font-size: 26px; font-weight: bold; color: #ffcc33; text-shadow: 0 2px 6px rgba(255,204,51,0.4); }
    .lmerge-best { font-size: 10px; color: #8899bb; letter-spacing: 1px; }
    .lmerge-combo {
      font-size: 16px;
      font-weight: bold;
      color: #ff66ff;
      text-shadow: 0 0 8px rgba(255,102,255,0.6);
      min-height: 20px;
    }
    .lmerge-canvas {
      flex: 1;
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
    .lmerge-tray {
      display: flex;
      gap: 8px;
      padding: 10px 12px 14px;
      justify-content: center;
      flex-shrink: 0;
      background: rgba(0,0,0,0.25);
    }
    .lmerge-swatch {
      flex: 1;
      max-width: 78px;
      aspect-ratio: 1 / 1;
      border: 3px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      cursor: pointer;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding-bottom: 4px;
      font-family: monospace;
      font-size: 9px;
      font-weight: bold;
      color: rgba(0,0,0,0.7);
      text-shadow: 0 1px 0 rgba(255,255,255,0.3);
      transition: transform 80ms ease-out, border-color 120ms;
    }
    .lmerge-swatch.active {
      border-color: #fff;
      transform: translateY(-3px) scale(1.05);
      box-shadow: 0 0 18px rgba(255,255,255,0.4);
    }
    .lmerge-swatch:active { transform: scale(0.95); }
    .lmerge-over {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.68);
      backdrop-filter: blur(4px);
      z-index: 60;
    }
    .lmerge-over-card {
      background: #131526;
      padding: 20px 30px;
      border-radius: 14px;
      border: 2px solid #ff4466;
      text-align: center;
      color: #fff;
      font-family: monospace;
      min-width: 220px;
    }
    .lmerge-over-title { color: #ff4466; font-size: 22px; font-weight: bold; margin-bottom: 12px; }
    .lmerge-over-score-label { font-size: 10px; color: #8899bb; letter-spacing: 2px; }
    .lmerge-over-score { font-size: 36px; font-weight: bold; color: #ffcc33; margin: 4px 0 18px; }
    .lmerge-over-btn {
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
    .lmerge-over-btn:active { transform: scale(0.96); }
    .lmerge-hint {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; z-index: 50;
    }
    .lmerge-hint-box {
      background: rgba(0,0,0,0.7);
      padding: 12px 20px;
      border-radius: 8px;
      color: #fff;
      font-family: monospace;
      font-size: 13px;
      font-weight: bold;
      text-align: center;
    }
    .lmerge-hint-box .sub {
      font-size: 9px;
      color: #aabbcc;
      margin-top: 4px;
      font-weight: normal;
    }
    .lmerge-popup {
      position: absolute;
      color: #ffee55;
      font-family: monospace;
      font-weight: bold;
      font-size: 14px;
      text-shadow: 0 0 6px rgba(0,0,0,0.8);
      pointer-events: none;
      z-index: 40;
      transition: transform 0.7s ease-out, opacity 0.7s ease-out;
    }
  `;
  wrap.appendChild(style);

  // ─── refs ───────────────────────────────────────────────────────────────────
  const scoreEl = hud.querySelector("#lm-score") as HTMLElement;
  const bestEl  = hud.querySelector("#lm-best")  as HTMLElement;
  const comboEl = hud.querySelector("#lm-combo") as HTMLElement;
  const overEl = over;
  const overScoreEl = over.querySelector("#lm-over-score") as HTMLElement;
  const againBtn = over.querySelector("#lm-again") as HTMLButtonElement;
  const swatches = Array.from(tray.querySelectorAll<HTMLButtonElement>(".lmerge-swatch"));
  const ctx = canvas.getContext("2d")!;

  // ─── state ──────────────────────────────────────────────────────────────────
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  const engine = Matter.Engine.create();
  engine.gravity.y = 1.0;
  engine.positionIterations = 6;
  engine.velocityIterations = 4;
  const world = engine.world;

  // walls
  const wallLeft   = Matter.Bodies.rectangle(JAR_LEFT - WALL_THICK / 2, (JAR_TOP + JAR_BOTTOM) / 2, WALL_THICK, JAR_BOTTOM - JAR_TOP + 20, { isStatic: true });
  const wallRight  = Matter.Bodies.rectangle(JAR_RIGHT + WALL_THICK / 2, (JAR_TOP + JAR_BOTTOM) / 2, WALL_THICK, JAR_BOTTOM - JAR_TOP + 20, { isStatic: true });
  const wallBottom = Matter.Bodies.rectangle((JAR_LEFT + JAR_RIGHT) / 2, JAR_BOTTOM + WALL_THICK / 2, JAR_RIGHT - JAR_LEFT + WALL_THICK * 2, WALL_THICK, { isStatic: true });
  Matter.World.add(world, [wallLeft, wallRight, wallBottom]);

  const blobs = new Map<number, { body: Matter.Body; data: BlobData }>();
  let nextId = 1;
  let selectedPaint = 0;
  let holdX = DESIGN_W / 2;
  let canDrop = true;
  let score = 0;
  let best = 0;
  let dead = false;
  let dangerBlobId: number | null = null;
  let dangerStartMs = 0;
  let lastTime = performance.now();

  // juice state
  interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
  const particles: Particle[] = [];
  let shakeStrength = 0;
  let shakeTimer = 0;
  let flashAlpha = 0;
  let flashColor: [number, number, number] = [255, 255, 255];
  let comboCount = 0;
  let comboTimer = 0;
  const COMBO_WINDOW = 1100;

  // load best
  try {
    const raw = localStorage.getItem("liquid-merge:best");
    if (raw) best = parseInt(raw, 10) || 0;
  } catch { /* ok */ }
  bestEl.textContent = `BEST ${best}`;

  // select first swatch
  setPaint(0);

  // ─── helpers ────────────────────────────────────────────────────────────────
  function setPaint(idx: number): void {
    selectedPaint = idx;
    swatches.forEach((s, i) => s.classList.toggle("active", i === idx));
  }

  function colorsClose(a: [number, number, number], b: [number, number, number]): boolean {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) < 22;
  }

  function addBlob(x: number, y: number, radius: number, rgb: [number, number, number], velocity: { x: number; y: number } = { x: 0, y: 0 }): number {
    const id = nextId++;
    const body = Matter.Bodies.circle(x, y, radius, {
      restitution: 0.14,
      friction: 0.04,
      frictionStatic: 0.3,
      density: 0.001 + radius * 0.00002,
      label: `blob-${id}`,
      slop: 0.04,
    });
    Matter.Body.setVelocity(body, velocity);
    Matter.World.add(world, body);
    blobs.set(id, { body, data: { id, r: radius, rgb, spawnedAt: performance.now() } });
    return id;
  }

  function removeBlob(id: number): void {
    const b = blobs.get(id);
    if (!b) return;
    Matter.World.remove(world, b.body);
    blobs.delete(id);
  }

  function mergeBlobs(a: { body: Matter.Body; data: BlobData }, b: { body: Matter.Body; data: BlobData }): void {
    if (a.data.merging || b.data.merging) return;
    a.data.merging = true;
    b.data.merging = true;

    const same = colorsClose(a.data.rgb, b.data.rgb);
    const area1 = Math.PI * a.data.r * a.data.r;
    const area2 = Math.PI * b.data.r * b.data.r;
    const totalArea = area1 + area2;
    const newR = Math.sqrt(totalArea / Math.PI);
    // weighted color blend by area
    const w1 = area1 / totalArea;
    const w2 = area2 / totalArea;
    const blend: [number, number, number] = [
      Math.round(a.data.rgb[0] * w1 + b.data.rgb[0] * w2),
      Math.round(a.data.rgb[1] * w1 + b.data.rgb[1] * w2),
      Math.round(a.data.rgb[2] * w1 + b.data.rgb[2] * w2),
    ];
    const mx = (a.body.position.x + b.body.position.x) / 2;
    const my = (a.body.position.y + b.body.position.y) / 2;
    const vx = (a.body.velocity.x + b.body.velocity.x) / 2;
    const vy = (a.body.velocity.y + b.body.velocity.y) / 2;

    removeBlob(a.data.id);
    removeBlob(b.data.id);

    // combo tracking — any merge counts
    const now = performance.now();
    if (now - comboTimer < COMBO_WINDOW) comboCount++;
    else comboCount = 1;
    comboTimer = now;
    const comboMult = comboCount >= 5 ? 3 : comboCount >= 3 ? 2 : comboCount >= 2 ? 1.5 : 1;

    if (same) {
      // same color: score based on area growth × combo
      const pts = Math.round(totalArea * 0.04 * comboMult);
      score += pts;
      scoreEl.textContent = String(score);
      showPopup(mx, my, comboMult > 1 ? `+${pts} x${comboMult}` : `+${pts}`, rgbToHex(blend));
      spawnMergeParticles(mx, my, blend, 10 + Math.floor(newR / 6));
      addShake(1.5 + newR / 30, 160);
      playSfx(newR > 40 ? "levelup" : "pop");
      if (navigator.vibrate) navigator.vibrate(6 + Math.floor(newR / 10));
    } else {
      // different colors: mixing = no score but visual reward
      spawnMergeParticles(mx, my, blend, 6);
      playSfx("tap");
      showPopup(mx, my, "MIX", rgbToHex(blend));
    }

    // pop if huge
    if (newR >= POP_RADIUS) {
      const bonus = Math.round(newR * newR * 0.5 * comboMult);
      score += bonus;
      scoreEl.textContent = String(score);
      showPopup(mx, my, `POP +${bonus}`, "#ffffff");
      spawnMergeParticles(mx, my, blend, 60);
      addShake(10, 420);
      flashAlpha = 1;
      flashColor = blend;
      playSfx("fanfare");
      if (navigator.vibrate) navigator.vibrate([40, 40, 120]);
    } else {
      addBlob(mx, my, newR, blend, { x: vx * 0.5, y: vy * 0.5 });
    }

    if (score > best) {
      best = score;
      bestEl.textContent = `BEST ${best}`;
      try { localStorage.setItem("liquid-merge:best", String(best)); } catch { /* ok */ }
    }
  }

  function rgbToHex([r, g, b]: [number, number, number]): string {
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function spawnMergeParticles(x: number, y: number, rgb: [number, number, number], count: number): void {
    const col = rgbToHex(rgb);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 140;
      particles.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 30,
        life: 0,
        maxLife: 400 + Math.random() * 300,
        color: i % 3 === 0 ? "#ffffff" : col,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function addShake(strength: number, duration: number): void {
    if (strength > shakeStrength) shakeStrength = strength;
    if (duration > shakeTimer) shakeTimer = duration;
  }

  function showPopup(designX: number, designY: number, text: string, color: string): void {
    const p = document.createElement("div");
    p.className = "lmerge-popup";
    p.textContent = text;
    p.style.color = color;
    wrap.appendChild(p);
    const cssX = offsetX + designX * scale;
    const cssY = offsetY + designY * scale;
    p.style.left = `${cssX - 20}px`;
    p.style.top  = `${cssY}px`;
    requestAnimationFrame(() => {
      p.style.transform = "translateY(-32px)";
      p.style.opacity = "0";
    });
    setTimeout(() => p.remove(), 800);
  }

  Matter.Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const aId = parseLabel(pair.bodyA.label);
      const bId = parseLabel(pair.bodyB.label);
      if (aId == null || bId == null) continue;
      const a = blobs.get(aId);
      const b = blobs.get(bId);
      if (!a || !b) continue;
      if (a.data.merging || b.data.merging) continue;
      mergeBlobs(a, b);
    }
  });

  function parseLabel(label: string): number | null {
    if (!label.startsWith("blob-")) return null;
    const n = parseInt(label.slice(5), 10);
    return Number.isFinite(n) ? n : null;
  }

  // ─── input ──────────────────────────────────────────────────────────────────
  function pointerToDesignX(px: number): number {
    const rect = canvas.getBoundingClientRect();
    const cssX = px - rect.left;
    return (cssX - offsetX) / scale;
  }

  function onPointerMove(e: PointerEvent): void {
    if (dead) return;
    const x = pointerToDesignX(e.clientX);
    holdX = Math.max(JAR_LEFT + BASE_RADIUS + 2, Math.min(JAR_RIGHT - BASE_RADIUS - 2, x));
  }
  function onPointerUp(e: PointerEvent): void {
    if (dead) return;
    if (!canDrop) return;
    const x = pointerToDesignX(e.clientX);
    holdX = Math.max(JAR_LEFT + BASE_RADIUS + 2, Math.min(JAR_RIGHT - BASE_RADIUS - 2, x));
    drop();
  }
  function drop(): void {
    canDrop = false;
    const p = PALETTE[selectedPaint]!;
    addBlob(holdX, DROP_Y + BASE_RADIUS, BASE_RADIUS, [p.r, p.g, p.b]);
    playSfx("tap");
    setTimeout(() => { canDrop = true; }, 320);
  }

  canvas.addEventListener("pointerdown", onPointerMove);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", (e) => { onPointerUp(e); });

  swatches.forEach((s, i) => {
    s.addEventListener("pointerdown", () => setPaint(i));
  });

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
  function drawJar(): void {
    const w = JAR_RIGHT - JAR_LEFT;
    const h = JAR_BOTTOM - JAR_TOP;
    ctx.fillStyle = "rgba(40,60,100,0.08)";
    ctx.fillRect(JAR_LEFT, JAR_TOP, w, h);
    ctx.strokeStyle = "#2a3450";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(JAR_LEFT, JAR_TOP);
    ctx.lineTo(JAR_LEFT, JAR_BOTTOM);
    ctx.lineTo(JAR_RIGHT, JAR_BOTTOM);
    ctx.lineTo(JAR_RIGHT, JAR_TOP);
    ctx.stroke();
    // danger line
    const danger = dangerBlobId != null ? "#ff3344" : "#5060a0";
    ctx.strokeStyle = danger;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(JAR_LEFT, JAR_TOP);
    ctx.lineTo(JAR_RIGHT, JAR_TOP);
    ctx.stroke();
    ctx.setLineDash([]);
    // POP hint line at radius-based threshold
    // show small POP marker at right edge
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`POP @ r=${POP_RADIUS}`, JAR_RIGHT - 4, JAR_TOP - 4);
    ctx.textAlign = "left";
  }

  function drawBlob(x: number, y: number, r: number, rgb: [number, number, number]): void {
    // soft radial gradient for liquid feel
    const [rc, gc, bc] = rgb;
    const lighter = `rgb(${clamp255(rc + 40)},${clamp255(gc + 40)},${clamp255(bc + 40)})`;
    const darker  = `rgb(${clamp255(rc - 60)},${clamp255(gc - 60)},${clamp255(bc - 60)})`;
    ctx.save();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.85, r * 0.8, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // body
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, lighter);
    g.addColorStop(0.55, `rgb(${rc},${gc},${bc})`);
    g.addColorStop(1, darker);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // rim
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.strokeStyle = darker;
    ctx.stroke();
    // highlight
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function clamp255(n: number): number {
    return Math.max(0, Math.min(255, n));
  }

  function drawHeld(now: number): void {
    if (dead) return;
    const p = PALETTE[selectedPaint]!;
    // aim guide
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(holdX, DROP_Y + BASE_RADIUS);
    ctx.lineTo(holdX, JAR_BOTTOM - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    // pulse
    const pulse = 1 + Math.sin(now / 240) * 0.1;
    ctx.save();
    ctx.strokeStyle = `rgb(${p.r},${p.g},${p.b})`;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(holdX, DROP_Y, BASE_RADIUS * 1.25 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawBlob(holdX, DROP_Y, BASE_RADIUS, [p.r, p.g, p.b]);
  }

  function drawParticles(): void {
    for (const p of particles) {
      const t = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ─── loop ───────────────────────────────────────────────────────────────────
  function loop(now: number): void {
    if (destroyed) return;
    const dt = Math.min(50, now - lastTime);
    lastTime = now;
    if (!dead) Matter.Engine.update(engine, dt);

    // juice update
    if (shakeTimer > 0) { shakeTimer -= dt; if (shakeTimer <= 0) shakeStrength = 0; }
    if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt / 500);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.life += dt;
      if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      p.vy += 240 * dt / 1000;
      p.vx *= 0.985;
    }
    if (comboCount > 0 && now - comboTimer > COMBO_WINDOW) comboCount = 0;
    comboEl.textContent = comboCount >= 2 ? `COMBO x${comboCount}` : "";

    // render
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#050710";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const shakeX = shakeTimer > 0 ? (Math.random() - 0.5) * 2 * shakeStrength : 0;
    const shakeY = shakeTimer > 0 ? (Math.random() - 0.5) * 2 * shakeStrength : 0;
    ctx.setTransform(
      dpr * scale, 0, 0,
      dpr * scale,
      dpr * (offsetX + shakeX * scale),
      dpr * (offsetY + shakeY * scale)
    );

    drawJar();
    blobs.forEach((b) => drawBlob(b.body.position.x, b.body.position.y, b.data.r, b.data.rgb));
    drawHeld(now);
    drawParticles();

    if (flashAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = flashAlpha * 0.5;
      ctx.fillStyle = `rgb(${flashColor[0]},${flashColor[1]},${flashColor[2]})`;
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      ctx.restore();
    }

    checkDanger(now);

    rafId = requestAnimationFrame(loop);
  }

  function checkDanger(now: number): void {
    if (dead) return;
    let violator: number | null = null;
    blobs.forEach((b) => {
      const body = b.body;
      const top = body.position.y - b.data.r;
      const vy = Math.abs(body.velocity.y);
      const vx = Math.abs(body.velocity.x);
      const settled = vy < 0.5 && vx < 0.5;
      const age = now - b.data.spawnedAt;
      if (top < JAR_TOP && settled && age > 700) violator = b.data.id;
    });
    if (violator != null) {
      if (dangerBlobId !== violator) {
        dangerBlobId = violator;
        dangerStartMs = now;
      } else if (now - dangerStartMs > DANGER_HOLD_MS) {
        triggerGameOver();
      }
    } else {
      dangerBlobId = null;
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
    blobs.forEach((b) => Matter.World.remove(world, b.body));
    blobs.clear();
    nextId = 1;
    score = 0;
    scoreEl.textContent = "0";
    dead = false;
    canDrop = true;
    dangerBlobId = null;
    overEl.style.display = "none";
    holdX = DESIGN_W / 2;
    particles.length = 0;
    shakeStrength = 0;
    shakeTimer = 0;
    flashAlpha = 0;
    comboCount = 0;
    comboTimer = 0;
    setPaint(0);
  }

  let rafId = 0;
  let destroyed = false;
  rafId = requestAnimationFrame(loop);

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
    container.classList.remove("lmerge-root");
    container.style.touchAction = prevTouchAction;
  };
}
