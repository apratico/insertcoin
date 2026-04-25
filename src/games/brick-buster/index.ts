// Brick Buster — Arkanoid-faithful brick-breaker on Phaser 4.
// Lessons applied from Star Void:
//   - Phaser 4 named import (default export dropped)
//   - Three-scene split (Boot/Play/UI) with launch-in-parallel UI
//   - Procedural Canvas textures (no PNG)
//   - Object pooling via Group.maxSize for bullets/particles
//   - In-scene soft reset (no scene.stop/start which proved flaky)
//   - Reset all class fields explicitly in create() (Phaser instances are reused)
//   - Cross-scene events via UI scene event bus (not registry — registry
//     changedata may not fire if value unchanged, races with scene lifecycle)
//   - Mount contract: classList.add, touchAction save/restore, FIT scale
//   - Banner overlay tween + leaderboard submit on game over
// Lessons applied from Drop Stack:
//   - Particle bursts + camera shake + screen flash for juice
//   - Combo system with windowed timing
//   - Damage popups (here: brick score popups)

import * as Phaser from "phaser";
import { submit } from "../../lib/leaderboard.js";
import { playSfx } from "../../lib/audio.js";

type ArcadePhysicsCallback = Phaser.Types.Physics.Arcade.ArcadePhysicsCallback;

const GAME_ID = "brick-buster";
const DESIGN_W = 360;
const DESIGN_H = 640;

// ─── playfield geometry ───────────────────────────────────────────────────────
const BEZEL_THICK = 14;
const FIELD_LEFT = BEZEL_THICK;
const FIELD_RIGHT = DESIGN_W - BEZEL_THICK;
const FIELD_TOP = BEZEL_THICK;
// FIELD_BOTTOM (open) acts as drain
const PADDLE_Y = DESIGN_H - 48;
const PADDLE_H = 11;
const PADDLE_W_NORMAL = 70;
const PADDLE_W_WIDE = 110;
const PADDLE_W_SHORT = 48;
const BALL_R = 7;
const BALL_SPEED_BASE = 380;
const BALL_SPEED_MAX = 580;
const BALL_SPEED_PER_ROUND = 12;
const MAX_BOUNCE_ANGLE = 65; // degrees from vertical at paddle edges

// ─── capsules (Arkanoid-canon power-ups) ──────────────────────────────────────
const CAPSULE_W = 22;
const CAPSULE_H = 12;
const CAPSULE_FALL_SPEED = 200;
const CAPSULE_DROP_CHANCE = 0.22;
const MAX_CAPSULES_ON_SCREEN = 3;
const LASER_DURATION_MS = 10000;
const LASER_MAX_SHOTS = 30;
const LASER_RPM = 360;
const LASER_SPEED = 800;

interface CapsuleType {
  letter: string;        // single-letter label drawn on the pill
  fill: string;
  rim: string;
  desc: string;          // banner text on pickup
}
const CAPSULES: Record<string, CapsuleType> = {
  E: { letter: "E", fill: "#3b88ff", rim: "#1a448c", desc: "WIDE PADDLE" },
  C: { letter: "C", fill: "#3eea4c", rim: "#1d8b25", desc: "CATCH"       },
  L: { letter: "L", fill: "#ff3b58", rim: "#9c1a2a", desc: "LASER"       },
  D: { letter: "D", fill: "#33d8ff", rim: "#1a87a0", desc: "TRIPLE BALL" },
  F: { letter: "F", fill: "#ff8a2c", rim: "#a0531a", desc: "FAST BALL"   },  // negative
  R: { letter: "R", fill: "#ff44aa", rim: "#7a1144", desc: "SHORT PADDLE" },// negative
  P: { letter: "P", fill: "#ffffff", rim: "#888888", desc: "+1 LIFE"     },
  M: { letter: "?", fill: "#ff66ff", rim: "#222244", desc: "MYSTERY"     }, // rainbow — reveals on pickup
};
const MYSTERY_CHANCE = 0.18; // 18% of drops are mystery instead of fixed
const CAPSULE_KEYS = Object.keys(CAPSULES);

// ─── bricks ───────────────────────────────────────────────────────────────────
const GRID_COLS = 13;
const BRICK_GAP = 2;
const BRICK_W = Math.floor((FIELD_RIGHT - FIELD_LEFT - (GRID_COLS - 1) * BRICK_GAP) / GRID_COLS);
const BRICK_H = 14;
const BRICK_ROW_TOP = 60;

interface BrickType {
  hp: number;            // 999 = indestructible (gold)
  score: number;
  fill: string;
  rim: string;
  highlight: string;
}
const BRICK_TYPES: Record<string, BrickType> = {
  W: { hp: 1, score: 50,  fill: "#ffffff", rim: "#aaaaaa", highlight: "#ffffff" },
  O: { hp: 1, score: 60,  fill: "#ff8a2c", rim: "#a0531a", highlight: "#ffd9a0" },
  C: { hp: 1, score: 70,  fill: "#33d8ff", rim: "#1a87a0", highlight: "#bff1ff" },
  G: { hp: 1, score: 80,  fill: "#3eea4c", rim: "#1d8b25", highlight: "#bdf9c0" },
  R: { hp: 1, score: 90,  fill: "#ff3b58", rim: "#9c1a2a", highlight: "#ffc4cc" },
  B: { hp: 1, score: 100, fill: "#3b88ff", rim: "#1a448c", highlight: "#bfd6ff" },
  P: { hp: 1, score: 110, fill: "#a04bff", rim: "#552080", highlight: "#dec4ff" },
  Y: { hp: 1, score: 120, fill: "#ffd83a", rim: "#a08000", highlight: "#fff2a0" },
  S: { hp: 2, score: 200, fill: "#c8c8d4", rim: "#5a5a78", highlight: "#ffffff" }, // silver: multi-hit
  X: { hp: 999, score: 0, fill: "#e8c032", rim: "#7a5e10", highlight: "#fff5b0" }, // gold: indestructible
};

