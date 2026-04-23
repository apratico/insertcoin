import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";
import { playSfx } from "../../lib/audio.js";
import { db } from "../../lib/storage.js";

// ─── constants ────────────────────────────────────────────────────────────────

const GAME_ID = "gem-cascade";
const HINT_KEY = "gem-cascade:seenHint";
const MODE_KEY = "gem-cascade:mode";
const LEVEL_KEY = "gem-cascade:level";

const GRID_COLS = 8;
const GRID_ROWS = 8;
const GEM_COLORS = 6;
const MAX_TILE = 48;

const TIME_ATTACK_SECS = 60;
const MOVES_INIT = 30;
const MOVES_BONUS = 5;

const BASE_SCORE_PER_GEM = 20;
const HINT_IDLE_MS = 8000;

// cascade multipliers [cascadeIndex] → multiplier (0-indexed)
const CASCADE_MULT = [1, 1.5, 2, 3];

// match length bonus multipliers
function matchLenMult(len: number): number {
  if (len >= 6) return 3;
  if (len === 5) return 2;
  if (len === 4) return 1.5;
  return 1;
}

// level N target score for Moves mode
function levelTarget(n: number): number {
  return 500 * n + 200 * (n - 1);
}

// ─── gem types ────────────────────────────────────────────────────────────────

type GemColor = 0 | 1 | 2 | 3 | 4 | 5;
const EMPTY_CELL = 255 as GemColor; // sentinel for empty cells during gravity
type GameMode = "time" | "moves" | "endless";

interface Gem {
  color: GemColor;
  // position in DOM terms — managed by CSS transform
  el: HTMLElement;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function rndColor(): GemColor {
  return (Math.floor(Math.random() * GEM_COLORS)) as GemColor;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─── gem rendering ────────────────────────────────────────────────────────────

const GEM_CFG: { color: string; shape: string }[] = [
  { color: "#ff3344", shape: "rhombus" },   // 0 red
  { color: "#00eeff", shape: "circle" },    // 1 cyan
  { color: "#ffee00", shape: "triangle" },  // 2 yellow
  { color: "#44ff66", shape: "pentagon" },  // 3 green
  { color: "#aa44ff", shape: "star" },      // 4 purple
  { color: "#ff8822", shape: "hexagon" },   // 5 orange
];

function shapeSvg(shape: string, color: string): string {
  const s = 20; // symbol size within gem cell
  const c = s / 2;
  switch (shape) {
    case "rhombus":
      return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
        <polygon points="${c},1 ${s-1},${c} ${c},${s-1} 1,${c}" fill="${color}" opacity="0.95"/>
      </svg>`;
    case "circle":
      return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
        <circle cx="${c}" cy="${c}" r="${c - 1.5}" fill="${color}" opacity="0.95"/>
      </svg>`;
    case "triangle":
      return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
        <polygon points="${c},1.5 ${s-1.5},${s-1.5} 1.5,${s-1.5}" fill="${color}" opacity="0.95"/>
      </svg>`;
    case "pentagon": {
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const a = (i * 72 - 90) * Math.PI / 180;
        pts.push(`${(c + (c - 1.5) * Math.cos(a)).toFixed(1)},${(c + (c - 1.5) * Math.sin(a)).toFixed(1)}`);
      }
      return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
        <polygon points="${pts.join(" ")}" fill="${color}" opacity="0.95"/>
      </svg>`;
    }
    case "star": {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = (i * 36 - 90) * Math.PI / 180;
        const r2 = i % 2 === 0 ? c - 1.5 : (c - 1.5) * 0.45;
        pts.push(`${(c + r2 * Math.cos(a)).toFixed(1)},${(c + r2 * Math.sin(a)).toFixed(1)}`);
      }
      return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
        <polygon points="${pts.join(" ")}" fill="${color}" opacity="0.95"/>
      </svg>`;
    }
    case "hexagon": {
      const pts: string[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i * 60 - 30) * Math.PI / 180;
        pts.push(`${(c + (c - 1.5) * Math.cos(a)).toFixed(1)},${(c + (c - 1.5) * Math.sin(a)).toFixed(1)}`);
      }
      return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
        <polygon points="${pts.join(" ")}" fill="${color}" opacity="0.95"/>
      </svg>`;
    }
    default:
      return "";
  }
}

function createGemEl(color: GemColor, tileSize: number): HTMLElement {
  const cfg = GEM_CFG[color]!;
  const el = document.createElement("div");
  el.className = "gc-gem";
  el.style.width = `${tileSize}px`;
  el.style.height = `${tileSize}px`;
  el.style.backgroundColor = cfg.color + "22";
  el.innerHTML = `<div class="gc-gem-shape" style="color:${cfg.color}">${shapeSvg(cfg.shape, cfg.color)}</div>`;
  return el;
}

// ─── styles ──────────────────────────────────────────────────────────────────

