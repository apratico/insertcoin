import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";
import { playSfx } from "../../lib/audio.js";

// ---------- types ----------

type Board = number[]; // length 16; 0 = empty cell; values 1..15 + 0
type Phase = "playing" | "won";

interface SavedState {
  board: Board;
  moves: number;
  elapsed: number; // seconds at time of save
  savedAt: number; // Date.now() at time of save
}

// ---------- constants ----------

const SIZE = 4;
const SAVE_KEY = "15puzzle:state";
const HINT_KEY = "15puzzle:seenHint";
const ANIM_MS = 150;
const LOCK_MS = ANIM_MS + 20;

// ---------- board logic ----------

function solvedBoard(): Board {
  // [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0]
  return Array.from({ length: SIZE * SIZE }, (_, i) =>
    i < SIZE * SIZE - 1 ? i + 1 : 0
  );
}

function scramble(n = 80): Board {
  const board = solvedBoard();
  let emptyIdx = 15;
  for (let i = 0; i < n; i++) {
    const neighbors = adjacentIndices(emptyIdx);
    const pick = neighbors[Math.floor(Math.random() * neighbors.length)]!;
    board[emptyIdx] = board[pick]!;
    board[pick] = 0;
    emptyIdx = pick;
  }
  return board;
}

function adjacentIndices(idx: number): number[] {
  const r = Math.floor(idx / SIZE);
  const c = idx % SIZE;
  const result: number[] = [];
  if (r > 0) result.push(idx - SIZE);
  if (r < SIZE - 1) result.push(idx + SIZE);
  if (c > 0) result.push(idx - 1);
  if (c < SIZE - 1) result.push(idx + 1);
  return result;
}

function isSolved(board: Board): boolean {
  for (let i = 0; i < SIZE * SIZE - 1; i++) {
    if (board[i] !== i + 1) return false;
  }
  return board[SIZE * SIZE - 1] === 0;
}

