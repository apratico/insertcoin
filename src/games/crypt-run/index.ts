import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";
import { playSfx } from "../../lib/audio.js";

// ─── constants ───────────────────────────────────────────────────────────────

const TILE = 32;
const GRAVITY = 1400;
const JUMP_VY_SHORT = -520;
const JUMP_VY_LONG = -680;
const DOUBLE_JUMP_VY = -460;
const JUMP_HOLD_MAX_MS = 300;
const PLAYER_X_RATIO = 0.30;
const HUD_H = 44;
const DT_CAP = 32;
const HINT_DISMISS_MS = 6000;
const SLIDE_DURATION_MS = 400;
const ATTACK_RANGE = 55;
const ATTACK_COOLDOWN_MS = 250;
const ATTACK_DAMAGE_FRAME_MS = 50;
const ATTACK_SWING_MS = 150;
const CHUNK_COLS = 8;
const CHUNK_ROWS = 6;
const LOOKAHEAD_CHUNKS = 3;
const PIXEL = 3; // pixel art scale for sprites

// tile ids
const T_AIR = 0;
const T_GROUND = 1;
const T_PLATFORM = 2;
const T_SPIKE = 3;
const T_COIN = 4;
const T_TORCH = 5;

// ─── difficulty ───────────────────────────────────────────────────────────────

type Difficulty = "easy" | "medium" | "hard";

interface DifficultyParams {
  runSpeed: number;
  gapChance: number;
  enemyChance: number;
  coinChance: number;
  spikeChance: number;
  scoreMultiplier: number;
  enemyHpBonus: number;
}

const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy:   { runSpeed: 170, gapChance: 0.15, enemyChance: 0.30, coinChance: 0.40, spikeChance: 0.10, scoreMultiplier: 1.0,  enemyHpBonus: -1 },
  medium: { runSpeed: 220, gapChance: 0.35, enemyChance: 0.55, coinChance: 0.30, spikeChance: 0.25, scoreMultiplier: 1.5,  enemyHpBonus: 0  },
  hard:   { runSpeed: 280, gapChance: 0.55, enemyChance: 0.80, coinChance: 0.20, spikeChance: 0.40, scoreMultiplier: 2.5,  enemyHpBonus: 1  },
};

// ─── pixel sprite definitions ─────────────────────────────────────────────────

type SpriteRow = string;

const KNIGHT_PALETTE: Record<string, string> = {
  "1": "#b0a8a0",  // armor light grey
  "2": "#5a4f45",  // leg brown
  "3": "#4a4238",  // dark border
  "4": "#c08040",  // belt gold
  "r": "#ff3333",  // glowing eyes
  "s": "#ccddff",  // sword silver
  "v": "#8888cc",  // visor slit
  "h": "#888aaa",  // helm
};

// 4-frame run cycle (8×8 logical px → PIXEL scale)
const KNIGHT_RUN: SpriteRow[][] = [
  [ // frame 0 — stride A
    "...333..",
    "..31133.",
    ".3111133",
    ".3h1vh13",
    ".311113.",
    "..41144.",
    ".22..22.",
    "222...22",
  ],
  [ // frame 1
    "...333..",
    "..31133.",
    ".3111133",
    ".3h1vh13",
    ".311113.",
    "..41144.",
    "222..22.",
    ".22...22",
  ],
  [ // frame 2 — stride B (mirror)
    "...333..",
    "..31133.",
    ".3111133",
    ".3h1vh13",
    ".311113.",
    "..41144.",
    ".22..22.",
    ".22..222",
  ],
  [ // frame 3
    "...333..",
    "..31133.",
    ".3111133",
    ".3h1vh13",
    ".311113.",
    "..41144.",
    ".22..222",
    "22...22.",
  ],
];

// jump — arms up, legs tucked
const KNIGHT_JUMP: SpriteRow[] = [
  "3..333..",
  ".331133.",
  ".3111133",
  ".3h1vh13",
  "3.11113.",
  "..41144.",
  "...22...",
  "..2222..",
];

// slide — 10×6 squashed
const KNIGHT_SLIDE: SpriteRow[] = [
  "..3333333.",
  ".311h1h113",
  "3311111133",
  ".344444433",
  ".22222222.",
  ".2........",
];

// attack swing — sword extended right
const KNIGHT_ATTACK: SpriteRow[] = [
  "...333..",
  "..31133.",
  ".3111133",
  ".3h1vh13",
  ".311113s",
  "..41144ssss",
  "..22.22.",
  "..22.22.",
];

// Zombie walk — 2 frames, 7×9 logical
const ZOMBIE_PALETTE: Record<string, string> = {
  "g": "#55aa55",  // skin green
  "d": "#447744",  // dark green
  "r": "#ff4400",  // red eyes
  "b": "#336633",  // legs
  "k": "#222222",  // dark detail
};