function injectStyles(): void {
  const ID = "gc-styles";
  if (document.getElementById(ID)) return;
  const s = document.createElement("style");
  s.id = ID;
  s.textContent = `
    .gem-root { display:flex; flex-direction:column; flex:1; min-height:0; }

    .gc-wrap {
      display:flex; flex-direction:column; flex:1; min-height:0;
      background:#1a0030; overflow:hidden;
    }

    .gc-hud {
      display:flex; align-items:center; justify-content:space-between;
      height:60px; padding:0 10px; flex-shrink:0;
      background:rgba(0,0,0,0.55); border-bottom:1px solid #2a0050;
      font-family:'Press Start 2P',ui-monospace,monospace; color:#fff;
    }
    .gc-hud-score { font-size:11px; color:#ff44ff; }
    .gc-hud-score-label { font-size:7px; color:#aaa; margin-bottom:2px; }
    .gc-hud-mode-btn {
      background:transparent; border:1px solid #aa44ff; color:#aa44ff;
      font-family:'Press Start 2P',ui-monospace,monospace; font-size:7px;
      padding:5px 7px; cursor:pointer; border-radius:4px; min-width:44px;
    }
    .gc-hud-mode-btn:active { background:#2a0050; }
    .gc-hud-right { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
    .gc-hud-stat { font-size:11px; color:#ff44ff; text-align:right; }
    .gc-hud-stat-label { font-size:7px; color:#aaa; text-align:right; }
    .gc-hud-btns { display:flex; gap:6px; align-items:center; }
    .gc-hud-btn {
      background:transparent; border:1px solid #333; color:#aaa;
      font-size:14px; padding:0; width:36px; height:36px; cursor:pointer;
      border-radius:4px; display:flex; align-items:center; justify-content:center;
    }
    .gc-hud-btn:active { background:#1a003a; }

    .gc-mode-bar {
      display:flex; align-items:center; justify-content:center;
      height:50px; flex-shrink:0; gap:8px; padding:0 8px;
      background:rgba(0,0,0,0.4); border-bottom:1px solid #1a0030;
      font-family:'Press Start 2P',ui-monospace,monospace;
    }
    .gc-mode-tab {
      background:transparent; border:1px solid #440077; color:#884488;
      font-family:'Press Start 2P',ui-monospace,monospace; font-size:7px;
      padding:7px 10px; cursor:pointer; border-radius:4px; min-width:44px;
    }
    .gc-mode-tab.active {
      background:#5500aa; border-color:#aa44ff; color:#fff;
    }
    .gc-mode-tab:active { opacity:0.8; }

    .gc-progress-bar {
      height:6px; flex-shrink:0; background:#1a0030; position:relative;
    }
    .gc-progress-fill {
      height:100%; background:#ff44ff; transition:width 0.3s ease;
      box-shadow:0 0 6px #ff44ff;
    }

    .gc-board-wrap {
      flex:1; min-height:0; display:flex; align-items:center; justify-content:center;
      overflow:hidden; position:relative;
    }

    .gc-board {
      position:relative;
      background:rgba(0,0,0,0.3);
      border:1px solid #2a0050;
      border-radius:4px;
      overflow:hidden;
    }

    .gc-gem {
      position:absolute;
      display:flex; align-items:center; justify-content:center;
      border-radius:4px;
      cursor:pointer;
      transition:transform 0.2s ease, opacity 0.18s ease, box-shadow 0.1s ease;
      box-sizing:border-box;
      border:1px solid rgba(255,255,255,0.08);
    }
    .gc-gem:active { opacity:0.8; }
    .gc-gem.selected {
      border:2px solid #fff !important;
      box-shadow:0 0 10px rgba(255,255,255,0.6), 0 0 20px rgba(255,68,255,0.4);
      z-index:2;
    }
    .gc-gem.hint-glow {
      box-shadow:0 0 14px rgba(255,238,0,0.8), 0 0 28px rgba(255,238,0,0.4) !important;
      border:2px solid #ffee00 !important;
      z-index:2;
    }
    .gc-gem.popping {
      transition:transform 0.18s ease-out, opacity 0.18s ease-out !important;
      transform:scale(1.2) !important;
      opacity:0 !important;
      pointer-events:none;
    }
    .gc-gem.spawning {
      transition:transform 0.18s ease-out, opacity 0.18s ease-out !important;
      opacity:0;
      transform:scale(0.5) !important;
    }
    .gc-gem.spawned {
      opacity:1 !important;
      transform:scale(1) !important;
    }
    .gc-gem-shape {
      display:flex; align-items:center; justify-content:center;
      pointer-events:none;
    }

    .gc-combo {
      position:absolute; top:30%; left:50%; transform:translateX(-50%);
      font-family:'Press Start 2P',ui-monospace,monospace; font-size:14px;
      color:#ffee00; text-shadow:0 0 12px #ff44ff; pointer-events:none;
      z-index:10; opacity:0; transition:opacity 0.2s ease;
    }
    .gc-combo.show {
      opacity:1;
      animation:gc-combo-pop 0.6s ease-out forwards;
    }
    @keyframes gc-combo-pop {
      0%   { transform:translateX(-50%) scale(0.5); opacity:1; }
      40%  { transform:translateX(-50%) scale(1.3); opacity:1; }
      100% { transform:translateX(-50%) scale(1.0); opacity:0; }
    }

    .gc-overlay {
      position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,0.78); z-index:20;
      font-family:'Press Start 2P',ui-monospace,monospace;
    }
    .gc-go-box {
      background:#0f0020; border:2px solid #ff44ff; border-radius:10px;
      padding:28px 22px; text-align:center; color:#fff; max-width:300px; width:90%;
      display:flex; flex-direction:column; gap:10px; align-items:center;
    }
    .gc-go-title { font-size:16px; color:#ff44ff; margin:0; }
    .gc-go-new { font-size:8px; color:#ffee44; }
    .gc-go-score { font-size:30px; color:#fff; }
    .gc-go-sublabel { font-size:7px; color:#888; margin-top:-4px; }
    .gc-go-best { font-size:8px; color:#aaa; }
    .gc-go-actions { display:flex; gap:10px; margin-top:6px; }
    .gc-go-btn {
      font-family:'Press Start 2P',ui-monospace,monospace; font-size:8px;
      padding:10px 14px; cursor:pointer; border-radius:6px;
    }
    .gc-go-btn.primary { background:#ff44ff; border:none; color:#fff; }
    .gc-go-btn:not(.primary) { background:transparent; border:1px solid #555; color:#aaa; }

    .gc-hint-overlay {
      position:absolute; inset:0; pointer-events:none;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:12px; z-index:15;
      font-family:'Press Start 2P',ui-monospace,monospace; font-size:9px;
      color:rgba(255,255,255,0.9); text-align:center;
      text-shadow:0 0 10px #000;
      background:rgba(0,0,0,0.55);
    }
    .gc-hint-line { margin:0; }

    .rank-card {
      background:rgba(255,68,255,0.1); border:1px solid #ff44ff; border-radius:6px;
      padding:8px 12px; font-size:7px; color:#ccc; text-align:center;
      width:100%; box-sizing:border-box;
    }
    .rank-card-title { color:#ff44ff; margin-bottom:4px; font-size:8px; }
    .rank-card-delta { font-size:7px; margin-bottom:4px; }
    .rank-card-btn {
      font-family:'Press Start 2P',ui-monospace,monospace; font-size:6px;
      background:transparent; border:1px solid #ff44ff; color:#ff44ff;
      padding:4px 8px; border-radius:4px; cursor:pointer; margin-top:4px;
    }
  `;
  document.head.appendChild(s);
}