// Layout DSL: each row = up to 13 chars. '.' = empty. Letters = brick type.
// 8 hand-designed rounds; loop with difficulty bump after that.
const LAYOUTS: string[][] = [
  // R1 — gentle warmup
  [
    "WWWWWWWWWWWWW",
    "OOOOOOOOOOOOO",
    "CCCCCCCCCCCCC",
    "GGGGGGGGGGGGG",
  ],
  // R2 — pyramid
  [
    "......W......",
    ".....OOO.....",
    "....CCCCC....",
    "...GGGGGGG...",
    "..RRRRRRRRR..",
  ],
  // R3 — silver mixed in
  [
    "RRRRRRRRRRRRR",
    "RSRSRSRSRSRSR",
    "BBBBBBBBBBBBB",
    "BSBSBSBSBSBSB",
    "PPPPPPPPPPPPP",
  ],
  // R4 — corridors with gold pillars
  [
    "X...X...X...X",
    "WWWWWWWWWWWWW",
    "X...X...X...X",
    "OOOOOOOOOOOOO",
    "X...X...X...X",
    "CCCCCCCCCCCCC",
  ],
  // R5 — checkerboard
  [
    "RBRBRBRBRBRBR",
    "BRBRBRBRBRBRB",
    "RBRBRBRBRBRBR",
    "BRBRBRBRBRBRB",
    "RBRBRBRBRBRBR",
  ],
  // R6 — fortress
  [
    "XXXSSSSSSSXXX",
    "XSSPPPPPPPSSX",
    "SSPPYYYYYPPSS",
    "XSSPPPPPPPSSX",
    "XXXSSSSSSSXXX",
  ],
  // R7 — heavy silver wall
  [
    "SSSSSSSSSSSSS",
    "SSSSSSSSSSSSS",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "GGGGGGGGGGGGG",
    "GGGGGGGGGGGGG",
  ],
  // R8 — complex mix (sector boss prep)
  [
    "Y.Y.Y.Y.Y.Y.Y",
    "PPPPPPPPPPPPP",
    "BBBBBBBBBBBBB",
    "RSRSRSRSRSRSR",
    "GGGGGGGGGGGGG",
    "CCCCCCCCCCCCC",
    "OOOOOOOOOOOOO",
  ],
  // R9 — gold maze, must aim through gaps
  [
    "X.X.X.X.X.X.X",
    "RRRRRRRRRRRRR",
    "X.X.X.X.X.X.X",
    "BBBBBBBBBBBBB",
    "X.X.X.X.X.X.X",
    "PPPPPPPPPPPPP",
    "X.X.X.X.X.X.X",
  ],
  // R10 — silver fortress with single weak point
  [
    "SSSSSXSXSSSSS",
    "SSSSSSPSSSSSS",
    "SSSSSXSXSSSSS",
    "SSSSSSSSSSSSS",
  ],
  // R11 — twin pillars + silver waves
  [
    "X.SSSSSSSSS.X",
    "X.RRRRRRRRR.X",
    "X.SSSSSSSSS.X",
    "X.BBBBBBBBB.X",
    "X.SSSSSSSSS.X",
    "X.PPPPPPPPP.X",
  ],
  // R12 — gold gauntlet, mostly indestructible cover
  [
    "XXXXX.X.XXXXX",
    "XSSSSSSSSSSSX",
    "XSPPPPPPPPPSX",
    "XSPYYYYYYYPSX",
    "XSPPPPPPPPPSX",
    "XSSSSSSSSSSSX",
    "XXXXX.X.XXXXX",
  ],
];

// ─── BootScene ────────────────────────────────────────────────────────────────

class BootScene extends Phaser.Scene {
  constructor() { super({ key: "Boot" }); }

  create(): void {
    this.makePaddleTextures();
    this.makeBallTexture();
    this.makeBrickTextures();
    this.makeParticleTexture();
    this.makeCapsuleTextures();
    this.makeLaserTexture();
    this.scene.start("Play");
    this.scene.launch("UI");
  }

