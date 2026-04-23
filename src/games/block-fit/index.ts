import { submit } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { playSfx } from "../../lib/audio.js";
import { db } from "../../lib/storage.js";
import { personalBest } from "../../lib/leaderboard.js";

// ---------- constants ----------

const GRID = 8;
const HINT_KEY = "block-fit:seenHint";
const STATE_KEY = "block-fit:state";

const RAINBOW: readonly string[] = [
  "#ff3344", // red
  "#ff8822", // orange
  "#ffee00", // yellow
  "#44ff66", // green
  "#22ddff", // cyan
  "#2266ff", // blue
  "#aa44ff", // purple
  "#ff44aa", // pink
];

// ---------- types ----------

type Cell = string | null; // null = empty, string = color

interface Shape {
  cells: [number, number][]; // relative [row, col] offsets
  color: string;
}

interface DragState {
  shapeIdx: number;
  shape: Shape;
  ghostRow: number;
  ghostCol: number;
  valid: boolean;
  pointerX: number;
  pointerY: number;
}

interface SavedState {
  grid: (string | null)[][];
  tray: (Shape | null)[];
  score: number;
  streak: number;
  lastDropHadClear: boolean;
}

// ---------- shape pool ----------

type ShapeTemplate = [number, number][];

interface ShapeDef {
  cells: ShapeTemplate;
  weight: number; // total weight bucket
  tier: "basic" | "medium" | "hard";
}

const SHAPE_DEFS: ShapeDef[] = [
  // basic (70%)
  { cells: [[0,0]], weight: 8, tier: "basic" },
  { cells: [[0,0],[0,1]], weight: 7, tier: "basic" },
  { cells: [[0,0],[0,1],[0,2]], weight: 7, tier: "basic" },
  { cells: [[0,0],[0,1],[0,2],[0,3]], weight: 6, tier: "basic" },
  { cells: [[0,0],[0,1],[0,2],[0,3],[0,4]], weight: 4, tier: "basic" },
  { cells: [[0,0],[1,0]], weight: 7, tier: "basic" },
  { cells: [[0,0],[1,0],[2,0]], weight: 7, tier: "basic" },
  { cells: [[0,0],[1,0],[2,0],[3,0]], weight: 6, tier: "basic" },
  { cells: [[0,0],[1,0],[2,0],[3,0],[4,0]], weight: 4, tier: "basic" },
  { cells: [[0,0],[0,1],[1,0],[1,1]], weight: 7, tier: "basic" },
  // medium (25%)
  { cells: [[0,0],[1,0],[2,0],[2,1]], weight: 4, tier: "medium" }, // L
  { cells: [[0,1],[1,1],[2,1],[2,0]], weight: 4, tier: "medium" }, // J
  { cells: [[0,0],[1,0],[2,0],[0,1]], weight: 4, tier: "medium" }, // reverse-L
  { cells: [[0,0],[0,1],[1,1],[2,1]], weight: 4, tier: "medium" }, // reverse-J
  { cells: [[0,1],[1,0],[1,1],[1,2]], weight: 4, tier: "medium" }, // T
  { cells: [[0,0],[1,0],[1,1],[2,1]], weight: 3, tier: "medium" }, // S
  { cells: [[0,1],[1,0],[1,1],[2,0]], weight: 3, tier: "medium" }, // Z
  // hard (5%)
  { cells: [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]], weight: 1, tier: "hard" }, // 3x3
  { cells: [[0,1],[1,0],[1,1],[1,2],[2,1]], weight: 1, tier: "hard" }, // plus
  { cells: [[0,0],[1,0],[1,1],[2,1]], weight: 1, tier: "hard" }, // stairs S variant
  { cells: [[0,1],[1,1],[1,0],[2,0]], weight: 1, tier: "hard" }, // stairs Z variant
];

const TOTAL_WEIGHT = SHAPE_DEFS.reduce((s, d) => s + d.weight, 0);