// ─── board logic ─────────────────────────────────────────────────────────────

function buildBoard(): GemColor[][] {
  // Build an 8x8 board with no initial 3-in-a-row
  const board: GemColor[][] = Array.from({ length: GRID_ROWS }, () =>
    new Array<GemColor>(GRID_COLS).fill(0 as GemColor)
  );
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      let color: GemColor;
      let attempts = 0;
      do {
        color = rndColor();
        attempts++;
      } while (
        attempts < 20 &&
        (
          (c >= 2 && board[r]![c - 1] === color && board[r]![c - 2] === color) ||
          (r >= 2 && board[r - 1]![c] === color && board[r - 2]![c] === color)
        )
      );
      board[r]![c] = color;
    }
  }
  return board;
}

// returns set of "r*8+c" keys for matching gems
function findMatches(board: GemColor[][]): Set<number> {
  const matches = new Set<number>();
  // horizontal
  for (let r = 0; r < GRID_ROWS; r++) {
    let run = 1;
    for (let c = 1; c <= GRID_COLS; c++) {
      const prev = board[r]![c - 1]!;
      const cur = c < GRID_COLS ? board[r]![c]! : EMPTY_CELL;
      const same = cur === prev && cur !== EMPTY_CELL;
      if (same) {
        run++;
      } else {
        if (run >= 3) {
          for (let k = c - run; k < c; k++) matches.add(r * GRID_COLS + k);
        }
        run = 1;
      }
    }
  }
  // vertical
  for (let c = 0; c < GRID_COLS; c++) {
    let run = 1;
    for (let r = 1; r <= GRID_ROWS; r++) {
      const prev = board[r - 1]![c]!;
      const cur = r < GRID_ROWS ? board[r]![c]! : EMPTY_CELL;
      const same = cur === prev && cur !== EMPTY_CELL;
      if (same) {
        run++;
      } else {
        if (run >= 3) {
          for (let k = r - run; k < r; k++) matches.add(k * GRID_COLS + c);
        }
        run = 1;
      }
    }
  }
  return matches;
}

// Check if any valid swap exists (for endless stalemate detection)
function hasValidSwap(board: GemColor[][]): boolean {
  const dirs: [number, number][] = [[0, 1], [1, 0]];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= GRID_ROWS || nc >= GRID_COLS) continue;
        // try swap
        const tmp = board[r]![c]!;
        board[r]![c] = board[nr]![nc]!;
        board[nr]![nc] = tmp;
        const has = findMatches(board).size > 0;
        // unswap
        board[nr]![nc] = board[r]![c]!;
        board[r]![c] = tmp;
        if (has) return true;
      }
    }
  }
  return false;
}