const ZOMBIE_FRAMES: SpriteRow[][] = [
  [ // frame 0
    ".ggggg.",
    "ggrgr.g",
    ".ggggg.",
    ".ddddd.",
    "d.ddd.d",
    "dd...dd",
    "b.....b",
    "bb...bb",
    "bb...bb",
  ],
  [ // frame 1 — shifted arms
    ".ggggg.",
    "g.rgrgg",
    ".ggggg.",
    ".ddddd.",
    "d.ddd.d",
    "dd...dd",
    ".b...b.",
    "bb...bb",
    ".bb.bb.",
  ],
];

// Bat — 2 frames, 9×6 logical
const BAT_PALETTE: Record<string, string> = {
  "r": "#cc3300",  // body red
  "w": "#aa2200",  // wing dark
  "e": "#ff6600",  // eyes orange
  "k": "#1a0010",  // black
};

const BAT_FRAMES: SpriteRow[][] = [
  [ // wings up
    "w..rrr..w",
    "ww.rrr.ww",
    "wwwrrrwww",
    "ww.ere.ww",
    "..wr.rw..",
    "...www...",
  ],
  [ // wings flat
    ".........",
    "ww.rrr.ww",
    "wwwrrrwww",
    "ww.ere.ww",
    "www...www",
    ".wwwwwww.",
  ],
];

// Skeleton — 2 frames, 7×9 logical
const SKELETON_PALETTE: Record<string, string> = {
  "b": "#eeeecc",  // bone cream
  "d": "#ddddaa",  // shadow bone
  "k": "#222222",  // dark
  "s": "#ccddff",  // sword
  "e": "#aabbdd",  // shield edge
  "f": "#7788aa",  // shield face
};

const SKELETON_FRAMES: SpriteRow[][] = [
  [ // frame 0
    ".bbbbb.",
    "bkbkb.b",
    ".bbbbb.",
    ".bdbd..",
    "b.bbb.b",
    "b.....b",
    "b.....b",
    "bb...bb",
    "bb...bb",
  ],
  [ // frame 1
    ".bbbbb.",
    "b.bkbbb",
    ".bbbbb.",
    ".bdbd..",
    "b.bbb.b",
    "b.....b",
    ".b...b.",
    "bb...bb",
    ".bb.bb.",
  ],
];

// Coin — 4 frame rotation (Y-stretch trick), 5×5 logical
const COIN_PALETTE: Record<string, string> = {
  "g": "#ffcc00",  // gold
  "y": "#ffe066",  // highlight
  "d": "#cc8800",  // shadow
};

const COIN_FRAMES: SpriteRow[][] = [
  [ ".ggg.", "gygdg", "gygdg", "gygdg", ".ggg." ],
  [ ".gg.", "yggd", "yggd", "yggd", ".gg." ],
  [ ".g.", "yg.", "ygd", "yg.", ".g." ],
  [ ".gg.", "yggd", "yggd", "yggd", ".gg." ],
];

// Ground tile 32×32 procedural — brick pattern
function buildGroundTileCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE; c.height = TILE;
  const cx = c.getContext("2d")!;

  // base dark purple
  cx.fillStyle = "#2a1035";
  cx.fillRect(0, 0, TILE, TILE);

  // top highlight border
  cx.fillStyle = "#5a2a80";
  cx.fillRect(0, 0, TILE, 2);

  // two brick rows
  const rowH = 14;
  const brickColors = ["#2e1840", "#341a48"];
  for (let row = 0; row < 2; row++) {
    const ry = 4 + row * rowH;
    const offset = row % 2 === 0 ? 0 : 16;
    for (let bx = -16; bx < TILE + 16; bx += 32) {
      const bxShifted = bx + offset;
      cx.fillStyle = brickColors[row % 2]!;
      cx.fillRect(bxShifted, ry, 30, rowH - 2);
      // mortar lines
      cx.fillStyle = "#1a0620";
      cx.fillRect(bxShifted + 29, ry, 2, rowH - 2);
      cx.fillRect(bxShifted, ry + rowH - 2, 32, 2);
    }
  }

  // random cracks on a few spots
  cx.strokeStyle = "#1a0620";
  cx.lineWidth = 1;
  // deterministic "random" cracks using tile constants
  const crackDefs: [number, number, number, number][] = [
    [8, 6, 12, 12], [22, 18, 25, 22],
  ];
  for (const [x1, y1, x2, y2] of crackDefs) {
    cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke();
  }

  return c;
}

// Platform tile — dark wood plank 32×8
function buildPlatformTileCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE; c.height = 8;
  const cx = c.getContext("2d")!;
  cx.fillStyle = "#3d2010";
  cx.fillRect(0, 0, TILE, 8);
  cx.fillStyle = "#5a3018";
  cx.fillRect(0, 0, TILE, 2);
  // wood grain lines
  cx.strokeStyle = "#2a1008";
  cx.lineWidth = 1;
  for (let gx = 6; gx < TILE; gx += 10) {
    cx.beginPath(); cx.moveTo(gx, 2); cx.lineTo(gx + 2, 8); cx.stroke();
  }
  return c;
}