function randomShape(): Shape {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const def of SHAPE_DEFS) {
    r -= def.weight;
    if (r <= 0) {
      const color = RAINBOW[Math.floor(Math.random() * RAINBOW.length)]!;
      return { cells: def.cells.map(([rr, cc]) => [rr, cc] as [number, number]), color };
    }
  }
  const color = RAINBOW[Math.floor(Math.random() * RAINBOW.length)]!;
  return { cells: SHAPE_DEFS[0]!.cells.map(([rr, cc]) => [rr, cc] as [number, number]), color };
}

function basicShape(): Shape {
  const basics = SHAPE_DEFS.filter((d) => d.cells.length <= 4);
  const def = basics[Math.floor(Math.random() * basics.length)]!;
  const color = RAINBOW[Math.floor(Math.random() * RAINBOW.length)]!;
  return { cells: def.cells.map(([rr, cc]) => [rr, cc] as [number, number]), color };
}

function generateTray(): [Shape, Shape, Shape] {
  const s0 = randomShape();
  const s1 = randomShape();
  const s2 = randomShape();
  // ensure at least one easy shape (cell count <= 4)
  if (s0.cells.length > 4 && s1.cells.length > 4 && s2.cells.length > 4) {
    return [basicShape(), s1, s2];
  }
  return [s0, s1, s2];
}

// ---------- shape bounds ----------

function shapeBounds(cells: [number, number][]): { rows: number; cols: number } {
  let maxR = 0; let maxC = 0;
  for (const [r, c] of cells) {
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  return { rows: maxR + 1, cols: maxC + 1 };
}

// ---------- placement logic ----------

function canPlace(grid: Cell[][], shape: Shape, row: number, col: number): boolean {
  for (const [dr, dc] of shape.cells) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || r >= GRID || c < 0 || c >= GRID) return false;
    if (grid[r]![c] !== null) return false;
  }
  return true;
}

function placeShape(grid: Cell[][], shape: Shape, row: number, col: number): Cell[][] {
  const next = grid.map((r) => [...r]) as Cell[][];
  for (const [dr, dc] of shape.cells) {
    next[row + dr]![col + dc] = shape.color;
  }
  return next;
}

function findClears(grid: Cell[][]): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = 0; r < GRID; r++) {
    if (grid[r]!.every((c) => c !== null)) rows.push(r);
  }
  for (let c = 0; c < GRID; c++) {
    if (grid.every((row) => row[c] !== null)) cols.push(c);
  }
  return { rows, cols };
}

function applyClear(grid: Cell[][], rows: number[], cols: number[]): Cell[][] {
  const next = grid.map((r) => [...r]) as Cell[][];
  for (const r of rows) {
    for (let c = 0; c < GRID; c++) next[r]![c] = null;
  }
  for (const c of cols) {
    for (let r = 0; r < GRID; r++) next[r]![c] = null;
  }
  return next;
}

function hasAnyPlacement(grid: Cell[][], tray: (Shape | null)[]): boolean {
  for (const shape of tray) {
    if (!shape) continue;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (canPlace(grid, shape, r, c)) return true;
      }
    }
  }
  return false;
}

// ---------- scoring ----------

function calcClearScore(clearCount: number, streak: number): number {
  if (clearCount === 0) return 0;
  const perLine = clearCount === 1 ? 100
    : clearCount === 2 ? 240
    : clearCount === 3 ? 360
    : 500;
  const base = perLine * clearCount;
  const mult = streak >= 3 ? 1.5 : 1.0;
  return Math.round(base * mult);
}

// ---------- persistence ----------

async function loadSavedState(): Promise<SavedState | null> {
  try {
    const row = await db.settings.get(STATE_KEY);
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.value);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as SavedState;
  } catch { return null; }
}

async function saveState(state: SavedState): Promise<void> {
  try { await db.settings.put({ key: STATE_KEY, value: JSON.stringify(state) }); } catch { /* non-critical */ }
}

async function clearSavedState(): Promise<void> {
  try { await db.settings.delete(STATE_KEY); } catch { /* non-critical */ }
}

async function hasSeenHint(): Promise<boolean> {
  try {
    const row = await db.settings.get(HINT_KEY);
    return row?.value === "1";
  } catch { return false; }
}

