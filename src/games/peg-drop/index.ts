// Peg Drop — vertical bounce-and-win arcade.
// Drag at top to aim, tap to drop a ball through a peg field.
// Ball lands in one of 9 slots; multiplier × base = score for that ball.
// 10 balls per run. Edge slots = jackpot, center = trap.
//
// Mobile-first portrait. Matter.js for physics, Canvas2D for paint.

import Matter from "matter-js";
import { submit, personalBest } from "../../lib/leaderboard.js";
import { playSfx } from "../../lib/audio.js";

const GAME_ID = "peg-drop";
const DESIGN_W = 360;
const DESIGN_H = 640;

// playfield geometry
const WALL_T = 16;
const DROP_Y = 96;
const FIRST_PEG_Y = 156;
const ROW_SPACING = 36;
const N_ROWS = 11;
const PEG_R = 4;
const N_SLOTS = 9;
const SLOT_W = DESIGN_W / N_SLOTS;
const SLOT_TOP = FIRST_PEG_Y + (N_ROWS - 1) * ROW_SPACING + 20;
const SLOT_FLOOR_Y = DESIGN_H - 16;
const DIVIDER_W = 4;
const BALL_R = 8;

// multipliers per slot (left → right). Symmetric, edges = jackpot.
const MULTIPLIERS: number[] = [25, 5, 2, 0.5, 0.2, 0.5, 2, 5, 25];

// per-multiplier color
function multColor(m: number): string {
  if (m >= 25) return "#ff44ff"; // magenta jackpot
  if (m >= 5)  return "#ff9933"; // orange
  if (m >= 2)  return "#ffd84d"; // yellow
  if (m >= 1)  return "#88e1ff"; // cyan
  if (m >= 0.5) return "#5577aa";
  return "#3a3a55";              // trap
}

const BALLS_PER_RUN = 10;
const BASE_PTS = 100;

interface Ball {
  body: Matter.Body;
  scored: boolean;
  fadeStart?: number;
}