  private makeCapsuleTextures(): void {
    for (const [key, def] of Object.entries(CAPSULES)) {
      const ct = this.textures.createCanvas(`cap-${key}`, CAPSULE_W, CAPSULE_H);
      if (!ct) continue;
      const ctx = ct.context;
      const r = CAPSULE_H / 2;
      // pill outline path
      const buildPath = (): void => {
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(CAPSULE_W - r, 0);
        ctx.arc(CAPSULE_W - r, r, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(r, CAPSULE_H);
        ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
      };
      // mystery: rainbow horizontal gradient
      if (key === "M") {
        const g = ctx.createLinearGradient(0, 0, CAPSULE_W, 0);
        g.addColorStop(0.00, "#ff3b58");
        g.addColorStop(0.18, "#ff8a2c");
        g.addColorStop(0.36, "#ffd83a");
        g.addColorStop(0.54, "#3eea4c");
        g.addColorStop(0.72, "#33d8ff");
        g.addColorStop(0.86, "#3b88ff");
        g.addColorStop(1.00, "#a04bff");
        ctx.fillStyle = g;
        buildPath();
        ctx.fill();
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, CAPSULE_H);
        g.addColorStop(0, def.fill);
        g.addColorStop(1, def.rim);
        ctx.fillStyle = g;
        buildPath();
        ctx.fill();
      }
      // bright rim
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 1;
      ctx.stroke();
      // letter
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.letter, CAPSULE_W / 2, CAPSULE_H / 2 + 0.5);
      ct.refresh();
    }
  }

  private makeLaserTexture(): void {
    const ct = this.textures.createCanvas("laser", 3, 12);
    if (!ct) return;
    const ctx = ct.context;
    const g = ctx.createLinearGradient(0, 0, 0, 12);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, "#ff66ff");
    g.addColorStop(1, "#aa1166");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 3, 12);
    ct.refresh();
  }

  private makePaddleTextures(): void {
    for (const [key, w] of [["paddle-normal", PADDLE_W_NORMAL], ["paddle-wide", PADDLE_W_WIDE], ["paddle-short", PADDLE_W_SHORT]] as const) {
      const ct = this.textures.createCanvas(key, w, PADDLE_H);
      if (!ct) continue;
      const ctx = ct.context;
      const g = ctx.createLinearGradient(0, 0, 0, PADDLE_H);
      g.addColorStop(0, "#88ddff");
      g.addColorStop(0.5, "#3a78c8");
      g.addColorStop(1, "#1a3868");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, PADDLE_H);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(0, 0, w, 2);
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, PADDLE_H - 2, w, 2);
      ctx.fillStyle = "rgba(150,240,255,0.7)";
      ctx.fillRect(2, 4, w - 4, 1);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1;
      const seams = Math.floor(w / 14);
      for (let i = 1; i < seams; i++) {
        const x = (w / seams) * i;
        ctx.beginPath();
        ctx.moveTo(x, 2);
        ctx.lineTo(x, PADDLE_H - 2);
        ctx.stroke();
      }
      ct.refresh();
    }
  }

  private makeBallTexture(): void {
    const D = BALL_R * 2 + 4;
    const ct = this.textures.createCanvas("ball", D, D);
    if (!ct) return;
    const ctx = ct.context;
    const cx = D / 2, cy = D / 2;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, BALL_R + 2);
    halo.addColorStop(0, "rgba(255,255,255,0.8)");
    halo.addColorStop(0.5, "rgba(180,220,255,0.3)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, D, D);
    const g = ctx.createRadialGradient(cx - BALL_R * 0.3, cy - BALL_R * 0.4, 1, cx, cy, BALL_R);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.5, "#cce6ff");
    g.addColorStop(1, "#446688");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(cx - BALL_R * 0.3, cy - BALL_R * 0.4, BALL_R * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ct.refresh();
  }

  private makeBrickTextures(): void {
    for (const [key, type] of Object.entries(BRICK_TYPES)) {
      const ct = this.textures.createCanvas(`brick-${key}`, BRICK_W, BRICK_H);
      if (!ct) continue;
      const ctx = ct.context;
      ctx.fillStyle = type.fill;
      ctx.fillRect(0, 0, BRICK_W, BRICK_H);
      ctx.fillStyle = type.highlight;
      ctx.fillRect(0, 0, BRICK_W, 1);
      ctx.fillRect(0, 0, 1, BRICK_H);
      ctx.fillStyle = type.rim;
      ctx.fillRect(0, BRICK_H - 1, BRICK_W, 1);
      ctx.fillRect(BRICK_W - 1, 0, 1, BRICK_H);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(2, 2, BRICK_W - 4, 1);
      if (key === "X") {
        const g = ctx.createRadialGradient(BRICK_W / 2, BRICK_H / 2, 0, BRICK_W / 2, BRICK_H / 2, BRICK_W / 2);
        g.addColorStop(0, "rgba(255,255,180,0.6)");
        g.addColorStop(1, "rgba(255,200,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, BRICK_W, BRICK_H);
      }
      if (key === "S") {
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        for (let i = 0; i < 6; i++) {
          ctx.fillRect(2 + i * 4, 4 + ((i * 3) % 6), 2, 1);
        }
      }
      ct.refresh();
    }
  }

  private makeParticleTexture(): void {
    const ct = this.textures.createCanvas("particle", 4, 4);
    if (!ct) return;
    const ctx = ct.context;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 4, 4);
    ct.refresh();
  }
}

// ─── PlayScene ────────────────────────────────────────────────────────────────

interface BrickData { type: string; hp: number; score: number; }

class PlayScene extends Phaser.Scene {
  private playerLives = 3;
  private playerScore = 0;
  private currentRound = 1;
  private dead = false;
  private comboCount = 0;
  private comboTimer = 0;
  private readonly COMBO_WINDOW = 1100;

  private paddle!: Phaser.Physics.Arcade.Image;
  private ball!: Phaser.Physics.Arcade.Image;          // primary ball
  private extraBalls: Phaser.Physics.Arcade.Image[] = []; // multi-ball extras
  private bricks!: Phaser.Physics.Arcade.StaticGroup;
  private capsules!: Phaser.Physics.Arcade.Group;
  private lasers!: Phaser.Physics.Arcade.Group;
  private particles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private ballTrail!: Phaser.GameObjects.Particles.ParticleEmitter;

  private ballOnPaddle = true;
  private paddleTargetX = DESIGN_W / 2;
  private bricksRemaining = 0;
  private inited = false;

  // power-ups state
  private isWide = false;
  private isShort = false;
  private catchMode = false;
  private laserMode = false;
  private laserTimer: Phaser.Time.TimerEvent | null = null;
  private laserShotsLeft = 0;
  private lastLaserShotMs = 0;
  private speedMult = 1;

  constructor() { super({ key: "Play" }); }

  create(): void {
    // reset all mutable state — Phaser reuses scene instance across restarts
    this.playerLives = 3;
    this.playerScore = 0;
    this.currentRound = 1;
    this.dead = false;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.ballOnPaddle = true;
    this.paddleTargetX = DESIGN_W / 2;
    this.bricksRemaining = 0;
    this.isWide = false;
    this.isShort = false;
    this.catchMode = false;
    this.laserMode = false;
    this.laserTimer = null;
    this.laserShotsLeft = 0;
    this.lastLaserShotMs = 0;
    this.speedMult = 1;
    this.extraBalls = [];

    const W = DESIGN_W;
    const H = DESIGN_H;

    // playfield background — depth -10 so EVERY game object renders above
    const bg = this.add.graphics().setDepth(-10);
    bg.fillStyle(0x080014, 1);
    bg.fillRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, DESIGN_H - FIELD_TOP);

    // bezel frame — depth 0 (covers walls only, not playfield interior)
    const bezel = this.add.graphics().setDepth(0);
    this.drawBezel(bezel);

    // top + sides bound, bottom OPEN (drain)
    this.physics.world.setBoundsCollision(true, true, true, false);
    this.physics.world.setBounds(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, H - FIELD_TOP);

    this.bricks = this.physics.add.staticGroup();
    this.capsules = this.physics.add.group();
    this.lasers = this.physics.add.group({ maxSize: 16 });

    this.paddle = this.physics.add.image(W / 2, PADDLE_Y, "paddle-normal").setImmovable();
    this.paddle.setDepth(5);
    (this.paddle.body as Phaser.Physics.Arcade.Body).allowGravity = false;