async function markHintSeen(): Promise<void> {
  try { await db.settings.put({ key: HINT_KEY, value: "1" }); } catch { /* non-critical */ }
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "bfit-styles";
  if (document.getElementById(id)) return;
  const s = document.createElement("style");
  s.id = id;
  s.textContent = `
    .blockfit-root {
      display: flex;
      flex: 1;
      min-height: 0;
      flex-direction: column;
      background: #0b0a24;
      user-select: none;
      -webkit-user-select: none;
      position: relative;
      overflow: hidden;
    }
    .bfit-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      min-height: 50px;
      flex-shrink: 0;
      font-family: monospace;
      color: #fff;
    }
    .bfit-hud-left { display: flex; flex-direction: column; }
    .bfit-score-label { font-size: 10px; color: #22ddff; letter-spacing: 2px; }
    .bfit-score-val { font-size: 22px; font-weight: bold; color: #fff; line-height: 1.1; }
    .bfit-streak { font-size: 10px; color: #ffee00; letter-spacing: 1px; margin-top: 1px; min-height: 12px; }
    .bfit-hud-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .bfit-best-label { font-size: 10px; color: #22ddff; letter-spacing: 2px; }
    .bfit-best-val { font-size: 14px; color: #aaaacc; }
    .bfit-hud-btns { display: flex; gap: 6px; margin-top: 4px; }
    .bfit-hud-btns button {
      background: transparent;
      border: 1px solid rgba(34,221,255,0.3);
      border-radius: 6px;
      color: #22ddff;
      font-size: 16px;
      min-width: 44px;
      min-height: 44px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .bfit-hud-btns button:active { background: rgba(34,221,255,0.15); }
    .bfit-arena {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      box-sizing: border-box;
      position: relative;
    }
    .bfit-grid {
      display: grid;
      grid-template-columns: repeat(8, var(--cs));
      grid-template-rows: repeat(8, var(--cs));
      gap: 2px;
      flex-shrink: 0;
    }
    .bfit-cell {
      width: var(--cs);
      height: var(--cs);
      border-radius: 4px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06);
      box-sizing: border-box;
      transition: background 80ms;
      position: relative;
    }
    .bfit-cell.filled {
      border-color: rgba(0,0,0,0.3);
    }
    .bfit-cell.ghost-valid {
      background: rgba(34,221,255,0.35) !important;
      border-color: #22ddff !important;
    }
    .bfit-cell.ghost-invalid {
      background: rgba(255,60,60,0.35) !important;
      border-color: #ff3c3c !important;
    }
    .bfit-cell.clearing {
      animation: bfit-clear 320ms ease forwards;
    }
    @keyframes bfit-clear {
      0%   { transform: scale(1); opacity: 1; filter: brightness(2); }
      50%  { transform: scale(1.1); opacity: 0.9; }
      100% { transform: scale(0.5); opacity: 0; }
    }
    .bfit-tray {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-around;
      padding: 6px 8px;
      min-height: 90px;
      flex-shrink: 0;
      box-sizing: border-box;
    }
    .bfit-tray-slot {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30%;
      min-height: 80px;
      border-radius: 8px;
      border: 1px solid rgba(34,221,255,0.15);
      background: rgba(255,255,255,0.03);
      position: relative;
      cursor: grab;
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
    }
    .bfit-tray-slot.used {
      opacity: 0.3;
      cursor: default;
      pointer-events: none;
    }
    .bfit-tray-slot.dragging-source {
      opacity: 0.4;
    }
    .bfit-mini-grid {
      display: grid;
      gap: 2px;
    }
    .bfit-mini-cell {
      border-radius: 3px;
    }
    .bfit-drag-ghost {
      position: fixed;
      pointer-events: none;
      z-index: 9999;
      display: grid;
      gap: 2px;
      opacity: 0.8;
      transform: translate(-50%, -50%);
    }
    .bfit-drag-ghost .bfit-mini-cell {
      border-radius: 4px;
    }
    .bfit-milestone {
      position: absolute;
      top: 30%;
      left: 50%;
      transform: translateX(-50%);
      font-family: monospace;
      font-size: 20px;
      font-weight: bold;
      color: #ffee00;
      text-shadow: 0 0 16px #ffee00;
      pointer-events: none;
      z-index: 20;
      animation: bfit-milestone 900ms ease-out forwards;
    }
    @keyframes bfit-milestone {
      0%   { opacity: 1; transform: translateX(-50%) scale(1); }
      60%  { opacity: 1; transform: translateX(-50%) scale(1.2); }
      100% { opacity: 0; transform: translateX(-50%) translateY(-30px) scale(0.8); }
    }
    .bfit-confetti-dot {
      position: absolute;
      width: 6px;
      height: 6px;
      border-radius: 2px;
      pointer-events: none;
      z-index: 19;
      animation: bfit-confetti 900ms ease-out forwards;
    }
    @keyframes bfit-confetti {
      0%   { opacity: 1; transform: translate(0,0) rotate(0deg); }
      100% { opacity: 0; transform: translate(var(--dx),var(--dy)) rotate(var(--dr)); }
    }
    .bfit-onboard {
      position: absolute;
      top: 55px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.85);
      border: 1px solid rgba(34,221,255,0.4);
      border-radius: 12px;
      padding: 14px 20px;
      text-align: center;
      pointer-events: none;
      z-index: 5;
      color: #fff;
      font-family: monospace;
      font-size: 13px;
      white-space: nowrap;
    }
    .bfit-onboard .sub { font-size: 10px; color: #22ddff; margin-top: 4px; }
    .bfit-gameover {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.88);
      z-index: 30;
    }
    .bfit-gameover-box {
      text-align: center;
      padding: 32px 28px;
      background: #0b0a24;
      border: 1px solid #22ddff;
      border-radius: 14px;
      min-width: 240px;
    }
    .bfit-gameover-title {
      font-family: monospace;
      font-size: 18px;
      color: #22ddff;
      letter-spacing: 3px;
      text-shadow: 0 0 14px #22ddff;
      margin: 0 0 10px;
    }
    .bfit-gameover-score {
      font-family: monospace;
      font-size: 28px;
      font-weight: bold;
      color: #fff;
      margin: 0 0 4px;
    }
    .bfit-gameover-best {
      font-family: monospace;
      font-size: 11px;
      color: #22ddff;
      margin-bottom: 22px;
    }
    .bfit-gameover-actions { display: flex; gap: 12px; justify-content: center; }
    .bfit-gameover-actions button {
      min-width: 110px;
      min-height: 44px;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 1px;
      border-radius: 8px;
      cursor: pointer;
    }
    .bfit-btn-play { background: #22ddff; color: #0b0a24; border: none; font-weight: bold; }
    .bfit-btn-menu { background: transparent; color: #22ddff; border: 1px solid #22ddff; }
  `;
  document.head.appendChild(s);
}

