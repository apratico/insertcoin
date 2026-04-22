import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";
import { playSfx } from "../../lib/audio.js";

// ---------- types ----------

type Cell = number; // 0 = empty, otherwise power of 2
type Board = Cell[][];
type Dir = "U" | "D" | "L" | "R";

interface Tile {
  id: number;
  r: number;
  c: number;
  val: number;
  fromR?: number;
  fromC?: number;
  merging?: boolean; // this tile is the result of a merge
  isNew?: boolean;   // freshly spawned
}

interface SavedState {
  board: Board;
  score: number;
  won: boolean;
  keepGoing: boolean;
}

// ---------- constants ----------

const SIZE = 4;
const SAVE_KEY = "2048:state";
const HINT_KEY = "2048:seenHint";
const ANIM_MS = 150; // slide transition duration
const MERGE_MS = 160; // merge/spawn pop duration
const LOCK_MS = ANIM_MS + 20; // total input lock window
const TILE_GAP = 6; // px — must match CSS

// Tile colours per value (0 = empty cell / grid background)
const TILE_COLORS: Record<number, { bg: string; fg: string }> = {
  0:    { bg: "#2a2a3e", fg: "#776e65" },
  2:    { bg: "#eee4da", fg: "#776e65" },
  4:    { bg: "#ede0c8", fg: "#776e65" },
  8:    { bg: "#f2b179", fg: "#f9f6f2" },
  16:   { bg: "#f59563", fg: "#f9f6f2" },
  32:   { bg: "#f67c5f", fg: "#f9f6f2" },
  64:   { bg: "#f65e3b", fg: "#f9f6f2" },
  128:  { bg: "#edcf72", fg: "#f9f6f2" },
  256:  { bg: "#edcc61", fg: "#f9f6f2" },
  512:  { bg: "#edc850", fg: "#f9f6f2" },
  1024: { bg: "#edc53f", fg: "#f9f6f2" },
  2048: { bg: "#edc22e", fg: "#f9f6f2" },
};

function tileStyle(val: number): { bg: string; fg: string } {
  return TILE_COLORS[val] ?? { bg: "#3c3a32", fg: "#f9f6f2" };
}

function tileFontSize(val: number): string {
  if (val < 100)   return "clamp(22px, 5vw, 36px)";
  if (val < 1000)  return "clamp(18px, 4vw, 28px)";
  if (val < 10000) return "clamp(14px, 3.2vw, 22px)";
  return "clamp(11px, 2.5vw, 17px)";
}

// ---------- board logic ----------

function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0) as Cell[]);
}

function freeCells(b: Board): { r: number; c: number }[] {
  const cells: { r: number; c: number }[] = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (b[r]![c] === 0) cells.push({ r, c });
  return cells;
}

function spawnTile(b: Board): Board {
  const free = freeCells(b);
  if (free.length === 0) return b;
  const pick = free[Math.floor(Math.random() * free.length)]!;
  const next = b.map((row) => [...row]) as Board;
  next[pick.r]![pick.c] = Math.random() < 0.9 ? 2 : 4;
  return next;
}

// ---------- verbose slide: tracks source → dest per tile ----------

interface SlideMove {
  srcIndex: number; // position in original row (0-based)
  dstIndex: number; // position in result row
  merged: boolean;  // this source was the secondary tile in a merge (gets removed)
}

interface SlideResult {
  row: Cell[];
  score: number;
  moves: SlideMove[];
}

// Slide a row left, returning the new row + per-tile movement map.
// Two tiles that merge: both get an entry pointing to the same dstIndex.
// The secondary tile (i+1) is marked merged:true — it will be removed visually.
function slideLeftVerbose(row: Cell[]): SlideResult {
  // gather non-zero positions: { val, origIdx }
  const nonzero: Array<{ val: Cell; origIdx: number }> = [];
  for (let i = 0; i < row.length; i++) {
    if (row[i] !== 0) nonzero.push({ val: row[i]!, origIdx: i });
  }

  let score = 0;
  const merged: Cell[] = [];
  const moves: SlideMove[] = [];
  let i = 0;

  while (i < nonzero.length) {
    const dstIndex = merged.length;
    if (
      i + 1 < nonzero.length &&
      nonzero[i]!.val === nonzero[i + 1]!.val
    ) {
      const sum = (nonzero[i]!.val * 2) as Cell;
      merged.push(sum);
      score += sum;
      // Primary tile moves to dstIndex
      moves.push({ srcIndex: nonzero[i]!.origIdx, dstIndex, merged: false });
      // Secondary tile also moves to dstIndex, flagged for removal
      moves.push({ srcIndex: nonzero[i + 1]!.origIdx, dstIndex, merged: true });
      i += 2;
    } else {
      merged.push(nonzero[i]!.val);
      moves.push({ srcIndex: nonzero[i]!.origIdx, dstIndex, merged: false });
      i++;
    }
  }

  while (merged.length < SIZE) merged.push(0);
  return { row: merged, score, moves };
}

// Standard (non-verbose) slideLeft — kept for applyMove
function slideLeft(row: Cell[]): { row: Cell[]; score: number } {
  const { row: r, score: s } = slideLeftVerbose(row);
  return { row: r, score: s };
}

