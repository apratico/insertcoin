import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";

// ─── constants ───────────────────────────────────────────────────────────────

const TILE = 32;
const GRAVITY = 1400;
const JUMP_VY_SHORT = -520;
const JUMP_VY_LONG = -680;
const DOUBLE_JUMP_VY = -460;
const JUMP_HOLD_MAX_MS = 300;
const RUN_SPEED = 220;
const PLAYER_X_RATIO = 0.30;
const HUD_H = 44;
const DT_CAP = 32;
const HINT_DISMISS_MS = 6000;
const SLIDE_DURATION_MS = 400;
const ATTACK_RANGE = 40;
const ATTACK_COOLDOWN_MS = 400;
const ATTACK_DAMAGE_FRAME_MS = 50;
const ATTACK_SWING_MS = 150;
const CHUNK_COLS = 8;
const CHUNK_ROWS = 6;
const LOOKAHEAD_CHUNKS = 3;

// tile ids
const T_AIR = 0;
const T_GROUND = 1;
const T_PLATFORM = 2;
const T_SPIKE = 3;
const T_COIN = 4;
const T_TORCH = 5;

// ─── types ───────────────────────────────────────────────────────────────────

type Phase = "idle" | "playing" | "gameover" | "paused";

interface Player {
  x: number;
  y: number;
  vy: number;
  onGround: boolean;
  jumpsUsed: number;
  sliding: boolean;
  slideTimer: number;
  attackCooldown: number;
  attackTimer: number;
  swingAngle: number;
  alive: boolean;
}

type EnemyKind = "zombie" | "bat" | "skeleton";

interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vy: number;
  sinOffset: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  shieldUp: boolean;
  alertTimer: number;
}

interface Coin {
  id: number;
  x: number;
  y: number;
  alive: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  maxLife: number;
  r: number;
}

interface Chunk {
  col: number; // world tile-column of left edge
  tiles: number[][]; // [row][col], row 0 = top
  enemies: Enemy[];
  coins: Coin[];
}

// ─── world tile helpers ───────────────────────────────────────────────────────

// ─── chunk templates (10 patterns) ──────────────────────────────────────────

function emptyRows(rows: number): number[][] {
  return Array.from({ length: rows }, () => Array(CHUNK_COLS).fill(T_AIR) as number[]);
}

function buildChunk(col: number): number[][] {
  const g = T_GROUND;
  const p = T_PLATFORM;
  const s = T_SPIKE;
  const c = T_COIN;
  const t = T_TORCH;

  const templates: (() => number[][])[] = [
    // 0: flat ground with torches
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      r[CHUNK_ROWS - 2]![2] = t;
      r[CHUNK_ROWS - 2]![6] = t;
      return r;
    },
    // 1: single raised platform mid
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      r[CHUNK_ROWS - 3]![2] = p;
      r[CHUNK_ROWS - 3]![3] = p;
      r[CHUNK_ROWS - 3]![4] = p;
      r[CHUNK_ROWS - 4]![3] = c;
      return r;
    },
    // 2: pit (2 tiles wide) — player must jump
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      r[CHUNK_ROWS - 1]![3] = T_AIR;
      r[CHUNK_ROWS - 1]![4] = T_AIR;
      return r;
    },
    // 3: pit (3 tiles wide) — tighter timing
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      r[CHUNK_ROWS - 1]![2] = T_AIR;
      r[CHUNK_ROWS - 1]![3] = T_AIR;
      r[CHUNK_ROWS - 1]![4] = T_AIR;
      return r;
    },
    // 4: spikes on ground
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      r[CHUNK_ROWS - 2]![3] = s;
      r[CHUNK_ROWS - 2]![4] = s;
      return r;
    },
    // 5: step up then back down
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < 4; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      for (let cc = 4; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 2]![cc] = g;
      r[CHUNK_ROWS - 3]![5] = c;
      return r;
    },
    // 6: step down
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < 4; cc++) r[CHUNK_ROWS - 2]![cc] = g;
      for (let cc = 4; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      return r;
    },
    // 7: two platforms ascending with coins
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      r[CHUNK_ROWS - 3]![1] = p; r[CHUNK_ROWS - 3]![2] = p;
      r[CHUNK_ROWS - 5]![4] = p; r[CHUNK_ROWS - 5]![5] = p;
      r[CHUNK_ROWS - 4]![1] = c;
      r[CHUNK_ROWS - 6]![4] = c;
      return r;
    },
    // 8: spike + platform skip
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      r[CHUNK_ROWS - 2]![2] = s;
      r[CHUNK_ROWS - 2]![5] = s;
      r[CHUNK_ROWS - 4]![3] = p; r[CHUNK_ROWS - 4]![4] = p;
      r[CHUNK_ROWS - 5]![3] = c;
      return r;
    },
    // 9: wide pit with platform bridge
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < 2; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      for (let cc = 6; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      r[CHUNK_ROWS - 3]![3] = p; r[CHUNK_ROWS - 3]![4] = p; r[CHUNK_ROWS - 3]![5] = p;
      r[CHUNK_ROWS - 4]![4] = c;
      return r;
    },
  ];

  const idx = (col / CHUNK_COLS + Math.floor(col / CHUNK_COLS * 7.3)) % templates.length | 0;
  const fn = templates[Math.abs(idx) % templates.length]!;
  return fn();
}

// ─── enemy factory ───────────────────────────────────────────────────────────

let _eid = 0;