// ─── sprite renderer ──────────────────────────────────────────────────────────

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteRow[],
  palette: Record<string, string>,
  x: number,
  y: number,
  ps: number,          // pixel size
  flipX = false
): void {
  const rows = sprite.length;
  const cols = sprite[0]?.length ?? 0;
  const ox = flipX ? x + cols * ps : x;
  const scaleX = flipX ? -1 : 1;

  ctx.save();
  ctx.translate(ox, y);
  ctx.scale(scaleX, 1);

  for (let r = 0; r < rows; r++) {
    const row = sprite[r]!;
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]!;
      if (ch === ".") continue;
      const color = palette[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(c * ps, r * ps, ps, ps);
    }
  }
  ctx.restore();
}

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

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;  // 0..1
  maxLife: number;
}

interface Chunk {
  col: number; // world tile-column of left edge
  tiles: number[][]; // [row][col], row 0 = top
  enemies: Enemy[];
  coins: Coin[];
}

// ─── fog particles ────────────────────────────────────────────────────────────

interface FogParticle {
  x: number;
  y: number;
  w: number;
  alpha: number;
  speed: number;
}

function initFog(cw: number, ch: number): FogParticle[] {
  const arr: FogParticle[] = [];
  const fogY = ch - HUD_H;
  for (let i = 0; i < 18; i++) {
    arr.push({
      x: Math.random() * cw,
      y: fogY - 20 - Math.random() * 60,
      w: 60 + Math.random() * 120,
      alpha: 0.04 + Math.random() * 0.10,
      speed: 12 + Math.random() * 24,
    });
  }
  return arr;
}

// ─── world tile helpers ───────────────────────────────────────────────────────

function emptyRows(rows: number): number[][] {
  return Array.from({ length: rows }, () => Array(CHUNK_COLS).fill(T_AIR) as number[]);
}

function buildChunk(col: number, diff: DifficultyParams): number[][] {
  const g = T_GROUND;
  const p = T_PLATFORM;
  const s = T_SPIKE;
  const c = T_COIN;
  const t = T_TORCH;

  // probability-gated decorators — applied after template selection
  const addSpike = (r: number[][], row: number, cc: number): void => {
    if (Math.random() < diff.spikeChance) r[row]![cc] = s;
  };
  const addCoin = (r: number[][], row: number, cc: number): void => {
    if (Math.random() < diff.coinChance + 0.1) r[row]![cc] = c;
  };

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
      addCoin(r, CHUNK_ROWS - 4, 3);
      return r;
    },
    // 2: pit (2 tiles wide) — only if gapChance allows
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      if (Math.random() < diff.gapChance) {
        r[CHUNK_ROWS - 1]![3] = T_AIR;
        r[CHUNK_ROWS - 1]![4] = T_AIR;
      }
      return r;
    },
    // 3: pit (3 tiles wide)
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      if (Math.random() < diff.gapChance) {
        r[CHUNK_ROWS - 1]![2] = T_AIR;
        r[CHUNK_ROWS - 1]![3] = T_AIR;
        r[CHUNK_ROWS - 1]![4] = T_AIR;
      }
      return r;
    },
    // 4: spikes on ground
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      addSpike(r, CHUNK_ROWS - 2, 3);
      addSpike(r, CHUNK_ROWS - 2, 4);
      return r;
    },
    // 5: step up then back down
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < 4; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      for (let cc = 4; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 2]![cc] = g;
      addCoin(r, CHUNK_ROWS - 3, 5);
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
      addCoin(r, CHUNK_ROWS - 4, 1);
      addCoin(r, CHUNK_ROWS - 6, 4);
      return r;
    },
    // 8: spike + platform skip
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      addSpike(r, CHUNK_ROWS - 2, 2);
      addSpike(r, CHUNK_ROWS - 2, 5);
      r[CHUNK_ROWS - 4]![3] = p; r[CHUNK_ROWS - 4]![4] = p;
      addCoin(r, CHUNK_ROWS - 5, 3);
      return r;
    },
    // 9: wide pit with platform bridge
    () => {
      const r = emptyRows(CHUNK_ROWS);
      for (let cc = 0; cc < 2; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      for (let cc = 6; cc < CHUNK_COLS; cc++) r[CHUNK_ROWS - 1]![cc] = g;
      if (Math.random() < diff.gapChance) {
        r[CHUNK_ROWS - 3]![3] = p; r[CHUNK_ROWS - 3]![4] = p; r[CHUNK_ROWS - 3]![5] = p;
      } else {
        // fill the pit on easy
        for (let cc = 2; cc < 6; cc++) r[CHUNK_ROWS - 1]![cc] = g;
        r[CHUNK_ROWS - 3]![3] = p; r[CHUNK_ROWS - 3]![4] = p; r[CHUNK_ROWS - 3]![5] = p;
      }
      addCoin(r, CHUNK_ROWS - 4, 4);
      return r;
    },
  ];

  const idx = (col / CHUNK_COLS + Math.floor(col / CHUNK_COLS * 7.3)) % templates.length | 0;
  const fn = templates[Math.abs(idx) % templates.length]!;
  return fn();
}