function rotateBoard(b: Board): Board {
  // 90° clockwise
  return Array.from({ length: SIZE }, (_, r) =>
    Array.from({ length: SIZE }, (__, c) => b[SIZE - 1 - c]![r]!)
  ) as Board;
}

function applyMove(b: Board, dir: Dir): { board: Board; score: number; changed: boolean } {
  let rotations = 0;
  if (dir === "U") rotations = 3;
  else if (dir === "D") rotations = 1;
  else if (dir === "R") rotations = 2;

  let work = b;
  for (let i = 0; i < rotations; i++) work = rotateBoard(work);

  let totalScore = 0;
  let changed = false;
  const result = work.map((row) => {
    const { row: newRow, score } = slideLeft(row);
    totalScore += score;
    if (!changed && newRow.some((v, idx) => v !== row[idx])) changed = true;
    return newRow;
  }) as Board;

  const backRotations = (4 - rotations) % 4;
  let final = result;
  for (let i = 0; i < backRotations; i++) final = rotateBoard(final);

  return { board: final, score: totalScore, changed };
}

function hasWon(b: Board): boolean {
  return b.some((row) => row.some((v) => v >= 2048));
}

function canMove(b: Board): boolean {
  if (freeCells(b).length > 0) return true;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = b[r]![c]!;
      if (c + 1 < SIZE && b[r]![c + 1] === v) return true;
      if (r + 1 < SIZE && b[r + 1]![c] === v) return true;
    }
  }
  return false;
}

// ---------- tile identity ----------

let _nextTileId = 1;
function nextId(): number { return _nextTileId++; }

// Build initial tile list from a board (e.g. after restore)
function tilesFromBoard(board: Board): Tile[] {
  const result: Tile[] = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const val = board[r]![c]!;
      if (val !== 0) result.push({ id: nextId(), r, c, val });
    }
  return result;
}

// Given the current tile list and a move direction, compute the next tile list.
// Returns: movedTiles (all tiles after move, including merged results and the new spawn).
// "consumed" tiles (secondary merge sources) are included with merging:true so
// the renderer can animate them to their dest before removing them.
function applyMoveTiles(
  tiles: Tile[],
  dir: Dir,
  nextBoard: Board
): { nextTiles: Tile[]; consumed: Tile[] } {
  // We'll work in rotated coordinate space, then de-rotate.
  // Rotation helpers for a single (r,c) point.
  // 1 clockwise rotation: (r, c) -> (c, SIZE-1-r)
  function rotateCoord(r: number, c: number, times: number): [number, number] {
    let rr = r, cc = c;
    for (let i = 0; i < times; i++) {
      const tmp = rr;
      rr = cc;
      cc = SIZE - 1 - tmp;
    }
    return [rr, cc];
  }

  let rotations = 0;
  if (dir === "U") rotations = 3;
  else if (dir === "D") rotations = 1;
  else if (dir === "R") rotations = 2;

  const backRotations = (4 - rotations) % 4;

  // Map each tile to its rotated position
  const rotated = tiles.map((t) => {
    const [rr, cc] = rotateCoord(t.r, t.c, rotations);
    return { ...t, r: rr, c: cc };
  });

  // Group tiles by rotated row
  const byRow: Tile[][] = Array.from({ length: SIZE }, () => []);
  for (const t of rotated) byRow[t.r]!.push(t);

  const nextTiles: Tile[] = [];
  const consumed: Tile[] = [];

  for (let row = 0; row < SIZE; row++) {
    const rowTiles = byRow[row]!.slice().sort((a, b) => a.c - b.c);
    // Build a full SIZE-length row with zeros for empty cells.
    // This ensures origIdx in slideLeftVerbose == board column index.
    const fullRow: Cell[] = Array(SIZE).fill(0) as Cell[];
    for (const t of rowTiles) fullRow[t.c] = t.val;
    const { moves } = slideLeftVerbose(fullRow);

    // moveMap: board column index -> SlideMove (srcIndex == column index)
    const moveMap = new Map<number, SlideMove>();
    for (const m of moves) moveMap.set(m.srcIndex, m);

    for (let i = 0; i < rowTiles.length; i++) {
      const tile = rowTiles[i]!;
      const m = moveMap.get(tile.c);
      if (!m) continue;

      const [newR, newC] = rotateCoord(row, m.dstIndex, backRotations);

      if (m.merged) {
        // Secondary tile consumed by merge — animate to dest then remove.
        const ct: Tile = { id: tile.id, val: tile.val, r: newR, c: newC, merging: true };
        if (tile.r !== row) ct.fromR = tile.r;
        if (tile.c !== m.dstIndex) ct.fromC = tile.c;
        consumed.push(ct);
      } else {
        // Check if this tile is a merge *result* (primary tile that absorbed another)
        const isMergeResult = moves.some(
          (mm) => mm.dstIndex === m.dstIndex && mm.merged
        );
        // val will be corrected from nextBoard after de-rotation (set below)
        const nt: Tile = {
          id: tile.id,
          val: tile.val,      // placeholder — corrected below from nextBoard
          r: newR,
          c: newC,
          fromR: tile.r,
          fromC: tile.c,
          merging: isMergeResult,
          isNew: false,
        };
        nextTiles.push(nt);
      }
    }
  }

  // Fix tile vals for merge results: they were doubled in nextBoard.
  // The spawn cell is empty in movedBoard, so any non-zero nextBoard value at
  // a position occupied by a nextTile is the correct post-merge value.
  for (const t of nextTiles) {
    const boardVal = nextBoard[t.r]![t.c]!;
    if (boardVal !== 0) t.val = boardVal;
  }

  // Find where the new tile spawned (diff nextBoard vs pre-spawn board)
  // nextBoard already has the spawn. Find the cell that differs from what
  // nextTiles would produce.
  const occupiedAfter = new Set<string>();
  for (const t of nextTiles) occupiedAfter.add(`${t.r},${t.c}`);

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const val = nextBoard[r]![c]!;
      if (val !== 0 && !occupiedAfter.has(`${r},${c}`)) {
        nextTiles.push({ id: nextId(), r, c, val, isNew: true });
      }
    }
  }

  return { nextTiles, consumed };
}

