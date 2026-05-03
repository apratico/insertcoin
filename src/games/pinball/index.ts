// Pinball — vertical pinball table with plunger lane, 5 bumpers, 4 slingshots,
// 2 flippers, funnel walls and top corner guides.
// Tap left/right halves of the field to control flippers. Multitouch.
// Right-side hold while ball is in the plunger lane charges the launcher.
// Keyboard: ←/Z left flipper, →// right flipper.
// 3 lives. Ball drains between flippers.
//
// Stack: Matter.js standalone for physics, Canvas2D for paint. No assets.

import Matter from "matter-js";
import { submit, personalBest } from "../../lib/leaderboard.js";
import { playSfx } from "../../lib/audio.js";

const GAME_ID = "pinball";
const DESIGN_W = 360;
const DESIGN_H = 640;

// playfield walls
const WALL_T = 14;
const TOP_Y = 18;
const FIELD_BOTTOM_Y = 620;
const SIDE_WALL_BOTTOM_Y = 460;

// plunger lane (right side)
const FIELD_RIGHT_X = 302;            // separator inner edge — right edge of playfield
const PLUNGER_SEPARATOR_THICK = 4;
const PLUNGER_SEPARATOR_TOP_Y = 90;
const PLUNGER_SEPARATOR_BOT_Y = 460;
const PLUNGER_SPAWN_X = 324;
const PLUNGER_SPAWN_Y = 555;
const PLUNGER_FLOOR_Y = 600;
const PLUNGER_FLOOR_THICK = 6;
// slopes from upper-left to lower-right above the plunger lane: a ball going
// up the lane reflects off it leftward into the playfield.
const PLUNGER_TOP_DEFLECTOR_FROM = { x: 250, y: 30 };
const PLUNGER_TOP_DEFLECTOR_TO   = { x: 346, y: 78 };
const PLUNGER_MAX_CHARGE_MS = 1200;
const PLUNGER_MIN_LAUNCH_VEL = 8;
const PLUNGER_MAX_LAUNCH_VEL = 22;

// top corner guide (left)
const TOP_GUIDE_LEFT_FROM = { x: 14, y: 30 };
const TOP_GUIDE_LEFT_TO   = { x: 60, y: 70 };
const TOP_GUIDE_THICK = 6;

// flippers
const FLIPPER_LEN = 62;
const FLIPPER_THICK = 12;
const LEFT_PIVOT = { x: 95, y: 575 };
const RIGHT_PIVOT = { x: 265, y: 575 };
const FLIPPER_REST_OFFSET = 0.42;     // ~24°
const FLIPPER_ACTIVE_OFFSET = 0.52;   // ~30° from horizontal upward

// funnel walls — 2 segments per side, channel ball into the flippers
interface SegmentDef { from: { x: number; y: number }; to: { x: number; y: number }; thick: number; }
const LEFT_FUNNEL_1: SegmentDef  = { from: { x: 14,  y: 460 }, to: { x: 50,  y: 510 }, thick: 12 };
const LEFT_FUNNEL_2: SegmentDef  = { from: { x: 50,  y: 510 }, to: { x: 95,  y: 575 }, thick: 10 };
const RIGHT_FUNNEL_1: SegmentDef = { from: { x: 302, y: 460 }, to: { x: 275, y: 510 }, thick: 12 };
const RIGHT_FUNNEL_2: SegmentDef = { from: { x: 275, y: 510 }, to: { x: 265, y: 575 }, thick: 10 };

// bumpers — 5 in irregular W in upper third
interface BumperDef { x: number; y: number; r: number; }
const BUMPERS: BumperDef[] = [
  { x:  60, y: 150, r: 19 },
  { x: 115, y: 200, r: 17 },
  { x: 175, y: 130, r: 22 },
  { x: 235, y: 200, r: 17 },
  { x: 280, y: 165, r: 18 },
];
const BUMPER_SCORE = 100;
const BUMPER_FORCE = 0.0030;
const BUMPER_FLASH_MS = 150;

// slingshots — 2 per side, downward-pointing triangles
interface SlingshotDef {
  cx: number; cy: number;
  verts: Array<{ x: number; y: number }>;  // relative to center
}
const SLINGSHOTS: SlingshotDef[] = [
  // Left upper — apex pointing right (kicks ball into field)
  { cx: 32, cy: 360, verts: [{ x: -10, y: -22 }, { x: -10, y: 22 }, { x: 16, y: 0 }] },
  // Left lower — apex pointing down-right toward flipper
  { cx: 62, cy: 480, verts: [{ x: -22, y: -10 }, { x: 22, y: -10 }, { x: 18, y: 18 }] },
  // Right upper — apex pointing left
  { cx: 268, cy: 360, verts: [{ x: 10, y: -22 }, { x: 10, y: 22 }, { x: -16, y: 0 }] },
  // Right lower — apex pointing down-left toward flipper
  { cx: 240, cy: 480, verts: [{ x: -22, y: -10 }, { x: 22, y: -10 }, { x: -18, y: 18 }] },
];
const SLINGSHOT_SCORE = 50;
const SLINGSHOT_FORCE = 0.0034;
const SLINGSHOT_FLASH_MS = 150;

