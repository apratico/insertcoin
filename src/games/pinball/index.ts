// Pinball — classic arcade feel, Matter.js rigid body physics.
// Portrait table. Left half of screen = left flipper, right half = right.
// Pull plunger down and release to launch ball.
//
// Table elements (MVP):
//  - Outer walls + angled top shield
//  - 3 chrome pop bumpers (top third) — big score + repel
//  - 2 triangular slingshots above flippers — kick ball away
//  - 5 drop targets row — all down = jackpot
//  - 2 flippers at bottom, hinged via Matter constraint
//  - Plunger lane on right, spring launches ball
//  - Drain gap between flippers → lose ball
//
// Visuals: chrome gradients, LED-style score, red/blue neon accents.
// Audio: bumper pop, slingshot kick, target drop, flipper whack,
//        ball lost, jackpot, game over.

import Matter from "matter-js";
import { submit } from "../../lib/leaderboard.js";
import { playSfx } from "../../lib/audio.js";

const GAME_ID = "pinball";
const DESIGN_W = 360;
const DESIGN_H = 640;

// ─── table dims ───────────────────────────────────────────────────────────────
const WALL = 6;
const PLAYFIELD_LEFT = 20;
const PLAYFIELD_RIGHT = 340;
const PLAYFIELD_TOP = 40;
const PLAYFIELD_BOTTOM = 610;
const PLUNGER_LANE_LEFT = 322;   // narrow lane on the right
const PLUNGER_LANE_TOP = 60;
const PLUNGER_START_Y = 560;
const DRAIN_LEFT = 140;
const DRAIN_RIGHT = 220;
const BALL_RADIUS = 10;

// Flippers
const FLIPPER_LEN = 60;
const FLIPPER_THICK = 9;
const LEFT_FLIPPER_PIVOT = { x: 120, y: 560 };
const RIGHT_FLIPPER_PIVOT = { x: 220, y: 560 };
const FLIPPER_REST_DEG = 28;     // resting downward angle
const FLIPPER_FLIP_DEG = -30;    // peak flip angle
const FLIPPER_SPEED = 0.8;       // lerp per tick

// Bumpers
interface BumperDef { x: number; y: number; r: number; color: string; }
const BUMPERS: BumperDef[] = [
  { x: 110, y: 170, r: 22, color: "#ff3355" },
  { x: 180, y: 135, r: 22, color: "#33c0ff" },
  { x: 250, y: 170, r: 22, color: "#ffcc33" },
];

// Slingshots (triangles) — positions as three-point polygons
interface Sling { x: number; y: number; points: [number, number][]; }
const SLINGS: Sling[] = [
  { x: 70, y: 490,  points: [[0,-24],[24,16],[-12,16]] },  // left, point up-right
  { x: 270, y: 490, points: [[0,-24],[12,16],[-24,16]] },  // right, point up-left
];

// Drop targets row — linear row of tall narrow blocks across middle
const DROP_ROW_Y = 330;
const DROP_TARGET_COUNT = 5;
const DROP_TARGET_WIDTH = 30;
const DROP_TARGET_HEIGHT = 14;