// ---------- persistence ----------

async function loadSaved(): Promise<SavedState | null> {
  try {
    const row = await db.settings.get(SAVE_KEY);
    if (!row) return null;
    return JSON.parse(row.value) as SavedState;
  } catch {
    return null;
  }
}

async function saveState(s: SavedState): Promise<void> {
  try {
    await db.settings.put({ key: SAVE_KEY, value: JSON.stringify(s) });
  } catch { /* non-critical */ }
}

async function clearSaved(): Promise<void> {
  try {
    await db.settings.delete(SAVE_KEY);
  } catch { /* non-critical */ }
}

async function hasSeenHint(): Promise<boolean> {
  try {
    const row = await db.settings.get(HINT_KEY);
    return !!row;
  } catch {
    return false;
  }
}

async function markHintSeen(): Promise<void> {
  try {
    await db.settings.put({ key: HINT_KEY, value: "1" });
  } catch { /* non-critical */ }
}

// ---------- DOM tile grid ----------

function buildGrid(parent: HTMLElement): {
  cells: HTMLElement[][];
  tileLayer: HTMLElement;
} {
  const grid = document.createElement("div");
  grid.className = "g2048-grid";
  parent.appendChild(grid);

  const cells: HTMLElement[][] = [];
  for (let r = 0; r < SIZE; r++) {
    const row: HTMLElement[] = [];
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement("div");
      cell.className = "g2048-cell-bg";
      grid.appendChild(cell);
      row.push(cell);
    }
    cells.push(row);
  }

  const tileLayer = document.createElement("div");
  tileLayer.className = "g2048-tile-layer";
  grid.appendChild(tileLayer);

  return { cells, tileLayer };
}

// ---------- tile DOM helpers ----------

// Compute pixel translate for a tile given layer dimensions.
// Each tile occupies (layerSize / SIZE) px including gap, but the gap
// is only between tiles. Actual cell size = (layerW - gap*(SIZE-1)) / SIZE.
// We position tile at: col * (cellSize + gap), row * (cellSize + gap).
// We express this as CSS custom properties --t-r and --t-c and let CSS do:
//   transform: translate(calc(var(--t-c) * (cellW + gap)), calc(var(--t-r) * (cellH + gap)))
// where cellW/H is computed in CSS as (100% - gap*(SIZE-1)) / SIZE = 25% - gap*3/4
// which simplifies to: translate position for col c is c*(100%/4) + c*gap/4 ... actually
// simpler to just use `left`+`top` percentages and not animate those, OR use the integer
// column/row indexes with a CSS calc that encodes the known gap.
// SIMPLEST: --t-c and --t-r are 0..3 integers, CSS does the math with known TILE_GAP.

function applyTilePosition(el: HTMLElement, r: number, c: number): void {
  el.style.setProperty("--t-r", String(r));
  el.style.setProperty("--t-c", String(c));
}

function createTileEl(tile: Tile): HTMLElement {
  const el = document.createElement("div");
  el.className = "g2048-tile";
  const { bg, fg } = tileStyle(tile.val);
  el.style.setProperty("--t-bg", bg);
  el.style.setProperty("--t-fg", fg);
  // Start at from-position (no transition yet) so the slide goes from there
  applyTilePosition(el, tile.fromR ?? tile.r, tile.fromC ?? tile.c);
  el.style.fontSize = tileFontSize(tile.val);
  el.textContent = String(tile.val);
  return el;
}

// Full static render (initial / undo — no animation)
function renderBoardStatic(
  tileLayer: HTMLElement,
  tileMap: Map<number, HTMLElement>,
  tiles: Tile[]
): void {
  tileLayer.innerHTML = "";
  tileMap.clear();
  for (const tile of tiles) {
    const el = document.createElement("div");
    el.className = "g2048-tile";
    const { bg, fg } = tileStyle(tile.val);
    el.style.setProperty("--t-bg", bg);
    el.style.setProperty("--t-fg", fg);
    applyTilePosition(el, tile.r, tile.c);
    el.style.fontSize = tileFontSize(tile.val);
    el.textContent = String(tile.val);
    tileLayer.appendChild(el);
    tileMap.set(tile.id, el);
  }
}

// ---------- HUD ----------