// Find one valid swap for hint system — returns [r1,c1,r2,c2] or null
function findHintSwap(board: GemColor[][]): [number, number, number, number] | null {
  const dirs: [number, number][] = [[0, 1], [1, 0]];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= GRID_ROWS || nc >= GRID_COLS) continue;
        const tmp = board[r]![c]!;
        board[r]![c] = board[nr]![nc]!;
        board[nr]![nc] = tmp;
        const has = findMatches(board).size > 0;
        board[nr]![nc] = board[r]![c]!;
        board[r]![c] = tmp;
        if (has) return [r, c, nr, nc];
      }
    }
  }
  return null;
}

// Compute score for a set of matched positions and cascade index
function computeMatchScore(matched: Set<number>, cascadeIdx: number): number {
  if (matched.size === 0) return 0;
  const cascMult = CASCADE_MULT[Math.min(cascadeIdx, CASCADE_MULT.length - 1)] ?? 3;
  const lenMult = matchLenMult(matched.size);
  return Math.round(matched.size * BASE_SCORE_PER_GEM * lenMult * cascMult);
}

// ─── gameover overlay ─────────────────────────────────────────────────────────

function buildRankCard(rank: RankInfo): string {
  const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="rank-card-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta}</div>`
    : "";
  return `<div class="rank-card">
    <div class="rank-card-title">RANK ${rankLabel} GLOBAL</div>
    ${deltaHtml}
    <button class="rank-card-btn" data-scores-id="${GAME_ID}">VIEW LEADERBOARD</button>
  </div>`;
}