// Scoring
const SCORE_BUMPER = 150;
const SCORE_SLING = 100;
const SCORE_TARGET = 500;
const SCORE_JACKPOT = 10000;

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
    <div class="pinball-score-box">
      <div class="pinball-score-label">SCORE</div>
      <div class="pinball-score" id="pb-score">00000000</div>
    </div>
    <div class="pinball-status">
      <div class="pinball-ball-label">BALL <span id="pb-ball">1</span>/3</div>
      <div class="pinball-best" id="pb-best">BEST 0</div>
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
      <div class="pinball-over-sub">FINAL SCORE</div>
      <div class="pinball-over-score" id="pb-over-score">0</div>
      <button class="pinball-over-btn" id="pb-again">PLAY AGAIN</button>
    </div>
  `;
  wrap.appendChild(over);

  // onboarding hint
  const hintKey = "pinball:seenHint";
  let seenHint = false;
  try { seenHint = !!localStorage.getItem(hintKey); } catch { /* ok */ }
  if (!seenHint) {
    try { localStorage.setItem(hintKey, "1"); } catch { /* ok */ }
    const hint = document.createElement("div");
    hint.className = "pinball-hint";
    hint.innerHTML = `
      <div class="pinball-hint-box">
        <div>TIENI SX/DX = FLIPPER SX/DX</div>
        <div class="sub">TIENI IN BASSO A DX = CARICA PLUNGER · RILASCIA = LANCIO</div>
      </div>
    `;
    wrap.appendChild(hint);
    setTimeout(() => hint.remove(), 5500);
  }

  // ─── styles ─────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    .pinball-root { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .pinball-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, #1a0220 0%, #050007 100%);
      position: relative;
      overflow: hidden;
      min-height: 0;
    }
    .pinball-hud {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 14px;
      font-family: "Courier New", monospace;
      color: #fff;
      flex-shrink: 0;
      background: linear-gradient(180deg, #22002c, #0f0014);
      border-bottom: 2px solid #ff3388;
      box-shadow: 0 0 16px rgba(255,51,136,0.3);
    }
    .pinball-score-box { display: flex; flex-direction: column; }
    .pinball-score-label { font-size: 9px; letter-spacing: 3px; color: #ff88bb; }
    .pinball-score {
      font-size: 26px;
      font-weight: bold;
      color: #ff3366;
      font-family: "Courier New", monospace;
      text-shadow: 0 0 8px #ff3366, 0 0 16px #ff3366;
      letter-spacing: 2px;
    }
    .pinball-status { text-align: right; }
    .pinball-ball-label { font-size: 11px; color: #ffcc33; letter-spacing: 2px; font-weight: bold; }
    .pinball-best { font-size: 10px; color: #8899bb; letter-spacing: 1px; margin-top: 2px; }
    .pinball-canvas {
      flex: 1;
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
    .pinball-over {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(4px);
      z-index: 60;
    }
    .pinball-over-card {
      background: #1a0220;
      padding: 24px 36px;
      border-radius: 14px;
      border: 3px solid #ff3388;
      box-shadow: 0 0 24px rgba(255,51,136,0.5);
      text-align: center;
      color: #fff;
      font-family: "Courier New", monospace;
      min-width: 240px;
    }
    .pinball-over-title {
      color: #ff3388;
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 14px;
      text-shadow: 0 0 12px #ff3388;
      letter-spacing: 3px;
    }
    .pinball-over-sub { font-size: 10px; color: #ffaacc; letter-spacing: 2px; }
    .pinball-over-score {
      font-size: 38px;
      font-weight: bold;
      color: #ffcc33;
      text-shadow: 0 0 10px #ffcc33;
      margin: 6px 0 20px;
      letter-spacing: 2px;
    }
    .pinball-over-btn {
      background: #ff3388;
      color: #fff;
      border: none;
      padding: 14px 24px;
      border-radius: 8px;
      font-family: "Courier New", monospace;
      font-weight: bold;
      font-size: 13px;
      letter-spacing: 2px;
      cursor: pointer;
      min-width: 160px;
      box-shadow: 0 0 12px rgba(255,51,136,0.6);
    }
    .pinball-over-btn:active { transform: scale(0.96); }
    .pinball-hint {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; z-index: 50;
    }
    .pinball-hint-box {
      background: rgba(0,0,0,0.75);
      padding: 14px 22px;
      border-radius: 10px;
      color: #fff;
      font-family: monospace;
      font-size: 13px;
      font-weight: bold;
      text-align: center;
      border: 2px solid #ff3388;
    }
    .pinball-hint-box .sub {
      font-size: 9px;
      color: #ffaacc;
      margin-top: 6px;
      font-weight: normal;
    }
    .pinball-popup {
      position: absolute;
      color: #ffcc33;
      font-family: "Courier New", monospace;
      font-weight: bold;
      font-size: 16px;
      text-shadow: 0 0 8px #ff3388;
      pointer-events: none;
      z-index: 40;
      transition: transform 0.7s ease-out, opacity 0.7s ease-out;
    }
  `;
  wrap.appendChild(style);

  // ─── refs ───────────────────────────────────────────────────────────────────
  const scoreEl = hud.querySelector("#pb-score") as HTMLElement;
  const bestEl  = hud.querySelector("#pb-best")  as HTMLElement;
  const ballEl  = hud.querySelector("#pb-ball")  as HTMLElement;
  const overScoreEl = over.querySelector("#pb-over-score") as HTMLElement;
  const againBtn = over.querySelector("#pb-again") as HTMLButtonElement;
  const ctx = canvas.getContext("2d")!;

  // ─── state ──────────────────────────────────────────────────────────────────
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  const engine = Matter.Engine.create();
  engine.gravity.y = 1.1;
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  const world = engine.world;

  // ─── static table ───────────────────────────────────────────────────────────
  const walls: Matter.Body[] = [];
  function makeWall(x: number, y: number, w: number, h: number, angle = 0): Matter.Body {
    const b = Matter.Bodies.rectangle(x, y, w, h, { isStatic: true, angle, restitution: 0.4 });
    walls.push(b);
    return b;
  }
  // outer frame
  const wallL  = makeWall(PLAYFIELD_LEFT + WALL / 2, (PLAYFIELD_TOP + PLAYFIELD_BOTTOM) / 2, WALL, PLAYFIELD_BOTTOM - PLAYFIELD_TOP);
  const wallR  = makeWall(PLAYFIELD_RIGHT - WALL / 2, (PLAYFIELD_TOP + PLAYFIELD_BOTTOM) / 2, WALL, PLAYFIELD_BOTTOM - PLAYFIELD_TOP);
  const wallT  = makeWall((PLAYFIELD_LEFT + PLAYFIELD_RIGHT) / 2, PLAYFIELD_TOP + WALL / 2, PLAYFIELD_RIGHT - PLAYFIELD_LEFT, WALL);
  // plunger-lane divider (vertical)
  const laneDiv = makeWall(PLUNGER_LANE_LEFT - WALL / 2, (PLUNGER_LANE_TOP + PLUNGER_START_Y) / 2, WALL, PLUNGER_START_Y - PLUNGER_LANE_TOP);
  // lane cap (angled to force ball leftward at top)
  const laneCap = makeWall(
    (PLUNGER_LANE_LEFT + PLAYFIELD_RIGHT) / 2 - 6,
    PLUNGER_LANE_TOP + 8,
    46, 5,
    -0.4
  );
  // funnel deflectors leading to flippers (angled walls)
  const deflLeft = makeWall(70, 520, 80, WALL, 0.55);
  const deflRight = makeWall(270, 520, 80, WALL, -0.55);
  // drain guard posts (small nubs)
  const postL = Matter.Bodies.circle(DRAIN_LEFT - 4, 585, 4, { isStatic: true });
  const postR = Matter.Bodies.circle(DRAIN_RIGHT + 4, 585, 4, { isStatic: true });
  walls.push(wallL, wallR, wallT, laneDiv, laneCap, deflLeft, deflRight, postL, postR);
  Matter.World.add(world, walls);

  // ─── bumpers ────────────────────────────────────────────────────────────────
  interface BumperBody { body: Matter.Body; def: BumperDef; flash: number; }
  const bumpers: BumperBody[] = BUMPERS.map((def) => {
    const b = Matter.Bodies.circle(def.x, def.y, def.r, {
      isStatic: true,
      label: `bumper`,
      restitution: 1.4,
    });
    Matter.World.add(world, b);
    return { body: b, def, flash: 0 };
  });

  // ─── slingshots ─────────────────────────────────────────────────────────────
  interface SlingBody { body: Matter.Body; def: Sling; flash: number; }
  const slings: SlingBody[] = SLINGS.map((def) => {
    const verts = def.points.map(([px, py]) => ({ x: px, y: py }));
    const b = Matter.Bodies.fromVertices(def.x, def.y, [verts], {
      isStatic: true,
      label: `sling`,
      restitution: 1.2,
    });
    Matter.World.add(world, b);
    return { body: b, def, flash: 0 };
  });

  // ─── drop targets ───────────────────────────────────────────────────────────
  interface DropTarget { body: Matter.Body; down: boolean; x: number; y: number; }
  const dropTargets: DropTarget[] = [];
  const rowWidth = DROP_TARGET_COUNT * DROP_TARGET_WIDTH + (DROP_TARGET_COUNT - 1) * 6;
  const rowStart = (PLAYFIELD_LEFT + PLAYFIELD_RIGHT - 40) / 2 - rowWidth / 2;
  for (let i = 0; i < DROP_TARGET_COUNT; i++) {
    const tx = rowStart + i * (DROP_TARGET_WIDTH + 6) + DROP_TARGET_WIDTH / 2;
    const ty = DROP_ROW_Y;
    const b = Matter.Bodies.rectangle(tx, ty, DROP_TARGET_WIDTH, DROP_TARGET_HEIGHT, {
      isStatic: true,
      label: `target-${i}`,
      restitution: 0.3,
    });
    Matter.World.add(world, b);
    dropTargets.push({ body: b, down: false, x: tx, y: ty });
  }

  // ─── flippers ───────────────────────────────────────────────────────────────
  interface Flipper {
    body: Matter.Body;
    pivot: { x: number; y: number };
    side: -1 | 1;      // -1 = left, 1 = right
    restAngle: number;
    flipAngle: number;
    target: number;    // current target angle
    angle: number;     // current angle
    active: boolean;
  }
  function makeFlipper(pivot: { x: number; y: number }, side: -1 | 1): Flipper {
    const restAngle = side === -1 ? FLIPPER_REST_DEG * Math.PI / 180 : Math.PI - FLIPPER_REST_DEG * Math.PI / 180;
    const flipAngle = side === -1 ? FLIPPER_FLIP_DEG * Math.PI / 180 : Math.PI - FLIPPER_FLIP_DEG * Math.PI / 180;
    // body extends FROM pivot outward; centroid at half length from pivot
    const cx = pivot.x + Math.cos(restAngle) * FLIPPER_LEN / 2;
    const cy = pivot.y + Math.sin(restAngle) * FLIPPER_LEN / 2;
    const body = Matter.Bodies.rectangle(cx, cy, FLIPPER_LEN, FLIPPER_THICK, {
      angle: restAngle,
      label: `flipper`,
      density: 0.03,
      friction: 0.1,
      restitution: 0.4,
    });
    // Constrain the pivot end to the pivot point
    const pinConstraint = Matter.Constraint.create({
      pointA: pivot,
      bodyB: body,
      pointB: { x: -FLIPPER_LEN / 2, y: 0 },
      stiffness: 1,
      length: 0,
    });
    Matter.World.add(world, [body, pinConstraint]);
    return { body, pivot, side, restAngle, flipAngle, target: restAngle, angle: restAngle, active: false };
  }
  const leftFlipper  = makeFlipper(LEFT_FLIPPER_PIVOT,  -1);
  const rightFlipper = makeFlipper(RIGHT_FLIPPER_PIVOT, 1);

  // ─── ball ───────────────────────────────────────────────────────────────────
  let ball: Matter.Body | null = null;
  function createBall(x: number, y: number): Matter.Body {
    const b = Matter.Bodies.circle(x, y, BALL_RADIUS, {
      label: "ball",
      restitution: 0.6,
      friction: 0.002,
      frictionAir: 0.006,
      density: 0.05,
    });
    Matter.World.add(world, b);
    return b;
  }

  // ─── plunger ────────────────────────────────────────────────────────────────
  let plungerCharge = 0;  // 0..1
  let plungerCharging = false;

  // ─── game state ─────────────────────────────────────────────────────────────
  let score = 0;
  let best = 0;
  let ballNumber = 1;
  const BALLS_PER_GAME = 3;
  let dead = false;
  let waitingLaunch = true;
  let lastTime = performance.now();

  // juice
  interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
  const particles: Particle[] = [];
  let shakeStrength = 0;
  let shakeTimer = 0;
  let flashAlpha = 0;
  let flashColor: [number, number, number] = [255, 255, 255];

  try {
    const raw = localStorage.getItem("pinball:best");
    if (raw) best = parseInt(raw, 10) || 0;
  } catch { /* ok */ }
  bestEl.textContent = `BEST ${best}`;

  function padScore(n: number): string {
    return String(n).padStart(8, "0");
  }
  scoreEl.textContent = padScore(0);

  // reset ball at plunger
  function resetBallToPlunger(): void {
    if (ball) Matter.World.remove(world, ball);
    const bx = (PLUNGER_LANE_LEFT + PLAYFIELD_RIGHT) / 2;
    ball = createBall(bx, PLUNGER_START_Y - BALL_RADIUS);
    Matter.Body.setVelocity(ball, { x: 0, y: 0 });
    waitingLaunch = true;
    plungerCharge = 0;
  }

  resetBallToPlunger();

  // ─── collision handlers ────────────────────────────────────────────────────
  Matter.Events.on(engine, "collisionStart", (event) => {
    if (dead) return;
    for (const pair of event.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const ballBody = a.label === "ball" ? a : b.label === "ball" ? b : null;
      if (!ballBody) continue;
      const other = ballBody === a ? b : a;
      const label = other.label;
      if (label === "bumper") {
        const bb = bumpers.find((x) => x.body === other);
        if (bb) {
          addScore(SCORE_BUMPER);
          bb.flash = 200;
          applyKickFromPoint(ballBody, other.position, 14);
          spawnParticles(ballBody.position.x, ballBody.position.y, bb.def.color, 10);
          addShake(2.5, 100);
          playSfx("bounce");
          if (navigator.vibrate) navigator.vibrate(6);
        }
      } else if (label === "sling") {
        const ss = slings.find((x) => x.body === other);
        if (ss) {
          addScore(SCORE_SLING);
          ss.flash = 150;
          applyKickFromPoint(ballBody, other.position, 10);
          spawnParticles(ballBody.position.x, ballBody.position.y, "#88eaff", 6);
          playSfx("pop");
          if (navigator.vibrate) navigator.vibrate(4);
        }
      } else if (label.startsWith("target-")) {
        const idx = parseInt(label.slice(7), 10);
        const t = dropTargets[idx];
        if (t && !t.down) {
          t.down = true;
          Matter.World.remove(world, t.body);
          addScore(SCORE_TARGET);
          spawnParticles(t.x, t.y, "#ffcc33", 10);
          addShake(1.5, 80);
          playSfx("coin");
          // check jackpot: all down
          if (dropTargets.every((x) => x.down)) {
            addScore(SCORE_JACKPOT);
            flashAlpha = 1;
            flashColor = [255, 240, 120];
            addShake(14, 500);
            playSfx("fanfare");
            if (navigator.vibrate) navigator.vibrate([60, 40, 120, 40, 160]);
            // reset all targets after brief delay
            setTimeout(() => {
              dropTargets.forEach((tt) => {
                if (tt.down) {
                  tt.down = false;
                  Matter.World.add(world, tt.body);
                }
              });
            }, 1200);
          }
          if (navigator.vibrate) navigator.vibrate(10);
        }
      }
    }
  });

  function applyKickFromPoint(ballBody: Matter.Body, from: Matter.Vector, strength: number): void {
    const dx = ballBody.position.x - from.x;
    const dy = ballBody.position.y - from.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    Matter.Body.setVelocity(ballBody, {
      x: (dx / d) * strength,
      y: (dy / d) * strength,
    });
  }

  function addScore(pts: number): void {
    score += pts;
    scoreEl.textContent = padScore(score);
    if (score > best) {
      best = score;
      bestEl.textContent = `BEST ${best}`;
      try { localStorage.setItem("pinball:best", String(best)); } catch { /* ok */ }
    }
  }

  function spawnParticles(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 180;
      particles.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0,
        maxLife: 300 + Math.random() * 300,
        color: i % 3 === 0 ? "#ffffff" : color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function addShake(strength: number, duration: number): void {
    if (strength > shakeStrength) shakeStrength = strength;
    if (duration > shakeTimer) shakeTimer = duration;
  }

  // ─── input ──────────────────────────────────────────────────────────────────
  const activePointers = new Map<number, "left" | "right" | "plunger">();

  function classifyPointer(e: PointerEvent): "left" | "right" | "plunger" {
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const x = (cssX - offsetX) / scale;
    const y = (cssY - offsetY) / scale;
    // plunger zone: bottom-right corner
    if (x > PLUNGER_LANE_LEFT - 20 && y > 400) return "plunger";
    return x < DESIGN_W / 2 ? "left" : "right";
  }

  function onPtrDown(e: PointerEvent): void {
    if (dead) return;
    const kind = classifyPointer(e);
    activePointers.set(e.pointerId, kind);
    if (kind === "left")  leftFlipper.active = true;
    if (kind === "right") rightFlipper.active = true;
    if (kind === "plunger") { plungerCharging = true; }
  }
  function onPtrUp(e: PointerEvent): void {
    const kind = activePointers.get(e.pointerId);
    activePointers.delete(e.pointerId);
    if (kind === "left")  leftFlipper.active = false;
    if (kind === "right") rightFlipper.active = false;
    if (kind === "plunger") {
      if (waitingLaunch && ball) {
        const power = 6 + plungerCharge * 26;  // 6..32 velocity
        Matter.Body.setVelocity(ball, { x: 0, y: -power });
        playSfx("go");
        waitingLaunch = false;
      }
      plungerCharging = false;
      plungerCharge = 0;
    }
  }
  canvas.addEventListener("pointerdown", onPtrDown);
  canvas.addEventListener("pointerup", onPtrUp);
  canvas.addEventListener("pointercancel", onPtrUp);
  canvas.addEventListener("pointerleave", onPtrUp);

  // keyboard (desktop)
  const onKeyDown = (e: KeyboardEvent) => {
    if (dead) return;
    if (e.key === "ArrowLeft" || e.key === "a") leftFlipper.active = true;
    if (e.key === "ArrowRight" || e.key === "d") rightFlipper.active = true;
    if (e.key === " " || e.key === "Spacebar") {
      plungerCharging = true;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "a") leftFlipper.active = false;
    if (e.key === "ArrowRight" || e.key === "d") rightFlipper.active = false;
    if (e.key === " " || e.key === "Spacebar") {
      if (waitingLaunch && ball) {
        const power = 6 + plungerCharge * 26;
        Matter.Body.setVelocity(ball, { x: 0, y: -power });
        playSfx("go");
        waitingLaunch = false;
      }
      plungerCharging = false;
      plungerCharge = 0;
    }
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  againBtn.addEventListener("pointerdown", () => { resetGame(); });

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

  // ─── loop ───────────────────────────────────────────────────────────────────
  function loop(now: number): void {
    if (destroyed) return;
    const dt = Math.min(50, now - lastTime);
    lastTime = now;

    // flipper update
    updateFlipper(leftFlipper, dt);
    updateFlipper(rightFlipper, dt);

    // plunger charging
    if (plungerCharging && plungerCharge < 1) {
      plungerCharge = Math.min(1, plungerCharge + dt / 900);
    }

    // physics
    if (!dead) Matter.Engine.update(engine, dt);

    // check drain
    if (ball && !waitingLaunch && ball.position.y > PLAYFIELD_BOTTOM + 20) {
      loseBall();
    }

    // juice
    if (shakeTimer > 0) { shakeTimer -= dt; if (shakeTimer <= 0) shakeStrength = 0; }
    if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt / 500);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.life += dt;
      if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      p.vy += 260 * dt / 1000;
      p.vx *= 0.98;
    }
    for (const bmp of bumpers) if (bmp.flash > 0) bmp.flash -= dt;
    for (const ss of slings) if (ss.flash > 0) ss.flash -= dt;

    render();
    rafId = requestAnimationFrame(loop);
  }

  function updateFlipper(f: Flipper, dt: number): void {
    f.target = f.active ? f.flipAngle : f.restAngle;
    const k = Math.min(1, (FLIPPER_SPEED * dt) / 16);
    const next = f.angle + (f.target - f.angle) * k;
    Matter.Body.setAngle(f.body, next);
    Matter.Body.setAngularVelocity(f.body, (next - f.angle) / (dt / 1000));
    f.angle = next;
  }

  function loseBall(): void {
    if (!ball) return;
    playSfx("lose");
    if (navigator.vibrate) navigator.vibrate([40, 60, 80]);
    if (ballNumber >= BALLS_PER_GAME) {
      gameOver();
      return;
    }
    ballNumber++;
    ballEl.textContent = String(ballNumber);
    resetBallToPlunger();
  }

  function gameOver(): void {
    if (dead) return;
    dead = true;
    playSfx("gameover");
    overScoreEl.textContent = padScore(score);
    over.style.display = "flex";
    void submit(GAME_ID, score);
  }

  function resetGame(): void {
    // restore all drop targets
    dropTargets.forEach((t) => {
      if (t.down) { t.down = false; Matter.World.add(world, t.body); }
    });
    score = 0;
    ballNumber = 1;
    dead = false;
    scoreEl.textContent = padScore(0);
    ballEl.textContent = "1";
    over.style.display = "none";
    particles.length = 0;
    shakeStrength = 0; shakeTimer = 0;
    flashAlpha = 0;
    resetBallToPlunger();
  }

  // ─── render ────────────────────────────────────────────────────────────────
  function render(): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#050007";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const shakeX = shakeTimer > 0 ? (Math.random() - 0.5) * 2 * shakeStrength : 0;
    const shakeY = shakeTimer > 0 ? (Math.random() - 0.5) * 2 * shakeStrength : 0;
    ctx.setTransform(
      dpr * scale, 0, 0,
      dpr * scale,
      dpr * (offsetX + shakeX * scale),
      dpr * (offsetY + shakeY * scale)
    );

    drawTable();
    drawDropTargets();
    drawBumpers();
    drawSlings();
    drawFlipper(leftFlipper);
    drawFlipper(rightFlipper);
    drawPlunger();
    drawBall();
    drawParticles();

    if (flashAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = flashAlpha * 0.6;
      ctx.fillStyle = `rgb(${flashColor[0]},${flashColor[1]},${flashColor[2]})`;
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      ctx.restore();
    }
  }

  function drawTable(): void {
    // playfield background — deep velvet with subtle vignette
    const g = ctx.createRadialGradient(DESIGN_W / 2, 200, 60, DESIGN_W / 2, 400, 450);
    g.addColorStop(0, "#2a0840");
    g.addColorStop(1, "#0a0014");
    ctx.fillStyle = g;
    ctx.fillRect(PLAYFIELD_LEFT, PLAYFIELD_TOP, PLAYFIELD_RIGHT - PLAYFIELD_LEFT, PLAYFIELD_BOTTOM - PLAYFIELD_TOP);

    // chrome walls
    drawWall(PLAYFIELD_LEFT, PLAYFIELD_TOP, WALL, PLAYFIELD_BOTTOM - PLAYFIELD_TOP);
    drawWall(PLAYFIELD_RIGHT - WALL, PLAYFIELD_TOP, WALL, PLAYFIELD_BOTTOM - PLAYFIELD_TOP);
    drawWall(PLAYFIELD_LEFT, PLAYFIELD_TOP, PLAYFIELD_RIGHT - PLAYFIELD_LEFT, WALL);
    // plunger lane div
    drawWall(PLUNGER_LANE_LEFT - WALL, PLUNGER_LANE_TOP, WALL, PLUNGER_START_Y - PLUNGER_LANE_TOP);

    // lane cap (rotated) — small tilted bar at top of plunger lane
    ctx.save();
    ctx.translate((PLUNGER_LANE_LEFT + PLAYFIELD_RIGHT) / 2 - 6, PLUNGER_LANE_TOP + 8);
    ctx.rotate(-0.4);
    drawWall(-23, -2.5, 46, 5);
    ctx.restore();

    // deflectors near flippers
    drawAngledBar(70, 520, 80, WALL, 0.55);
    drawAngledBar(270, 520, 80, WALL, -0.55);

    // drain arrows
    ctx.fillStyle = "#ff3366";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("▼", (DRAIN_LEFT + DRAIN_RIGHT) / 2, 620);
    ctx.textAlign = "left";

    // posts
    ctx.fillStyle = "#aabbcc";
    ctx.beginPath(); ctx.arc(DRAIN_LEFT - 4, 585, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(DRAIN_RIGHT + 4, 585, 4, 0, Math.PI * 2); ctx.fill();
  }

  function drawWall(x: number, y: number, w: number, h: number): void {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#ddd");
    g.addColorStop(0.4, "#889");
    g.addColorStop(1, "#334");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, y, w, h);
  }

  function drawAngledBar(cx: number, cy: number, w: number, h: number, angle: number): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    drawWall(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function drawBumpers(): void {
    for (const bmp of bumpers) {
      const flashAmt = Math.max(0, bmp.flash / 200);
      const r = bmp.def.r + flashAmt * 4;
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(bmp.def.x, bmp.def.y + r * 0.4, r * 0.9, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // base ring
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(bmp.def.x, bmp.def.y, r + 3, 0, Math.PI * 2);
      ctx.fill();
      // colored cap with radial gradient
      const g = ctx.createRadialGradient(bmp.def.x - r * 0.3, bmp.def.y - r * 0.3, r * 0.1, bmp.def.x, bmp.def.y, r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.4, bmp.def.color);
      g.addColorStop(1, shade(bmp.def.color, -0.4));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bmp.def.x, bmp.def.y, r, 0, Math.PI * 2);
      ctx.fill();
      // highlight
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.ellipse(bmp.def.x - r * 0.35, bmp.def.y - r * 0.4, r * 0.3, r * 0.2, -0.5, 0, Math.PI * 2);
      ctx.fill();
      // flash glow ring
      if (flashAmt > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${flashAmt})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(bmp.def.x, bmp.def.y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawSlings(): void {
    for (const ss of slings) {
      const flashAmt = Math.max(0, ss.flash / 150);
      ctx.save();
      ctx.translate(ss.def.x, ss.def.y);
      ctx.beginPath();
      const pts = ss.def.points;
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
      ctx.closePath();
      const col = flashAmt > 0 ? "#ffffff" : "#00aaff";
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = "#004466";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawDropTargets(): void {
    for (const t of dropTargets) {
      if (t.down) {
        // draw dim ghost indicator where it was
        ctx.fillStyle = "rgba(100,100,100,0.25)";
        ctx.fillRect(t.x - DROP_TARGET_WIDTH / 2, t.y - DROP_TARGET_HEIGHT / 2, DROP_TARGET_WIDTH, DROP_TARGET_HEIGHT);
      } else {
        // shiny metallic target
        const g = ctx.createLinearGradient(t.x - DROP_TARGET_WIDTH / 2, t.y, t.x + DROP_TARGET_WIDTH / 2, t.y);
        g.addColorStop(0, "#ffaa33");
        g.addColorStop(0.5, "#ffffcc");
        g.addColorStop(1, "#cc7711");
        ctx.fillStyle = g;
        ctx.fillRect(t.x - DROP_TARGET_WIDTH / 2, t.y - DROP_TARGET_HEIGHT / 2, DROP_TARGET_WIDTH, DROP_TARGET_HEIGHT);
        ctx.strokeStyle = "#884400";
        ctx.lineWidth = 1;
        ctx.strokeRect(t.x - DROP_TARGET_WIDTH / 2, t.y - DROP_TARGET_HEIGHT / 2, DROP_TARGET_WIDTH, DROP_TARGET_HEIGHT);
      }
    }
  }

  function drawFlipper(f: Flipper): void {
    ctx.save();
    ctx.translate(f.body.position.x, f.body.position.y);
    ctx.rotate(f.body.angle);
    // body — chrome gradient
    const g = ctx.createLinearGradient(0, -FLIPPER_THICK / 2, 0, FLIPPER_THICK / 2);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, "#aaaaaa");
    g.addColorStop(1, "#333333");
    ctx.fillStyle = g;
    ctx.fillRect(-FLIPPER_LEN / 2, -FLIPPER_THICK / 2, FLIPPER_LEN, FLIPPER_THICK);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.strokeRect(-FLIPPER_LEN / 2, -FLIPPER_THICK / 2, FLIPPER_LEN, FLIPPER_THICK);
    // tip rounded
    ctx.fillStyle = "#aaa";
    ctx.beginPath();
    ctx.arc(FLIPPER_LEN / 2, 0, FLIPPER_THICK / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // pivot cap
    ctx.fillStyle = "#ffcc33";
    ctx.beginPath();
    ctx.arc(f.pivot.x, f.pivot.y, FLIPPER_THICK / 2 + 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlunger(): void {
    const laneX = (PLUNGER_LANE_LEFT + PLAYFIELD_RIGHT) / 2;
    const plungerY = PLUNGER_START_Y + 10 + plungerCharge * 30;
    // shaft
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(laneX, plungerY);
    ctx.lineTo(laneX, PLAYFIELD_BOTTOM - 4);
    ctx.stroke();
    // knob
    const g = ctx.createRadialGradient(laneX - 3, plungerY - 3, 1, laneX, plungerY, 7);
    g.addColorStop(0, "#ff88aa");
    g.addColorStop(1, "#881122");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(laneX, plungerY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // charge meter
    if (plungerCharging) {
      ctx.fillStyle = "#ff3366";
      ctx.fillRect(PLAYFIELD_RIGHT - 12, plungerY - 40, 8, 40 * plungerCharge);
    }
  }

  function drawBall(): void {
    if (!ball) return;
    const x = ball.position.x;
    const y = ball.position.y;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.ellipse(x, y + BALL_RADIUS * 0.9, BALL_RADIUS * 0.9, BALL_RADIUS * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // steel gradient
    const g = ctx.createRadialGradient(x - BALL_RADIUS * 0.4, y - BALL_RADIUS * 0.5, BALL_RADIUS * 0.1, x, y, BALL_RADIUS);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.3, "#ddd");
    g.addColorStop(0.7, "#888");
    g.addColorStop(1, "#222");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    // tiny highlight
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(x - BALL_RADIUS * 0.4, y - BALL_RADIUS * 0.45, BALL_RADIUS * 0.22, 0, Math.PI * 2);
    ctx.fill();
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

  function shade(hex: string, pct: number): string {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const adjust = (c: number) => Math.max(0, Math.min(255, Math.round(c + c * pct)));
    return `rgb(${adjust(r)},${adjust(g)},${adjust(b)})`;
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
    canvas.removeEventListener("pointerdown", onPtrDown);
    canvas.removeEventListener("pointerup", onPtrUp);
    canvas.removeEventListener("pointercancel", onPtrUp);
    canvas.removeEventListener("pointerleave", onPtrUp);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    wrap.remove();
    style.remove();
    container.classList.remove("pinball-root");
    container.style.touchAction = prevTouchAction;
  };
}