function buildHUD(parent: HTMLElement): {
  scoreEl: HTMLElement;
  bestEl: HTMLElement;
  undoBtn: HTMLButtonElement;
  newBtn: HTMLButtonElement;
  fsBtn: HTMLButtonElement;
} {
  const hud = document.createElement("div");
  hud.className = "g2048-hud";
  hud.innerHTML = `
    <div class="g2048-hud-scores">
      <div class="g2048-score-block">
        <span class="g2048-score-label">SCORE</span>
        <span class="g2048-score-val" id="g2048-score">0</span>
      </div>
      <div class="g2048-score-block">
        <span class="g2048-score-label">BEST</span>
        <span class="g2048-score-val" id="g2048-best">0</span>
      </div>
    </div>
    <div class="g2048-hud-actions">
      <button class="btn g2048-btn" id="g2048-fs" aria-label="Fullscreen">⛶</button>
      <button class="btn g2048-btn" id="g2048-undo" aria-label="Undo" disabled>↶</button>
      <button class="btn g2048-btn" id="g2048-new" aria-label="New game">⟳</button>
    </div>
  `;
  parent.appendChild(hud);

  return {
    scoreEl: hud.querySelector("#g2048-score") as HTMLElement,
    bestEl:  hud.querySelector("#g2048-best") as HTMLElement,
    undoBtn: hud.querySelector("#g2048-undo") as HTMLButtonElement,
    newBtn:  hud.querySelector("#g2048-new") as HTMLButtonElement,
    fsBtn:   hud.querySelector("#g2048-fs") as HTMLButtonElement,
  };
}

// ---------- overlays ----------

function showWinOverlay(
  container: HTMLElement,
  score: number,
  onKeepGoing: () => void,
  onNewGame: () => void
): HTMLElement {
  const ov = document.createElement("div");
  ov.className = "g2048-overlay";
  ov.innerHTML = `
    <div class="g2048-overlay-box">
      <h2 class="g2048-ov-title g2048-ov-win">YOU WIN!</h2>
      <div class="g2048-ov-score">${score}</div>
      <div class="g2048-ov-label">SCORE</div>
      <div class="g2048-ov-actions">
        <button class="btn primary g2048-ov-btn" id="ov-keep">KEEP GOING</button>
        <button class="btn g2048-ov-btn" id="ov-new">NEW GAME</button>
        <button class="btn g2048-ov-btn" id="ov-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(ov);
  ov.querySelector("#ov-keep")?.addEventListener("pointerup", () => { ov.remove(); onKeepGoing(); });
  ov.querySelector("#ov-new")?.addEventListener("pointerup", () => { ov.remove(); onNewGame(); });
  ov.querySelector("#ov-menu")?.addEventListener("pointerup", () => { navigate("/"); });
  return ov;
}

function buildRankCard(rank: RankInfo, gameId: string): HTMLElement {
  const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="rank-card-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta} pts</div>`
    : "";
  const card = document.createElement("div");
  card.className = "rank-card";
  card.innerHTML = `
    <div class="rank-card-title">RANK ${rankLabel} GLOBAL</div>
    ${deltaHtml}
    <button class="btn rank-card-btn" data-scores-id="${gameId}">VIEW LEADERBOARD</button>
  `;
  card.querySelector<HTMLElement>(".rank-card-btn")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    navigate(`/scores/${gameId}`);
  });
  return card;
}