function showGameoverOverlay(
  container: HTMLElement,
  score: number,
  best: number,
  subtitle: string,
  onReplay: () => void
): { el: HTMLElement; addRank: (r: RankInfo) => void } {
  const isNew = score >= best && score > 0;
  const overlay = document.createElement("div");
  overlay.className = "gc-overlay";
  overlay.innerHTML = `
    <div class="gc-go-box">
      <h2 class="gc-go-title">GAME OVER</h2>
      ${isNew ? `<div class="gc-go-new">NEW BEST!</div>` : ""}
      <div class="gc-go-score">${score}</div>
      <div class="gc-go-sublabel">SCORE</div>
      <div class="gc-go-best">BEST ${best}</div>
      <div class="gc-go-best">${subtitle}</div>
      <div class="gc-go-actions">
        <button class="gc-go-btn primary" id="gc-replay">PLAY AGAIN</button>
        <button class="gc-go-btn" id="gc-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector("#gc-replay")?.addEventListener("pointerup", () => {
    overlay.remove();
    onReplay();
  });
  overlay.querySelector("#gc-menu")?.addEventListener("pointerup", () => {
    navigate("/");
  });

  function addRank(rank: RankInfo): void {
    const box = overlay.querySelector(".gc-go-box");
    if (!box || box.querySelector(".rank-card")) return;
    const actions = box.querySelector(".gc-go-actions");
    if (!actions) return;
    const div = document.createElement("div");
    div.innerHTML = buildRankCard(rank);
    const cardEl = div.firstElementChild as HTMLElement | null;
    if (!cardEl) return;
    cardEl.querySelector<HTMLElement>(".rank-card-btn")?.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      navigate(`/scores/${GAME_ID}`);
    });
    box.insertBefore(cardEl, actions);
  }

  return { el: overlay, addRank };
}

// ─── mount ────────────────────────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.classList.add("gem-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // ── DOM structure ──
  const wrap = document.createElement("div");
  wrap.className = "gc-wrap";
  container.appendChild(wrap);

  // HUD
  const hud = document.createElement("div");
  hud.className = "gc-hud";
  hud.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:2px;">
      <div class="gc-hud-score-label">SCORE</div>
      <div class="gc-hud-score" id="gc-score">0</div>
    </div>
    <button class="gc-hud-mode-btn" id="gc-mode-toggle">MODE</button>
    <div class="gc-hud-right">
      <div class="gc-hud-stat-label" id="gc-stat-label">TIME</div>
      <div class="gc-hud-stat" id="gc-stat">60</div>
    </div>
    <div class="gc-hud-btns">
      <button class="gc-hud-btn" id="gc-fs" aria-label="Fullscreen">⛶</button>
      <button class="gc-hud-btn" id="gc-pause" aria-label="Pause">⏸</button>
    </div>
  `;
  wrap.appendChild(hud);

  // Mode selector bar (hidden by default, toggled)
  const modeBar = document.createElement("div");
  modeBar.className = "gc-mode-bar";
  modeBar.style.display = "none";
  modeBar.innerHTML = `
    <button class="gc-mode-tab" data-mode="time">TIME</button>
    <button class="gc-mode-tab" data-mode="moves">MOVES</button>
    <button class="gc-mode-tab" data-mode="endless">ENDLESS</button>
  `;
  wrap.appendChild(modeBar);

  // Progress bar (Moves mode target)
  const progressBar = document.createElement("div");
  progressBar.className = "gc-progress-bar";
  progressBar.style.display = "none";
  progressBar.innerHTML = `<div class="gc-progress-fill" id="gc-progress-fill" style="width:0%"></div>`;
  wrap.appendChild(progressBar);

  // Timer bar (Time Attack)
  const timerBar = document.createElement("div");
  timerBar.className = "gc-progress-bar";
  timerBar.innerHTML = `<div class="gc-progress-fill" id="gc-timer-fill" style="width:100%;background:#ff44ff"></div>`;
  wrap.appendChild(timerBar);

  // Board area
  const boardWrap = document.createElement("div");
  boardWrap.className = "gc-board-wrap";
  wrap.appendChild(boardWrap);

  const boardEl = document.createElement("div");
  boardEl.className = "gc-board";
  boardWrap.appendChild(boardEl);

  // Combo label
  const comboEl = document.createElement("div");
  comboEl.className = "gc-combo";
  boardEl.appendChild(comboEl);

  // ── state ──
  let mode: GameMode = "time";
  let paused = false;
  let animating = false;

  // board data
  let board: GemColor[][] = buildBoard();
  // parallel DOM element grid
  let gems: (Gem | null)[][] = Array.from({ length: GRID_ROWS }, () =>
    new Array<Gem | null>(GRID_COLS).fill(null)
  );

  let tileSize = MAX_TILE;
  let selected: [number, number] | null = null;
  let score = 0;
  let best = 0;

  // Time Attack
  let timeLeft = TIME_ATTACK_SECS;
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  // Moves
  let movesLeft = MOVES_INIT;
  let currentLevel = 1;
  let targetScore = levelTarget(1);

  // Endless hint
  let hintTimeout: ReturnType<typeof setTimeout> | null = null;
  let hintCells: [number, number, number, number] | null = null;

  // onboarding
  let onboardingEl: HTMLElement | null = null;

  // gameover overlay ref
  let gameoverEl: { el: HTMLElement; addRank: (r: RankInfo) => void } | null = null;

  // ── load persisted state ──
  void personalBest(GAME_ID).then((b) => { best = b; });
  void db.settings.get(MODE_KEY).then((row) => {
    if (row?.value === "moves" || row?.value === "endless" || row?.value === "time") {
      mode = row.value as GameMode;
      updateModeUI();
    }
  });
  void db.settings.get(LEVEL_KEY).then((row) => {
    if (row) {
      const n = parseInt(row.value, 10);
      if (!isNaN(n) && n > 0) currentLevel = n;
    }
  });

  // ── tile size + resize ──
  function calcTileSize(): void {
    const w = boardWrap.clientWidth;
    const h = boardWrap.clientHeight;
    if (w < 8 || h < 8) return;
    tileSize = Math.floor(Math.min(w / GRID_COLS, h / GRID_ROWS, MAX_TILE));
    const gridPx = tileSize * GRID_COLS;
    const gridPxH = tileSize * GRID_ROWS;
    boardEl.style.width = `${gridPx}px`;
    boardEl.style.height = `${gridPxH}px`;
    repositionAllGems();
  }

  function posX(c: number): number { return c * tileSize; }
  function posY(r: number): number { return r * tileSize; }

  function repositionAllGems(): void {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const gem = gems[r]![c];
        if (!gem) continue;
        gem.el.style.width = `${tileSize}px`;
        gem.el.style.height = `${tileSize}px`;
        gem.el.style.left = `${posX(c)}px`;
        gem.el.style.top = `${posY(r)}px`;
        // update inner svg size
        const svgEl = gem.el.querySelector<SVGElement>("svg");
        if (svgEl) {
          svgEl.setAttribute("width", String(tileSize - 8));
          svgEl.setAttribute("height", String(tileSize - 8));
        }
      }
    }
  }

  const ro = new ResizeObserver(() => { calcTileSize(); });
  ro.observe(boardWrap);

  // ── board init ──
  function buildGemEl(color: GemColor, r: number, c: number): Gem {
    const el = createGemEl(color, tileSize);
    el.style.left = `${posX(c)}px`;
    el.style.top = `${posY(r)}px`;
    boardEl.appendChild(el);
    el.addEventListener("pointerdown", () => handleGemTap(r, c));
    return { color, el };
  }

  function initBoard(): void {
    // remove existing gem els
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const g = gems[r]![c];
        if (g) g.el.remove();
      }
    }
    gems = Array.from({ length: GRID_ROWS }, () =>
      new Array<Gem | null>(GRID_COLS).fill(null)
    );
    board = buildBoard();
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const color = board[r]![c]!;
        gems[r]![c] = buildGemEl(color, r, c);
      }
    }
    selected = null;
  }

  // ── HUD helpers ──
  function updateScoreEl(): void {
    const el = hud.querySelector<HTMLElement>("#gc-score");
    if (el) el.textContent = String(score);
  }

  function updateStatEl(): void {
    const el = hud.querySelector<HTMLElement>("#gc-stat");
    const label = hud.querySelector<HTMLElement>("#gc-stat-label");
    if (!el || !label) return;
    switch (mode) {
      case "time":
        label.textContent = "TIME";
        el.textContent = String(Math.ceil(timeLeft));
        break;
      case "moves":
        label.textContent = "MOVES";
        el.textContent = `${movesLeft}`;
        break;
      case "endless":
        label.textContent = "LEVEL";
        el.textContent = String(currentLevel);
        break;
    }
  }

  function updateProgressBar(): void {
    if (mode === "moves") {
      progressBar.style.display = "block";
      timerBar.style.display = "none";
      const pct = clamp((score / targetScore) * 100, 0, 100);
      const fill = progressBar.querySelector<HTMLElement>("#gc-progress-fill");
      if (fill) fill.style.width = `${pct}%`;
    } else if (mode === "time") {
      timerBar.style.display = "block";
      progressBar.style.display = "none";
      const pct = clamp((timeLeft / TIME_ATTACK_SECS) * 100, 0, 100);
      const fill = timerBar.querySelector<HTMLElement>("#gc-timer-fill");
      if (fill) fill.style.width = `${pct}%`;
    } else {
      timerBar.style.display = "none";
      progressBar.style.display = "none";
    }
  }

  function updateModeUI(): void {
    modeBar.querySelectorAll<HTMLElement>(".gc-mode-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset["mode"] === mode);
    });
    updateStatEl();
    updateProgressBar();
  }

  // ── selection & swap ──
  function clearSelection(): void {
    if (selected) {
      const [sr, sc] = selected;
      gems[sr]?.[sc]?.el.classList.remove("selected");
      selected = null;
    }
  }

  function setSelected(r: number, c: number): void {
    clearSelection();
    selected = [r, c];
    gems[r]?.[c]?.el.classList.add("selected");
  }

  function isAdjacent(r1: number, c1: number, r2: number, c2: number): boolean {
    return (Math.abs(r1 - r2) + Math.abs(c1 - c2)) === 1;
  }

  function handleGemTap(r: number, c: number): void {
    if (animating || paused || gameoverEl) return;

    if ("vibrate" in navigator) navigator.vibrate(3);
    playSfx("click");

    clearHint();

    if (!selected) {
      setSelected(r, c);
      playSfx("click");
      return;
    }

    const [sr, sc] = selected;

    // tap same gem — deselect
    if (sr === r && sc === c) {
      clearSelection();
      return;
    }

    // tap non-adjacent — reselect
    if (!isAdjacent(sr, sc, r, c)) {
      setSelected(r, c);
      return;
    }

    // attempt swap
    clearSelection();
    void doSwap(sr, sc, r, c);
  }

  async function doSwap(r1: number, c1: number, r2: number, c2: number): Promise<void> {
    if (animating) return;
    animating = true;

    const g1 = gems[r1]![c1]!;
    const g2 = gems[r2]![c2]!;

    // animate swap
    await animateSwap(g1, g2, r1, c1, r2, c2);

    // apply to board data
    const tmp = board[r1]![c1]!;
    board[r1]![c1] = board[r2]![c2]!;
    board[r2]![c2] = tmp;

    gems[r1]![c1] = g2;
    gems[r2]![c2] = g1;

    // check for matches
    const matches = findMatches(board);
    if (matches.size === 0) {
      // no match — reverse swap (g2 at r1,c1 goes back to r2,c2; g1 at r2,c2 goes back to r1,c1)
      await animateSwap(g2, g1, r2, c2, r1, c1);
      // restore board data (swap back)
      board[r2]![c2] = board[r1]![c1]!;
      board[r1]![c1] = tmp;
      gems[r1]![c1] = g1;
      gems[r2]![c2] = g2;
      if ("vibrate" in navigator) navigator.vibrate(5);
      playSfx("error");
      animating = false;
      resetHintTimer();
      return;
    }

    // valid swap
    if ("vibrate" in navigator) navigator.vibrate(8);
    playSfx("place");

    // consume move
    if (mode === "moves") {
      movesLeft--;
      updateStatEl();
    }

    // dismiss onboarding
    dismissOnboarding();

    // cascade loop
    let cascadeIdx = 0;
    let m = matches;
    while (m.size > 0) {
      const gained = computeMatchScore(m, cascadeIdx);
      score += gained;
      updateScoreEl();
      updateProgressBar();

      // vibration/sfx for match
      if (cascadeIdx >= 2) {
        if ("vibrate" in navigator) navigator.vibrate(20);
        playSfx("score");
        showCombo(cascadeIdx + 1);
      } else {
        if ("vibrate" in navigator) navigator.vibrate(10);
        playSfx("pop");
      }

      await animatePop(m);
      applyGravity(m);
      await animateDrop();
      spawnNewGems();
      await animateSpawn();

      cascadeIdx++;

      // small pause between cascades so player can follow
      await delay(60);

      m = findMatches(board);
    }

    animating = false;
    checkModeCondition();
    resetHintTimer();
  }

  // ── animation helpers ──
  function delay(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
  }

  function animateSwap(
    g1: Gem, g2: Gem,
    r1: number, c1: number,
    r2: number, c2: number
  ): Promise<void> {
    return new Promise((res) => {
      g1.el.style.transition = "left 0.2s ease, top 0.2s ease";
      g2.el.style.transition = "left 0.2s ease, top 0.2s ease";
      // g1 moves to (r2,c2), g2 moves to (r1,c1)
      g1.el.style.left = `${posX(c2)}px`;
      g1.el.style.top = `${posY(r2)}px`;
      g2.el.style.left = `${posX(c1)}px`;
      g2.el.style.top = `${posY(r1)}px`;
      setTimeout(res, 220);
    });
  }

  function animatePop(matched: Set<number>): Promise<void> {
    return new Promise((res) => {
      for (const key of matched) {
        const r = Math.floor(key / GRID_COLS);
        const c = key % GRID_COLS;
        const gem = gems[r]?.[c];
        if (gem) gem.el.classList.add("popping");
      }
      setTimeout(res, 200);
    });
  }

  // apply gravity: clear matched positions, shift down
  function applyGravity(matched: Set<number>): void {
    // remove matched gems from DOM and board
    for (const key of matched) {
      const r = Math.floor(key / GRID_COLS);
      const c = key % GRID_COLS;
      const gem = gems[r]?.[c];
      if (gem) {
        gem.el.remove();
        gems[r]![c] = null;
        board[r]![c] = EMPTY_CELL; // mark empty
      }
    }

    // gravity: for each column, compact down
    for (let c = 0; c < GRID_COLS; c++) {
      let writeRow = GRID_ROWS - 1;
      for (let r = GRID_ROWS - 1; r >= 0; r--) {
        if (gems[r]![c] !== null) {
          if (writeRow !== r) {
            // move gem down to writeRow
            gems[writeRow]![c] = gems[r]![c];
            board[writeRow]![c] = board[r]![c]!;
            gems[r]![c] = null;
            board[r]![c] = EMPTY_CELL;
          }
          writeRow--;
        }
      }
    }
  }

  function animateDrop(): Promise<void> {
    return new Promise((res) => {
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const gem = gems[r]![c];
          if (!gem) continue;
          const targetTop = posY(r);
          const currentTop = parseInt(gem.el.style.top, 10);
          if (currentTop !== targetTop) {
            const dist = Math.abs(targetTop - currentTop);
            const dur = Math.min(50 + dist * 0.8, 300);
            gem.el.style.transition = `top ${dur}ms cubic-bezier(0.4,0,1,1)`;
            gem.el.style.top = `${targetTop}px`;
          }
        }
      }
      setTimeout(res, 320);
    });
  }

  function spawnNewGems(): void {
    for (let c = 0; c < GRID_COLS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        if (gems[r]![c] === null) {
          const color = rndColor();
          board[r]![c] = color;
          const gem = buildGemEl(color, r, c);
          gems[r]![c] = gem;
          gem.el.classList.add("spawning");
        }
      }
    }
  }

  function animateSpawn(): Promise<void> {
    return new Promise((res) => {
      requestAnimationFrame(() => {
        for (let r = 0; r < GRID_ROWS; r++) {
          for (let c = 0; c < GRID_COLS; c++) {
            const gem = gems[r]![c];
            if (gem?.el.classList.contains("spawning")) {
              gem.el.classList.remove("spawning");
              gem.el.classList.add("spawned");
            }
          }
        }
        setTimeout(res, 200);
      });
    });
  }

  function showCombo(n: number): void {
    comboEl.textContent = `x${n} CASCADE!`;
    comboEl.classList.remove("show");
    void comboEl.offsetWidth; // reflow
    comboEl.classList.add("show");
    setTimeout(() => comboEl.classList.remove("show"), 700);
  }

  // ── mode logic ────────────────────────────────────────────────────────────

  function startGame(): void {
    score = 0;
    selected = null;
    animating = false;
    updateScoreEl();

    switch (mode) {
      case "time":
        timeLeft = TIME_ATTACK_SECS;
        stopTimer();
        startTimer();
        break;
      case "moves":
        movesLeft = MOVES_INIT + (currentLevel - 1) * MOVES_BONUS;
        targetScore = levelTarget(currentLevel);
        break;
      case "endless":
        clearHint();
        break;
    }

    updateStatEl();
    updateProgressBar();
    initBoard();
    resetHintTimer();
  }

  function startTimer(): void {
    stopTimer();
    timerInterval = setInterval(() => {
      if (paused || animating) return;
      timeLeft -= 0.25;
      updateStatEl();
      updateProgressBar();
      if (timeLeft <= 5) playSfx("tap");
      if (timeLeft <= 0) {
        timeLeft = 0;
        stopTimer();
        doGameover("TIME'S UP");
      }
    }, 250);
  }

  function stopTimer(): void {
    if (timerInterval !== null) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function checkModeCondition(): void {
    if (mode === "moves") {
      if (score >= targetScore) {
        // level up
        currentLevel++;
        void db.settings.put({ key: LEVEL_KEY, value: String(currentLevel) });
        void submit(GAME_ID, score).then(() => {
          void personalBest(GAME_ID).then((b) => { best = Math.max(best, b); });
        });
        movesLeft += MOVES_BONUS;
        targetScore = levelTarget(currentLevel);
        score = 0;
        updateScoreEl();
        updateStatEl();
        updateProgressBar();
        initBoard();
        return;
      }
      if (movesLeft <= 0) {
        doGameover(`LEVEL ${currentLevel}`);
        return;
      }
    }
    if (mode === "endless") {
      if (!hasValidSwap(board)) {
        doGameover("NO MOVES LEFT");
      }
    }
  }

  function doGameover(subtitle: string): void {
    stopTimer();
    clearHint();
    if ("vibrate" in navigator) navigator.vibrate([50, 50, 100]);
    playSfx("gameover");
    void submit(GAME_ID, score).then(() => {
      void personalBest(GAME_ID).then((b) => { best = Math.max(best, b); });
    });
    setTimeout(() => {
      gameoverEl = showGameoverOverlay(container, score, best, subtitle, () => {
        gameoverEl = null;
        startGame();
      });
      void computeRank(GAME_ID, score).then((rank) => {
        if (rank && gameoverEl) gameoverEl.addRank(rank);
      });
    }, 400);
  }

  // ── hint system (endless mode) ──
  function resetHintTimer(): void {
    clearHint();
    if (mode !== "endless") return;
    hintTimeout = setTimeout(() => {
      hintCells = findHintSwap(board);
      if (hintCells) {
        const [r1, c1, r2, c2] = hintCells;
        gems[r1]?.[c1]?.el.classList.add("hint-glow");
        gems[r2]?.[c2]?.el.classList.add("hint-glow");
      }
    }, HINT_IDLE_MS);
  }

  function clearHint(): void {
    if (hintTimeout !== null) {
      clearTimeout(hintTimeout);
      hintTimeout = null;
    }
    if (hintCells) {
      const [r1, c1, r2, c2] = hintCells;
      gems[r1]?.[c1]?.el.classList.remove("hint-glow");
      gems[r2]?.[c2]?.el.classList.remove("hint-glow");
      hintCells = null;
    }
  }

  // ── onboarding hint ──
  void db.settings.get(HINT_KEY).then((row) => {
    if (row) return;
    const el = document.createElement("div");
    el.className = "gc-hint-overlay";
    el.innerHTML = `
      <p class="gc-hint-line">TAP + TAP TO SWAP</p>
      <p class="gc-hint-line" style="font-size:7px;color:rgba(255,255,255,0.7)">Match 3 same color to pop</p>
    `;
    boardWrap.appendChild(el);
    onboardingEl = el;
    setTimeout(dismissOnboarding, 5000);
  });

  function dismissOnboarding(): void {
    if (!onboardingEl) return;
    onboardingEl.remove();
    onboardingEl = null;
    void db.settings.put({ key: HINT_KEY, value: "1" });
  }

  // ── pause ──
  function togglePause(): void {
    paused = !paused;
    const btn = hud.querySelector<HTMLElement>("#gc-pause");
    if (btn) btn.textContent = paused ? "▶" : "⏸";
    if (!paused && mode === "time") {
      startTimer();
    } else if (paused) {
      stopTimer();
    }
  }

  // ── mode selector ──
  function openModeBar(): void {
    modeBar.style.display = modeBar.style.display === "none" ? "flex" : "none";
  }

  function setMode(m: GameMode): void {
    mode = m;
    modeBar.style.display = "none";
    void db.settings.put({ key: MODE_KEY, value: mode });
    stopTimer();
    gameoverEl?.el.remove();
    gameoverEl = null;
    updateModeUI();
    startGame();
  }

  hud.querySelector("#gc-mode-toggle")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    openModeBar();
  });

  modeBar.querySelectorAll<HTMLElement>(".gc-mode-tab").forEach((btn) => {
    btn.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      const m = btn.dataset["mode"] as GameMode | undefined;
      if (m) setMode(m);
    });
  });

  hud.querySelector("#gc-pause")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    togglePause();
  });

  hud.querySelector("#gc-fs")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const host = container.closest<HTMLElement>(".game-host");
    if (host?.requestFullscreen) void host.requestFullscreen();
  });

  // ── keyboard ──
  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      togglePause();
    }
  }
  window.addEventListener("keydown", handleKeyDown);

  // ── init ──
  updateModeUI();
  // defer start until layout is settled
  requestAnimationFrame(() => {
    calcTileSize();
    startGame();
  });

  // ── cleanup ──
  return () => {
    stopTimer();
    clearHint();
    ro.disconnect();
    window.removeEventListener("keydown", handleKeyDown);
    container.style.touchAction = prevTouchAction;
    container.classList.remove("gem-root");
  };
}