function spawnEnemyForChunk(chunk: Chunk, canvasH: number): void {
  const groundY = canvasH - HUD_H;
  const roll = Math.random();
  let kind: EnemyKind;
  if (roll < 0.30) kind = "zombie";
  else if (roll < 0.70) kind = "bat";
  else kind = "skeleton";

  const tileX = chunk.col * TILE + CHUNK_COLS * TILE * 0.5 + Math.random() * CHUNK_COLS * TILE * 0.3;
  let tileY: number;
  if (kind === "bat") {
    tileY = groundY - (CHUNK_ROWS - 2) * TILE + Math.random() * TILE * 2;
  } else {
    tileY = groundY - TILE;
  }

  const hp = kind === "skeleton" ? 2 : 1;
  chunk.enemies.push({
    id: _eid++,
    kind,
    x: tileX,
    y: tileY,
    vy: 0,
    sinOffset: Math.random() * Math.PI * 2,
    hp,
    maxHp: hp,
    alive: true,
    shieldUp: kind === "skeleton",
    alertTimer: 0,
  });
}

// ─── coin factory ────────────────────────────────────────────────────────────

let _cid = 0;

function coinsFromTiles(chunk: Chunk, groundY: number): void {
  for (let row = 0; row < CHUNK_ROWS; row++) {
    for (let cc = 0; cc < CHUNK_COLS; cc++) {
      if (chunk.tiles[row]![cc] === T_COIN) {
        const wx = (chunk.col + cc) * TILE + TILE / 2;
        const wy = groundY + (row - CHUNK_ROWS + 1) * TILE + TILE / 2;
        chunk.coins.push({ id: _cid++, x: wx, y: wy, alive: true });
        chunk.tiles[row]![cc] = T_AIR;
      }
    }
  }
}

// ─── particles ───────────────────────────────────────────────────────────────

function spawnParticles(
  particles: Particle[],
  x: number,
  y: number,
  color: string,
  count: number
): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 120;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 80,
      color,
      life: 1,
      maxLife: 400 + Math.random() * 300,
      r: 2 + Math.random() * 3,
    });
  }
}

// ─── AABB collision helpers ───────────────────────────────────────────────────

interface Rect {
  x: number; y: number; w: number; h: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function playerRect(p: Player): Rect {
  const h = p.sliding ? 12 : 24;
  const w = 14;
  return { x: p.x - w / 2, y: p.y - h, w, h };
}

function enemyRect(e: Enemy): Rect {
  if (e.kind === "bat") return { x: e.x - 10, y: e.y - 8, w: 20, h: 16 };
  return { x: e.x - 8, y: e.y - 20, w: 16, h: 20 };
}

// ─── tile collision resolution ───────────────────────────────────────────────

function resolvePlayerTiles(
  player: Player,
  chunks: Chunk[],
  prevY: number,
  groundY: number
): void {
  player.onGround = false;

  // pit death
  if (player.y > groundY + TILE) {
    player.alive = false;
    return;
  }

  const pr = playerRect(player);
  const h = pr.h;

  for (const chunk of chunks) {
    for (let row = 0; row < CHUNK_ROWS; row++) {
      for (let cc = 0; cc < CHUNK_COLS; cc++) {
        const t = chunk.tiles[row]![cc]!;
        if (t !== T_GROUND && t !== T_PLATFORM) continue;
        const tx = (chunk.col + cc) * TILE;
        const ty = groundY + (row - CHUNK_ROWS + 1) * TILE;

        if (!rectsOverlap(pr, { x: tx, y: ty, w: TILE, h: TILE })) continue;

        if (t === T_PLATFORM) {
          // only collide from top (falling onto)
          if (player.vy >= 0 && prevY - h <= ty && player.y - h >= ty - 2) {
            player.y = ty;
            player.vy = 0;
            player.onGround = true;
            player.jumpsUsed = 0;
          }
        } else {
          // full solid
          const overlapX = Math.min(pr.x + pr.w, tx + TILE) - Math.max(pr.x, tx);
          const overlapY = Math.min(pr.y, ty + TILE) - Math.max(pr.y - h, ty);

          if (overlapX < overlapY) {
            // push horizontally — treat as wall
            player.alive = false;
            return;
          } else {
            if (player.vy >= 0) {
              player.y = ty;
              player.vy = 0;
              player.onGround = true;
              player.jumpsUsed = 0;
            } else {
              player.y = ty + TILE + h;
              player.vy = 0;
            }
          }
        }
      }
    }
  }
}

// ─── drawing helpers ──────────────────────────────────────────────────────────

function drawParallax(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  worldX: number
): void {
  // layer 1: sky (stars + gradient)
  const sky = ctx.createLinearGradient(0, 0, 0, ch);
  sky.addColorStop(0, "#14041a");
  sky.addColorStop(1, "#2a0838");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cw, ch);