    this.ball = this.spawnBall(W / 2, PADDLE_Y - PADDLE_H / 2 - BALL_R, 0, 0);

    this.particles = this.add.particles(0, 0, "particle", {
      speed: { min: 60, max: 220 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.6, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 250, max: 500 },
      quantity: 0,
      frequency: -1,
    }).setDepth(9);

    // ball trail — soft cyan sparkle following primary ball
    this.ballTrail = this.add.particles(0, 0, "particle", {
      speed: 0,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.7, end: 0 },
      lifespan: 220,
      frequency: 16,
      tint: [0x88ddff, 0xffffff],
    }).setDepth(5).startFollow(this.ball);

    // capsule pickup
    this.physics.add.overlap(this.paddle, this.capsules, (_p, capObj) => {
      this.onCapsulePickup(capObj as Phaser.Physics.Arcade.Image);
    });
    // laser hits brick
    this.physics.add.overlap(this.lasers, this.bricks, (laserObj, brickObj) => {
      this.onLaserHitBrick(laserObj as Phaser.Physics.Arcade.Image, brickObj as Phaser.Physics.Arcade.Image);
    });

    this.buildRound(this.currentRound);

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.paddleTargetX = this.toDesignX(p);
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.paddleTargetX = this.toDesignX(p);
      if (this.ballOnPaddle) {
        this.launchBall();
      } else if (this.laserMode) {
        this.fireLasers();
      }
    });

    const cursors = this.input.keyboard?.createCursorKeys();
    if (cursors) this.data.set("cursors", cursors);
    this.input.keyboard?.on("keydown-SPACE", () => {
      if (this.ballOnPaddle) this.launchBall();
    });

    this.events.on("brickbuster:restart", () => this.softReset());

    // first-play hint (DOM overlay so it survives Phaser canvas)
    const hintKey = "brick-buster:seenHint";
    let seen = false;
    try { seen = !!localStorage.getItem(hintKey); } catch { /* ok */ }
    if (!seen) {
      try { localStorage.setItem(hintKey, "1"); } catch { /* ok */ }
      const hint = document.createElement("div");
      hint.id = "bb-hint";
      hint.style.cssText = "position:absolute;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;pointer-events:none";
      hint.innerHTML = `
        <div style="background:rgba(0,0,0,0.75);padding:14px 20px;border-radius:10px;color:#fff;font-family:monospace;text-align:center;font-size:13px;font-weight:bold;border:2px solid #88ddff">
          <div>TRASCINA = MUOVI VAUS</div>
          <div style="font-size:9px;color:#aaccee;margin-top:6px;font-weight:normal">TAP / SPACE = LANCIA · ROMPI TUTTI I MATTONI</div>
        </div>
      `;
      const root = (this.game.canvas.parentElement?.parentElement) ?? this.game.canvas.parentElement;
      root?.appendChild(hint);
      this.input.once("pointerdown", () => hint.remove());
      this.time.delayedCall(5500, () => hint.remove());
    }

    this.scene.get("UI").events.emit("brickbuster:hud", { score: 0, lives: 3, round: 1 });
    this.scene.get("UI").events.emit("brickbuster:banner", {
      text: "R1 · SECTOR ALPHA",
      sub: "BREAK ALL BRICKS",
      color: "#88ddff",
    });

    this.inited = true;
  }

  private drawBezel(g: Phaser.GameObjects.Graphics): void {
    g.clear();
    // chrome frame — left, right, top only (bottom open = drain)
    g.fillStyle(0x222244, 1);
    g.fillRect(0, 0, BEZEL_THICK, DESIGN_H);
    g.fillRect(DESIGN_W - BEZEL_THICK, 0, BEZEL_THICK, DESIGN_H);
    g.fillRect(0, 0, DESIGN_W, BEZEL_THICK);
    // inner highlight rim
    g.fillStyle(0x4488cc, 0.5);
    g.fillRect(BEZEL_THICK - 2, BEZEL_THICK, 1, DESIGN_H - BEZEL_THICK);
    g.fillRect(DESIGN_W - BEZEL_THICK + 1, BEZEL_THICK, 1, DESIGN_H - BEZEL_THICK);
    g.fillRect(BEZEL_THICK, BEZEL_THICK - 2, DESIGN_W - BEZEL_THICK * 2, 1);
    // rivets
    g.fillStyle(0xffcc33, 1);
    for (let y = 30; y < DESIGN_H - 30; y += 60) {
      g.fillCircle(BEZEL_THICK / 2, y, 2);
      g.fillCircle(DESIGN_W - BEZEL_THICK / 2, y, 2);
    }
  }

  private toDesignX(p: Phaser.Input.Pointer): number {
    return Phaser.Math.Clamp(p.x, FIELD_LEFT + this.paddle.displayWidth / 2, FIELD_RIGHT - this.paddle.displayWidth / 2);
  }

  // ─── ball helpers ───────────────────────────────────────────────────────────

  private spawnBall(x: number, y: number, vx: number, vy: number): Phaser.Physics.Arcade.Image {
    const b = this.physics.add.image(x, y, "ball")
      .setCollideWorldBounds(true)
      .setBounce(1)
      .setCircle(BALL_R, 2, 2);
    b.setDepth(6);
    (b.body as Phaser.Physics.Arcade.Body).allowGravity = false;
    b.setVelocity(vx, vy);
    this.physics.add.collider(b, this.paddle, this.onBallPaddle, undefined, this);
    this.physics.add.collider(b, this.bricks, this.onBallBrick, undefined, this);
    return b;
  }

  private forEachBall(fn: (ball: Phaser.Physics.Arcade.Image) => void): void {
    if (this.ball) fn(this.ball);
    for (const b of this.extraBalls) fn(b);
  }

  private removeExtraBall(b: Phaser.Physics.Arcade.Image): void {
    const i = this.extraBalls.indexOf(b);
    if (i >= 0) this.extraBalls.splice(i, 1);
    b.destroy();
  }

  private buildRound(round: number): void {
    this.bricks.clear(true, true);
    this.bricksRemaining = 0;
    // also clear any in-flight capsules/lasers/extras (round transition)
    this.capsules.clear(true, true);
    this.lasers.clear(true, true);
    for (const b of this.extraBalls.slice()) b.destroy();
    this.extraBalls.length = 0;

    const layout = LAYOUTS[(round - 1) % LAYOUTS.length]!;
    for (let r = 0; r < layout.length; r++) {
      const row = layout[r]!;
      for (let c = 0; c < GRID_COLS && c < row.length; c++) {
        const ch = row[c];
        if (!ch || ch === "." || ch === " ") continue;
        const type = BRICK_TYPES[ch];
        if (!type) continue;
        const x = FIELD_LEFT + c * (BRICK_W + BRICK_GAP) + BRICK_W / 2;
        const y = BRICK_ROW_TOP + r * (BRICK_H + BRICK_GAP) + BRICK_H / 2;
        const b = this.bricks.create(x, y, `brick-${ch}`) as Phaser.Physics.Arcade.Image;
        b.setData("brick", { type: ch, hp: type.hp, score: type.score } as BrickData);
        if (ch !== "X") this.bricksRemaining++;
      }
    }
    void PADDLE_W_WIDE;
  }

  private launchBall(): void {
    if (this.dead) return;
    this.ballOnPaddle = false;
    const speed = this.ballSpeed();
    // wider launch variety so two runs feel different
    const angle = (Math.random() - 0.5) * 0.85 - Math.PI / 2; // -90° ± ~24°
    this.ball.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    playSfx("go");
    if (navigator.vibrate) navigator.vibrate(8);
  }

  private ballSpeed(): number {
    const base = Math.min(BALL_SPEED_MAX, BALL_SPEED_BASE + (this.currentRound - 1) * BALL_SPEED_PER_ROUND);
    return base * this.speedMult;
  }

  private onBallPaddle: ArcadePhysicsCallback = (ballObj, _paddle) => {
    if (this.dead) return;
    if (this.ballOnPaddle) return;
    const ball = ballObj as Phaser.Physics.Arcade.Image;
    // skeleton-style manual reflection by paddle-relative offset
    const diff = ball.x - this.paddle.x;
    const half = this.paddle.displayWidth / 2;
    const norm = Phaser.Math.Clamp(diff / half, -1, 1);
    // Catch capsule effect: stick primary ball to paddle (only if not all balls)
    if (this.catchMode && ball === this.ball && this.extraBalls.length === 0) {
      this.ball.setVelocity(0, 0);
      this.ballOnPaddle = true;
      playSfx("tap");
      return;
    }
    const angleDeg = norm * MAX_BOUNCE_ANGLE;
    const angleRad = (angleDeg - 90) * Math.PI / 180;
    const speed = this.ballSpeed();
    ball.setVelocity(Math.cos(angleRad) * speed, Math.sin(angleRad) * speed);
    playSfx("bounce");
    this.comboCount = 0;
  };

  private onBallBrick: ArcadePhysicsCallback = (_ball, brickObj) => {
    if (this.dead) return;
    const brick = brickObj as Phaser.Physics.Arcade.Image;
    const data = brick.getData("brick") as BrickData;
    if (!data) return;

    if (data.type === "X") {
      playSfx("bounce");
      return;
    }

    data.hp--;
    if (data.hp > 0) {
      brick.setTint(0xffffff);
      this.time.delayedCall(60, () => brick.clearTint());
      playSfx("tap");
      return;
    }

    const t = BRICK_TYPES[data.type]!;

    const now = this.time.now;
    if (now - this.comboTimer < this.COMBO_WINDOW) this.comboCount++;
    else this.comboCount = 1;
    this.comboTimer = now;
    const comboMult = this.comboCount >= 40 ? 4 : this.comboCount >= 20 ? 3 : this.comboCount >= 8 ? 2 : 1;
    const pts = data.score * comboMult;
    this.addScore(pts);

    this.particles.setParticleTint(Phaser.Display.Color.HexStringToColor(t.fill).color);
    this.particles.explode(8, brick.x, brick.y);
    this.cameras.main.shake(40, 0.003);
    if (this.comboCount >= 8) this.cameras.main.shake(80, 0.005);
    this.showScorePopup(brick.x, brick.y, pts, comboMult);
    playSfx("pop");
    if (navigator.vibrate) navigator.vibrate(4);

    brick.disableBody(true, true);
    this.bricksRemaining--;
    if (this.activeCapsuleCount() < MAX_CAPSULES_ON_SCREEN && Math.random() < CAPSULE_DROP_CHANCE) {
      this.spawnCapsule(brick.x, brick.y);
    }
    if (this.bricksRemaining <= 0) this.onRoundCleared();
  };

  private activeCapsuleCount(): number {
    let n = 0;
    this.capsules.getChildren().forEach((c) => { if ((c as Phaser.Physics.Arcade.Image).active) n++; });
    return n;
  }

  // ─── capsules ───────────────────────────────────────────────────────────────

  private spawnCapsule(x: number, y: number): void {
    // ~18% rainbow mystery; otherwise random non-mystery capsule
    const fixedKeys = CAPSULE_KEYS.filter((k) => k !== "M");
    const key = Math.random() < MYSTERY_CHANCE
      ? "M"
      : fixedKeys[Math.floor(Math.random() * fixedKeys.length)]!;
    // Use group.create() so the body is created once, owned by the group.
    // Doing physics.add.image() + group.add() left the velocity unset and
    // capsules hung in mid-air.
    const cap = this.capsules.create(x, y, `cap-${key}`) as Phaser.Physics.Arcade.Image;
    cap.setData("kind", key);
    cap.setDepth(7);
    const body = cap.body as Phaser.Physics.Arcade.Body;
    body.allowGravity = false;
    body.setCollideWorldBounds(false);
    const vx = (Math.random() - 0.5) * 60;
    body.setVelocity(vx, CAPSULE_FALL_SPEED);
    this.tweens.add({
      targets: cap,
      angle: { from: -8, to: 8 },
      duration: 380,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private onCapsulePickup(cap: Phaser.Physics.Arcade.Image): void {
    if (!cap.active) return;
    let kind = cap.getData("kind") as string;
    cap.destroy();
    if (!CAPSULES[kind]) return;
    // mystery: roll a real effect now
    let mystery = false;
    if (kind === "M") {
      const pool = CAPSULE_KEYS.filter((k) => k !== "M");
      kind = pool[Math.floor(Math.random() * pool.length)]!;
      mystery = true;
    }
    const def = CAPSULES[kind]!;
    playSfx("coin");
    if (navigator.vibrate) navigator.vibrate(20);
    this.applyPowerUp(kind);
    this.scene.get("UI").events.emit("brickbuster:banner", {
      text: def.desc,
      sub: mystery ? `[?] MYSTERY → [${def.letter}]` : `[${def.letter}] CAPSULE`,
      color: def.fill,
    });
  }

  private applyPowerUp(kind: string): void {
    switch (kind) {
      case "E": {
        // wide cancels short
        this.isShort = false;
        this.isWide = true;
        this.paddle.setTexture("paddle-wide");
        break;
      }
      case "R": {
        this.isWide = false;
        this.isShort = true;
        this.paddle.setTexture("paddle-short");
        break;
      }
      case "C": {
        this.catchMode = true;
        this.cancelLaser();
        break;
      }
      case "L": {
        this.laserMode = true;
        this.catchMode = false;
        this.laserShotsLeft = LASER_MAX_SHOTS;
        if (this.laserTimer) this.laserTimer.remove();
        this.laserTimer = this.time.delayedCall(LASER_DURATION_MS, () => this.cancelLaser());
        break;
      }
      case "D": {
        // triple ball: spawn 2 extras at primary ball position with offset velocities
        const src = this.ball;
        if (this.ballOnPaddle) {
          // launch primary first so the spawn isn't all stuck on paddle
          this.launchBall();
        }
        const sv = src.body!.velocity;
        const baseSpd = Math.max(this.ballSpeed(), Math.sqrt(sv.x * sv.x + sv.y * sv.y));
        const baseAng = Math.atan2(sv.y, sv.x);
        for (const off of [-0.5, 0.5]) {
          const a = baseAng + off;
          const eb = this.spawnBall(src.x, src.y, Math.cos(a) * baseSpd, Math.sin(a) * baseSpd);
          this.extraBalls.push(eb);
        }
        break;
      }
      case "F": {
        this.speedMult = Math.min(1.5, this.speedMult + 0.25);
        break;
      }
      case "P": {
        this.playerLives = Math.min(5, this.playerLives + 1);
        this.scene.get("UI").events.emit("brickbuster:hud", {
          score: this.playerScore, lives: this.playerLives, round: this.currentRound,
        });
        break;
      }
    }
  }

  private cancelLaser(): void {
    this.laserMode = false;
    this.laserShotsLeft = 0;
    if (this.laserTimer) { this.laserTimer.remove(); this.laserTimer = null; }
  }

  // ─── lasers ─────────────────────────────────────────────────────────────────

  private fireLasers(): void {
    if (!this.laserMode) return;
    if (this.laserShotsLeft <= 0) { this.cancelLaser(); return; }
    const interval = 60000 / LASER_RPM;
    if (this.time.now - this.lastLaserShotMs < interval) return;
    this.lastLaserShotMs = this.time.now;
    const xL = this.paddle.x - this.paddle.displayWidth / 2 + 4;
    const xR = this.paddle.x + this.paddle.displayWidth / 2 - 4;
    const y = this.paddle.y - PADDLE_H / 2 - 6;
    for (const x of [xL, xR]) {
      const beam = this.lasers.get(x, y, "laser") as Phaser.Physics.Arcade.Image | null;
      if (!beam) continue;
      beam.setActive(true).setVisible(true).setDepth(7);
      const body = beam.body as Phaser.Physics.Arcade.Body;
      body.reset(x, y);
      body.setAllowGravity(false);
      body.setVelocity(0, -LASER_SPEED);
    }
    playSfx("shoot");
    this.laserShotsLeft -= 2; // twin barrels = 2 shots per tap
    if (this.laserShotsLeft <= 0) this.cancelLaser();
  }

  private onLaserHitBrick(laser: Phaser.Physics.Arcade.Image, brick: Phaser.Physics.Arcade.Image): void {
    if (!laser.active || !brick.active) return;
    const data = brick.getData("brick") as BrickData | undefined;
    laser.setActive(false).setVisible(false);
    (laser.body as Phaser.Physics.Arcade.Body).reset(-100, -100);
    if (!data || data.type === "X") {
      playSfx("bounce");
      return;
    }
    data.hp--;
    if (data.hp > 0) {
      brick.setTint(0xffffff);
      this.time.delayedCall(60, () => brick.clearTint());
      playSfx("tap");
      return;
    }
    const t = BRICK_TYPES[data.type]!;
    this.addScore(data.score);
    this.particles.setParticleTint(Phaser.Display.Color.HexStringToColor(t.fill).color);
    this.particles.explode(6, brick.x, brick.y);
    brick.disableBody(true, true);
    this.bricksRemaining--;
    if (this.activeCapsuleCount() < MAX_CAPSULES_ON_SCREEN && Math.random() < CAPSULE_DROP_CHANCE) {
      this.spawnCapsule(brick.x, brick.y);
    }
    if (this.bricksRemaining <= 0) this.onRoundCleared();
  }

  private addScore(pts: number): void {
    this.playerScore += pts;
    this.scene.get("UI").events.emit("brickbuster:hud", {
      score: this.playerScore,
      lives: this.playerLives,
      round: this.currentRound,
    });
  }

  private showScorePopup(x: number, y: number, pts: number, mult: number): void {
    const txt = mult > 1 ? `+${pts} x${mult}` : `+${pts}`;
    const color = mult > 1 ? "#ff66ff" : "#ffffff";
    const t = this.add.text(x, y, txt, {
      fontFamily: "monospace",
      fontSize: `${10 + Math.min(8, mult * 2)}px`,
      color,
      fontStyle: "bold",
      stroke: "#000",
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(15);
    this.tweens.add({
      targets: t,
      y: y - 22,
      alpha: { from: 1, to: 0 },
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => t.destroy(),
    });
  }

  private onRoundCleared(): void {
    this.cameras.main.flash(220, 100, 220, 255);
    this.cameras.main.shake(280, 0.01);
    playSfx("levelup");
    if (navigator.vibrate) navigator.vibrate([40, 40, 80]);

    this.playerLives = Math.min(5, this.playerLives + 1);
    this.currentRound++;

    this.scene.get("UI").events.emit("brickbuster:banner", {
      text: `R${this.currentRound - 1} CLEAR`,
      sub: "+1 LIFE · NEXT ROUND",
      color: "#ffcc33",
    });

    this.time.delayedCall(900, () => {
      // reset paddle width + cancel laser between rounds
      if (this.isWide || this.isShort) { this.isWide = false; this.isShort = false; this.paddle.setTexture("paddle-normal"); }
      this.cancelLaser();
      this.catchMode = false;
      this.speedMult = 1;
      this.ballOnPaddle = true;
      this.ball.setVelocity(0, 0);
      this.ball.setPosition(this.paddle.x, PADDLE_Y - PADDLE_H / 2 - BALL_R);
      this.buildRound(this.currentRound);
      this.scene.get("UI").events.emit("brickbuster:hud", {
        score: this.playerScore,
        lives: this.playerLives,
        round: this.currentRound,
      });
    });
  }

  private loseBall(): void {
    if (this.dead) return;
    this.playerLives--;
    playSfx("error");
    if (navigator.vibrate) navigator.vibrate([40, 60, 80]);
    if (this.playerLives <= 0) {
      this.gameOver();
      return;
    }
    // reset paddle/effects on life lost (Arkanoid behavior)
    if (this.isWide) { this.isWide = false; this.paddle.setTexture("paddle-normal"); }
    this.cancelLaser();
    this.catchMode = false;
    this.speedMult = 1;
    this.ballOnPaddle = true;
    this.ball.setVelocity(0, 0);
    this.ball.setPosition(this.paddle.x, PADDLE_Y - PADDLE_H / 2 - BALL_R);
    this.scene.get("UI").events.emit("brickbuster:hud", {
      score: this.playerScore,
      lives: this.playerLives,
      round: this.currentRound,
    });
  }

  private gameOver(): void {
    if (this.dead) return;
    this.dead = true;
    playSfx("gameover");
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    this.cameras.main.shake(400, 0.02);
    this.physics.pause();
    void submit(GAME_ID, this.playerScore);
    this.scene.get("UI").events.emit("brickbuster:gameover", this.playerScore);
  }

  private softReset(): void {
    this.playerLives = 3;
    this.playerScore = 0;
    this.currentRound = 1;
    this.dead = false;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.ballOnPaddle = true;
    this.paddleTargetX = DESIGN_W / 2;
    this.isWide = false;
    this.isShort = false;
    this.paddle.setTexture("paddle-normal");
    this.cancelLaser();
    this.catchMode = false;
    this.speedMult = 1;
    this.paddle.setPosition(DESIGN_W / 2, PADDLE_Y);
    this.ball.setVelocity(0, 0);
    this.ball.setPosition(DESIGN_W / 2, PADDLE_Y - PADDLE_H / 2 - BALL_R);
    this.physics.resume();
    this.buildRound(1);
    this.scene.get("UI").events.emit("brickbuster:hud", { score: 0, lives: 3, round: 1 });
    this.scene.get("UI").events.emit("brickbuster:banner", {
      text: "R1 · SECTOR ALPHA",
      sub: "BREAK ALL BRICKS",
      color: "#88ddff",
    });
  }

  update(_time: number, delta: number): void {
    if (!this.inited) return;
    if (this.dead) return;

    // paddle move toward target (lerp for snappy-but-smooth feel)
    const k = Math.min(1, (0.4 * delta) / 16);
    this.paddle.x = Phaser.Math.Linear(this.paddle.x, this.paddleTargetX, k);
    this.paddle.x = Phaser.Math.Clamp(this.paddle.x, FIELD_LEFT + this.paddle.displayWidth / 2, FIELD_RIGHT - this.paddle.displayWidth / 2);

    // keyboard arrow movement
    const cursors = this.data.get("cursors") as Phaser.Types.Input.Keyboard.CursorKeys | undefined;
    if (cursors) {
      const spd = 6 + this.currentRound * 0.2;
      if (cursors.left.isDown)  this.paddleTargetX = Math.max(FIELD_LEFT + this.paddle.displayWidth / 2, this.paddle.x - spd);
      if (cursors.right.isDown) this.paddleTargetX = Math.min(FIELD_RIGHT - this.paddle.displayWidth / 2, this.paddle.x + spd);
    }

    if (this.ballOnPaddle) {
      this.ball.setPosition(this.paddle.x, PADDLE_Y - PADDLE_H / 2 - BALL_R);
      this.ball.setVelocity(0, 0);
    }
    // primary ball drain
    if (!this.ballOnPaddle && this.ball.y > DESIGN_H + BALL_R) {
      // if extras alive, promote one to primary (don't lose a life)
      if (this.extraBalls.length > 0) {
        this.ball.destroy();
        this.ball = this.extraBalls.shift()!;
        this.ballTrail.startFollow(this.ball);
      } else {
        this.loseBall();
      }
    }
    // extras drain
    for (const eb of this.extraBalls.slice()) {
      if (eb.y > DESIGN_H + BALL_R) this.removeExtraBall(eb);
    }

    // anti-stuck on every active ball
    const target = this.ballSpeed();
    this.forEachBall((b) => {
      if (this.ballOnPaddle && b === this.ball) return;
      const body = b.body as Phaser.Physics.Arcade.Body | null;
      if (!body) return;
      const v = body.velocity;
      const cur = Math.sqrt(v.x * v.x + v.y * v.y);
      if (cur > 0 && Math.abs(cur - target) > 30) {
        const f = target / cur;
        body.setVelocity(v.x * f, v.y * f);
      }
      if (Math.abs(v.y) < 30) {
        body.setVelocity(v.x, v.y < 0 ? -60 : 60);
      }
    });

    // capsule cull below playfield
    this.capsules.getChildren().forEach((obj) => {
      const c = obj as Phaser.Physics.Arcade.Image;
      if (c.active && c.y > DESIGN_H + 20) {
        c.destroy();
      }
    });
    // laser cull above playfield
    this.lasers.getChildren().forEach((obj) => {
      const l = obj as Phaser.Physics.Arcade.Image;
      if (l.active && l.y < FIELD_TOP - 20) {
        l.setActive(false).setVisible(false);
        (l.body as Phaser.Physics.Arcade.Body).reset(-100, -100);
      }
    });

    // continuous laser auto-fire while held: skip — fire on tap (already wired)

    if (this.comboCount > 0 && this.time.now - this.comboTimer > this.COMBO_WINDOW) {
      this.comboCount = 0;
    }
  }
}

// ─── UIScene ──────────────────────────────────────────────────────────────────

class UIScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Container;
  private bannerMain!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private bannerTimer: Phaser.Time.TimerEvent | null = null;
  private gameoverOverlay!: Phaser.GameObjects.Container;
  private gameoverScore!: Phaser.GameObjects.Text;

  constructor() { super({ key: "UI", active: false }); }

  create(): void {
    const W = DESIGN_W;
    const H = DESIGN_H;

    this.scoreText = this.add.text(20, 22, "0", {
      fontFamily: "monospace", fontSize: "20px", color: "#ffcc33", fontStyle: "bold",
    }).setOrigin(0, 0.5).setDepth(50);
    this.roundText = this.add.text(W / 2, 22, "R1", {
      fontFamily: "monospace", fontSize: "13px", color: "#88ddff", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(50);
    this.livesText = this.add.text(W - 20, 22, "♥♥♥", {
      fontFamily: "monospace", fontSize: "14px", color: "#ff4466",
    }).setOrigin(1, 0.5).setDepth(50);

    this.banner = this.add.container(W / 2, H * 0.4).setDepth(58).setVisible(false);
    const bnBg = this.add.rectangle(0, 0, Math.min(W - 40, 320), 96, 0x000000, 0.85);
    bnBg.setStrokeStyle(2, 0x88ddff, 0.7);
    this.bannerMain = this.add.text(0, -14, "", {
      fontFamily: "monospace", fontSize: "20px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5);
    this.bannerSub = this.add.text(0, 18, "", {
      fontFamily: "monospace", fontSize: "11px", color: "#aaeeff",
    }).setOrigin(0.5);
    this.banner.add([bnBg, this.bannerMain, this.bannerSub]);

    this.gameoverOverlay = this.add.container(W / 2, H / 2).setDepth(60).setVisible(false);
    const goBg = this.add.rectangle(0, 0, 280, 200, 0x000000, 0.9);
    goBg.setStrokeStyle(3, 0xff4466, 0.8);
    const goTitle = this.add.text(0, -68, "GAME OVER", {
      fontFamily: "monospace", fontSize: "22px", color: "#ff4466", fontStyle: "bold",
    }).setOrigin(0.5);
    const goLbl = this.add.text(0, -28, "FINAL SCORE", {
      fontFamily: "monospace", fontSize: "10px", color: "#aaaaaa",
    }).setOrigin(0.5);
    this.gameoverScore = this.add.text(0, 0, "0", {
      fontFamily: "monospace", fontSize: "28px", color: "#ffcc33", fontStyle: "bold",
    }).setOrigin(0.5);
    const goBtn = this.add.rectangle(0, 60, 160, 44, 0xff4466).setInteractive({ useHandCursor: true });
    const goBtnLbl = this.add.text(0, 60, "PLAY AGAIN", {
      fontFamily: "monospace", fontSize: "13px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5);
    this.gameoverOverlay.add([goBg, goTitle, goLbl, this.gameoverScore, goBtn, goBtnLbl]);

    let restarting = false;
    const restart = () => {
      if (restarting) return;
      if (!this.gameoverOverlay.visible) return;
      restarting = true;
      this.gameoverOverlay.setVisible(false);
      this.scene.get("Play").events.emit("brickbuster:restart");
      this.time.delayedCall(50, () => { restarting = false; });
    };
    goBtn.on("pointerdown", restart);
    this.input.on("pointerdown", () => {
      if (this.gameoverOverlay.visible) restart();
    });

    this.events.on("brickbuster:hud", (data: { score: number; lives: number; round: number }) => {
      this.scoreText.setText(String(data.score));
      this.roundText.setText(`R${data.round}`);
      this.livesText.setText("♥".repeat(Math.max(0, data.lives)));
    });
    this.events.on("brickbuster:banner", (data: { text: string; sub: string; color: string }) => {
      this.bannerMain.setText(data.text).setColor(data.color);
      this.bannerSub.setText(data.sub);
      this.banner.setVisible(true).setAlpha(0);
      this.tweens.add({ targets: this.banner, alpha: 1, duration: 220 });
      if (this.bannerTimer) this.bannerTimer.remove();
      this.bannerTimer = this.time.delayedCall(2400, () => {
        this.tweens.add({
          targets: this.banner, alpha: 0, duration: 350,
          onComplete: () => this.banner.setVisible(false),
        });
      });
    });
    this.events.on("brickbuster:gameover", (score: number) => {
      this.gameoverScore.setText(String(score));
      this.gameoverOverlay.setVisible(true).setAlpha(0).setScale(0.85);
      this.tweens.add({
        targets: this.gameoverOverlay,
        alpha: 1, scale: 1,
        duration: 320,
        ease: "Back.easeOut",
      });
    });
  }
}

// ─── mount / unmount ──────────────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  container.classList.add("brickbuster-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0;width:100%;height:100%;";
  container.appendChild(wrapper);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: wrapper,
    backgroundColor: "#02000a",
    scene: [BootScene, PlayScene, UIScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: DESIGN_W,
      height: DESIGN_H,
    },
    physics: {
      default: "arcade",
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    audio: { disableWebAudio: true },
    banner: false,
    disableContextMenu: true,
  });

  return (): void => {
    game.destroy(true, false);
    wrapper.remove();
    container.classList.remove("brickbuster-root");
    container.style.touchAction = prevTouchAction;
    document.getElementById("bb-hint")?.remove();
  };
}