function showGameoverOverlay(
  container: HTMLElement,
  score: number,
  best: number,
  onReplay: () => void
): HTMLElement {
  const isNewBest = score > 0 && score >= best;
  const ov = document.createElement("div");
  ov.className = "g2048-overlay";
  ov.innerHTML = `
    <div class="g2048-overlay-box">
      <h2 class="g2048-ov-title">GAME OVER</h2>
      ${isNewBest ? `<div class="g2048-ov-best-flag">NEW BEST!</div>` : ""}
      <div class="g2048-ov-score">${score}</div>
      <div class="g2048-ov-label">SCORE</div>
      <div class="g2048-ov-actions">
        <button class="btn primary g2048-ov-btn" id="ov-replay">PLAY AGAIN</button>
        <button class="btn g2048-ov-btn" id="ov-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(ov);
  ov.querySelector("#ov-replay")?.addEventListener("pointerup", () => { ov.remove(); onReplay(); });
  ov.querySelector("#ov-menu")?.addEventListener("pointerup", () => { navigate("/"); });
  void computeRank("2048", score).then((rank) => {
    if (!rank) return;
    const box = ov.querySelector(".g2048-overlay-box");
    const actions = ov.querySelector(".g2048-ov-actions");
    if (!box || !actions) return;
    box.insertBefore(buildRankCard(rank, "2048"), actions);
  });
  return ov;
}

function showNewGameConfirm(
  container: HTMLElement,
  onConfirm: () => void
): HTMLElement {
  const ov = document.createElement("div");
  ov.className = "g2048-overlay";
  ov.innerHTML = `
    <div class="g2048-overlay-box">
      <h2 class="g2048-ov-title">NEW GAME?</h2>
      <div class="g2048-ov-label" style="margin-bottom:20px">Current progress will be lost.</div>
      <div class="g2048-ov-actions">
        <button class="btn primary g2048-ov-btn" id="ng-yes">YES</button>
        <button class="btn g2048-ov-btn" id="ng-no">CANCEL</button>
      </div>
    </div>
  `;
  container.appendChild(ov);
  ov.querySelector("#ng-yes")?.addEventListener("pointerup", () => { ov.remove(); onConfirm(); });
  ov.querySelector("#ng-no")?.addEventListener("pointerup", () => { ov.remove(); });
  return ov;
}

// ---------- onboarding hint overlay ----------

function buildHintOverlay(container: HTMLElement): HTMLElement {
  const ov = document.createElement("div");
  ov.className = "g2048-hint-overlay";
  // pointer-events: none so swipe passes through to the wrap underneath
  ov.innerHTML = `
    <div class="g2048-hint-box">
      <div class="g2048-hint-title">SWIPE TO MOVE</div>
      <div class="g2048-hint-arrows" aria-hidden="true">
        <svg class="g2048-hint-svg" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Up arrow -->
          <path class="g2048-hint-arrow g2048-hint-up" d="M32 10 L32 30" stroke="#f6c24c" stroke-width="3" stroke-linecap="round"/>
          <path class="g2048-hint-arrow g2048-hint-up" d="M24 18 L32 10 L40 18" stroke="#f6c24c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <!-- Down arrow -->
          <path class="g2048-hint-arrow g2048-hint-down" d="M32 54 L32 34" stroke="#f6c24c" stroke-width="3" stroke-linecap="round"/>
          <path class="g2048-hint-arrow g2048-hint-down" d="M24 46 L32 54 L40 46" stroke="#f6c24c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <!-- Left arrow -->
          <path class="g2048-hint-arrow g2048-hint-left" d="M10 32 L30 32" stroke="#f6c24c" stroke-width="3" stroke-linecap="round"/>
          <path class="g2048-hint-arrow g2048-hint-left" d="M18 24 L10 32 L18 40" stroke="#f6c24c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <!-- Right arrow -->
          <path class="g2048-hint-arrow g2048-hint-right" d="M54 32 L34 32" stroke="#f6c24c" stroke-width="3" stroke-linecap="round"/>
          <path class="g2048-hint-arrow g2048-hint-right" d="M46 24 L54 32 L46 40" stroke="#f6c24c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <!-- Centre dot -->
          <circle cx="32" cy="32" r="3" fill="#f6c24c" opacity="0.7"/>
        </svg>
      </div>
      <div class="g2048-hint-sub">Merge equal tiles. Reach 2048.</div>
    </div>
  `;
  container.appendChild(ov);
  return ov;
}

// ---------- directional flash ----------

function flashEdge(wrap: HTMLElement, dir: Dir): void {
  const classMap: Record<Dir, string> = {
    U: "g2048-flash-top",
    D: "g2048-flash-bottom",
    L: "g2048-flash-left",
    R: "g2048-flash-right",
  };
  const cls = classMap[dir];
  wrap.classList.add(cls);
  setTimeout(() => wrap.classList.remove(cls), 120);
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("game2048-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // State
  let board: Board = emptyBoard();
  let tiles: Tile[] = [];
  let score = 0;
  let best = 0;
  let won = false;
  let keepGoing = false;
  let prevBoard: Board | null = null;
  let prevTiles: Tile[] | null = null;
  let prevScore = 0;
  let inputLocked = false;
  let activeOverlay: HTMLElement | null = null;
  let hintOverlay: HTMLElement | null = null;

  // DOM id -> element map for differential updates
  const tileMap = new Map<number, HTMLElement>();

  // Layout
  const wrap = document.createElement("div");
  wrap.className = "g2048-wrap";
  container.appendChild(wrap);

  const { scoreEl, bestEl, undoBtn, newBtn, fsBtn } = buildHUD(wrap);

  const gridArea = document.createElement("div");
  gridArea.className = "g2048-grid-area";
  wrap.appendChild(gridArea);

  const { tileLayer } = buildGrid(gridArea);

  // Load best score
  void personalBest("2048").then((b) => {
    best = b;
    bestEl.textContent = String(best);
  });

  // Restore saved state or start fresh; check hint after
  void loadSaved().then(async (saved) => {
    if (saved) {
      board = saved.board;
      score = saved.score;
      won = saved.won;
      keepGoing = saved.keepGoing;
      tiles = tilesFromBoard(board);
      scoreEl.textContent = String(score);
      renderBoardStatic(tileLayer, tileMap, tiles);
    } else {
      startNewGame();
    }

    // Show hint only if never seen before AND no saved state (fresh game)
    if (!saved) {
      const seen = await hasSeenHint();
      if (!seen) {
        hintOverlay = buildHintOverlay(container);
        // Auto-dismiss after 5 seconds
        setTimeout(() => dismissHint(), 5000);
      }
    }
  });

  function dismissHint(): void {
    if (!hintOverlay) return;
    hintOverlay.classList.add("g2048-hint-fade");
    setTimeout(() => {
      hintOverlay?.remove();
      hintOverlay = null;
    }, 350);
    void markHintSeen();
  }

  // ---------- fullscreen ----------
  fsBtn.addEventListener("pointerup", () => {
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen().catch(() => {});
    }
  });

  // ---------- new game button ----------
  newBtn.addEventListener("pointerup", () => {
    if (activeOverlay) return;
    activeOverlay = showNewGameConfirm(container, () => {
      activeOverlay = null;
      startNewGame();
    });
    activeOverlay.querySelector("#ng-no")?.addEventListener("pointerup", () => {
      activeOverlay = null;
    });
  });

  // ---------- undo ----------
  undoBtn.addEventListener("pointerup", () => {
    if (!prevBoard || inputLocked) return;
    board = prevBoard;
    tiles = prevTiles ?? tilesFromBoard(board);
    score = prevScore;
    prevBoard = null;
    prevTiles = null;
    undoBtn.disabled = true;
    renderBoardStatic(tileLayer, tileMap, tiles);
    scoreEl.textContent = String(score);
    void saveState({ board, score, won, keepGoing });
  });

  // ---------- keyboard ----------
  function onKey(e: KeyboardEvent): void {
    const map: Record<string, Dir> = {
      ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
      w: "U", s: "D", a: "L", d: "R",
    };
    const d = map[e.key];
    if (d) {
      e.preventDefault();
      handleMove(d);
    }
  }
  document.addEventListener("keydown", onKey);

  // ---------- swipe ----------
  let touchStartX = 0;
  let touchStartY = 0;

  function onTouchStart(e: TouchEvent): void {
    const t = e.changedTouches[0];
    if (!t) return;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }

  function onTouchEnd(e: TouchEvent): void {
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const MIN = 20;
    if (Math.abs(dx) < MIN && Math.abs(dy) < MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      handleMove(dx > 0 ? "R" : "L");
    } else {
      handleMove(dy > 0 ? "D" : "U");
    }
  }

  wrap.addEventListener("touchstart", onTouchStart, { passive: true });
  wrap.addEventListener("touchend", onTouchEnd, { passive: true });

  // ---------- game logic ----------

  function startNewGame(): void {
    prevBoard = null;
    prevTiles = null;
    prevScore = 0;
    score = 0;
    won = false;
    keepGoing = false;
    inputLocked = false;
    undoBtn.disabled = true;
    scoreEl.textContent = "0";
    board = spawnTile(spawnTile(emptyBoard()));
    tiles = tilesFromBoard(board);
    renderBoardStatic(tileLayer, tileMap, tiles);
    void saveState({ board, score, won, keepGoing });
  }

  function handleMove(dir: Dir): void {
    if (inputLocked || activeOverlay) return;
    if (!keepGoing && won) return;

    const { board: movedBoard, score: gained, changed } = applyMove(board, dir);
    if (!changed) return;

    // First valid move dismisses the hint
    if (hintOverlay) dismissHint();

    navigator.vibrate?.(10);

    // Save undo snapshot
    prevBoard = board.map((r) => [...r]) as Board;
    prevTiles = tiles.map((t) => ({ ...t }));
    prevScore = score;
    undoBtn.disabled = false;

    const nextBoard = spawnTile(movedBoard);
    const { nextTiles, consumed } = applyMoveTiles(tiles, dir, nextBoard);

    board = nextBoard;
    // nextTiles contains all surviving tiles (including merge results marked merging:true
    // for the pulse animation) plus the new spawn. Consumed secondary sources are in
    // `consumed` and will be removed from DOM after the animation — they are NOT in nextTiles.
    tiles = nextTiles.map((t) => ({ ...t, merging: false, isNew: false } as Tile));
    score += gained;
    if (score > best) best = score;
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);

    if (gained > 0) playSfx("merge");
    if (gained >= 128) navigator.vibrate?.(25);

    flashEdge(wrap, dir);

    inputLocked = true;
    animateMoveAndRender(nextTiles, consumed, () => {
      inputLocked = false;

      void saveState({ board, score, won, keepGoing });

      if (!won && !keepGoing && hasWon(board)) {
        won = true;
        playSfx("win");
        navigator.vibrate?.([30, 60, 30, 60, 100]);
        void saveState({ board, score, won, keepGoing });
        activeOverlay = showWinOverlay(
          container,
          score,
          () => { keepGoing = true; activeOverlay = null; },
          () => { activeOverlay = null; startNewGame(); }
        );
        return;
      }

      if (!canMove(board)) {
        playSfx("gameover");
        navigator.vibrate?.([50, 50, 100]);
        void submit("2048", score);
        void clearSaved();
        activeOverlay = showGameoverOverlay(container, score, best, () => {
          activeOverlay = null;
          void personalBest("2048").then((b) => {
            best = b;
            bestEl.textContent = String(best);
          });
          startNewGame();
        });
      }
    });
  }

  // ---------- animated move render ----------

  function animateMoveAndRender(
    nextTiles: Tile[],
    consumed: Tile[],
    done: () => void
  ): void {
    const toRemove: HTMLElement[] = [];

    // 1. Animate consumed (secondary merge sources) sliding to their merge dest.
    //    They already exist in the DOM at their current position.
    for (const ct of consumed) {
      const el = tileMap.get(ct.id);
      if (!el) continue;
      tileMap.delete(ct.id);
      toRemove.push(el);
      // Trigger slide — rAF ensures the browser registers the current position first
      requestAnimationFrame(() => applyTilePosition(el, ct.r, ct.c));
    }

    // 2. Update and slide surviving tiles to new positions.
    //    For merge-result tiles: update value, color, font before sliding.
    for (const tile of nextTiles) {
      if (tile.isNew) continue;

      const el = tileMap.get(tile.id);
      if (el) {
        // Update displayed value if it changed (merge result)
        if (el.textContent !== String(tile.val)) {
          const { bg, fg } = tileStyle(tile.val);
          el.textContent = String(tile.val);
          el.style.setProperty("--t-bg", bg);
          el.style.setProperty("--t-fg", fg);
          el.style.fontSize = tileFontSize(tile.val);
        }
        requestAnimationFrame(() => applyTilePosition(el, tile.r, tile.c));
      }
      // (No else branch needed: all non-isNew tiles should already be in the map
      //  since they existed before the move.)
    }

    // 3. Create new spawn tile hidden; reveal with pop after the slide finishes.
    const newTile = nextTiles.find((t) => t.isNew);
    let newEl: HTMLElement | null = null;
    if (newTile) {
      newEl = createTileEl(newTile);
      // createTileEl sets --t-r/--t-c from fromR/fromC (which equal r/c for isNew tiles)
      // so position is correct already; just start it transparent so it doesn't flash
      newEl.style.opacity = "0";
      tileLayer.appendChild(newEl);
      tileMap.set(newTile.id, newEl);
    }

    // After slide animation completes:
    setTimeout(() => {
      // Remove secondary merge sources from DOM
      for (const el of toRemove) el.remove();

      // Pulse merge-result tiles
      for (const tile of nextTiles) {
        if (tile.merging && !tile.isNew) {
          const el = tileMap.get(tile.id);
          if (el) {
            el.classList.add("g2048-tile-merge");
            el.addEventListener(
              "animationend",
              () => el.classList.remove("g2048-tile-merge"),
              { once: true }
            );
          }
        }
      }

      // Pop-in new spawn tile
      if (newEl) {
        newEl.style.opacity = "";
        newEl.classList.add("g2048-tile-spawn");
        newEl.addEventListener(
          "animationend",
          () => newEl!.classList.remove("g2048-tile-spawn"),
          { once: true }
        );
      }

      done();
    }, LOCK_MS);
  }

  // ---------- cleanup ----------
  return function cleanup(): void {
    document.removeEventListener("keydown", onKey);
    container.innerHTML = "";
    container.classList.remove("game2048-root");
    container.style.touchAction = prevTouchAction;
    tileMap.clear();
  };
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "g2048-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .game2048-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #1a1a2a;
      user-select: none;
      -webkit-user-select: none;
    }
    .g2048-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-height: 0;
      padding: 8px 8px 12px;
      gap: 8px;
      box-sizing: border-box;
      position: relative;
    }
    /* Directional flash — pseudo-elements on the wrap */
    .g2048-wrap::before,
    .g2048-wrap::after {
      content: '';
      position: absolute;
      pointer-events: none;
      z-index: 5;
      opacity: 0;
      transition: opacity 80ms ease;
    }
    /* HUD */
    .g2048-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-width: 420px;
      font-family: var(--font-mono, monospace);
      flex-shrink: 0;
    }
    .g2048-hud-scores {
      display: flex;
      gap: 12px;
    }
    .g2048-score-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: #2a2a3e;
      border-radius: 6px;
      padding: 4px 12px;
      min-width: 64px;
    }
    .g2048-score-label {
      font-size: 9px;
      letter-spacing: 1.5px;
      color: #a09880;
      margin-bottom: 1px;
    }
    .g2048-score-val {
      font-size: 18px;
      font-weight: bold;
      color: #f6c24c;
      text-shadow: 0 0 8px rgba(246,194,76,0.5);
      min-width: 28px;
      text-align: center;
    }
    .g2048-hud-actions {
      display: flex;
      gap: 6px;
    }
    .g2048-btn {
      min-width: 44px;
      min-height: 44px;
      font-size: 18px;
      border-color: #3a3a5a;
      color: #c8c0b0;
      background: #2a2a3e;
    }
    .g2048-btn:active { background: #3a3a5a; }
    .g2048-btn:disabled { opacity: 0.35; pointer-events: none; }
    /* Grid area */
    .g2048-grid-area {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      max-width: 420px;
      position: relative;
    }
    .g2048-grid {
      position: relative;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      grid-template-rows: repeat(4, 1fr);
      gap: ${TILE_GAP}px;
      padding: ${TILE_GAP}px;
      background: #1a1a2a;
      border-radius: 8px;
      border: 1px solid #3a3a5a;
      width: min(90vw, min(90vh - 80px, 420px));
      aspect-ratio: 1 / 1;
      box-sizing: border-box;
    }
    .g2048-cell-bg {
      background: #2a2a3e;
      border-radius: 5px;
    }
    /* Tile layer: absolute over the grid interior (inside padding) */
    .g2048-tile-layer {
      position: absolute;
      inset: ${TILE_GAP}px;
      pointer-events: none;
      overflow: visible;
    }
    /* Tile: absolute inside the tile layer. step = layerW/4 + gap/4 = 25% + gap/SIZE px */
    .g2048-tile {
      position: absolute;
      width: calc((100% - ${TILE_GAP}px * ${SIZE - 1}) / ${SIZE});
      height: calc((100% - ${TILE_GAP}px * ${SIZE - 1}) / ${SIZE});
      background: var(--t-bg, #2a2a3e);
      color: var(--t-fg, #f9f6f2);
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono, monospace);
      font-weight: bold;
      left: calc(var(--t-c, 0) * (25% + ${TILE_GAP / SIZE}px));
      top:  calc(var(--t-r, 0) * (25% + ${TILE_GAP / SIZE}px));
      transition: left ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1),
                  top  ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1);
    }
    @keyframes g2048-spawn {
      0%   { transform: scale(0.4); opacity: 0.4; }
      60%  { transform: scale(1.12); opacity: 1; }
      100% { transform: scale(1);   opacity: 1; }
    }
    .g2048-tile-spawn {
      animation: g2048-spawn ${MERGE_MS}ms ease forwards;
    }
    @keyframes g2048-merge {
      0%   { transform: scale(1); }
      50%  { transform: scale(1.15); }
      100% { transform: scale(1); }
    }
    .g2048-tile-merge {
      animation: g2048-merge ${MERGE_MS}ms ease forwards;
    }
    /* Directional flash via box-shadow on the grid area */
    .g2048-grid-area {
      transition: box-shadow 60ms ease;
    }
    .g2048-flash-top    .g2048-grid-area { box-shadow: 0 -4px 18px 2px rgba(246,194,76,0.55); }
    .g2048-flash-bottom .g2048-grid-area { box-shadow: 0  4px 18px 2px rgba(246,194,76,0.55); }
    .g2048-flash-left   .g2048-grid-area { box-shadow: -4px 0 18px 2px rgba(246,194,76,0.55); }
    .g2048-flash-right  .g2048-grid-area { box-shadow:  4px 0 18px 2px rgba(246,194,76,0.55); }
    /* Overlays */
    .g2048-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.82);
      z-index: 20;
    }
    .g2048-overlay-box {
      text-align: center;
      padding: 32px 28px;
      background: #1e1e30;
      border: 1px solid #3a3a5a;
      border-radius: 14px;
      min-width: 240px;
      max-width: 92vw;
    }
    .g2048-ov-title {
      margin: 0 0 8px;
      font-family: var(--font-mono, monospace);
      font-size: 22px;
      color: #f65e3b;
      letter-spacing: 3px;
      text-shadow: 0 0 12px rgba(246,94,59,0.7);
    }
    .g2048-ov-win {
      color: #edc22e;
      text-shadow: 0 0 16px rgba(237,194,46,0.8);
    }
    .g2048-ov-best-flag {
      color: #f6c24c;
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      letter-spacing: 2px;
      margin-bottom: 8px;
      text-shadow: 0 0 8px rgba(246,194,76,0.6);
    }
    .g2048-ov-score {
      font-family: var(--font-mono, monospace);
      font-size: 48px;
      font-weight: bold;
      color: #f6c24c;
      text-shadow: 0 0 16px rgba(246,194,76,0.7);
      line-height: 1;
    }
    .g2048-ov-label {
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      color: #6a6488;
      letter-spacing: 2px;
      margin-bottom: 20px;
    }
    .g2048-ov-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .g2048-ov-btn {
      min-width: 96px;
      min-height: 44px;
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      letter-spacing: 1px;
    }
    /* ---- Hint overlay ---- */
    .g2048-hint-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      pointer-events: none;
      background: rgba(0, 0, 0, 0.45);
      transition: opacity 350ms ease;
    }
    .g2048-hint-overlay.g2048-hint-fade {
      opacity: 0;
    }
    .g2048-hint-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 22px 28px 18px;
      background: rgba(26, 26, 42, 0.85);
      border: 1px solid rgba(246, 194, 76, 0.4);
      border-radius: 16px;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .g2048-hint-title {
      font-family: var(--font-mono, monospace);
      font-size: clamp(16px, 4vw, 22px);
      font-weight: bold;
      letter-spacing: 3px;
      color: #f6c24c;
      text-shadow: 0 0 14px rgba(246,194,76,0.8);
    }
    .g2048-hint-svg {
      width: 72px;
      height: 72px;
    }
    .g2048-hint-arrow {
      filter: drop-shadow(0 0 4px rgba(246,194,76,0.9));
    }
    @keyframes g2048-hint-pulse {
      0%, 100% { opacity: 0.4; }
      50%       { opacity: 1; }
    }
    .g2048-hint-up    { animation: g2048-hint-pulse 800ms ease-in-out infinite; animation-delay: 0ms; }
    .g2048-hint-right { animation: g2048-hint-pulse 800ms ease-in-out infinite; animation-delay: 200ms; }
    .g2048-hint-down  { animation: g2048-hint-pulse 800ms ease-in-out infinite; animation-delay: 400ms; }
    .g2048-hint-left  { animation: g2048-hint-pulse 800ms ease-in-out infinite; animation-delay: 600ms; }
    .g2048-hint-sub {
      font-family: var(--font-mono, monospace);
      font-size: clamp(10px, 2.5vw, 13px);
      color: #a09880;
      letter-spacing: 1px;
      text-align: center;
    }
  `;
  document.head.appendChild(style);
}