// ---------- mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("blockfit-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // ---- state ----
  let grid: Cell[][] = Array.from({ length: GRID }, () => Array(GRID).fill(null) as Cell[]);
  let tray: (Shape | null)[] = [null, null, null];
  let score = 0;
  let best = 0;
  let streak = 0;
  let lastDropHadClear = false;
  let cellSize = 40;
  let gameOver = false;

  let drag: DragState | null = null;
  let dragGhostEl: HTMLElement | null = null;

  // ---- DOM layout ----
  const hud = document.createElement("div");
  hud.className = "bfit-hud";
  hud.innerHTML = `
    <div class="bfit-hud-left">
      <span class="bfit-score-label">SCORE</span>
      <span class="bfit-score-val" id="bfit-score">0</span>
      <span class="bfit-streak" id="bfit-streak"></span>
    </div>
    <div class="bfit-hud-right">
      <span class="bfit-best-label">BEST</span>
      <span class="bfit-best-val" id="bfit-best">0</span>
      <div class="bfit-hud-btns">
        <button id="bfit-fs" aria-label="Fullscreen">⛶</button>
      </div>
    </div>
  `;
  container.appendChild(hud);

  const arena = document.createElement("div");
  arena.className = "bfit-arena";
  container.appendChild(arena);

  const gridEl = document.createElement("div");
  gridEl.className = "bfit-grid";
  arena.appendChild(gridEl);

  const trayEl = document.createElement("div");
  trayEl.className = "bfit-tray";
  container.appendChild(trayEl);

  // ---- grid cells ----
  const cellEls: HTMLElement[][] = [];
  for (let r = 0; r < GRID; r++) {
    cellEls.push([]);
    for (let c = 0; c < GRID; c++) {
      const el = document.createElement("div");
      el.className = "bfit-cell";
      gridEl.appendChild(el);
      cellEls[r]!.push(el);
    }
  }

  // ---- tray slots ----
  const slotEls: HTMLElement[] = [];
  for (let i = 0; i < 3; i++) {
    const slot = document.createElement("div");
    slot.className = "bfit-tray-slot";
    trayEl.appendChild(slot);
    slotEls.push(slot);
  }

  // ---- refs ----
  const scoreEl = hud.querySelector("#bfit-score") as HTMLElement;
  const bestEl = hud.querySelector("#bfit-best") as HTMLElement;
  const streakEl = hud.querySelector("#bfit-streak") as HTMLElement;
  const fsBtn = hud.querySelector("#bfit-fs") as HTMLButtonElement;

  // ---- resize ----
  function recalcCellSize(): void {
    const aW = arena.clientWidth - 8;
    const aH = arena.clientHeight - 8;
    const byW = Math.floor(aW / (GRID + 0.5));
    const byH = Math.floor(aH / (GRID + 0.5));
    cellSize = Math.max(20, Math.min(48, byW, byH));
    gridEl.style.setProperty("--cs", `${cellSize}px`);
  }

  const ro = new ResizeObserver(() => {
    recalcCellSize();
    renderTray();
  });
  ro.observe(container);

  // ---- HUD render ----
  function renderHUD(): void {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    streakEl.textContent = streak > 1 ? `STREAK x${streak}` : "";
  }

  // ---- grid render ----
  function renderGrid(clearRows: number[] = [], clearCols: number[] = []): void {
    const clearSet = new Set<string>();
    for (const r of clearRows) for (let c = 0; c < GRID; c++) clearSet.add(`${r},${c}`);
    for (const c of clearCols) for (let r = 0; r < GRID; r++) clearSet.add(`${r},${c}`);

    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const el = cellEls[r]![c]!;
        const color = grid[r]![c];
        el.classList.remove("filled", "ghost-valid", "ghost-invalid", "clearing");
        el.style.background = "";
        if (clearSet.has(`${r},${c}`)) {
          el.style.background = color ?? "";
          el.classList.add("filled", "clearing");
        } else if (color) {
          el.style.background = color;
          el.classList.add("filled");
        }
      }
    }
  }

  function renderGhost(): void {
    // clear all ghost classes first
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        cellEls[r]![c]!.classList.remove("ghost-valid", "ghost-invalid");
      }
    }
    if (!drag) return;
    const { shape, ghostRow, ghostCol, valid } = drag;
    const cls = valid ? "ghost-valid" : "ghost-invalid";
    for (const [dr, dc] of shape.cells) {
      const r = ghostRow + dr;
      const c = ghostCol + dc;
      if (r >= 0 && r < GRID && c >= 0 && c < GRID) {
        const el = cellEls[r]![c]!;
        if (!el.classList.contains("filled")) {
          el.classList.add(cls);
        }
      }
    }
  }

  // ---- tray render ----
  function renderTray(): void {
    for (let i = 0; i < 3; i++) {
      const slot = slotEls[i]!;
      slot.innerHTML = "";
      const shape = tray[i];
      if (!shape) {
        slot.classList.add("used");
        continue;
      }
      slot.classList.remove("used");
      if (drag && drag.shapeIdx === i) {
        slot.classList.add("dragging-source");
      } else {
        slot.classList.remove("dragging-source");
      }
      slot.appendChild(buildMiniShape(shape, Math.round(cellSize * 0.55)));
    }
  }

  function buildMiniShape(shape: Shape, cs: number): HTMLElement {
    const bounds = shapeBounds(shape.cells);
    const miniGrid = document.createElement("div");
    miniGrid.className = "bfit-mini-grid";
    miniGrid.style.gridTemplateColumns = `repeat(${bounds.cols}, ${cs}px)`;
    miniGrid.style.gridTemplateRows = `repeat(${bounds.rows}, ${cs}px)`;
    const occupied = new Set(shape.cells.map(([r, c]) => `${r},${c}`));
    for (let r = 0; r < bounds.rows; r++) {
      for (let c = 0; c < bounds.cols; c++) {
        const cell = document.createElement("div");
        cell.className = "bfit-mini-cell";
        cell.style.width = `${cs}px`;
        cell.style.height = `${cs}px`;
        if (occupied.has(`${r},${c}`)) {
          cell.style.background = shape.color;
        } else {
          cell.style.background = "transparent";
        }
        miniGrid.appendChild(cell);
      }
    }
    return miniGrid;
  }

  // ---- drag ghost element ----
  function createDragGhostEl(shape: Shape): HTMLElement {
    const ghost = document.createElement("div");
    ghost.className = "bfit-drag-ghost";
    const bounds = shapeBounds(shape.cells);
    ghost.style.gridTemplateColumns = `repeat(${bounds.cols}, ${cellSize}px)`;
    ghost.style.gridTemplateRows = `repeat(${bounds.rows}, ${cellSize}px)`;
    const occupied = new Set(shape.cells.map(([r, c]) => `${r},${c}`));
    for (let r = 0; r < bounds.rows; r++) {
      for (let c = 0; c < bounds.cols; c++) {
        const cell = document.createElement("div");
        cell.className = "bfit-mini-cell";
        cell.style.width = `${cellSize}px`;
        cell.style.height = `${cellSize}px`;
        if (occupied.has(`${r},${c}`)) {
          cell.style.background = shape.color;
        } else {
          cell.style.background = "transparent";
        }
        ghost.appendChild(cell);
      }
    }
    document.body.appendChild(ghost);
    return ghost;
  }

  function moveDragGhost(x: number, y: number): void {
    if (!dragGhostEl) return;
    dragGhostEl.style.left = `${x}px`;
    dragGhostEl.style.top = `${y}px`;
  }

  function removeDragGhost(): void {
    dragGhostEl?.remove();
    dragGhostEl = null;
  }

  // ---- grid coordinate from pointer ----
  function gridCoordsFromPointer(px: number, py: number, shape: Shape): { row: number; col: number } {
    const rect = gridEl.getBoundingClientRect();
    const step = cellSize + 2; // gap=2
    const bounds = shapeBounds(shape.cells);
    // center shape on pointer
    const col = Math.round((px - rect.left - (bounds.cols * step) / 2) / step);
    const row = Math.round((py - rect.top - (bounds.rows * step) / 2) / step);
    return { row, col };
  }

  // ---- pointer handlers on tray slots ----
  function onSlotPointerDown(i: number, e: PointerEvent): void {
    if (gameOver) return;
    const shape = tray[i];
    if (!shape) return;
    e.preventDefault();
    e.stopPropagation();
    playSfx("click");
    if ("vibrate" in navigator) navigator.vibrate?.(4);
    const { row, col } = gridCoordsFromPointer(e.clientX, e.clientY, shape);
    const valid = canPlace(grid, shape, row, col);
    drag = { shapeIdx: i, shape, ghostRow: row, ghostCol: col, valid, pointerX: e.clientX, pointerY: e.clientY };
    dragGhostEl = createDragGhostEl(shape);
    moveDragGhost(e.clientX, e.clientY);
    renderTray();
    renderGhost();
    void dismissHint();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    e.preventDefault();
    moveDragGhost(e.clientX, e.clientY);
    const { row, col } = gridCoordsFromPointer(e.clientX, e.clientY, drag.shape);
    const valid = canPlace(grid, drag.shape, row, col);
    if (drag.ghostRow !== row || drag.ghostCol !== col || drag.valid !== valid) {
      drag = { ...drag, ghostRow: row, ghostCol: col, valid };
      renderGhost();
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!drag) return;
    e.preventDefault();
    const { shapeIdx, shape, ghostRow, ghostCol, valid } = drag;
    drag = null;
    removeDragGhost();

    // check if pointer is over the grid area
    const gridRect = gridEl.getBoundingClientRect();
    const overGrid = e.clientX >= gridRect.left && e.clientX <= gridRect.right
      && e.clientY >= gridRect.top && e.clientY <= gridRect.bottom;

    if (!overGrid || !valid) {
      renderTray();
      renderGhost();
      return;
    }

    // place the shape
    playSfx("place");
    if ("vibrate" in navigator) navigator.vibrate?.(8);

    let newGrid = placeShape(grid, shape, ghostRow, ghostCol);
    const pts = shape.cells.length * 10;
    score += pts;

    // detect clears
    const { rows: clearRows, cols: clearCols } = findClears(newGrid);
    const clearCount = clearRows.length + clearCols.length;

    if (clearCount > 0) {
      renderGrid(clearRows, clearCols);
      playSfx("pop");
      if ("vibrate" in navigator) navigator.vibrate?.(12);
      if (clearCount > 1) {
        playSfx("score");
        if ("vibrate" in navigator) navigator.vibrate?.(25);
      }
      const hadClearBefore = lastDropHadClear;
      if (hadClearBefore) {
        streak++;
      } else {
        streak = 1;
      }
      lastDropHadClear = true;
      const clearPts = calcClearScore(clearCount, streak);
      score += clearPts;
      // apply clear after animation
      setTimeout(() => {
        newGrid = applyClear(newGrid, clearRows, clearCols);
        grid = newGrid;
        renderGrid();
        checkMilestone(score - clearPts, score);
      }, 330);
    } else {
      if (lastDropHadClear) streak = 0;
      lastDropHadClear = false;
      grid = newGrid;
      renderGrid();
    }

    tray[shapeIdx] = null;
    if (score > best) best = score;
    renderHUD();
    renderTray();
    renderGhost();

    // if all 3 used → refill
    const allUsed = tray.every((s) => s === null);
    if (allUsed) {
      const [s0, s1, s2] = generateTray();
      tray = [s0, s1, s2];
      renderTray();
    }

    void persist();

    // check gameover (after clears animate)
    if (clearCount > 0) {
      setTimeout(() => checkGameOver(), 350);
    } else {
      checkGameOver();
    }
  }

  function checkGameOver(): void {
    if (!hasAnyPlacement(grid, tray)) {
      triggerGameOver();
    }
  }

  function checkMilestone(prevScore: number, newScore: number): void {
    const prev500 = Math.floor(prevScore / 500);
    const new500 = Math.floor(newScore / 500);
    if (new500 > prev500) {
      showMilestone(`+${new500 * 500}!`);
      playSfx("levelup");
      spawnConfetti();
    }
  }

  function showMilestone(text: string): void {
    const el = document.createElement("div");
    el.className = "bfit-milestone";
    el.textContent = text;
    arena.appendChild(el);
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }

  function spawnConfetti(): void {
    const cx = arena.clientWidth / 2;
    const cy = arena.clientHeight / 2;
    for (let i = 0; i < 18; i++) {
      const dot = document.createElement("div");
      dot.className = "bfit-confetti-dot";
      const angle = (i / 18) * Math.PI * 2;
      const dist = 40 + Math.random() * 60;
      dot.style.left = `${cx}px`;
      dot.style.top = `${cy}px`;
      dot.style.background = RAINBOW[i % RAINBOW.length]!;
      dot.style.setProperty("--dx", `${(Math.cos(angle) * dist).toFixed(1)}px`);
      dot.style.setProperty("--dy", `${(Math.sin(angle) * dist).toFixed(1)}px`);
      dot.style.setProperty("--dr", `${Math.round(Math.random() * 360)}deg`);
      arena.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove(), { once: true });
    }
  }

  function triggerGameOver(): void {
    gameOver = true;
    playSfx("gameover");
    if ("vibrate" in navigator) navigator.vibrate?.([50, 50, 100]);
    void submit("block-fit", score);
    void clearSavedState();

    const overlay = document.createElement("div");
    overlay.className = "bfit-gameover";
    overlay.innerHTML = `
      <div class="bfit-gameover-box">
        <h2 class="bfit-gameover-title">GAME OVER</h2>
        <div class="bfit-gameover-score">${score}</div>
        <div class="bfit-gameover-best">${score >= best ? "NEW BEST!" : `BEST: ${best}`}</div>
        <div class="bfit-gameover-actions">
          <button class="bfit-btn-play" id="bfit-play-again">PLAY AGAIN</button>
          <button class="bfit-btn-menu" id="bfit-menu">MENU</button>
        </div>
      </div>
    `;
    container.appendChild(overlay);

    overlay.querySelector("#bfit-play-again")?.addEventListener("pointerup", () => {
      overlay.remove();
      resetGame();
    });
    overlay.querySelector("#bfit-menu")?.addEventListener("pointerup", () => {
      navigate("/");
    });
  }

  function resetGame(): void {
    gameOver = false;
    grid = Array.from({ length: GRID }, () => Array(GRID).fill(null) as Cell[]);
    score = 0;
    streak = 0;
    lastDropHadClear = false;
    const [s0, s1, s2] = generateTray();
    tray = [s0, s1, s2];
    renderGrid();
    renderTray();
    renderHUD();
    void persist();
  }

  async function persist(): Promise<void> {
    const state: SavedState = {
      grid,
      tray,
      score,
      streak,
      lastDropHadClear,
    };
    await saveState(state);
  }

  // ---- onboarding ----
  let onboardEl: HTMLElement | null = null;

  async function showOnboarding(): Promise<void> {
    if (await hasSeenHint()) return;
    const el = document.createElement("div");
    el.className = "bfit-onboard";
    el.innerHTML = `DRAG BLOCK TO GRID<div class="sub">Fill rows or columns to clear</div>`;
    container.appendChild(el);
    onboardEl = el;
    setTimeout(() => { el.remove(); onboardEl = null; }, 5000);
  }

  async function dismissHint(): Promise<void> {
    if (onboardEl) { onboardEl.remove(); onboardEl = null; }
    await markHintSeen();
  }

  // ---- fullscreen ----
  fsBtn.addEventListener("pointerup", () => {
    const target = (container.closest(".game-host") as HTMLElement | null) ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen?.().catch(() => {});
    }
  });

  // ---- pointer events on tray slots ----
  for (let i = 0; i < 3; i++) {
    const idx = i;
    slotEls[i]!.addEventListener("pointerdown", (e) => onSlotPointerDown(idx, e));
  }

  // global pointer move/up
  const onMove = (e: PointerEvent): void => onPointerMove(e);
  const onUp = (e: PointerEvent): void => onPointerUp(e);
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);

  // ---- init ----
  async function init(): Promise<void> {
    best = await personalBest("block-fit");
    const saved = await loadSavedState();
    if (saved) {
      grid = saved.grid;
      tray = saved.tray;
      score = saved.score;
      streak = saved.streak ?? 0;
      lastDropHadClear = saved.lastDropHadClear ?? false;
      // ensure any null-holes from corrupt save don't break us
      if (!Array.isArray(tray) || tray.length !== 3) {
        const [s0, s1, s2] = generateTray();
        tray = [s0, s1, s2];
      }
      // check if game was already over
      if (!hasAnyPlacement(grid, tray)) {
        // restore failed — just fresh start
        grid = Array.from({ length: GRID }, () => Array(GRID).fill(null) as Cell[]);
        const [s0, s1, s2] = generateTray();
        tray = [s0, s1, s2];
        score = 0;
        streak = 0;
        lastDropHadClear = false;
      }
    } else {
      const [s0, s1, s2] = generateTray();
      tray = [s0, s1, s2];
    }
    recalcCellSize();
    renderGrid();
    renderTray();
    renderHUD();
    void showOnboarding();
  }

  void init();

  return function cleanup(): void {
    ro.disconnect();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    removeDragGhost();
    container.innerHTML = "";
    container.classList.remove("blockfit-root");
    container.style.touchAction = prevTouchAction;
  };
}