  // stars scroll at 0.2x
  const starOff = (worldX * 0.2) % cw;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  for (let i = 0; i < 28; i++) {
    const sx = ((i * 47 + 13) % (cw * 2)) - starOff;
    const sy = ((i * 31 + 7) % (ch * 0.55));
    const sr = i % 4 === 0 ? 1.5 : 0.7;
    ctx.beginPath();
    ctx.arc(((sx % cw) + cw) % cw, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // layer 2: castle silhouette (0.5x)
  const castleOff = (worldX * 0.5) % (cw * 2);
  ctx.fillStyle = "#1a0828";
  const castleW = cw * 2;
  const towerCount = 6;
  for (let i = 0; i < towerCount; i++) {
    const bx = ((i / towerCount) * castleW - castleOff + castleW) % castleW;
    const bh = 40 + (i % 3) * 20;
    const bw = 20 + (i % 2) * 8;
    ctx.fillRect(bx - bw / 2, ch - HUD_H - bh, bw, bh);
    // merlons
    for (let m = 0; m < 3; m++) {
      ctx.fillRect(bx - bw / 2 + m * (bw / 3), ch - HUD_H - bh - 6, bw / 3 - 2, 8);
    }
  }

  // ground strip
  const groundGrad = ctx.createLinearGradient(0, ch - HUD_H - 8, 0, ch - HUD_H);
  groundGrad.addColorStop(0, "#2e1040");
  groundGrad.addColorStop(1, "#1e0828");
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, ch - HUD_H - 4, cw, 4);
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  chunks: Chunk[],
  worldX: number,
  ch: number
): void {
  const screenOffX = worldX % TILE;
  const groundY = ch - HUD_H;
  for (const chunk of chunks) {
    for (let row = 0; row < CHUNK_ROWS; row++) {
      for (let cc = 0; cc < CHUNK_COLS; cc++) {
        const t = chunk.tiles[row]![cc]!;
        if (t === T_AIR) continue;
        const wx = (chunk.col + cc) * TILE - worldX;
        const wy = groundY + (row - CHUNK_ROWS + 1) * TILE;

        if (wx + TILE < 0 || wx > 800) continue;

        switch (t) {
          case T_GROUND:
            ctx.fillStyle = "#2a1035";
            ctx.fillRect(wx, wy, TILE, TILE);
            ctx.fillStyle = "#3d1a52";
            ctx.fillRect(wx, wy, TILE, 4);
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.fillRect(wx + 1, wy + 1, 3, TILE - 2);
            break;
          case T_PLATFORM:
            ctx.fillStyle = "#5a2a80";
            ctx.fillRect(wx, wy, TILE, 6);
            ctx.fillStyle = "#7a3aaa";
            ctx.fillRect(wx, wy, TILE, 2);
            break;
          case T_SPIKE:
            ctx.fillStyle = "#cc4444";
            ctx.beginPath();
            ctx.moveTo(wx + 4, wy + TILE);
            ctx.lineTo(wx + TILE / 2, wy + 2);
            ctx.lineTo(wx + TILE - 4, wy + TILE);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "#ff6666";
            ctx.beginPath();
            ctx.moveTo(wx + 6, wy + TILE);
            ctx.lineTo(wx + TILE / 2, wy + 6);
            ctx.lineTo(wx + TILE - 6, wy + TILE);
            ctx.closePath();
            ctx.fill();
            break;
          case T_TORCH: {
            ctx.fillStyle = "#5a3a10";
            ctx.fillRect(wx + 12, wy + 4, 8, 20);
            ctx.fillStyle = "#ff8800";
            ctx.shadowColor = "#ff8800";
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(wx + 16, wy + 4, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            break;
          }
        }
      }
    }
  }
  void screenOffX; // suppress unused
}

function drawCoins(
  ctx: CanvasRenderingContext2D,
  chunks: Chunk[],
  worldX: number,
  tick: number
): void {
  for (const chunk of chunks) {
    for (const coin of chunk.coins) {
      if (!coin.alive) continue;
      const sx = coin.x - worldX;
      const sy = coin.y + Math.sin(tick * 0.005 + coin.id) * 3;
      ctx.fillStyle = "#ff5722";
      ctx.shadowColor = "#ff5722";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffaa66";
      ctx.beginPath();
      ctx.arc(sx - 1.5, sy - 1.5, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawEnemies(
  ctx: CanvasRenderingContext2D,
  chunks: Chunk[],
  worldX: number,
  tick: number
): void {
  for (const chunk of chunks) {
    for (const enemy of chunk.enemies) {
      if (!enemy.alive) continue;
      const sx = enemy.x - worldX;
      const sy = enemy.y;

      ctx.save();
      switch (enemy.kind) {
        case "zombie": {
          // body
          ctx.fillStyle = "#447744";
          ctx.fillRect(sx - 7, sy - 20, 14, 12);
          // head
          ctx.fillStyle = "#55aa55";
          ctx.beginPath();
          ctx.arc(sx, sy - 24, 7, 0, Math.PI * 2);
          ctx.fill();
          // eyes
          ctx.fillStyle = "#ff4400";
          ctx.fillRect(sx - 4, sy - 26, 2, 3);
          ctx.fillRect(sx + 2, sy - 26, 2, 3);
          // arms outstretched
          const aAnim = Math.sin(tick * 0.008) * 0.3;
          ctx.fillStyle = "#447744";
          ctx.save();
          ctx.translate(sx - 7, sy - 14);
          ctx.rotate(-0.5 - aAnim);
          ctx.fillRect(-10, -2, 10, 4);
          ctx.restore();
          ctx.save();
          ctx.translate(sx + 7, sy - 14);
          ctx.rotate(0.5 + aAnim);
          ctx.fillRect(0, -2, 10, 4);
          ctx.restore();
          // legs
          ctx.fillStyle = "#336633";
          const lAnim = Math.sin(tick * 0.012) * 4;
          ctx.fillRect(sx - 6, sy - 8, 5, 8 + lAnim);
          ctx.fillRect(sx + 1, sy - 8, 5, 8 - lAnim);
          break;
        }
        case "bat": {
          const bsy = sy + Math.sin(tick * 0.007 + enemy.sinOffset) * 8;
          ctx.fillStyle = "#cc3300";
          ctx.shadowColor = "#ff4400";
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.ellipse(sx, bsy, 6, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          // wings flap
          const wingFlap = Math.sin(tick * 0.016) * 0.4;
          ctx.fillStyle = "#aa2200";
          ctx.save();
          ctx.translate(sx, bsy);
          ctx.rotate(-wingFlap);
          ctx.beginPath();
          ctx.moveTo(-6, 0);
          ctx.quadraticCurveTo(-14, -10, -18, -2);
          ctx.quadraticCurveTo(-14, -1, -6, 0);
          ctx.fill();
          ctx.restore();
          ctx.save();
          ctx.translate(sx, bsy);
          ctx.rotate(wingFlap);
          ctx.beginPath();
          ctx.moveTo(6, 0);
          ctx.quadraticCurveTo(14, -10, 18, -2);
          ctx.quadraticCurveTo(14, -1, 6, 0);
          ctx.fill();
          ctx.restore();
          // eyes
          ctx.fillStyle = "#ff6600";
          ctx.beginPath();
          ctx.arc(sx - 2, bsy - 2, 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx + 2, bsy - 2, 1.5, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "skeleton": {
          // body — bony torso
          ctx.fillStyle = "#ddddcc";
          ctx.fillRect(sx - 5, sy - 18, 10, 10);
          // rib lines
          ctx.strokeStyle = "#bbbbaa";
          ctx.lineWidth = 1;
          for (let r = 0; r < 3; r++) {
            ctx.beginPath();
            ctx.moveTo(sx - 5, sy - 16 + r * 3);
            ctx.lineTo(sx + 5, sy - 16 + r * 3);
            ctx.stroke();
          }
          // head skull
          ctx.fillStyle = "#eeeecc";
          ctx.beginPath();
          ctx.arc(sx, sy - 24, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#222";
          ctx.fillRect(sx - 3, sy - 25, 2, 3);
          ctx.fillRect(sx + 1, sy - 25, 2, 3);
          ctx.fillRect(sx - 2, sy - 22, 5, 1.5);
          // shield
          if (enemy.shieldUp) {
            ctx.fillStyle = "#7788aa";
            ctx.strokeStyle = "#aabbdd";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx - 10, sy - 20);
            ctx.lineTo(sx - 16, sy - 14);
            ctx.lineTo(sx - 14, sy - 6);
            ctx.lineTo(sx - 8, sy - 4);
            ctx.lineTo(sx - 6, sy - 10);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          // sword
          ctx.strokeStyle = "#ccddff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx + 6, sy - 18);
          ctx.lineTo(sx + 16, sy - 8);
          ctx.stroke();
          // legs
          ctx.fillStyle = "#ddddcc";
          ctx.fillRect(sx - 5, sy - 8, 4, 8);
          ctx.fillRect(sx + 1, sy - 8, 4, 8);
          break;
        }
      }
      ctx.restore();
    }
  }
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: Player,
  screenX: number,
  tick: number
): void {
  const x = screenX;
  const y = player.y;
  const sliding = player.sliding;

  ctx.save();

  if (sliding) {
    ctx.translate(x, y - 6);
    ctx.rotate(0.4);
  } else {
    ctx.translate(x, y);
  }

  ctx.shadowColor = "#8844ff";
  ctx.shadowBlur = 8;

  const runFrame = Math.floor(tick / 7) % 6;
  const legSwing = Math.sin((runFrame / 6) * Math.PI * 2) * 5;

  if (!sliding) {
    // legs
    ctx.fillStyle = "#334466";
    ctx.fillRect(-4, -8, 3, 8 + legSwing);
    ctx.fillRect(1, -8, 3, 8 - legSwing);
  } else {
    // legs flat in slide
    ctx.fillStyle = "#334466";
    ctx.fillRect(-10, -4, 20, 4);
  }

  // torso
  ctx.fillStyle = "#4466aa";
  if (sliding) {
    ctx.fillRect(-10, -12, 20, 8);
  } else {
    ctx.fillRect(-5, -20, 10, 12);
  }

  // arms
  ctx.fillStyle = "#3355aa";
  if (player.attackTimer > 0) {
    // swing arc
    const angle = -Math.PI * 0.5 + player.swingAngle;
    ctx.save();
    ctx.translate(5, -14);
    ctx.rotate(angle);
    ctx.fillRect(0, -3, 12, 3);
    // sword
    ctx.fillStyle = "#ccddff";
    ctx.fillRect(10, -2, 14, 2);
    ctx.restore();
  } else {
    if (!sliding) {
      ctx.fillRect(-8, -18, 3, 8);
      // sword at rest
      ctx.fillStyle = "#ccddff";
      ctx.fillRect(5, -20, 3, 12);
    }
  }

  // helm
  ctx.fillStyle = "#888aaa";
  if (sliding) {
    ctx.fillRect(-7, -20, 14, 10);
  } else {
    ctx.fillRect(-5, -30, 10, 12);
  }
  // visor slit
  ctx.fillStyle = "#222";
  ctx.fillRect(-3, sliding ? -16 : -26, 6, 3);
  // glow eyes
  ctx.fillStyle = "#ff5722";
  ctx.shadowColor = "#ff5722";
  ctx.shadowBlur = 4;
  ctx.fillRect(-2, sliding ? -16 : -26, 2, 2);
  ctx.fillRect(1, sliding ? -16 : -26, 2, 2);
  ctx.shadowBlur = 0;

  ctx.restore();
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  worldX: number
): void {
  for (const p of particles) {
    if (p.life <= 0) continue;
    const alpha = p.life;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x - worldX, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawHUD(
  ctx: CanvasRenderingContext2D,
  cw: number,
  _ch: number,
  distance: number,
  score: number,
  coins: number,
  best: number
): void {
  ctx.fillStyle = "rgba(20,4,26,0.82)";
  ctx.fillRect(0, 0, cw, HUD_H);

  ctx.fillStyle = "#ff5722";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${Math.floor(distance)}m`, 8, 16);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "8px monospace";
  ctx.fillText("DIST", 8, 28);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(score), cw / 2, 20);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "8px monospace";
  ctx.fillText("SCORE", cw / 2, 32);

  ctx.fillStyle = "#ff5722";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${coins}c`, cw - 8, 16);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "8px monospace";
  ctx.fillText(`B:${best}`, cw - 8, 28);

  ctx.textAlign = "left";
}

function drawGameArea(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  worldX: number,
  chunks: Chunk[],
  player: Player,
  particles: Particle[],
  playerScreenX: number,
  tick: number,
  distance: number,
  score: number,
  coins: number,
  best: number
): void {
  drawParallax(ctx, cw, ch, worldX);
  drawTiles(ctx, chunks, worldX, ch);
  drawCoins(ctx, chunks, worldX, tick);
  drawEnemies(ctx, chunks, worldX, tick);
  drawParticles(ctx, particles, worldX);
  drawPlayer(ctx, player, playerScreenX, tick);
  drawHUD(ctx, cw, ch, distance, score, coins, best);
}

// ─── game over overlay DOM ────────────────────────────────────────────────────

function buildRankCard(rank: RankInfo, gameId: string): string {
  const label = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="cr-rank-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta} pts</div>`
    : "";
  return `<div class="rank-card">
    <div class="rank-card-title">RANK ${label} GLOBAL</div>
    ${deltaHtml}
    <button class="btn rank-card-btn" data-scores-id="${gameId}">VIEW LEADERBOARD</button>
  </div>`;
}

function showGameoverOverlay(
  container: HTMLElement,
  score: number,
  best: number,
  distance: number,
  kills: number,
  coinsCollected: number,
  onReplay: () => void
): { el: HTMLElement; addRank: (r: RankInfo) => void } {
  const isNew = score >= best && score > 0;
  const overlay = document.createElement("div");
  overlay.className = "cr-gameover";
  overlay.innerHTML = `
    <div class="cr-go-box">
      <h2 class="cr-go-title">GAME OVER</h2>
      ${isNew ? `<div class="cr-go-new">NEW BEST!</div>` : ""}
      <div class="cr-go-score">${score}</div>
      <div class="cr-go-sublabel">SCORE</div>
      <div class="cr-go-stats">
        <span>${Math.floor(distance)}m</span>
        <span>${kills} kills</span>
        <span>${coinsCollected} coins</span>
      </div>
      <div class="cr-go-best">BEST ${best}</div>
      <div class="cr-go-actions">
        <button class="btn primary cr-go-btn" id="cr-replay">PLAY AGAIN</button>
        <button class="btn cr-go-btn" id="cr-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector("#cr-replay")?.addEventListener("pointerup", () => {
    overlay.remove();
    onReplay();
  });
  overlay.querySelector("#cr-menu")?.addEventListener("pointerup", () => {
    navigate("/");
  });

  function addRank(rank: RankInfo): void {
    const box = overlay.querySelector(".cr-go-box");
    if (!box || box.querySelector(".rank-card")) return;
    const actions = box.querySelector(".cr-go-actions");
    if (!actions) return;
    const card = document.createElement("div");
    card.innerHTML = buildRankCard(rank, "crypt-run");
    const cardEl = card.firstElementChild as HTMLElement | null;
    if (!cardEl) return;
    cardEl.querySelector<HTMLElement>(".rank-card-btn")?.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      navigate("/scores/crypt-run");
    });
    box.insertBefore(cardEl, actions);
  }

  return { el: overlay, addRank };
}

// ─── onboarding hint ──────────────────────────────────────────────────────────

function maybeShowHint(container: HTMLElement): HTMLElement | null {
  const hint = document.createElement("div");
  hint.className = "cr-hint";
  hint.innerHTML = `
    <div class="cr-hint-line">TAP TO JUMP</div>
    <div class="cr-hint-line cr-hint-sub">Hold longer = higher jump</div>
    <div class="cr-hint-line cr-hint-sub">Swipe down = slide</div>
  `;
  container.appendChild(hint);
  return hint;
}

// ─── styles ───────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById("cr-styles")) return;
  const s = document.createElement("style");
  s.id = "cr-styles";
  s.textContent = `
.cryptrun-root { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.cr-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative; }
.cr-hud { display: flex; align-items: center; justify-content: space-between;
  padding: 0 8px; height: ${HUD_H}px; flex-shrink: 0;
  background: #14041a; z-index: 2; }
.cr-hud-btn { min-width: 44px; min-height: 44px; background: transparent;
  border: none; color: #ff5722; font-size: 18px; cursor: pointer; padding: 0 8px; }
.cr-canvas-wrap { flex: 1; min-height: 0; position: relative; overflow: hidden; }
.cr-canvas { display: block; }
.cr-gameover {
  position: absolute; inset: 0; background: rgba(20,4,26,0.88);
  display: flex; align-items: center; justify-content: center; z-index: 10; }
.cr-go-box {
  background: #1e0830; border: 2px solid #ff5722; border-radius: 12px;
  padding: 24px 28px; text-align: center; color: #fff;
  min-width: 220px; max-width: 320px; width: 90%; }
.cr-go-title { font-family: monospace; font-size: 22px; font-weight: bold;
  color: #ff5722; margin: 0 0 12px; }
.cr-go-new { color: #ffcc00; font-family: monospace; font-weight: bold;
  font-size: 14px; margin-bottom: 8px; }
.cr-go-score { font-family: monospace; font-size: 40px; font-weight: bold;
  color: #ff5722; line-height: 1; }
.cr-go-sublabel { font-family: monospace; font-size: 10px; color: rgba(255,255,255,0.5);
  margin-top: 2px; letter-spacing: 2px; }
.cr-go-stats { display: flex; justify-content: space-around;
  margin: 10px 0; font-family: monospace; font-size: 12px; color: rgba(255,255,255,0.7); }
.cr-go-best { font-family: monospace; font-size: 13px; color: rgba(255,255,255,0.5);
  margin: 8px 0; }
.cr-go-actions { display: flex; gap: 10px; margin-top: 14px; justify-content: center; }
.cr-go-btn { min-width: 90px; min-height: 44px; }
.cr-hint {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: flex-end; padding-bottom: 80px;
  pointer-events: none; z-index: 5; }
.cr-hint-line { font-family: monospace; font-size: 18px; font-weight: bold;
  color: #ffffff; text-shadow: 0 0 12px #ff5722; margin-bottom: 6px;
  animation: cr-pulse 1.2s ease-in-out infinite; }
.cr-hint-sub { font-size: 13px; color: rgba(255,255,255,0.7); animation: none; }
@keyframes cr-pulse { 0%,100%{opacity:1} 50%{opacity:0.55} }
.rank-card { background: rgba(255,87,34,0.12); border: 1px solid rgba(255,87,34,0.4);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
.rank-card-title { font-family: monospace; font-size: 14px; font-weight: bold;
  color: #ff5722; }
.cr-rank-delta { font-family: monospace; font-size: 11px; color: rgba(255,255,255,0.7);
  margin-top: 4px; }
.rank-card-btn { min-height: 36px; margin-top: 8px; font-size: 11px; }
`;
  document.head.appendChild(s);
}

// ─── main mount ───────────────────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("cryptrun-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  const wrap = document.createElement("div");
  wrap.className = "cr-wrap";
  container.appendChild(wrap);

  const hud = document.createElement("div");
  hud.className = "cr-hud";
  hud.innerHTML = `
    <span style="font-family:monospace;font-size:12px;color:#ff5722;letter-spacing:1px">CRYPT RUN</span>
    <div style="display:flex;gap:4px">
      <button class="cr-hud-btn" id="cr-fs" aria-label="Fullscreen">&#x26F6;</button>
      <button class="cr-hud-btn" id="cr-pause" aria-label="Pause">&#x23F8;</button>
    </div>
  `;
  wrap.appendChild(hud);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "cr-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "cr-canvas";
  canvasWrap.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx: CanvasRenderingContext2D = ctxRaw;

  // ── game state ──
  let phase: Phase = "idle";
  let paused = false;
  let rafId = 0;
  let lastTime = 0;
  let tick = 0;
  let stateReady = false;

  let canvasW = 0;
  let canvasH = 0;

  // world
  let worldX = 0;
  let distance = 0;
  let score = 0;
  let coinCount = 0;
  let kills = 0;
  let best = 0;

  let chunks: Chunk[] = [];
  let particles: Particle[] = [];
  let nextChunkCol = 0;

  let player: Player = makePlayer(0, 0);
  let playerScreenX = 0;
  let gameoverEl: { el: HTMLElement; addRank: (r: RankInfo) => void } | null = null;

  // input state
  let touchStartY = 0;
  let touchStartTime = 0;
  let touchHolding = false;
  let jumpQueued = false;
  let jumpHoldTime = 0;
  let swipeDownQueued = false;
  let hintEl: HTMLElement | null = null;
  let hintTimer = 0;
  let hintDismissed = false;

  void personalBest("crypt-run").then((b) => { best = b; });

  // ── helpers ──
  function makePlayer(x: number, y: number): Player {
    return {
      x, y, vy: 0,
      onGround: false,
      jumpsUsed: 0,
      sliding: false,
      slideTimer: 0,
      attackCooldown: 0,
      attackTimer: 0,
      swingAngle: 0,
      alive: true,
    };
  }

  function initWorld(): void {
    worldX = 0;
    distance = 0;
    score = 0;
    coinCount = 0;
    kills = 0;
    chunks = [];
    particles = [];
    nextChunkCol = 0;

    playerScreenX = Math.round(canvasW * PLAYER_X_RATIO);
    const groundY = canvasH - HUD_H;
    player = makePlayer(playerScreenX + worldX, groundY - TILE);
    player.onGround = true;

    // seed initial chunks
    for (let i = 0; i < LOOKAHEAD_CHUNKS + 1; i++) addChunk();
  }

  function addChunk(): void {
    const tiles = buildChunk(nextChunkCol);
    const chunk: Chunk = {
      col: nextChunkCol,
      tiles,
      enemies: [],
      coins: [],
    };
    const groundY = canvasH - HUD_H;
    coinsFromTiles(chunk, groundY);
    if (nextChunkCol > CHUNK_COLS * 2) {
      if (Math.random() < 0.7) spawnEnemyForChunk(chunk, canvasH);
    }
    chunks.push(chunk);
    nextChunkCol += CHUNK_COLS;
  }

  function pruneChunks(): void {
    const leftEdgeWorld = worldX - TILE * 2;
    chunks = chunks.filter((c) => (c.col + CHUNK_COLS) * TILE > leftEdgeWorld);
  }

  function ensureChunks(): void {
    const rightEdgeWorld = worldX + canvasW;
    while (nextChunkCol * TILE < rightEdgeWorld + CHUNK_COLS * TILE * LOOKAHEAD_CHUNKS) {
      addChunk();
    }
    pruneChunks();
  }

  function performAttack(): void {
    if (player.attackCooldown > 0) return;
    player.attackCooldown = ATTACK_COOLDOWN_MS;
    player.attackTimer = ATTACK_SWING_MS;
    player.swingAngle = 0;
  }

  function checkAutoAttack(): void {
    if (player.attackCooldown > 0) return;
    const pr = playerRect(player);
    const frontX = pr.x + pr.w + ATTACK_RANGE;
    const meleeFront: Rect = {
      x: pr.x + pr.w,
      y: pr.y - pr.h * 0.5,
      w: ATTACK_RANGE,
      h: pr.h * 1.5,
    };
    void frontX;

    for (const chunk of chunks) {
      for (const enemy of chunk.enemies) {
        if (!enemy.alive) continue;
        if (rectsOverlap(meleeFront, enemyRect(enemy))) {
          performAttack();
          return;
        }
      }
    }
  }

  function applyAttackDamage(): void {
    // damage fires at ATTACK_DAMAGE_FRAME_MS into the swing
    if (player.attackTimer <= 0) return;
    const alreadyDamaged = player.attackTimer <= ATTACK_SWING_MS - ATTACK_DAMAGE_FRAME_MS;
    if (!alreadyDamaged) return;

    const pr = playerRect(player);
    const meleeFront: Rect = {
      x: pr.x + pr.w,
      y: pr.y - pr.h * 0.5,
      w: ATTACK_RANGE,
      h: pr.h * 1.5,
    };

    for (const chunk of chunks) {
      for (const enemy of chunk.enemies) {
        if (!enemy.alive) continue;
        if (!rectsOverlap(meleeFront, enemyRect(enemy))) continue;

        if (enemy.kind === "skeleton" && enemy.shieldUp) {
          enemy.shieldUp = false;
          continue;
        }

        enemy.hp--;
        if (enemy.hp <= 0) {
          enemy.alive = false;
          kills++;
          const reward = enemy.kind === "zombie" ? 50 : enemy.kind === "bat" ? 80 : 150;
          const coinReward = enemy.kind === "zombie" ? 5 : enemy.kind === "bat" ? 8 : 15;
          score += reward;
          coinCount += coinReward;
          spawnParticles(particles, enemy.x, enemy.y - 10, "#ff5722", 8);
          if (navigator.vibrate) navigator.vibrate(12);
        }
      }
    }
  }

  function checkHazards(): void {
    const pr = playerRect(player);
    const groundY = canvasH - HUD_H;
    // spikes
    for (const chunk of chunks) {
      for (let row = 0; row < CHUNK_ROWS; row++) {
        for (let cc = 0; cc < CHUNK_COLS; cc++) {
          if (chunk.tiles[row]![cc] !== T_SPIKE) continue;
          const tx = (chunk.col + cc) * TILE;
          const ty = groundY + (row - CHUNK_ROWS + 1) * TILE;
          if (rectsOverlap(pr, { x: tx + 4, y: ty + 4, w: TILE - 8, h: TILE - 4 })) {
            player.alive = false;
            return;
          }
        }
      }
    }
    // enemy touch
    for (const chunk of chunks) {
      for (const enemy of chunk.enemies) {
        if (!enemy.alive) continue;
        if (rectsOverlap(pr, enemyRect(enemy))) {
          // only hurt if not in active attack frame
          if (player.attackTimer <= 0 || player.attackTimer > ATTACK_SWING_MS - ATTACK_DAMAGE_FRAME_MS) {
            player.alive = false;
            return;
          }
        }
      }
    }
  }

  function collectCoins(): void {
    const pr = playerRect(player);
    for (const chunk of chunks) {
      for (const coin of chunk.coins) {
        if (!coin.alive) continue;
        const cr: Rect = { x: coin.x - 6, y: coin.y - 6, w: 12, h: 12 };
        if (rectsOverlap(pr, cr)) {
          coin.alive = false;
          coinCount++;
          score += 5;
          spawnParticles(particles, coin.x, coin.y, "#ff5722", 4);
          if (navigator.vibrate) navigator.vibrate(3);
        }
      }
    }
  }

  function skeleton_AI(enemy: Enemy, dt: number): void {
    if (enemy.kind !== "skeleton") return;
    const distToPlayer = Math.abs(enemy.x - player.x);
    if (distToPlayer < 80) {
      enemy.alertTimer += dt;
      if (enemy.alertTimer > 800) {
        enemy.shieldUp = false;
      }
    } else {
      enemy.alertTimer = Math.max(0, enemy.alertTimer - dt);
      enemy.shieldUp = true;
    }
  }

  // ── main update ──
  function update(dt: number): void {
    if (phase !== "playing" || paused) return;

    tick++;
    const dtS = dt / 1000;

    // scroll world
    worldX += RUN_SPEED * dtS;
    distance += RUN_SPEED * dtS / 100;

    // player position in world
    playerScreenX = Math.round(canvasW * PLAYER_X_RATIO);
    player.x = worldX + playerScreenX;

    // jump / double-jump input
    if (jumpQueued) {
      jumpQueued = false;
      if (player.onGround) {
        const holdRatio = Math.min(jumpHoldTime / JUMP_HOLD_MAX_MS, 1);
        player.vy = JUMP_VY_SHORT + (JUMP_VY_LONG - JUMP_VY_SHORT) * holdRatio;
        player.jumpsUsed = 1;
        if (navigator.vibrate) navigator.vibrate(5);
        dismissHint();
      } else if (player.jumpsUsed < 2) {
        player.vy = DOUBLE_JUMP_VY;
        player.jumpsUsed = 2;
        if (navigator.vibrate) navigator.vibrate(8);
      }
    }

    // slide input
    if (swipeDownQueued && !player.sliding) {
      swipeDownQueued = false;
      player.sliding = true;
      player.slideTimer = SLIDE_DURATION_MS;
      if (navigator.vibrate) navigator.vibrate(5);
    }
    if (player.sliding) {
      player.slideTimer -= dt;
      if (player.slideTimer <= 0) player.sliding = false;
    }

    // gravity
    const prevY = player.y;
    player.vy += GRAVITY * dtS;
    player.y += player.vy * dtS;

    // tile collision
    resolvePlayerTiles(player, chunks, prevY, canvasH - HUD_H);

    // attack swing animation
    if (player.attackTimer > 0) {
      player.attackTimer -= dt;
      player.swingAngle = ((ATTACK_SWING_MS - player.attackTimer) / ATTACK_SWING_MS) * (Math.PI / 2);
      applyAttackDamage();
    }
    if (player.attackCooldown > 0) player.attackCooldown -= dt;

    // auto-attack check
    checkAutoAttack();

    // enemy AI
    for (const chunk of chunks) {
      for (const enemy of chunk.enemies) {
        if (!enemy.alive) continue;
        if (enemy.kind === "zombie") {
          enemy.x -= (RUN_SPEED * 0.2) * dtS;
        } else if (enemy.kind === "bat") {
          enemy.y += Math.sin(tick * 0.08 + enemy.sinOffset) * 1.2;
        }
        skeleton_AI(enemy, dt);
      }
    }

    // coins
    collectCoins();

    // hazards
    checkHazards();

    // particles
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.x += p.vx * dtS;
      p.y += p.vy * dtS;
      p.vy += 200 * dtS;
      p.life -= dt / p.maxLife;
    }

    // distance score
    score = Math.round(distance * 1 + kills * 50 + coinCount * 5);

    // chunk management
    ensureChunks();

    // hint
    if (hintEl && !hintDismissed) {
      hintTimer += dt;
      if (hintTimer >= HINT_DISMISS_MS) dismissHint();
    }

    // game over
    if (!player.alive) {
      triggerGameOver();
    }
  }

  function dismissHint(): void {
    if (hintDismissed) return;
    hintDismissed = true;
    if (hintEl) {
      hintEl.style.transition = "opacity 0.4s";
      hintEl.style.opacity = "0";
      setTimeout(() => hintEl?.remove(), 400);
    }
    void db.settings.put({ key: "crypt-run:seenHint", value: "1" });
  }

  async function triggerGameOver(): Promise<void> {
    phase = "gameover";
    if (navigator.vibrate) navigator.vibrate([50, 50, 100]);

    const finalScore = score;
    const finalBest = Math.max(best, finalScore);

    await submit("crypt-run", finalScore);
    best = finalBest;

    gameoverEl = showGameoverOverlay(
      canvasWrap,
      finalScore,
      finalBest,
      distance,
      kills,
      coinCount,
      startGame
    );

    const rank = await computeRank("crypt-run", finalScore);
    if (rank && gameoverEl) {
      gameoverEl.addRank(rank);
    }
  }

  function startGame(): void {
    if (gameoverEl) {
      gameoverEl.el.remove();
      gameoverEl = null;
    }
    hintDismissed = false;
    hintTimer = 0;
    initWorld();
    phase = "playing";
    lastTime = 0;

    void db.settings.get("crypt-run:seenHint").then((row) => {
      if (!row) {
        hintEl = maybeShowHint(canvasWrap);
      } else {
        hintDismissed = true;
      }
    });
  }

  // ── render ──
  function drawFrame(ts: number): void {
    if (!stateReady) return;
    const dt = lastTime ? Math.min(ts - lastTime, DT_CAP) : 0;
    lastTime = ts;

    if (phase === "playing" && !paused) {
      update(dt);
    }

    ctx.clearRect(0, 0, canvasW, canvasH);

    if (phase === "idle") {
      drawParallax(ctx, canvasW, canvasH, 0);
      drawHUD(ctx, canvasW, canvasH, 0, 0, 0, best);
      ctx.fillStyle = "rgba(20,4,26,0.4)";
      ctx.fillRect(0, HUD_H, canvasW, canvasH - HUD_H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff5722";
      ctx.font = "bold 20px monospace";
      ctx.shadowColor = "#ff5722";
      ctx.shadowBlur = 12;
      ctx.fillText("CRYPT RUN", canvasW / 2, canvasH * 0.38);
      ctx.shadowBlur = 0;
      const alpha = 0.7 + 0.3 * Math.sin(tick * 0.05);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.font = "14px monospace";
      ctx.fillText("TAP TO START", canvasW / 2, canvasH * 0.52);
      ctx.textAlign = "left";
      tick++;
    } else if (phase === "playing" || phase === "gameover") {
      drawGameArea(
        ctx, canvasW, canvasH,
        worldX, chunks, player, particles,
        playerScreenX, tick,
        distance, score, coinCount, best
      );
    } else if (phase === "paused") {
      drawGameArea(
        ctx, canvasW, canvasH,
        worldX, chunks, player, particles,
        playerScreenX, tick,
        distance, score, coinCount, best
      );
      ctx.fillStyle = "rgba(20,4,26,0.65)";
      ctx.fillRect(0, HUD_H, canvasW, canvasH - HUD_H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff5722";
      ctx.font = "bold 22px monospace";
      ctx.fillText("PAUSED", canvasW / 2, canvasH / 2);
      ctx.textAlign = "left";
    }

    rafId = requestAnimationFrame(drawFrame);
  }

  // ── resize ──
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
    stateReady = true;
    onAfterResize();
  }

  function onAfterResize(): void {
    if (!stateReady) return;
    if (phase === "idle") {
      playerScreenX = Math.round(canvasW * PLAYER_X_RATIO);
      player = makePlayer(playerScreenX, canvasH - HUD_H - TILE);
    }
    drawFrame(0);
  }

  const ro = new ResizeObserver(onResize);
  ro.observe(canvasWrap);
  onResize();

  // ── input ──
  function onPointerDown(e: PointerEvent): void {
    if (e.target === hud.querySelector("#cr-fs") || e.target === hud.querySelector("#cr-pause")) return;
    touchStartY = e.clientY;
    touchStartTime = performance.now();
    touchHolding = true;
    jumpHoldTime = 0;
  }

  function onPointerMove(e: PointerEvent): void {
    if (!touchHolding) return;
    jumpHoldTime = performance.now() - touchStartTime;
    const dy = e.clientY - touchStartY;
    if (dy > 40) {
      touchHolding = false;
      swipeDownQueued = true;
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!touchHolding) return;
    touchHolding = false;
    const pressDuration = performance.now() - touchStartTime;
    const dy = e.clientY - touchStartY;

    if (dy > 40) {
      swipeDownQueued = true;
      return;
    }

    if (phase === "idle") {
      startGame();
      return;
    }

    jumpHoldTime = pressDuration;
    jumpQueued = true;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      if (phase === "idle") { startGame(); return; }
      jumpHoldTime = 100;
      jumpQueued = true;
    }
    if (e.code === "KeyS" || e.code === "ArrowDown") {
      swipeDownQueued = true;
    }
    if (e.code === "Escape" || e.code === "KeyP") {
      if (phase === "playing") { paused = !paused; phase = paused ? "paused" : "playing"; }
      else if (phase === "paused") { paused = false; phase = "playing"; }
    }
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDown);

  // ── buttons ──
  hud.querySelector("#cr-fs")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const host = container.closest<HTMLElement>(".game-host") ?? container;
    if (!document.fullscreenElement) {
      void host.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  });

  hud.querySelector("#cr-pause")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    if (phase === "playing") { paused = true; phase = "paused"; }
    else if (phase === "paused") { paused = false; phase = "playing"; }
  });

  // start RAF
  rafId = requestAnimationFrame(drawFrame);

  // ── cleanup ──
  return () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    container.classList.remove("cryptrun-root");
    container.style.touchAction = prevTouchAction;
    container.innerHTML = "";
  };
}