// ball
const BALL_R = 9;
const LIVES_INIT = 3;
const DRAIN_Y = FIELD_BOTTOM_Y + 28;
const BALL_TRAIL_LEN = 6;

// flipper category for collision filter (so flippers don't snag on slope)
const CAT_DEFAULT = 0x0001;
const CAT_FLIPPER = 0x0002;

interface Flipper {
  body: Matter.Body;
  pivot: { x: number; y: number };
  isLeft: boolean;
  active: boolean;
  restAngle: number;
  activeAngle: number;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }

export function mount(container: HTMLElement): () => void {
  container.classList.add("pinball-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // ─── DOM ────────────────────────────────────────────────────────────────────
  const wrap = document.createElement("div");
  wrap.className = "pinball-wrap";
  container.appendChild(wrap);

  const hud = document.createElement("div");
  hud.className = "pinball-hud";
  hud.innerHTML = `
    <div class="pinball-hud-l">
      <div class="pinball-score" id="pb-score">0</div>
      <div class="pinball-best" id="pb-best">BEST 0</div>
    </div>
    <div class="pinball-hud-c">
      <div class="pinball-lives-label">BALLS</div>
      <div class="pinball-lives" id="pb-lives">3</div>
    </div>
    <div class="pinball-hud-r">
      <button class="pinball-fs" id="pb-fs" aria-label="Fullscreen">⛶</button>
    </div>
  `;
  wrap.appendChild(hud);

  const canvas = document.createElement("canvas");
  canvas.className = "pinball-canvas";
  wrap.appendChild(canvas);

  const over = document.createElement("div");
  over.className = "pinball-over";
  over.style.display = "none";
  over.innerHTML = `
    <div class="pinball-over-card">
      <div class="pinball-over-title">GAME OVER</div>
      <div class="pinball-over-score-label">SCORE</div>
      <div class="pinball-over-score" id="pb-over-score">0</div>
      <button class="pinball-over-btn" id="pb-again">PLAY AGAIN</button>
    </div>
  `;
  wrap.appendChild(over);

  // hint
  const hintKey = "pinball:seenHint";
  let seenHint = false;
  try { seenHint = !!localStorage.getItem(hintKey); } catch { /* ok */ }
  let hintEl: HTMLElement | null = null;
  if (!seenHint) {
    try { localStorage.setItem(hintKey, "1"); } catch { /* ok */ }
    hintEl = document.createElement("div");
    hintEl.className = "pinball-hint";
    hintEl.innerHTML = `
      <div class="pinball-hint-box">
        <div>TAP SINISTRA / DESTRA PER I FLIPPER</div>
        <div class="sub">←/Z · →/'/' · COLPISCI I BUMPER</div>
      </div>
    `;
    wrap.appendChild(hintEl);
    setTimeout(() => hintEl?.remove(), 5000);
  }

  // styles
  const style = document.createElement("style");
  style.textContent = `
    .pinball-root { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .pinball-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, #14142e 0%, #06061a 100%);
      position: relative;
      overflow: hidden;
      min-height: 0;
    }
    .pinball-hud {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      font-family: monospace;
      color: #fff;
      flex-shrink: 0;
    }
    .pinball-hud-l { display: flex; flex-direction: column; }
    .pinball-hud-c { display: flex; flex-direction: column; align-items: center; }
    .pinball-hud-r { display: flex; align-items: center; gap: 6px; }
    .pinball-score { font-size: 26px; font-weight: bold; color: #ff6ec7; text-shadow: 0 2px 6px rgba(255,110,199,0.45); }
    .pinball-best { font-size: 10px; color: #998abb; letter-spacing: 1px; }
    .pinball-lives-label { font-size: 9px; color: #998abb; letter-spacing: 2px; }
    .pinball-lives { font-size: 22px; font-weight: bold; color: #88e1ff; }
    .pinball-fs {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      color: #fff;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
    }
    .pinball-fs:active { transform: scale(0.94); }
    .pinball-canvas {
      flex: 1;
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
    .pinball-over {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
    }
    .pinball-over-card {
      background: #14142e;
      padding: 22px 32px;
      border-radius: 14px;
      border: 2px solid #ff6ec7;
      text-align: center;
      color: #fff;
      font-family: monospace;
      min-width: 220px;
    }
    .pinball-over-title { color: #ff6ec7; font-size: 22px; font-weight: bold; margin-bottom: 12px; letter-spacing: 2px; }
    .pinball-over-score-label { font-size: 10px; color: #998abb; letter-spacing: 2px; }
    .pinball-over-score { font-size: 36px; font-weight: bold; color: #88e1ff; margin: 4px 0 18px; }
    .pinball-over-btn {
      background: #ff6ec7;
      color: #14142e;
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
    .pinball-over-btn:active { transform: scale(0.96); }
    .pinball-hint {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; z-index: 50;
    }
    .pinball-hint-box {
      background: rgba(0,0,0,0.7);
      padding: 12px 20px;
      border-radius: 8px;
      color: #fff;
      font-family: monospace;
      font-size: 12px;
      font-weight: bold;
      text-align: center;
    }
    .pinball-hint-box .sub {
      font-size: 9px;
      color: #aabbcc;
      margin-top: 4px;
      font-weight: normal;
    }
    .pinball-popup {
      position: absolute;
      color: #ff6ec7;
      font-family: monospace;
      font-weight: bold;
      font-size: 14px;
      text-shadow: 0 0 6px rgba(255,110,199,0.8);
      pointer-events: none;
      z-index: 40;
      transition: transform 0.7s ease-out, opacity 0.7s ease-out;
    }
  `;
  wrap.appendChild(style);

  // refs
  const scoreEl = hud.querySelector("#pb-score") as HTMLElement;
  const bestEl  = hud.querySelector("#pb-best")  as HTMLElement;
  const livesEl = hud.querySelector("#pb-lives") as HTMLElement;
  const fsBtn   = hud.querySelector("#pb-fs")    as HTMLButtonElement;
  const overEl  = over;
  const overScoreEl = over.querySelector("#pb-over-score") as HTMLElement;
  const againBtn = over.querySelector("#pb-again") as HTMLButtonElement;
  const ctx = canvas.getContext("2d")!;

  // canvas geometry
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  // juice state
  const particles: Particle[] = [];
  let shakeStrength = 0;
  let shakeTimer = 0;
  const bumperFlash = new Map<Matter.Body, number>(); // body → timestamp of last hit

  // ─── matter ─────────────────────────────────────────────────────────────────
  const engine = Matter.Engine.create();
  engine.gravity.y = 1.0;
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  const world = engine.world;

  // helper: rotated rectangle from two world endpoints
  function segmentBody(seg: SegmentDef, label: string): Matter.Body {
    const dx = seg.to.x - seg.from.x;
    const dy = seg.to.y - seg.from.y;
    const len = Math.hypot(dx, dy);
    const cx = (seg.from.x + seg.to.x) / 2;
    const cy = (seg.from.y + seg.to.y) / 2;
    const angle = Math.atan2(dy, dx);
    return Matter.Bodies.rectangle(cx, cy, len, seg.thick, {
      isStatic: true,
      angle,
      chamfer: { radius: 3 },
      label,
    });
  }

  // walls
  const topWall = Matter.Bodies.rectangle(DESIGN_W / 2, TOP_Y / 2, DESIGN_W, TOP_Y, { isStatic: true, label: "wall" });
  // left side wall: from top to top of left funnel
  const leftWall = Matter.Bodies.rectangle(WALL_T / 2, (TOP_Y + SIDE_WALL_BOTTOM_Y) / 2, WALL_T, SIDE_WALL_BOTTOM_Y - TOP_Y, { isStatic: true, label: "wall" });
  // right outer wall: full height to enclose plunger lane
  const rightWall = Matter.Bodies.rectangle(DESIGN_W - WALL_T / 2, (TOP_Y + FIELD_BOTTOM_Y) / 2, WALL_T, FIELD_BOTTOM_Y - TOP_Y, { isStatic: true, label: "wall" });
  // plunger separator: vertical wall between playfield and plunger lane
  const plungerSeparator = Matter.Bodies.rectangle(
    FIELD_RIGHT_X + PLUNGER_SEPARATOR_THICK / 2,
    (PLUNGER_SEPARATOR_TOP_Y + PLUNGER_SEPARATOR_BOT_Y) / 2,
    PLUNGER_SEPARATOR_THICK,
    PLUNGER_SEPARATOR_BOT_Y - PLUNGER_SEPARATOR_TOP_Y,
    { isStatic: true, label: "wall" },
  );
  // plunger floor: closes the bottom of the lane so the ball doesn't escape
  const plungerFloor = Matter.Bodies.rectangle(
    (FIELD_RIGHT_X + DESIGN_W - WALL_T) / 2,
    PLUNGER_FLOOR_Y + PLUNGER_FLOOR_THICK / 2,
    DESIGN_W - WALL_T - FIELD_RIGHT_X,
    PLUNGER_FLOOR_THICK,
    { isStatic: true, label: "wall" },
  );
  Matter.World.add(world, [topWall, leftWall, rightWall, plungerSeparator, plungerFloor]);

  // top corner guide (left) and plunger top deflector (right)
  const topGuideLeft = segmentBody({ from: TOP_GUIDE_LEFT_FROM, to: TOP_GUIDE_LEFT_TO, thick: TOP_GUIDE_THICK }, "wall");
  const plungerTopDeflector = segmentBody(
    { from: PLUNGER_TOP_DEFLECTOR_FROM, to: PLUNGER_TOP_DEFLECTOR_TO, thick: TOP_GUIDE_THICK },
    "wall",
  );
  Matter.World.add(world, [topGuideLeft, plungerTopDeflector]);

  // funnel segments (2 per side)
  const leftFunnel1  = segmentBody(LEFT_FUNNEL_1,  "funnel");
  const leftFunnel2  = segmentBody(LEFT_FUNNEL_2,  "funnel");
  const rightFunnel1 = segmentBody(RIGHT_FUNNEL_1, "funnel");
  const rightFunnel2 = segmentBody(RIGHT_FUNNEL_2, "funnel");
  Matter.World.add(world, [leftFunnel1, leftFunnel2, rightFunnel1, rightFunnel2]);

  // bumpers
  const bumperBodies: Matter.Body[] = BUMPERS.map((b) =>
    Matter.Bodies.circle(b.x, b.y, b.r, {
      isStatic: true,
      restitution: 1.05,
      friction: 0,
      label: "bumper",
    }),
  );
  Matter.World.add(world, bumperBodies);

  // slingshots — triangular static bumpers above flippers
  const slingshotBodies: Matter.Body[] = SLINGSHOTS.map((s) => {
    const verts = s.verts.map((v) => ({ x: s.cx + v.x, y: s.cy + v.y }));
    const body = Matter.Bodies.fromVertices(s.cx, s.cy, [verts], {
      isStatic: true,
      restitution: 1.1,
      friction: 0.02,
      label: "slingshot",
    });
    return body;
  });
  Matter.World.add(world, slingshotBodies);
  const slingshotFlash = new Map<Matter.Body, number>();

  // flippers
  function makeFlipper(isLeft: boolean): Flipper {
    const pivot = isLeft ? LEFT_PIVOT : RIGHT_PIVOT;
    const restAngle = isLeft ? FLIPPER_REST_OFFSET : -FLIPPER_REST_OFFSET;
    const activeAngle = isLeft ? -FLIPPER_ACTIVE_OFFSET : FLIPPER_ACTIVE_OFFSET;
    // body extends from pivot toward field center; place its center such that
    // local pivot offset matches the body's pivot end
    const localPivotX = isLeft ? -FLIPPER_LEN / 2 : FLIPPER_LEN / 2;
    const initialBodyX = isLeft ? pivot.x + FLIPPER_LEN / 2 : pivot.x - FLIPPER_LEN / 2;
    const body = Matter.Bodies.rectangle(initialBodyX, pivot.y, FLIPPER_LEN, FLIPPER_THICK, {
      density: 0.012,
      friction: 0.05,
      frictionAir: 0,
      restitution: 0.1,
      chamfer: { radius: 5 },
      label: "flipper",
      collisionFilter: { category: CAT_FLIPPER, mask: CAT_DEFAULT },
    });
    Matter.Body.setAngle(body, restAngle);
    const constraint = Matter.Constraint.create({
      pointA: { x: pivot.x, y: pivot.y },
      bodyB: body,
      pointB: { x: localPivotX, y: 0 },
      stiffness: 1,
      length: 0,
      damping: 0.1,
    });
    Matter.World.add(world, [body, constraint]);
    return { body, pivot, isLeft, active: false, restAngle, activeAngle };
  }
  const leftFlipper = makeFlipper(true);
  const rightFlipper = makeFlipper(false);

  function updateFlipper(f: Flipper): void {
    const target = f.active ? f.activeAngle : f.restAngle;
    const cur = f.body.angle;
    const diff = target - cur;
    if (Math.abs(diff) < 0.02) {
      Matter.Body.setAngularVelocity(f.body, 0);
      Matter.Body.setAngle(f.body, target);
      return;
    }
    const speed = f.active ? 0.6 : 0.22;
    Matter.Body.setAngularVelocity(f.body, Math.sign(diff) * speed);
  }

  // ─── ball ───────────────────────────────────────────────────────────────────
  let ballBody: Matter.Body | null = null;
  let ballRespawnPending = false;
  const ballTrail: Array<{ x: number; y: number }> = [];

  // plunger state
  let awaitingPlunge = false;
  let plungerCharging = false;
  let plungerChargeStart = 0;

  function plungerCharge(now: number): number {
    if (!plungerCharging) return 0;
    return Math.min((now - plungerChargeStart) / PLUNGER_MAX_CHARGE_MS, 1);
  }

  function spawnBall(): void {
    const b = Matter.Bodies.circle(PLUNGER_SPAWN_X, PLUNGER_SPAWN_Y, BALL_R, {
      restitution: 0.55,
      friction: 0.01,
      frictionAir: 0.001,
      density: 0.0026,
      label: "ball",
      slop: 0.01,
      collisionFilter: { category: CAT_DEFAULT, mask: 0xFFFF },
    });
    Matter.Body.setVelocity(b, { x: 0, y: 0 });
    Matter.World.add(world, b);
    ballBody = b;
    ballTrail.length = 0;
    awaitingPlunge = true;
  }

  // ─── state ──────────────────────────────────────────────────────────────────
  let score = 0;
  let best = 0;
  let lives = LIVES_INIT;
  let dead = false;
  let lastTime = performance.now();

  livesEl.textContent = String(lives);
  void personalBest(GAME_ID).then((b) => {
    best = b;
    bestEl.textContent = `BEST ${best}`;
  });
  spawnBall();

  // ─── particles & juice ──────────────────────────────────────────────────────
  function spawnHitParticles(x: number, y: number, color: string, count = 10): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 100;
      particles.push({
        x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 0,
        maxLife: 350 + Math.random() * 250,
        color: i % 2 === 0 ? color : "#ffffff",
        size: 1.5 + Math.random() * 2,
      });
    }
  }

  function addShake(strength: number, duration: number): void {
    if (strength > shakeStrength) shakeStrength = strength;
    if (duration > shakeTimer) shakeTimer = duration;
  }

  function showPopup(designX: number, designY: number, text: string, color: string): void {
    const p = document.createElement("div");
    p.className = "pinball-popup";
    p.textContent = text;
    p.style.color = color;
    wrap.appendChild(p);
    const cssX = offsetX + designX * scale;
    const cssY = offsetY + designY * scale;
    p.style.left = `${cssX - 22}px`;
    p.style.top  = `${cssY}px`;
    requestAnimationFrame(() => {
      p.style.transform = "translateY(-32px)";
      p.style.opacity = "0";
    });
    setTimeout(() => p.remove(), 720);
  }

  // ─── collisions ─────────────────────────────────────────────────────────────
  function bumpScore(points: number): void {
    score += points;
    scoreEl.textContent = String(score);
    if (score > best) {
      best = score;
      bestEl.textContent = `BEST ${best}`;
    }
  }

  Matter.Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const ball = a.label === "ball" ? a : b.label === "ball" ? b : null;
      if (!ball) continue;
      const other = ball === a ? b : a;
      if (other.label === "bumper") {
        const dx = ball.position.x - other.position.x;
        const dy = ball.position.y - other.position.y;
        const len = Math.hypot(dx, dy) || 1;
        Matter.Body.applyForce(ball, ball.position, {
          x: (dx / len) * BUMPER_FORCE,
          y: (dy / len) * BUMPER_FORCE,
        });
        bumpScore(BUMPER_SCORE);
        spawnHitParticles(other.position.x, other.position.y, "#ff6ec7", 14);
        addShake(4, 200);
        playSfx("bounce");
        if (navigator.vibrate) navigator.vibrate(20);
        bumperFlash.set(other, performance.now());
        showPopup(other.position.x, other.position.y - 18, `+${BUMPER_SCORE}`, "#ff6ec7");
      } else if (other.label === "slingshot") {
        // lateral kick: push ball outward (+ slight upward bias)
        const dx = ball.position.x - other.position.x;
        const dy = ball.position.y - other.position.y - 4;
        const len = Math.hypot(dx, dy) || 1;
        Matter.Body.applyForce(ball, ball.position, {
          x: (dx / len) * SLINGSHOT_FORCE,
          y: (dy / len) * SLINGSHOT_FORCE,
        });
        bumpScore(SLINGSHOT_SCORE);
        spawnHitParticles(other.position.x, other.position.y, "#88e1ff", 10);
        addShake(3, 160);
        playSfx("hit");
        if (navigator.vibrate) navigator.vibrate(40);
        slingshotFlash.set(other, performance.now());
        showPopup(other.position.x, other.position.y - 14, `+${SLINGSHOT_SCORE}`, "#88e1ff");
      } else if (other.label === "flipper") {
        playSfx("tap");
      } else if (other.label === "wall" || other.label === "funnel") {
        if (Math.abs(ball.velocity.x) + Math.abs(ball.velocity.y) > 6) {
          playSfx("hit");
        }
      }
    }
  });

  // ─── input ──────────────────────────────────────────────────────────────────
  type PointerRole = "flipper" | "plunger";
  interface PointerInfo { side: "left" | "right"; role: PointerRole; chargeStart: number; }
  const pointers = new Map<number, PointerInfo>();

  function pointerSide(e: PointerEvent): "left" | "right" {
    const rect = canvas.getBoundingClientRect();
    return (e.clientX - rect.left) < rect.width / 2 ? "left" : "right";
  }

  function recomputeFlipperState(): void {
    let leftHeld = false;
    let rightHeld = false;
    for (const v of pointers.values()) {
      if (v.role !== "flipper") continue;
      if (v.side === "left") leftHeld = true;
      else rightHeld = true;
    }
    leftFlipper.active = leftHeld || keyLeft;
    rightFlipper.active = rightHeld || keyRight;
  }

  function onPointerDown(e: PointerEvent): void {
    if (dead) return;
    const side = pointerSide(e);
    if (awaitingPlunge && side === "right") {
      const now = performance.now();
      pointers.set(e.pointerId, { side, role: "plunger", chargeStart: now });
      plungerCharging = true;
      plungerChargeStart = now;
      return;
    }
    pointers.set(e.pointerId, { side, role: "flipper", chargeStart: 0 });
    recomputeFlipperState();
  }
  function onPointerUp(e: PointerEvent): void {
    const info = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!info) return;
    if (info.role === "plunger") {
      plungerCharging = false;
      if (awaitingPlunge && ballBody) {
        const charge = Math.min((performance.now() - info.chargeStart) / PLUNGER_MAX_CHARGE_MS, 1);
        const vy = -(PLUNGER_MIN_LAUNCH_VEL + charge * (PLUNGER_MAX_LAUNCH_VEL - PLUNGER_MIN_LAUNCH_VEL));
        Matter.Body.setVelocity(ballBody, { x: 0, y: vy });
        awaitingPlunge = false;
        playSfx("shoot");
        if (navigator.vibrate) navigator.vibrate(15 + Math.round(charge * 25));
      }
      return;
    }
    recomputeFlipperState();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerUp);

  // keyboard
  let keyLeft = false;
  let keyRight = false;
  function onKeyDown(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === "ArrowLeft" || e.key === "z" || e.key === "Z") {
      if (!keyLeft) { keyLeft = true; recomputeFlipperState(); }
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "/") {
      if (!keyRight) { keyRight = true; recomputeFlipperState(); }
      e.preventDefault();
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === "ArrowLeft" || e.key === "z" || e.key === "Z") {
      keyLeft = false; recomputeFlipperState();
    } else if (e.key === "ArrowRight" || e.key === "/") {
      keyRight = false; recomputeFlipperState();
    }
  }
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  // fullscreen
  function onFsClick(): void {
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (target.requestFullscreen) {
      void target.requestFullscreen().catch(() => { /* ok */ });
    }
  }
  fsBtn.addEventListener("pointerup", onFsClick);

  // play again
  function onAgainClick(): void { reset(); }
  againBtn.addEventListener("pointerup", onAgainClick);

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

  // ─── render helpers ─────────────────────────────────────────────────────────
  function drawWalls(): void {
    ctx.fillStyle = "#2a2a55";
    // top
    ctx.fillRect(0, 0, DESIGN_W, TOP_Y);
    // left side: only down to where the funnel starts
    ctx.fillRect(0, TOP_Y, WALL_T, SIDE_WALL_BOTTOM_Y - TOP_Y);
    // right side: full height (encloses plunger lane)
    ctx.fillRect(DESIGN_W - WALL_T, TOP_Y, WALL_T, FIELD_BOTTOM_Y - TOP_Y);
    // accent line under top wall
    ctx.fillStyle = "#ff6ec7";
    ctx.fillRect(WALL_T, TOP_Y, DESIGN_W - 2 * WALL_T, 2);
  }

  function drawSegment(seg: SegmentDef, fillColor: string, accentColor: string | null = "#88e1ff"): void {
    const dx = seg.to.x - seg.from.x;
    const dy = seg.to.y - seg.from.y;
    const len = Math.hypot(dx, dy);
    const cx = (seg.from.x + seg.to.x) / 2;
    const cy = (seg.from.y + seg.to.y) / 2;
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = fillColor;
    ctx.fillRect(-len / 2, -seg.thick / 2, len, seg.thick);
    if (accentColor) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = accentColor;
      ctx.fillRect(-len / 2, -seg.thick / 2, len, 2);
    }
    ctx.restore();
  }

  function drawSlingshot(s: SlingshotDef, body: Matter.Body, now: number): void {
    const flashTs = slingshotFlash.get(body) ?? 0;
    const flashT = Math.max(0, 1 - (now - flashTs) / SLINGSHOT_FLASH_MS);
    ctx.save();
    ctx.translate(s.cx, s.cy);
    // body fill
    ctx.beginPath();
    s.verts.forEach((v, i) => {
      if (i === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();
    const grd = ctx.createLinearGradient(0, -22, 0, 22);
    grd.addColorStop(0, flashT > 0 ? "#cdf2ff" : "#9ad6f5");
    grd.addColorStop(1, "#3a6e9a");
    ctx.fillStyle = grd;
    ctx.fill();
    // outline
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = flashT > 0 ? "#ffffff" : "#88e1ff";
    ctx.stroke();
    // inner highlight
    if (flashT > 0) {
      ctx.globalAlpha = flashT * 0.7;
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawBumper(b: BumperDef, body: Matter.Body, now: number): void {
    const flashTs = bumperFlash.get(body) ?? 0;
    const flashT = Math.max(0, 1 - (now - flashTs) / BUMPER_FLASH_MS);
    // always-on outer halo (radial gradient fading to transparent)
    const haloR = b.r + 14 + flashT * 10;
    const halo = ctx.createRadialGradient(b.x, b.y, b.r * 0.6, b.x, b.y, haloR);
    halo.addColorStop(0, `rgba(255,110,199,${0.30 + flashT * 0.45})`);
    halo.addColorStop(1, "rgba(255,110,199,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(b.x, b.y, haloR, 0, Math.PI * 2);
    ctx.fill();
    // ring
    ctx.fillStyle = "#1a1a3a";
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 2, 0, Math.PI * 2);
    ctx.fill();
    // body gradient — flash brightens it
    const g = ctx.createRadialGradient(b.x - 4, b.y - 5, 1, b.x, b.y, b.r);
    if (flashT > 0) {
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.45, "#ffb0dc");
      g.addColorStop(1, "#c75aa0");
    } else {
      g.addColorStop(0, "#ffd0eb");
      g.addColorStop(0.5, "#ff6ec7");
      g.addColorStop(1, "#a83a85");
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    // inner cap
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // tiny core dot
    ctx.fillStyle = flashT > 0 ? "#ffffff" : "#ff6ec7";
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFlipper(f: Flipper): void {
    const body = f.body;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    // body
    const w = FLIPPER_LEN;
    const h = FLIPPER_THICK;
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    if (f.active) {
      g.addColorStop(0, "#ffd6f1");
      g.addColorStop(0.5, "#ff95d8");
      g.addColorStop(1, "#a83a85");
    } else {
      g.addColorStop(0, "#ddddff");
      g.addColorStop(0.5, "#88e1ff");
      g.addColorStop(1, "#3a6e9a");
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    } else {
      ctx.rect(-w / 2, -h / 2, w, h);
    }
    ctx.fill();
    // tip cap
    const tipX = f.isLeft ? w / 2 - 4 : -w / 2 + 4;
    ctx.fillStyle = f.active ? "#ffffff" : "#ff6ec7";
    ctx.beginPath();
    ctx.arc(tipX, 0, h / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // pivot dot
    ctx.fillStyle = "#888aaf";
    ctx.beginPath();
    ctx.arc(f.pivot.x, f.pivot.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBallTrail(): void {
    const n = ballTrail.length;
    if (n === 0) return;
    for (let i = 0; i < n; i++) {
      const p = ballTrail[i]!;
      const t = (i + 1) / n;             // newest = highest t (close to 1)
      const r = BALL_R * (0.4 + 0.5 * t);
      ctx.save();
      ctx.globalAlpha = 0.08 + 0.32 * t;
      ctx.fillStyle = "#cfd6ff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBall(): void {
    if (!ballBody) return;
    const x = ballBody.position.x;
    const y = ballBody.position.y;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(x, y + BALL_R * 0.85, BALL_R * 0.7, BALL_R * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // body
    const g = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, BALL_R);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.5, "#cfd6ff");
    g.addColorStop(1, "#5a6298");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    // highlight
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.ellipse(x - BALL_R * 0.35, y - BALL_R * 0.4, BALL_R * 0.32, BALL_R * 0.18, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlungerLane(now: number): void {
    // separator wall
    ctx.fillStyle = "#2a2a55";
    ctx.fillRect(FIELD_RIGHT_X, PLUNGER_SEPARATOR_TOP_Y, PLUNGER_SEPARATOR_THICK, PLUNGER_SEPARATOR_BOT_Y - PLUNGER_SEPARATOR_TOP_Y);
    // plunger floor
    ctx.fillStyle = "#2a2a55";
    ctx.fillRect(FIELD_RIGHT_X, PLUNGER_FLOOR_Y, DESIGN_W - WALL_T - FIELD_RIGHT_X, PLUNGER_FLOOR_THICK);
    // top deflector
    drawSegment({ from: PLUNGER_TOP_DEFLECTOR_FROM, to: PLUNGER_TOP_DEFLECTOR_TO, thick: TOP_GUIDE_THICK }, "#3a3a66", "#88e1ff");
    // lane background hint
    ctx.fillStyle = "rgba(136,225,255,0.04)";
    ctx.fillRect(FIELD_RIGHT_X + PLUNGER_SEPARATOR_THICK, PLUNGER_SEPARATOR_TOP_Y, DESIGN_W - WALL_T - FIELD_RIGHT_X - PLUNGER_SEPARATOR_THICK, PLUNGER_FLOOR_Y - PLUNGER_SEPARATOR_TOP_Y);

    // plunger pad and charge bar
    const charge = plungerCharge(now);
    const padX = PLUNGER_SPAWN_X - 10;
    const padW = 20;
    const padBaseY = PLUNGER_FLOOR_Y - 4;
    const padPushed = padBaseY + 16 + charge * 18;
    // shaft
    ctx.fillStyle = "#3a3a66";
    ctx.fillRect(padX + 4, padPushed - 50, padW - 8, 50);
    // pad cap
    ctx.fillStyle = awaitingPlunge ? "#ff6ec7" : "#5a5a8a";
    ctx.fillRect(padX, padPushed, padW, 6);
    // charge bar (vertical)
    if (awaitingPlunge) {
      const barX = DESIGN_W - WALL_T - 8;
      const barY1 = PLUNGER_FLOOR_Y - 6;
      const barH = 100;
      // bg
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(barX, barY1 - barH, 4, barH);
      // fill
      const fillH = barH * charge;
      const fillG = ctx.createLinearGradient(0, barY1 - fillH, 0, barY1);
      fillG.addColorStop(0, "#ff6ec7");
      fillG.addColorStop(1, "#88e1ff");
      ctx.fillStyle = fillG;
      ctx.fillRect(barX, barY1 - fillH, 4, fillH);
    }
    // hint text on awaiting
    if (awaitingPlunge && !plungerCharging) {
      ctx.save();
      ctx.fillStyle = "rgba(255,110,199,0.6)";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText("HOLD →", PLUNGER_SPAWN_X, PLUNGER_FLOOR_Y - 70);
      ctx.fillText("LAUNCH", PLUNGER_SPAWN_X, PLUNGER_FLOOR_Y - 58);
      ctx.restore();
    }
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
  let rafId = 0;
  let destroyed = false;
  function loop(now: number): void {
    if (destroyed) return;
    const dt = Math.min(50, now - lastTime);
    lastTime = now;

    if (!dead) {
      updateFlipper(leftFlipper);
      updateFlipper(rightFlipper);
      Matter.Engine.update(engine, dt);

      // drain detection — only if ball drained through the playfield (not in plunger lane)
      if (ballBody && ballBody.position.y > DRAIN_Y && ballBody.position.x < FIELD_RIGHT_X && !ballRespawnPending) {
        Matter.World.remove(world, ballBody);
        ballBody = null;
        ballTrail.length = 0;
        lives--;
        livesEl.textContent = String(lives);
        if (lives <= 0) {
          triggerGameOver();
        } else {
          ballRespawnPending = true;
          playSfx("error");
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
          window.setTimeout(() => {
            if (destroyed || dead) return;
            spawnBall();
            ballRespawnPending = false;
          }, 700);
        }
      }
    }

    // particle update
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.life += dt;
      if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      p.vy += 220 * dt / 1000;
      p.vx *= 0.985;
    }

    // shake decay
    if (shakeTimer > 0) {
      shakeTimer -= dt;
      if (shakeTimer <= 0) shakeStrength = 0;
    }

    // bumper flash decay (handled per-draw via timestamps; just clean stale entries)
    for (const [body, ts] of bumperFlash) {
      if (now - ts > BUMPER_FLASH_MS + 100) bumperFlash.delete(body);
    }
    for (const [body, ts] of slingshotFlash) {
      if (now - ts > SLINGSHOT_FLASH_MS + 100) slingshotFlash.delete(body);
    }

    // accumulate ball trail (only when ball is moving meaningfully)
    if (ballBody && !awaitingPlunge) {
      ballTrail.push({ x: ballBody.position.x, y: ballBody.position.y });
      if (ballTrail.length > BALL_TRAIL_LEN) ballTrail.shift();
    }

    // ── render ──
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#06061a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const shakeX = shakeTimer > 0 ? (Math.random() - 0.5) * 2 * shakeStrength : 0;
    const shakeY = shakeTimer > 0 ? (Math.random() - 0.5) * 2 * shakeStrength : 0;
    ctx.setTransform(
      dpr * scale, 0, 0,
      dpr * scale,
      dpr * (offsetX + shakeX * scale),
      dpr * (offsetY + shakeY * scale),
    );

    // backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, DESIGN_H);
    bg.addColorStop(0, "#14142e");
    bg.addColorStop(1, "#06061a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

    // playfield grid hint (only inside playfield, not plunger lane)
    ctx.strokeStyle = "rgba(136,225,255,0.05)";
    ctx.lineWidth = 0.5;
    for (let y = 60; y < FIELD_BOTTOM_Y; y += 40) {
      ctx.beginPath();
      ctx.moveTo(WALL_T, y);
      ctx.lineTo(FIELD_RIGHT_X, y);
      ctx.stroke();
    }

    drawWalls();
    // top corner guide (left)
    drawSegment({ from: TOP_GUIDE_LEFT_FROM, to: TOP_GUIDE_LEFT_TO, thick: TOP_GUIDE_THICK }, "#3a3a66", "#88e1ff");
    // funnel (2 segments per side)
    drawSegment(LEFT_FUNNEL_1,  "#3a3a66", "#88e1ff");
    drawSegment(LEFT_FUNNEL_2,  "#3a3a66", "#88e1ff");
    drawSegment(RIGHT_FUNNEL_1, "#3a3a66", "#88e1ff");
    drawSegment(RIGHT_FUNNEL_2, "#3a3a66", "#88e1ff");

    // plunger lane (separator + deflector + plunger pad + charge bar)
    drawPlungerLane(now);

    // slingshots before bumpers (slingshots are lower-z visually)
    SLINGSHOTS.forEach((s, i) => drawSlingshot(s, slingshotBodies[i]!, now));
    BUMPERS.forEach((b, i) => drawBumper(b, bumperBodies[i]!, now));

    drawFlipper(leftFlipper);
    drawFlipper(rightFlipper);
    drawBallTrail();
    drawBall();
    drawParticles();

    // drain warning line
    ctx.strokeStyle = "rgba(255,110,199,0.18)";
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, FIELD_BOTTOM_Y);
    ctx.lineTo(DESIGN_W, FIELD_BOTTOM_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    rafId = requestAnimationFrame(loop);
  }

  function triggerGameOver(): void {
    if (dead) return;
    dead = true;
    if (ballBody) {
      Matter.World.remove(world, ballBody);
      ballBody = null;
    }
    playSfx("gameover");
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    overScoreEl.textContent = String(score);
    overEl.style.display = "flex";
    void submit(GAME_ID, score);
  }

  function reset(): void {
    if (ballBody) {
      Matter.World.remove(world, ballBody);
      ballBody = null;
    }
    score = 0;
    scoreEl.textContent = "0";
    lives = LIVES_INIT;
    livesEl.textContent = String(lives);
    dead = false;
    ballRespawnPending = false;
    overEl.style.display = "none";
    particles.length = 0;
    bumperFlash.clear();
    slingshotFlash.clear();
    ballTrail.length = 0;
    shakeStrength = 0;
    shakeTimer = 0;
    pointers.clear();
    keyLeft = false;
    keyRight = false;
    leftFlipper.active = false;
    rightFlipper.active = false;
    plungerCharging = false;
    awaitingPlunge = false;
    Matter.Body.setAngle(leftFlipper.body, leftFlipper.restAngle);
    Matter.Body.setAngle(rightFlipper.body, rightFlipper.restAngle);
    spawnBall();
  }

  rafId = requestAnimationFrame(loop);

  // ─── cleanup ────────────────────────────────────────────────────────────────
  return (): void => {
    destroyed = true;
    cancelAnimationFrame(rafId);
    ro.disconnect();
    Matter.Events.off(engine, "collisionStart");
    Matter.World.clear(world, false);
    Matter.Engine.clear(engine);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerUp);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    fsBtn.removeEventListener("pointerup", onFsClick);
    againBtn.removeEventListener("pointerup", onAgainClick);
    wrap.remove();
    style.remove();
    container.classList.remove("pinball-root");
    container.style.touchAction = prevTouchAction;
  };
}