function calcScore(moves: number, seconds: number): number {
  return Math.max(0, 10000 - moves * 10 - seconds * 2);
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

// ---------- styles ----------

function injectStyles(): void {
  const id = "p15-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .p15-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #0f172a;
      user-select: none;
      -webkit-user-select: none;
    }
    .p15-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-height: 0;
      padding: 8px 8px 10px;
      gap: 8px;
      box-sizing: border-box;
    }
    /* HUD */
    .p15-hud-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-width: 420px;
      flex-shrink: 0;
      font-family: var(--font-mono, monospace);
      gap: 6px;
    }
    .p15-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: #1e293b;
      border-radius: 6px;
      padding: 4px 10px;
      min-width: 56px;
      flex: 1;
    }
    .p15-stat-label {
      font-size: 9px;
      letter-spacing: 1.5px;
      color: #64748b;
      margin-bottom: 1px;
    }
    .p15-stat-val {
      font-size: 16px;
      font-weight: bold;
      color: #38bdf8;
      text-shadow: 0 0 8px rgba(56,189,248,0.5);
      min-width: 36px;
      text-align: center;
    }
    .p15-hud-bottom {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      max-width: 420px;
      flex-shrink: 0;
    }
    .p15-btn {
      min-width: 44px;
      min-height: 44px;
      font-size: 13px;
      font-family: var(--font-mono, monospace);
      letter-spacing: 1px;
      border-color: #334155;
      color: #94a3b8;
      background: #1e293b;
      border-radius: 8px;
      border-width: 1px;
      border-style: solid;
      cursor: pointer;
      padding: 0 12px;
      transition: background 80ms;
    }
    .p15-btn:active { background: #334155; }
    .p15-btn:disabled { opacity: 0.35; pointer-events: none; }
    .p15-btn-wide { flex: 1; max-width: 160px; }
    /* Grid area */
    .p15-grid-area {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      max-width: 420px;
      position: relative;
    }
    /* CSS grid board */
    .p15-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      grid-template-rows: repeat(4, 1fr);
      gap: 6px;
      padding: 6px;
      background: #1e293b;
      border-radius: 10px;
      border: 1px solid #334155;
      width: min(90vw, min(calc(90vh - 140px), 420px));
      aspect-ratio: 1 / 1;
      box-sizing: border-box;
    }
    .p15-cell {
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono, monospace);
      font-weight: bold;
      font-size: clamp(16px, 5vw, 32px);
      cursor: pointer;
      transition: transform 80ms ease, background 80ms ease;
      position: relative;
      overflow: hidden;
    }
    .p15-cell-tile {
      background: #0c4a6e;
      color: #38bdf8;
      border: 1px solid #0369a1;
      text-shadow: 0 0 10px rgba(56,189,248,0.6);
      box-shadow: inset 0 1px 0 rgba(56,189,248,0.18), 0 2px 6px rgba(0,0,0,0.4);
    }
    .p15-cell-tile:active,
    .p15-cell-tile.p15-active {
      transform: scale(1.07);
      background: #0369a1;
    }
    .p15-cell-empty {
      background: #0f172a;
      border: 1px solid #1e293b;
      cursor: default;
    }
    @keyframes p15-shake {
      0%,100% { transform: translateX(0); }
      20%      { transform: translateX(-5px); }
      40%      { transform: translateX(5px); }
      60%      { transform: translateX(-4px); }
      80%      { transform: translateX(4px); }
    }
    .p15-shake {
      animation: p15-shake 280ms ease;
    }
    @keyframes p15-slide-up    { from { transform: translateY(calc(var(--slide-dist, 1) * 100% + var(--slide-gap, 6px))); } }
    @keyframes p15-slide-down  { from { transform: translateY(calc(var(--slide-dist, 1) * -100% - var(--slide-gap, 6px))); } }
    @keyframes p15-slide-left  { from { transform: translateX(calc(var(--slide-dist, 1) * 100% + var(--slide-gap, 6px))); } }
    @keyframes p15-slide-right { from { transform: translateX(calc(var(--slide-dist, 1) * -100% - var(--slide-gap, 6px))); } }
    .p15-anim-up    { animation: p15-slide-up    ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1) both; }
    .p15-anim-down  { animation: p15-slide-down  ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1) both; }
    .p15-anim-left  { animation: p15-slide-left  ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1) both; }
    .p15-anim-right { animation: p15-slide-right ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1) both; }
    /* Overlays */
    .p15-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.82);
      z-index: 20;
    }
    .p15-overlay-box {
      text-align: center;
      padding: 30px 26px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 14px;
      min-width: 240px;
      max-width: 92vw;
    }
    .p15-ov-title {
      margin: 0 0 8px;
      font-family: var(--font-mono, monospace);
      font-size: 20px;
      color: #38bdf8;
      letter-spacing: 3px;
      text-shadow: 0 0 14px rgba(56,189,248,0.8);
    }
    .p15-ov-row {
      font-family: var(--font-mono, monospace);
      font-size: 13px;
      color: #94a3b8;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .p15-ov-score {
      font-family: var(--font-mono, monospace);
      font-size: 48px;
      font-weight: bold;
      color: #38bdf8;
      text-shadow: 0 0 18px rgba(56,189,248,0.7);
      line-height: 1;
      margin: 10px 0 4px;
    }
    .p15-ov-label {
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      color: #475569;
      letter-spacing: 2px;
      margin-bottom: 18px;
    }
    .p15-ov-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .p15-ov-btn {
      min-width: 96px;
      min-height: 44px;
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      letter-spacing: 1px;
    }
    /* Hint overlay */
    .p15-hint-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      pointer-events: none;
      background: rgba(0,0,0,0.5);
      transition: opacity 350ms ease;
    }
    .p15-hint-overlay.p15-hint-fade { opacity: 0; }
    .p15-hint-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 20px 26px 16px;
      background: rgba(15,23,42,0.9);
      border: 1px solid rgba(56,189,248,0.4);
      border-radius: 14px;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .p15-hint-title {
      font-family: var(--font-mono, monospace);
      font-size: clamp(16px, 4vw, 20px);
      font-weight: bold;
      letter-spacing: 3px;
      color: #38bdf8;
      text-shadow: 0 0 14px rgba(56,189,248,0.8);
    }
    .p15-hint-sub {
      font-family: var(--font-mono, monospace);
      font-size: clamp(10px, 2.5vw, 12px);
      color: #64748b;
      letter-spacing: 1px;
      text-align: center;
    }
    /* Rank card (reuse shell styles if present, fallback here) */
    .rank-card {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 12px;
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      color: #94a3b8;
    }
    .rank-card-title { font-size: 14px; color: #38bdf8; margin-bottom: 4px; }
    .rank-card-delta { font-size: 11px; color: #64748b; margin-bottom: 6px; }
    .rank-card-btn {
      min-height: 36px;
      font-size: 11px;
      letter-spacing: 1px;
    }
  `;
  document.head.appendChild(style);
}

// ---------- rank card helper ----------

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

// ---------- timer util ----------

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------- mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("p15-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // Viewport cap guard — fail gracefully on tiny containers
  if (container.clientWidth < 8 || container.clientHeight < 8) {
    return function cleanup() {
      container.classList.remove("p15-root");
      container.style.touchAction = prevTouchAction;
    };
  }

  // --- state ---
  let board: Board = solvedBoard();
  let phase: Phase = "playing";
  let moves = 0;
  let elapsed = 0;
  let bestMoves = 0;
  let prevBoard: Board | null = null;
  let prevMoves = 0;
  let inputLocked = false;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let timerRunning = false;
  let hintOverlay: HTMLElement | null = null;
  let activeOverlay: HTMLElement | null = null;

  // --- layout ---
  const wrap = document.createElement("div");
  wrap.className = "p15-wrap";
  container.appendChild(wrap);

  // HUD top
  const hudTop = document.createElement("div");
  hudTop.className = "p15-hud-top";
  hudTop.innerHTML = `
    <div class="p15-stat"><span class="p15-stat-label">TIMER</span><span class="p15-stat-val" id="p15-timer">00:00</span></div>
    <div class="p15-stat"><span class="p15-stat-label">MOVES</span><span class="p15-stat-val" id="p15-moves">0</span></div>
    <div class="p15-stat"><span class="p15-stat-label">BEST</span><span class="p15-stat-val" id="p15-best">-</span></div>
  `;
  wrap.appendChild(hudTop);

  const timerEl = hudTop.querySelector("#p15-timer") as HTMLElement;
  const movesEl = hudTop.querySelector("#p15-moves") as HTMLElement;
  const bestEl = hudTop.querySelector("#p15-best") as HTMLElement;

  // Grid area
  const gridArea = document.createElement("div");
  gridArea.className = "p15-grid-area";
  wrap.appendChild(gridArea);

  const grid = document.createElement("div");
  grid.className = "p15-grid";
  gridArea.appendChild(grid);

  // HUD bottom
  const hudBottom = document.createElement("div");
  hudBottom.className = "p15-hud-bottom";
  wrap.appendChild(hudBottom);

  const newBtn = document.createElement("button");
  newBtn.className = "p15-btn p15-btn-wide";
  newBtn.textContent = "NEW GAME";

  const undoBtn = document.createElement("button");
  undoBtn.className = "p15-btn";
  undoBtn.textContent = "↶";
  undoBtn.setAttribute("aria-label", "Undo");
  undoBtn.disabled = true;

  const fsBtn = document.createElement("button");
  fsBtn.className = "p15-btn";
  fsBtn.textContent = "⛶";
  fsBtn.setAttribute("aria-label", "Fullscreen");

  hudBottom.appendChild(newBtn);
  hudBottom.appendChild(undoBtn);
  hudBottom.appendChild(fsBtn);

  // Cell DOM elements (index 0..15)
  const cells: HTMLElement[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const cell = document.createElement("div");
    grid.appendChild(cell);
    cells.push(cell);
  }

  // --- timer ---
  function startTimer(): void {
    if (timerRunning) return;
    timerRunning = true;
    timerInterval = setInterval(() => {
      elapsed++;
      timerEl.textContent = fmtTime(elapsed);
      void saveState({ board, moves, elapsed, savedAt: Date.now() });
    }, 1000);
  }

  function stopTimer(): void {
    timerRunning = false;
    if (timerInterval !== null) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // --- render ---
  function renderBoard(): void {
    const emptyIdx = board.indexOf(0);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const val = board[i]!;
      const cell = cells[i]!;
      if (val === 0) {
        cell.className = "p15-cell p15-cell-empty";
        cell.textContent = "";
      } else {
        cell.className = "p15-cell p15-cell-tile";
        cell.textContent = String(val);
        // Mark legal slides differently
        const isAdj = adjacentIndices(emptyIdx).includes(i);
        if (isAdj) {
          cell.classList.add("p15-legal");
        }
      }
    }
  }

  // --- slide logic ---
  function trySlide(tileIdx: number): void {
    if (inputLocked || phase !== "playing") return;
    const emptyIdx = board.indexOf(0);
    const neighbors = adjacentIndices(emptyIdx);

    if (!neighbors.includes(tileIdx)) {
      // Illegal tap — shake + vibrate
      const cell = cells[tileIdx]!;
      cell.classList.remove("p15-shake");
      void cell.offsetWidth; // reflow to restart animation
      cell.classList.add("p15-shake");
      cell.addEventListener("animationend", () => cell.classList.remove("p15-shake"), { once: true });
      playSfx("error");
      navigator.vibrate?.(4);
      return;
    }

    // Valid slide
    playSfx("slide");
    navigator.vibrate?.(6);

    // Dismiss hint on first valid move
    if (hintOverlay) dismissHint();

    // Start timer on first move
    if (moves === 0 && elapsed === 0) startTimer();

    // Undo snapshot
    prevBoard = board.slice() as Board;
    prevMoves = moves;
    undoBtn.disabled = false;

    // Determine animation direction:
    // tile moves toward the empty cell
    const tileRow = Math.floor(tileIdx / SIZE);
    const tileCol = tileIdx % SIZE;
    const emptyRow = Math.floor(emptyIdx / SIZE);
    const emptyCol = emptyIdx % SIZE;

    let animClass = "";
    if (tileRow < emptyRow) animClass = "p15-anim-down";
    else if (tileRow > emptyRow) animClass = "p15-anim-up";
    else if (tileCol < emptyCol) animClass = "p15-anim-right";
    else animClass = "p15-anim-left";

    // Swap in board
    board[emptyIdx] = board[tileIdx]!;
    board[tileIdx] = 0;
    moves++;
    movesEl.textContent = String(moves);

    // Animate the tile cell
    inputLocked = true;
    const tileCell = cells[tileIdx]!;
    tileCell.classList.add(animClass);
    tileCell.addEventListener("animationend", () => {
      tileCell.classList.remove(animClass);
      renderBoard();
      inputLocked = false;

      // Check win
      if (isSolved(board)) {
        handleWin();
      } else {
        void saveState({ board, moves, elapsed, savedAt: Date.now() });
      }
    }, { once: true });

    // Safety: if animationend doesn't fire within LOCK_MS*2, unlock anyway
    setTimeout(() => {
      if (inputLocked) {
        tileCell.classList.remove(animClass);
        renderBoard();
        inputLocked = false;
        if (isSolved(board)) handleWin();
      }
    }, LOCK_MS * 2);
  }

  function handleWin(): void {
    stopTimer();
    phase = "won";
    const score = calcScore(moves, elapsed);
    playSfx("win");
    navigator.vibrate?.([30, 60, 30, 60, 100]);
    void clearSaved();
    void submit("15puzzle", score);
    void personalBest("15puzzle").then((pb) => {
      if (score > 0 && score >= pb) {
        bestMoves = moves;
        updateBestDisplay();
      }
    });
    showWinOverlay(score);
  }

  function updateBestDisplay(): void {
    if (bestMoves > 0) {
      bestEl.textContent = `${bestMoves}M`;
    }
  }

  // --- new game ---
  function startNewGame(): void {
    stopTimer();
    phase = "playing";
    board = scramble(80);
    moves = 0;
    elapsed = 0;
    prevBoard = null;
    prevMoves = 0;
    inputLocked = false;
    timerRunning = false;
    undoBtn.disabled = true;
    movesEl.textContent = "0";
    timerEl.textContent = "00:00";
    renderBoard();
    void saveState({ board, moves, elapsed, savedAt: Date.now() });
  }

  // --- undo ---
  function doUndo(): void {
    if (!prevBoard || inputLocked || phase !== "playing") return;
    board = prevBoard.slice() as Board;
    moves = prevMoves;
    prevBoard = null;
    undoBtn.disabled = true;
    movesEl.textContent = String(moves);
    renderBoard();
    void saveState({ board, moves, elapsed, savedAt: Date.now() });
  }

  // --- overlays ---
  function showWinOverlay(score: number): void {
    const ov = document.createElement("div");
    ov.className = "p15-overlay";
    ov.innerHTML = `
      <div class="p15-overlay-box">
        <h2 class="p15-ov-title">CONGRATULAZIONI!</h2>
        <div class="p15-ov-row">Tempo: ${fmtTime(elapsed)}</div>
        <div class="p15-ov-row">Mosse: ${moves}</div>
        <div class="p15-ov-score">${score}</div>
        <div class="p15-ov-label">SCORE</div>
        <div class="p15-ov-actions">
          <button class="btn primary p15-ov-btn" id="p15-ov-new">NEW GAME</button>
          <button class="btn p15-ov-btn" id="p15-ov-menu">MENU</button>
        </div>
      </div>
    `;
    gridArea.appendChild(ov);
    activeOverlay = ov;
    ov.querySelector("#p15-ov-new")?.addEventListener("pointerup", () => {
      ov.remove();
      activeOverlay = null;
      startNewGame();
    });
    ov.querySelector("#p15-ov-menu")?.addEventListener("pointerup", () => {
      navigate("/");
    });

    // Async rank card
    void computeRank("15puzzle", score).then((rank) => {
      if (!rank) return;
      const box = ov.querySelector(".p15-overlay-box");
      const actions = ov.querySelector(".p15-ov-actions");
      if (!box || !actions) return;
      box.insertBefore(buildRankCard(rank, "15puzzle"), actions);
    });
  }

  function showNewGameConfirm(): void {
    if (activeOverlay) return;
    const ov = document.createElement("div");
    ov.className = "p15-overlay";
    ov.innerHTML = `
      <div class="p15-overlay-box">
        <h2 class="p15-ov-title" style="color:#f59e0b">NEW GAME?</h2>
        <div class="p15-ov-label" style="margin-bottom:18px">Il progresso andrà perso.</div>
        <div class="p15-ov-actions">
          <button class="btn primary p15-ov-btn" id="p15-ng-yes">YES</button>
          <button class="btn p15-ov-btn" id="p15-ng-no">CANCEL</button>
        </div>
      </div>
    `;
    gridArea.appendChild(ov);
    activeOverlay = ov;
    ov.querySelector("#p15-ng-yes")?.addEventListener("pointerup", () => {
      ov.remove();
      activeOverlay = null;
      startNewGame();
    });
    ov.querySelector("#p15-ng-no")?.addEventListener("pointerup", () => {
      ov.remove();
      activeOverlay = null;
    });
  }

  // --- hint overlay ---
  function buildHintOverlay(): HTMLElement {
    const ov = document.createElement("div");
    ov.className = "p15-hint-overlay";
    ov.innerHTML = `
      <div class="p15-hint-box">
        <div class="p15-hint-title">TAP TO SLIDE</div>
        <div class="p15-hint-sub">Arrange 1–15 in order.</div>
      </div>
    `;
    gridArea.appendChild(ov);
    return ov;
  }

  function dismissHint(): void {
    if (!hintOverlay) return;
    hintOverlay.classList.add("p15-hint-fade");
    setTimeout(() => {
      hintOverlay?.remove();
      hintOverlay = null;
    }, 350);
    void markHintSeen();
  }

  // --- input ---
  function onPointerUp(e: PointerEvent): void {
    if (activeOverlay || phase !== "playing") return;
    const target = e.target as HTMLElement;
    const cell = target.closest(".p15-cell") as HTMLElement | null;
    if (!cell) return;
    const idx = cells.indexOf(cell);
    if (idx === -1) return;
    trySlide(idx);
  }

  // Keyboard support (desktop bonus)
  function onKeyDown(e: KeyboardEvent): void {
    if (activeOverlay || phase !== "playing" || inputLocked) return;
    const emptyIdx = board.indexOf(0);
    const emptyRow = Math.floor(emptyIdx / SIZE);
    const emptyCol = emptyIdx % SIZE;
    let tileIdx = -1;
    switch (e.key) {
      case "ArrowUp":    tileIdx = emptyRow < SIZE - 1 ? emptyIdx + SIZE : -1; break;
      case "ArrowDown":  tileIdx = emptyRow > 0 ? emptyIdx - SIZE : -1; break;
      case "ArrowLeft":  tileIdx = emptyCol < SIZE - 1 ? emptyIdx + 1 : -1; break;
      case "ArrowRight": tileIdx = emptyCol > 0 ? emptyIdx - 1 : -1; break;
    }
    if (tileIdx !== -1) {
      e.preventDefault();
      trySlide(tileIdx);
    }
  }

  grid.addEventListener("pointerup", onPointerUp);
  document.addEventListener("keydown", onKeyDown);

  // --- buttons ---
  newBtn.addEventListener("pointerup", () => {
    if (phase === "won" || moves === 0) {
      startNewGame();
    } else {
      showNewGameConfirm();
    }
  });

  undoBtn.addEventListener("pointerup", doUndo);

  fsBtn.addEventListener("pointerup", () => {
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen().catch(() => {});
    }
  });

  // --- load personal best ---
  void personalBest("15puzzle").then((pb) => {
    if (pb > 0) {
      // Best is stored as score; derive moves approximation for display
      // Show raw score in BEST field
      bestEl.textContent = String(pb);
    }
  });

  // --- restore or start fresh ---
  void loadSaved().then(async (saved) => {
    if (saved) {
      board = saved.board;
      moves = saved.moves;
      // Compensate for time passed while app was closed (cap at +5min to avoid runaway)
      const dormant = Math.min(Math.floor((Date.now() - saved.savedAt) / 1000), 300);
      elapsed = saved.elapsed + dormant;
      movesEl.textContent = String(moves);
      timerEl.textContent = fmtTime(elapsed);
      renderBoard();
      if (moves > 0) {
        startTimer();
        undoBtn.disabled = true; // undo not available after restore
      }
    } else {
      startNewGame();
    }

    if (!saved) {
      const seen = await hasSeenHint();
      if (!seen) {
        hintOverlay = buildHintOverlay();
        setTimeout(() => dismissHint(), 5000);
      }
    }
  });

  // --- cleanup ---
  return function cleanup(): void {
    stopTimer();
    document.removeEventListener("keydown", onKeyDown);
    grid.removeEventListener("pointerup", onPointerUp);
    container.innerHTML = "";
    container.classList.remove("p15-root");
    container.style.touchAction = prevTouchAction;
  };
}