export function mount(container: HTMLElement): () => void {
  container.classList.add("pegdrop-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // ─── DOM ────────────────────────────────────────────────────────────────────
  const wrap = document.createElement("div");
  wrap.className = "pegdrop-wrap";
  container.appendChild(wrap);

  const hud = document.createElement("div");
  hud.className = "pegdrop-hud";
  hud.innerHTML = `
    <div class="pegdrop-hud-l">
      <div class="pegdrop-score" id="pd-score">0</div>
      <div class="pegdrop-best" id="pd-best">BEST 0</div>
    </div>
    <div class="pegdrop-hud-c">
      <div class="pegdrop-balls-label">BALLS</div>
      <div class="pegdrop-balls" id="pd-balls">10</div>
    </div>
    <div class="pegdrop-hud-r">
      <button class="pegdrop-fs" id="pd-fs" aria-label="Fullscreen">⛶</button>
    </div>
  `;
  wrap.appendChild(hud);

  const canvas = document.createElement("canvas");
  canvas.className = "pegdrop-canvas";
  wrap.appendChild(canvas);

  const over = document.createElement("div");
  over.className = "pegdrop-over";
  over.style.display = "none";
  over.innerHTML = `
    <div class="pegdrop-over-card">
      <div class="pegdrop-over-title">RUN OVER</div>
      <div class="pegdrop-over-score-label">SCORE</div>
      <div class="pegdrop-over-score" id="pd-over-score">0</div>
      <button class="pegdrop-over-btn" id="pd-again">PLAY AGAIN</button>
    </div>
  `;
  wrap.appendChild(over);

  // hint
  const hintKey = "peg-drop:seenHint";
  let seenHint = false;
  try { seenHint = !!localStorage.getItem(hintKey); } catch { /* ok */ }
  let hintEl: HTMLElement | null = null;
  if (!seenHint) {
    try { localStorage.setItem(hintKey, "1"); } catch { /* ok */ }
    hintEl = document.createElement("div");
    hintEl.className = "pegdrop-hint";
    hintEl.innerHTML = `
      <div class="pegdrop-hint-box">
        <div>TRASCINA SOPRA PER MIRARE</div>
        <div class="sub">RILASCIA PER LASCIAR CADERE · BORDI = JACKPOT</div>
      </div>
    `;
    wrap.appendChild(hintEl);
    setTimeout(() => hintEl?.remove(), 5000);
  }

  // styles
  const style = document.createElement("style");
  style.textContent = `
    .pegdrop-root { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .pegdrop-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, #16082a 0%, #060214 100%);
      position: relative;
      overflow: hidden;
      min-height: 0;
    }
    .pegdrop-hud {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      font-family: monospace;
      color: #fff;
      flex-shrink: 0;
    }
    .pegdrop-hud-l { display: flex; flex-direction: column; }
    .pegdrop-hud-c { display: flex; flex-direction: column; align-items: center; }
    .pegdrop-hud-r { display: flex; align-items: center; gap: 6px; }
    .pegdrop-score { font-size: 26px; font-weight: bold; color: #ffd84d; text-shadow: 0 2px 6px rgba(255,216,77,0.4); }
    .pegdrop-best { font-size: 10px; color: #998abb; letter-spacing: 1px; }
    .pegdrop-balls-label { font-size: 9px; color: #998abb; letter-spacing: 2px; }
    .pegdrop-balls { font-size: 22px; font-weight: bold; color: #ff44ff; text-shadow: 0 2px 6px rgba(255,68,255,0.4); }
    .pegdrop-fs {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      color: #fff;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
    }
    .pegdrop-fs:active { transform: scale(0.94); }
    .pegdrop-canvas {
      flex: 1;
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
    .pegdrop-over {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
    }
    .pegdrop-over-card {
      background: #16082a;
      padding: 22px 32px;
      border-radius: 14px;
      border: 2px solid #ff44ff;
      text-align: center;
      color: #fff;
      font-family: monospace;
      min-width: 220px;
    }
    .pegdrop-over-title { color: #ff44ff; font-size: 22px; font-weight: bold; margin-bottom: 12px; letter-spacing: 2px; }
    .pegdrop-over-score-label { font-size: 10px; color: #998abb; letter-spacing: 2px; }
    .pegdrop-over-score { font-size: 36px; font-weight: bold; color: #ffd84d; margin: 4px 0 18px; }
    .pegdrop-over-btn {
      background: #ff44ff;
      color: #fff;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: monospace;
      font-weight: bold;
      font-size: 13px;
      cursor: pointer;
      min-width: 140px;
      letter-spacing: 1px;
    }
    .pegdrop-over-btn:active { transform: scale(0.96); }
    .pegdrop-hint {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; z-index: 50;
    }
    .pegdrop-hint-box {
      background: rgba(0,0,0,0.7);
      padding: 12px 20px;
      border-radius: 8px;
      color: #fff;
      font-family: monospace;
      font-size: 12px;
      font-weight: bold;
      text-align: center;
    }
    .pegdrop-hint-box .sub {
      font-size: 9px;
      color: #aabbcc;
      margin-top: 4px;
      font-weight: normal;
    }
    .pegdrop-popup {
      position: absolute;
      color: #ffd84d;
      font-family: monospace;
      font-weight: bold;
      font-size: 18px;
      text-shadow: 0 0 8px rgba(255,216,77,0.8);
      pointer-events: none;
      z-index: 40;
      transition: transform 0.9s ease-out, opacity 0.9s ease-out;
    }
  `;
  wrap.appendChild(style);

  // refs
  const scoreEl = hud.querySelector("#pd-score") as HTMLElement;
  const bestEl  = hud.querySelector("#pd-best")  as HTMLElement;
  const ballsEl = hud.querySelector("#pd-balls") as HTMLElement;
  const fsBtn   = hud.querySelector("#pd-fs")    as HTMLButtonElement;
  const overEl  = over;
  const overScoreEl = over.querySelector("#pd-over-score") as HTMLElement;
  const againBtn = over.querySelector("#pd-again") as HTMLButtonElement;
  const ctx = canvas.getContext("2d")!;

  // canvas geometry state
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

  // matter world
  const engine = Matter.Engine.create();
  engine.gravity.y = 1.4;
  engine.positionIterations = 6;
  engine.velocityIterations = 5;
  const world = engine.world;

  // walls
  const wallLeft = Matter.Bodies.rectangle(-WALL_T / 2, DESIGN_H / 2, WALL_T, DESIGN_H * 2, { isStatic: true });
  const wallRight = Matter.Bodies.rectangle(DESIGN_W + WALL_T / 2, DESIGN_H / 2, WALL_T, DESIGN_H * 2, { isStatic: true });
  const wallFloor = Matter.Bodies.rectangle(DESIGN_W / 2, SLOT_FLOOR_Y + WALL_T / 2, DESIGN_W * 2, WALL_T, { isStatic: true });
  Matter.World.add(world, [wallLeft, wallRight, wallFloor]);

  // pegs
  const pegPositions: Array<{ x: number; y: number }> = [];
  for (let row = 0; row < N_ROWS; row++) {
    const y = FIRST_PEG_Y + row * ROW_SPACING;
    if (row % 2 === 0) {
      // 9 pegs centered on slot centers
      for (let i = 0; i < 9; i++) {
        pegPositions.push({ x: SLOT_W / 2 + i * SLOT_W, y });
      }
    } else {
      // 8 pegs offset by half slot
      for (let i = 0; i < 8; i++) {
        pegPositions.push({ x: SLOT_W + i * SLOT_W, y });
      }
    }
  }
  for (const p of pegPositions) {
    const peg = Matter.Bodies.circle(p.x, p.y, PEG_R, {
      isStatic: true,
      restitution: 0.7,
      friction: 0,
      label: "peg",
    });
    Matter.World.add(world, peg);
  }

  // slot dividers (vertical walls between slots)
  for (let i = 1; i < N_SLOTS; i++) {
    const x = i * SLOT_W;
    const dh = SLOT_FLOOR_Y - SLOT_TOP;
    const div = Matter.Bodies.rectangle(x, SLOT_TOP + dh / 2, DIVIDER_W, dh, {
      isStatic: true,
      restitution: 0.2,
      label: "divider",
    });
    Matter.World.add(world, div);
  }

  // ─── state ──────────────────────────────────────────────────────────────────
  const balls: Ball[] = [];
  let ballsLeft = BALLS_PER_RUN;
  let aimX = DESIGN_W / 2;
  let canDrop = true;
  let score = 0;
  let best = 0;
  let dead = false;
  let lastTime = performance.now();

  ballsEl.textContent = String(ballsLeft);

  void personalBest(GAME_ID).then((b) => {
    best = b;
    bestEl.textContent = `BEST ${best}`;
  });

  // ─── helpers ────────────────────────────────────────────────────────────────
  function spawnBall(x: number): void {
    const body = Matter.Bodies.circle(x, DROP_Y, BALL_R, {
      restitution: 0.55,
      friction: 0.005,
      frictionStatic: 0.05,
      density: 0.002,
      label: "ball",
      slop: 0.02,
    });
    Matter.Body.setVelocity(body, { x: (Math.random() - 0.5) * 0.4, y: 0.1 });
    Matter.World.add(world, body);
    balls.push({ body, scored: false });
  }

  function spawnHitParticles(x: number, y: number, color: string): void {
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 60;
      particles.push({
        x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 0,
        maxLife: 250 + Math.random() * 200,
        color,
        size: 1.5 + Math.random() * 1.5,
      });
    }
  }

  function spawnSlotParticles(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.6;
      const speed = 120 + Math.random() * 140;
      particles.push({
        x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 0,
        maxLife: 600 + Math.random() * 300,
        color: i % 2 === 0 ? color : "#ffffff",
        size: 2 + Math.random() * 2,
      });
    }
  }

  function addShake(strength: number, duration: number): void {
    if (strength > shakeStrength) shakeStrength = strength;
    if (duration > shakeTimer) shakeTimer = duration;
  }

  function showPopup(designX: number, designY: number, text: string, color: string): void {
    const p = document.createElement("div");
    p.className = "pegdrop-popup";
    p.textContent = text;
    p.style.color = color;
    wrap.appendChild(p);
    const cssX = offsetX + designX * scale;
    const cssY = offsetY + designY * scale;
    p.style.left = `${cssX - 30}px`;
    p.style.top  = `${cssY}px`;
    requestAnimationFrame(() => {
      p.style.transform = "translateY(-46px)";
      p.style.opacity = "0";
    });
    setTimeout(() => p.remove(), 950);
  }

  // peg-hit detection: sparks + low vibrate + sfx
  Matter.Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const ball = a.label === "ball" ? a : b.label === "ball" ? b : null;
      const peg  = a.label === "peg"  ? a : b.label === "peg"  ? b : null;
      if (ball && peg) {
        spawnHitParticles(peg.position.x, peg.position.y, "#aaccff");
        playSfx("bounce");
        if (navigator.vibrate) navigator.vibrate(4);
      }
    }
  });

  function settleBall(ball: Ball, now: number): void {
    if (ball.scored) return;
    const x = ball.body.position.x;
    const y = ball.body.position.y;
    if (y < SLOT_FLOOR_Y - BALL_R - 1) return;
    // determine slot index
    let idx = Math.floor(x / SLOT_W);
    if (idx < 0) idx = 0;
    if (idx >= N_SLOTS) idx = N_SLOTS - 1;
    const mult = MULTIPLIERS[idx]!;
    const pts = Math.round(BASE_PTS * mult);
    score += pts;
    scoreEl.textContent = String(score);

    const color = multColor(mult);
    const isJackpot = mult >= 25;
    const isBig = mult >= 5;

    showPopup(x, SLOT_TOP - 6, `+${pts}` + (mult >= 1 ? ` x${mult}` : ""), color);
    spawnSlotParticles(x, SLOT_TOP, color, isJackpot ? 60 : isBig ? 28 : 14);

    if (isJackpot) {
      playSfx("fanfare");
      if (navigator.vibrate) navigator.vibrate([60, 40, 120, 40, 200]);
      addShake(12, 420);
      flashAlpha = 1;
      flashColor = [255, 100, 255];
    } else if (isBig) {
      playSfx("score");
      if (navigator.vibrate) navigator.vibrate(40);
      addShake(5, 220);
    } else if (mult >= 1) {
      playSfx("coin");
      if (navigator.vibrate) navigator.vibrate(20);
    } else {
      playSfx("hit");
      if (navigator.vibrate) navigator.vibrate(10);
    }

    if (score > best) {
      best = score;
      bestEl.textContent = `BEST ${best}`;
    }

    ball.scored = true;
    ball.fadeStart = now;
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
    aimX = Math.max(BALL_R + 4, Math.min(DESIGN_W - BALL_R - 4, x));
  }

  function onPointerUp(e: PointerEvent): void {
    if (dead) return;
    if (!canDrop) return;
    if (ballsLeft <= 0) return;
    const x = pointerToDesignX(e.clientX);
    aimX = Math.max(BALL_R + 4, Math.min(DESIGN_W - BALL_R - 4, x));
    drop();
  }

  function drop(): void {
    canDrop = false;
    spawnBall(aimX);
    ballsLeft--;
    ballsEl.textContent = String(ballsLeft);
    playSfx("tap");
    setTimeout(() => { canDrop = true; }, 220);
  }

  canvas.addEventListener("pointerdown", onPointerMove);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", (e) => onPointerUp(e));

  fsBtn.addEventListener("pointerup", () => {
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (target.requestFullscreen) {
      void target.requestFullscreen().catch(() => { /* ok */ });
    }
  });

  againBtn.addEventListener("pointerup", () => reset());

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
  function drawPegs(): void {
    for (const p of pegPositions) {
      // glow
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, PEG_R + 2, 0, Math.PI * 2);
      ctx.fill();
      // peg
      const g = ctx.createRadialGradient(p.x - 1, p.y - 1, 0, p.x, p.y, PEG_R);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#888aaf");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PEG_R, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSlots(): void {
    // slot floor highlight per multiplier
    for (let i = 0; i < N_SLOTS; i++) {
      const x = i * SLOT_W;
      const m = MULTIPLIERS[i]!;
      const color = multColor(m);
      // slot bg
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(x + 1, SLOT_TOP, SLOT_W - 2, SLOT_FLOOR_Y - SLOT_TOP);
      ctx.globalAlpha = 1;
      // top edge glow
      ctx.fillStyle = color;
      ctx.fillRect(x + 2, SLOT_TOP - 2, SLOT_W - 4, 3);
      // multiplier label
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const txt = m >= 1 ? `${m}x` : `${m}x`;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.fillText(txt, x + SLOT_W / 2, SLOT_FLOOR_Y - 14);
      ctx.restore();
    }
    // dividers (visual on top of physics)
    ctx.fillStyle = "#3a2a55";
    for (let i = 1; i < N_SLOTS; i++) {
      const x = i * SLOT_W - DIVIDER_W / 2;
      ctx.fillRect(x, SLOT_TOP, DIVIDER_W, SLOT_FLOOR_Y - SLOT_TOP);
    }
    // floor line
    ctx.fillStyle = "#1a0d2a";
    ctx.fillRect(0, SLOT_FLOOR_Y, DESIGN_W, 3);
  }

  function drawBall(x: number, y: number, alpha: number = 1): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, y + BALL_R * 0.85, BALL_R * 0.7, BALL_R * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // body
    const g = ctx.createRadialGradient(x - 2, y - 3, 1, x, y, BALL_R);
    g.addColorStop(0, "#fff8b0");
    g.addColorStop(0.5, "#ffd84d");
    g.addColorStop(1, "#a87900");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    // highlight
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.ellipse(x - BALL_R * 0.35, y - BALL_R * 0.4, BALL_R * 0.32, BALL_R * 0.18, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawAim(now: number): void {
    if (dead || ballsLeft <= 0) return;
    // aim guide
    ctx.strokeStyle = "rgba(255,68,255,0.35)";
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(aimX, DROP_Y + BALL_R);
    ctx.lineTo(aimX, FIRST_PEG_Y - 10);
    ctx.stroke();
    ctx.setLineDash([]);
    // pulse ring
    const pulse = 1 + Math.sin(now / 240) * 0.1;
    ctx.save();
    ctx.strokeStyle = "#ff44ff";
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(aimX, DROP_Y, BALL_R * 1.6 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawBall(aimX, DROP_Y);
  }

  function drawParticles(): void {
    for (const p of particles) {
      const t = p.life / p.maxLife;
      const a = 1 - t;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ─── loop ───────────────────────────────────────────────────────────────────
  function loop(now: number): void {
    if (destroyed) return;
    const dt = Math.min(50, now - lastTime);
    lastTime = now;
    Matter.Engine.update(engine, dt);

    // settle balls into slots, fade out scored ones
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i]!;
      if (!b.scored) settleBall(b, now);
      if (b.scored && b.fadeStart != null && now - b.fadeStart > 350) {
        Matter.World.remove(world, b.body);
        balls.splice(i, 1);
      }
    }

    // run-end check
    if (!dead && ballsLeft <= 0 && balls.length === 0) {
      triggerRunOver();
    }

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.life += dt;
      if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      p.vy += 240 * dt / 1000;
      p.vx *= 0.98;
    }

    // shake decay
    if (shakeTimer > 0) {
      shakeTimer -= dt;
      if (shakeTimer <= 0) shakeStrength = 0;
    }
    if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt / 480);

    // render
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#060214";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const shakeX = shakeTimer > 0 ? (Math.random() - 0.5) * 2 * shakeStrength : 0;
    const shakeY = shakeTimer > 0 ? (Math.random() - 0.5) * 2 * shakeStrength : 0;
    ctx.setTransform(
      dpr * scale, 0, 0,
      dpr * scale,
      dpr * (offsetX + shakeX * scale),
      dpr * (offsetY + shakeY * scale),
    );

    // backdrop gradient inside design
    const bgGrad = ctx.createLinearGradient(0, 0, 0, DESIGN_H);
    bgGrad.addColorStop(0, "#16082a");
    bgGrad.addColorStop(1, "#060214");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

    drawSlots();
    drawPegs();
    drawAim(now);

    // balls
    for (const b of balls) {
      let alpha = 1;
      if (b.scored && b.fadeStart != null) {
        alpha = Math.max(0, 1 - (now - b.fadeStart) / 350);
      }
      drawBall(b.body.position.x, b.body.position.y, alpha);
    }

    drawParticles();

    if (flashAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = flashAlpha * 0.55;
      ctx.fillStyle = `rgb(${flashColor[0]},${flashColor[1]},${flashColor[2]})`;
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      ctx.restore();
    }

    rafId = requestAnimationFrame(loop);
  }

  function triggerRunOver(): void {
    if (dead) return;
    dead = true;
    playSfx(score >= 5000 ? "win" : "gameover");
    if (navigator.vibrate) navigator.vibrate([80, 60, 120]);
    overScoreEl.textContent = String(score);
    overEl.style.display = "flex";
    void submit(GAME_ID, score);
  }

  function reset(): void {
    for (const b of balls) Matter.World.remove(world, b.body);
    balls.length = 0;
    score = 0;
    scoreEl.textContent = "0";
    ballsLeft = BALLS_PER_RUN;
    ballsEl.textContent = String(ballsLeft);
    dead = false;
    canDrop = true;
    overEl.style.display = "none";
    aimX = DESIGN_W / 2;
    particles.length = 0;
    shakeStrength = 0;
    shakeTimer = 0;
    flashAlpha = 0;
  }

  let rafId = 0;
  let destroyed = false;
  rafId = requestAnimationFrame(loop);

  // ─── cleanup ────────────────────────────────────────────────────────────────
  return (): void => {
    destroyed = true;
    cancelAnimationFrame(rafId);
    ro.disconnect();
    Matter.Events.off(engine, "collisionStart");
    Matter.World.clear(world, false);
    Matter.Engine.clear(engine);
    canvas.removeEventListener("pointerdown", onPointerMove);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    wrap.remove();
    style.remove();
    container.classList.remove("pegdrop-root");
    container.style.touchAction = prevTouchAction;
  };
}