// ─── enemy factory ───────────────────────────────────────────────────────────

let _eid = 0;

function spawnEnemyForChunk(chunk: Chunk, canvasH: number, diff: DifficultyParams): void {
  if (Math.random() > diff.enemyChance) return;

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

  const baseHp = kind === "skeleton" ? 2 : 1;
  const hp = Math.max(1, baseHp + diff.enemyHpBonus);
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

function spawnDustParticles(particles: Particle[], x: number, y: number): void {
  const count = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    particles.push({
      x: x + (Math.random() - 0.5) * 8,
      y,
      vx: (Math.random() - 0.5) * 30,
      vy: -20 - Math.random() * 20,
      color: "#aa9988",
      life: 1,
      maxLife: 180 + Math.random() * 80,
      r: 1 + Math.random() * 1.5,
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
          if (player.vy >= 0 && prevY - h <= ty && player.y - h >= ty - 2) {
            player.y = ty;
            player.vy = 0;
            player.onGround = true;
            player.jumpsUsed = 0;
          }
        } else {
          const overlapX = Math.min(pr.x + pr.w, tx + TILE) - Math.max(pr.x, tx);
          const overlapY = Math.min(pr.y, ty + TILE) - Math.max(pr.y - h, ty);

          if (overlapX < overlapY) {
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

// Cached tile canvases (built once)
let _groundTile: HTMLCanvasElement | null = null;
let _platformTile: HTMLCanvasElement | null = null;

function getGroundTile(): HTMLCanvasElement {
  if (!_groundTile) _groundTile = buildGroundTileCanvas();
  return _groundTile;
}

function getPlatformTile(): HTMLCanvasElement {
  if (!_platformTile) _platformTile = buildPlatformTileCanvas();
  return _platformTile;
}

function drawParallax(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  worldX: number,
  fogParticles: FogParticle[],
  tick: number
): void {
  // sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, ch);
  sky.addColorStop(0, "#0d021a");
  sky.addColorStop(0.6, "#1a0530");
  sky.addColorStop(1, "#2a0838");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cw, ch);

  // stars — 3 sizes + sinusoidal twinkle
  const starOff = (worldX * 0.15) % cw;
  for (let i = 0; i < 36; i++) {
    const sx = ((i * 53 + 17) % (cw * 2)) - starOff;
    const sy = ((i * 37 + 11) % (ch * 0.50));
    const sizeTier = i % 6;
    const sr = sizeTier === 0 ? 2.0 : sizeTier < 3 ? 1.2 : 0.6;
    const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(tick * 0.02 + i * 0.9));
    ctx.globalAlpha = twinkle;
    ctx.fillStyle = i % 7 === 0 ? "#fffacc" : "#ffffff";
    ctx.beginPath();
    ctx.arc(((sx % cw) + cw) % cw, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // moon — large, top-right area, with craters + glow
  const moonX = cw * 0.82;
  const moonY = ch * 0.22;
  const moonR = 28;
  // glow
  const moonGlow = ctx.createRadialGradient(moonX, moonY, moonR * 0.6, moonX, moonY, moonR * 2.2);
  moonGlow.addColorStop(0, "rgba(255,255,210,0.22)");
  moonGlow.addColorStop(1, "rgba(255,255,210,0)");
  ctx.fillStyle = moonGlow;
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR * 2.2, 0, Math.PI * 2);
  ctx.fill();
  // moon body
  ctx.fillStyle = "#f5f0d8";
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
  ctx.fill();
  // craters
  const craterDefs: [number, number, number][] = [
    [-8, -6, 5], [10, 4, 7], [-4, 12, 4], [14, -10, 3],
  ];
  for (const [cx2, cy2, cr] of craterDefs) {
    ctx.fillStyle = "rgba(180,170,130,0.55)";
    ctx.beginPath();
    ctx.arc(moonX + cx2, moonY + cy2, cr, 0, Math.PI * 2);
    ctx.fill();
  }

  // castle silhouette — 3 depth layers
  const castleColors = ["#160420", "#1a0828", "#220e32"];
  const depthSpeeds = [0.25, 0.45, 0.65];
  for (let depth = 0; depth < 3; depth++) {
    const castleOff = (worldX * depthSpeeds[depth]!) % (cw * 2);
    ctx.fillStyle = castleColors[depth]!;
    const castleW = cw * 2;
    const towerCount = 5 + depth;
    const baseH = 30 + depth * 18;

    // base wall
    ctx.fillRect(
      ((-castleOff % castleW) + castleW) % castleW - castleW,
      ch - HUD_H - baseH,
      castleW * 2,
      baseH
    );

    for (let i = 0; i < towerCount; i++) {
      const bx = ((i / towerCount) * castleW - castleOff + castleW * 2) % castleW;
      const bh = baseH + 20 + (i % 3) * 16 + depth * 10;
      const bw = 18 + (i % 2) * 10 + depth * 4;

      ctx.fillRect(bx - bw / 2, ch - HUD_H - bh, bw, bh);

      // merlons
      const mCount = Math.max(2, Math.floor(bw / 8));
      const mw = bw / mCount;
      for (let m = 0; m < mCount; m++) {
        if (m % 2 === 0) {
          ctx.fillRect(bx - bw / 2 + m * mw, ch - HUD_H - bh - 8, mw - 2, 9);
        }
      }

      // lit windows (orange dots) on back layers
      if (depth < 2) {
        ctx.fillStyle = "#ff9933";
        ctx.shadowColor = "#ff9933";
        ctx.shadowBlur = 4;
        const wCount = Math.max(1, Math.floor(bh / 20));
        for (let ww = 0; ww < wCount; ww++) {
          const wy = ch - HUD_H - bh + 10 + ww * 18;
          if (wy < ch - HUD_H - 4) {
            ctx.fillRect(bx - 2, wy, 4, 5);
          }
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = castleColors[depth]!;
      }
    }
  }

  // fog layer — mid-ground horizontal wisps
  for (const fp of fogParticles) {
    const grad = ctx.createLinearGradient(fp.x, fp.y, fp.x + fp.w, fp.y);
    grad.addColorStop(0,   `rgba(120,60,180,0)`);
    grad.addColorStop(0.3, `rgba(120,60,180,${fp.alpha})`);
    grad.addColorStop(0.7, `rgba(120,60,180,${fp.alpha})`);
    grad.addColorStop(1,   `rgba(120,60,180,0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(fp.x, fp.y, fp.w, 18);
  }

  // ground strip gradient
  const groundGrad = ctx.createLinearGradient(0, ch - HUD_H - 8, 0, ch - HUD_H);
  groundGrad.addColorStop(0, "#3e1060");
  groundGrad.addColorStop(1, "#1e0828");
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, ch - HUD_H - 4, cw, 4);
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  chunks: Chunk[],
  worldX: number,
  ch: number,
  tick: number
): void {
  const groundY = ch - HUD_H;
  const gt = getGroundTile();
  const pt = getPlatformTile();

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
            ctx.drawImage(gt, wx, wy, TILE, TILE);
            break;

          case T_PLATFORM:
            ctx.drawImage(pt, wx, wy, TILE, 8);
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
            const flickerA = 0.7 + 0.3 * Math.sin(tick * 0.14);
            ctx.fillStyle = `rgba(255,136,0,${flickerA})`;
            ctx.shadowColor = "#ff8800";
            ctx.shadowBlur = 10 + 4 * Math.sin(tick * 0.17);
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
      // animated 4-frame coin
      const frame = Math.floor(tick / 8) % 4;
      const cf = COIN_FRAMES[frame]!;
      // center the 5×5 sprite (at PIXEL scale = 15×15) around sx,sy
      drawSprite(ctx, cf, COIN_PALETTE, sx - cf[0]!.length * PIXEL / 2, sy - cf.length * PIXEL / 2, PIXEL);
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

      switch (enemy.kind) {
        case "zombie": {
          const frame = Math.floor(tick / 12) % 2;
          const sprite = ZOMBIE_FRAMES[frame]!;
          const cols = sprite[0]!.length;
          const rows = sprite.length;
          // shadow glow
          ctx.shadowColor = "#33aa33";
          ctx.shadowBlur = 6;
          drawSprite(ctx, sprite, ZOMBIE_PALETTE, sx - cols * PIXEL / 2, sy - rows * PIXEL, PIXEL, true);
          ctx.shadowBlur = 0;
          break;
        }
        case "bat": {
          const batY = sy + Math.sin(tick * 0.07 + enemy.sinOffset) * 8;
          const frame = Math.floor(tick / 8) % 2;
          const sprite = BAT_FRAMES[frame]!;
          const cols = sprite[0]!.length;
          const rows = sprite.length;
          ctx.shadowColor = "#ff4400";
          ctx.shadowBlur = 8;
          drawSprite(ctx, sprite, BAT_PALETTE, sx - cols * PIXEL / 2, batY - rows * PIXEL / 2, PIXEL);
          ctx.shadowBlur = 0;
          break;
        }
        case "skeleton": {
          const frame = Math.floor(tick / 14) % 2;
          const sprite = SKELETON_FRAMES[frame]!;
          const cols = sprite[0]!.length;
          const rows = sprite.length;
          ctx.shadowColor = "#aabbdd";
          ctx.shadowBlur = 5;
          drawSprite(ctx, sprite, SKELETON_PALETTE, sx - cols * PIXEL / 2, sy - rows * PIXEL, PIXEL, true);
          ctx.shadowBlur = 0;
          // shield overlay
          if (enemy.shieldUp) {
            ctx.fillStyle = "rgba(100,120,180,0.35)";
            ctx.strokeStyle = "#aabbdd";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sx - cols * PIXEL / 2 - 8, sy - rows * PIXEL);
            ctx.lineTo(sx - cols * PIXEL / 2 - 14, sy - rows * PIXEL * 0.6);
            ctx.lineTo(sx - cols * PIXEL / 2 - 12, sy - rows * PIXEL * 0.1);
            ctx.lineTo(sx - cols * PIXEL / 2 - 5, sy);
            ctx.lineTo(sx - cols * PIXEL / 2 - 3, sy - rows * PIXEL * 0.4);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          break;
        }
      }
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
  const attacking = player.attackTimer > 0;

  ctx.save();
  ctx.shadowColor = "#8844ff";
  ctx.shadowBlur = 10;

  if (sliding) {
    // slide sprite: 10 cols × 6 rows at PIXEL scale
    const sprite = KNIGHT_SLIDE;
    const cols = sprite[0]!.length;
    const rows = sprite.length;
    drawSprite(ctx, sprite, KNIGHT_PALETTE, x - cols * PIXEL / 2, y - rows * PIXEL, PIXEL);
  } else if (attacking) {
    // attack swing: show swing trail arc + attack sprite
    const swingProgress = player.swingAngle / (Math.PI / 2);

    // arc trail: white → transparent gradient
    ctx.save();
    ctx.globalAlpha = (1 - swingProgress) * 0.7;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    const arcR = 20;
    const arcStartAngle = -Math.PI * 0.85;
    const arcEndAngle = arcStartAngle + player.swingAngle * 1.2;
    ctx.arc(x + 4, y - 14, arcR, arcStartAngle, arcEndAngle);
    ctx.stroke();
    ctx.restore();

    // attack sprite
    drawSprite(ctx, KNIGHT_ATTACK, KNIGHT_PALETTE, x - 8 * PIXEL / 2, y - 8 * PIXEL, PIXEL);
  } else if (!player.onGround) {
    // jump sprite
    const sprite = KNIGHT_JUMP;
    const cols = sprite[0]!.length;
    const rows = sprite.length;
    drawSprite(ctx, sprite, KNIGHT_PALETTE, x - cols * PIXEL / 2, y - rows * PIXEL, PIXEL);
  } else {
    // run cycle: 4 frames
    const frame = Math.floor(tick / 6) % 4;
    const sprite = KNIGHT_RUN[frame]!;
    const cols = sprite[0]!.length;
    const rows = sprite.length;
    drawSprite(ctx, sprite, KNIGHT_PALETTE, x - cols * PIXEL / 2, y - rows * PIXEL, PIXEL);
  }

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

function drawFloatTexts(
  ctx: CanvasRenderingContext2D,
  floats: FloatText[],
  worldX: number
): void {
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "center";
  for (const ft of floats) {
    if (ft.life <= 0) continue;
    ctx.globalAlpha = ft.life;
    ctx.fillStyle = "#ffdd00";
    ctx.shadowColor = "#ffaa00";
    ctx.shadowBlur = 6;
    ctx.fillText(ft.text, ft.x - worldX, ft.y);
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

function drawHUD(
  ctx: CanvasRenderingContext2D,
  cw: number,
  _ch: number,
  distance: number,
  score: number,
  coins: number,
  best: number,
  difficulty: Difficulty
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
  ctx.fillText(`${coins}c`, cw - 54, 16);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "8px monospace";
  ctx.fillText(`B:${best}`, cw - 54, 28);

  // difficulty badge
  const diffColor: Record<Difficulty, string> = { easy: "#44cc44", medium: "#ffaa00", hard: "#ff3333" };
  ctx.fillStyle = diffColor[difficulty]!;
  ctx.font = "bold 8px monospace";
  ctx.textAlign = "right";
  ctx.fillText(difficulty.toUpperCase(), cw - 8, 20);

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
  floatTexts: FloatText[],
  fogParticles: FogParticle[],
  playerScreenX: number,
  tick: number,
  distance: number,
  score: number,
  coins: number,
  best: number,
  difficulty: Difficulty
): void {
  drawParallax(ctx, cw, ch, worldX, fogParticles, tick);
  drawTiles(ctx, chunks, worldX, ch, tick);
  drawCoins(ctx, chunks, worldX, tick);
  drawEnemies(ctx, chunks, worldX, tick);
  drawParticles(ctx, particles, worldX);
  drawFloatTexts(ctx, floatTexts, worldX);
  drawPlayer(ctx, player, playerScreenX, tick);
  drawHUD(ctx, cw, ch, distance, score, coins, best, difficulty);
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
  difficulty: Difficulty,
  onReplay: () => void
): { el: HTMLElement; addRank: (r: RankInfo) => void } {
  const isNew = score >= best && score > 0;
  const multStr = DIFFICULTY[difficulty].scoreMultiplier === 1 ? "" :
    ` <span style="font-size:12px;color:#ffaa00">×${DIFFICULTY[difficulty].scoreMultiplier}</span>`;
  const overlay = document.createElement("div");
  overlay.className = "cr-gameover";
  overlay.innerHTML = `
    <div class="cr-go-box">
      <h2 class="cr-go-title">GAME OVER</h2>
      ${isNew ? `<div class="cr-go-new">NEW BEST!</div>` : ""}
      <div class="cr-go-score">${score}${multStr}</div>
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

// ─── difficulty dialog ────────────────────────────────────────────────────────

function showDifficultyDialog(
  container: HTMLElement,
  current: Difficulty,
  onSelect: (d: Difficulty) => void
): void {
  // remove existing
  container.querySelector(".cr-diff-dialog")?.remove();

  const dialog = document.createElement("div");
  dialog.className = "cr-diff-dialog";
  dialog.innerHTML = `
    <div class="cr-diff-box">
      <div class="cr-diff-title">DIFFICULTY</div>
      <button class="btn cr-diff-opt${current === "easy" ? " cr-diff-active" : ""}" data-diff="easy">
        EASY <span class="cr-diff-sub">x1 score</span>
      </button>
      <button class="btn cr-diff-opt${current === "medium" ? " cr-diff-active" : ""}" data-diff="medium">
        MEDIUM <span class="cr-diff-sub">x1.5 score</span>
      </button>
      <button class="btn cr-diff-opt${current === "hard" ? " cr-diff-active" : ""}" data-diff="hard">
        HARD <span class="cr-diff-sub">x2.5 score</span>
      </button>
      <button class="btn cr-diff-cancel" id="cr-diff-close">CANCEL</button>
    </div>
  `;
  container.appendChild(dialog);

  dialog.querySelectorAll<HTMLElement>(".cr-diff-opt").forEach((btn) => {
    btn.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      const d = btn.dataset["diff"] as Difficulty | undefined;
      if (d) {
        dialog.remove();
        onSelect(d);
      }
    });
  });
  dialog.querySelector("#cr-diff-close")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    dialog.remove();
  });
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
.cr-hud-diff { min-width: 52px; min-height: 44px; background: transparent;
  border: 1px solid rgba(255,87,34,0.4); border-radius: 6px;
  color: #ff5722; font-family: monospace; font-size: 10px; font-weight: bold;
  cursor: pointer; padding: 0 6px; letter-spacing: 1px; }
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
.cr-diff-dialog {
  position: absolute; inset: 0; background: rgba(20,4,26,0.88);
  display: flex; align-items: center; justify-content: center; z-index: 20; }
.cr-diff-box {
  background: #1e0830; border: 2px solid #7744aa; border-radius: 12px;
  padding: 20px 24px; text-align: center; color: #fff; width: 80%; max-width: 280px;
  display: flex; flex-direction: column; gap: 10px; }
.cr-diff-title { font-family: monospace; font-size: 16px; font-weight: bold;
  color: #cc88ff; letter-spacing: 2px; margin-bottom: 4px; }
.cr-diff-opt { min-height: 44px; font-family: monospace; font-size: 13px;
  font-weight: bold; letter-spacing: 1px; }
.cr-diff-active { border-color: #cc88ff !important; color: #cc88ff !important; }
.cr-diff-sub { font-size: 10px; font-weight: normal; opacity: 0.7; margin-left: 6px; }
.cr-diff-cancel { min-height: 40px; font-family: monospace; font-size: 11px;
  opacity: 0.7; }
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
    <div style="display:flex;gap:4px;align-items:center">
      <button class="cr-hud-diff" id="cr-diff" aria-label="Difficulty">DIFF</button>
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

  // ── difficulty state ──
  let currentDifficulty: Difficulty = "medium";
  void db.settings.get("crypt-run:difficulty").then((row) => {
    if (row && (row.value === "easy" || row.value === "medium" || row.value === "hard")) {
      currentDifficulty = row.value as Difficulty;
    }
  });

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
  let floatTexts: FloatText[] = [];
  let fogParticles: FogParticle[] = [];
  let nextChunkCol = 0;
  let dustFrameCounter = 0;

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

  function activeDiff(): DifficultyParams {
    return DIFFICULTY[currentDifficulty];
  }

  function initWorld(): void {
    worldX = 0;
    distance = 0;
    score = 0;
    coinCount = 0;
    kills = 0;
    chunks = [];
    particles = [];
    floatTexts = [];
    nextChunkCol = 0;
    dustFrameCounter = 0;
    fogParticles = initFog(canvasW, canvasH);

    playerScreenX = Math.round(canvasW * PLAYER_X_RATIO);
    const groundY = canvasH - HUD_H;
    player = makePlayer(playerScreenX + worldX, groundY - TILE);
    player.onGround = true;

    for (let i = 0; i < LOOKAHEAD_CHUNKS + 1; i++) addChunk();
  }

  function addChunk(): void {
    const diff = activeDiff();
    const tiles = buildChunk(nextChunkCol, diff);
    const chunk: Chunk = {
      col: nextChunkCol,
      tiles,
      enemies: [],
      coins: [],
    };
    const groundY = canvasH - HUD_H;
    coinsFromTiles(chunk, groundY);
    if (nextChunkCol > CHUNK_COLS * 2) {
      spawnEnemyForChunk(chunk, canvasH, diff);
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
    const meleeFront: Rect = {
      x: pr.x + pr.w,
      y: pr.y - pr.h * 0.5,
      w: ATTACK_RANGE,
      h: pr.h * 1.5,
    };

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
          playSfx("kill");
          if (navigator.vibrate) navigator.vibrate(12);
        }
      }
    }
  }

  function checkHazards(): void {
    const pr = playerRect(player);
    const groundY = canvasH - HUD_H;
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
    for (const chunk of chunks) {
      for (const enemy of chunk.enemies) {
        if (!enemy.alive) continue;
        if (rectsOverlap(pr, enemyRect(enemy))) {
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
          // coin pickup: 6 yellow scatter particles + float text
          spawnParticles(particles, coin.x, coin.y, "#ffcc00", 6);
          floatTexts.push({
            x: coin.x,
            y: coin.y - 10,
            text: "+5",
            life: 1,
            maxLife: 500,
          });
          playSfx("coin");
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
    const diff = activeDiff();

    // scroll world using difficulty speed
    worldX += diff.runSpeed * dtS;
    distance += diff.runSpeed * dtS / 100;

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
        playSfx("jump");
        if (navigator.vibrate) navigator.vibrate(5);
        dismissHint();
      } else if (player.jumpsUsed < 2) {
        player.vy = DOUBLE_JUMP_VY;
        player.jumpsUsed = 2;
        playSfx("jump");
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

    // dust particles when running on ground
    if (player.onGround && !player.sliding) {
      dustFrameCounter++;
      if (dustFrameCounter >= 6) {
        dustFrameCounter = 0;
        spawnDustParticles(particles, player.x, player.y);
      }
    } else {
      dustFrameCounter = 0;
    }

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
          enemy.x -= (diff.runSpeed * 0.2) * dtS;
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

    // float texts
    for (const ft of floatTexts) {
      if (ft.life <= 0) continue;
      const progress = 1 - ft.life;
      ft.y -= 40 * dtS; // float upward 40px total
      ft.life -= dt / ft.maxLife;
      void progress;
    }

    // fog movement
    for (const fp of fogParticles) {
      fp.x += fp.speed * dtS;
      if (fp.x > canvasW + fp.w) fp.x = -fp.w;
    }

    // distance score with multiplier
    const mult = diff.scoreMultiplier;
    score = Math.round((distance * 1 + kills * 50 + coinCount * 5) * mult);

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
    playSfx("gameover");
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
      currentDifficulty,
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
      drawParallax(ctx, canvasW, canvasH, 0, fogParticles, tick);
      drawHUD(ctx, canvasW, canvasH, 0, 0, 0, best, currentDifficulty);
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
        worldX, chunks, player, particles, floatTexts, fogParticles,
        playerScreenX, tick,
        distance, score, coinCount, best, currentDifficulty
      );
    } else if (phase === "paused") {
      drawGameArea(
        ctx, canvasW, canvasH,
        worldX, chunks, player, particles, floatTexts, fogParticles,
        playerScreenX, tick,
        distance, score, coinCount, best, currentDifficulty
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
      fogParticles = initFog(canvasW, canvasH);
    }
    drawFrame(0);
  }

  const ro = new ResizeObserver(onResize);
  ro.observe(canvasWrap);
  onResize();

  // ── input ──
  function onPointerDown(e: PointerEvent): void {
    if (
      e.target === hud.querySelector("#cr-fs") ||
      e.target === hud.querySelector("#cr-pause") ||
      e.target === hud.querySelector("#cr-diff")
    ) return;
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

  hud.querySelector("#cr-diff")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    showDifficultyDialog(canvasWrap, currentDifficulty, (chosen) => {
      currentDifficulty = chosen;
      void db.settings.put({ key: "crypt-run:difficulty", value: chosen });
      // restart run with new difficulty
      if (phase === "playing" || phase === "paused") {
        paused = false;
        if (gameoverEl) { gameoverEl.el.remove(); gameoverEl = null; }
        startGame();
      }
    });
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
