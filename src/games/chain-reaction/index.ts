import { db } from "../../lib/storage.js";
import { navigate } from "../../lib/router.js";
import { playSfx } from "../../lib/audio.js";

// ── Constants ────────────────────────────────────────────────────────────────

const COLS = 6;
const ROWS = 9;
const COLOR_P1 = "#22ddff";
const COLOR_P2 = "#ff3344";
const COLOR_BG = "#0a0a2a";
const EXPLODE_STEP_MS = 180;
const HINT_DISMISS_MS = 6000;

// ── Types ─────────────────────────────────────────────────────────────────────

type Owner = 0 | 1 | 2;

interface CellState {
  owner: Owner;
  orbs: number;
}

type Phase = "hint" | "playing" | "exploding" | "gameover";

// ── Capacity ──────────────────────────────────────────────────────────────────

function capacity(idx: number): number {
  const col = idx % COLS;
  const row = Math.floor(idx / COLS);
  const isLeft = col === 0;
  const isRight = col === COLS - 1;
  const isTop = row === 0;
  const isBottom = row === ROWS - 1;
  const edgeCount = (isLeft ? 1 : 0) + (isRight ? 1 : 0) + (isTop ? 1 : 0) + (isBottom ? 1 : 0);
  // corner = 2 edges → cap 2; single edge → cap 3; inner → cap 4
  if (edgeCount >= 2) return 2;
  if (edgeCount === 1) return 3;
  return 4;
}

function neighbors(idx: number): number[] {
  const col = idx % COLS;
  const row = Math.floor(idx / COLS);
  const result: number[] = [];
  if (row > 0) result.push(idx - COLS);
  if (row < ROWS - 1) result.push(idx + COLS);
  if (col > 0) result.push(idx - 1);
  if (col < COLS - 1) result.push(idx + 1);
  return result;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

async function loadSeenHint(): Promise<boolean> {
  try {
    const row = await db.settings.get("chain-reaction:seenHint");
    return row?.value === "1";
  } catch { return false; }
}

async function markSeenHint(): Promise<void> {
  await db.settings.put({ key: "chain-reaction:seenHint", value: "1" });
}

// ── Cascade algorithm ─────────────────────────────────────────────────────────

function findUnstable(board: CellState[]): number[] {
  return board.reduce<number[]>((acc, cell, idx) => {
    if (cell.orbs >= capacity(idx)) acc.push(idx);
    return acc;
  }, []);
}

function applyExplosionStep(board: CellState[]): CellState[] {
  const unstable = findUnstable(board);
  if (unstable.length === 0) return board;
  const next = board.map(c => ({ ...c }));
  for (const idx of unstable) {
    const owner = next[idx]!.owner;
    next[idx]!.orbs = 0;
    next[idx]!.owner = 0;
    for (const nb of neighbors(idx)) {
      next[nb]!.orbs++;
      next[nb]!.owner = owner;
    }
  }
  return next;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function playerColor(p: 1 | 2): string { return p === 1 ? COLOR_P1 : COLOR_P2; }

function countOrbs(board: CellState[], player: 1 | 2): number {
  return board.reduce((sum, c) => sum + (c.owner === player ? c.orbs : 0), 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main builder ──────────────────────────────────────────────────────────────

function buildGame(container: HTMLElement, showHintFirst: boolean): () => void {

  // ── State ──────────────────────────────────────────────────────────────────

  let board: CellState[] = Array.from({ length: COLS * ROWS }, () => ({ owner: 0 as Owner, orbs: 0 }));
  let currentPlayer: 1 | 2 = 1;
  let phase: Phase = showHintFirst ? "hint" : "playing";
  let turnNumber = 0;

  // Timers for cleanup
  const timers: ReturnType<typeof setTimeout>[] = [];
  function addTimer(fn: () => void, ms: number): void {
    timers.push(setTimeout(fn, ms));
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  const root = document.createElement("div");
  root.className = "cr-game";

  // Score strip P2 (rotated)
  const scoreP2 = document.createElement("div");
  scoreP2.className = "cr-score-strip cr-score-p2";

  // Banner P2 (rotated)
  const bannerP2 = document.createElement("div");
  bannerP2.className = "cr-banner cr-banner-p2";

  // Board wrap
  const boardWrap = document.createElement("div");
  boardWrap.className = "cr-board-wrap";

  const boardEl = document.createElement("div");
  boardEl.className = "cr-board";
  boardEl.setAttribute("role", "grid");
  boardEl.setAttribute("aria-label", "Chain Reaction board");

  const cellEls: HTMLButtonElement[] = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const btn = document.createElement("button");
    btn.className = "cr-cell";
    btn.setAttribute("role", "gridcell");
    btn.dataset["idx"] = String(i);
    cellEls.push(btn);
    boardEl.appendChild(btn);
  }
  boardWrap.appendChild(boardEl);

  // Banner P1
  const bannerP1 = document.createElement("div");
  bannerP1.className = "cr-banner cr-banner-p1";

  // Score strip P1
  const scoreP1 = document.createElement("div");
  scoreP1.className = "cr-score-strip cr-score-p1";

  root.appendChild(scoreP2);
  root.appendChild(bannerP2);
  root.appendChild(boardWrap);
  root.appendChild(bannerP1);
  root.appendChild(scoreP1);

  container.appendChild(root);

  // ── Render helpers ────────────────────────────────────────────────────────

  function orbDots(count: number, color: string): string {
    // 1 orb: center; 2 orbs: horizontal pair; 3 orbs: triangle; 4 orbs: quad
    const r = 5;
    const positions: [number, number][] = [];
    if (count === 1) {
      positions.push([50, 50]);
    } else if (count === 2) {
      positions.push([30, 50], [70, 50]);
    } else if (count === 3) {
      positions.push([50, 28], [25, 68], [75, 68]);
    } else {
      positions.push([28, 28], [72, 28], [28, 72], [72, 72]);
    }
    return positions.map(([cx, cy]) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`
    ).join("");
  }

  function renderCell(idx: number): void {
    const btn = cellEls[idx];
    if (!btn) return;
    const cell = board[idx]!;
    const cap = capacity(idx);
    const isWarning = cell.orbs > 0 && cell.orbs >= cap - 1;
    const color = cell.owner === 1 ? COLOR_P1 : COLOR_P2;

    btn.classList.toggle("cr-cell-p1", cell.owner === 1);
    btn.classList.toggle("cr-cell-p2", cell.owner === 2);
    btn.classList.toggle("cr-cell-warning", isWarning && cell.owner !== 0);

    if (cell.orbs === 0) {
      btn.innerHTML = "";
    } else {
      const glowFilter = cell.owner === 1
        ? `drop-shadow(0 0 4px ${COLOR_P1})`
        : `drop-shadow(0 0 4px ${COLOR_P2})`;
      btn.innerHTML = `<svg viewBox="0 0 100 100" class="cr-orbs-svg" style="filter:${glowFilter}">
        ${orbDots(Math.min(cell.orbs, 4), color)}
      </svg>`;
    }
  }

  function renderAll(): void {
    for (let i = 0; i < COLS * ROWS; i++) renderCell(i);
  }

  function updateScores(): void {
    const c1 = countOrbs(board, 1);
    const c2 = countOrbs(board, 2);
    scoreP1.textContent = `P1: ${c1} orbs`;
    scoreP2.textContent = `P2: ${c2} orbs`;
  }

  function updateBanners(): void {
    const text = `TURNO: P${currentPlayer}`;
    bannerP1.textContent = text;
    bannerP2.textContent = text;
    const col = playerColor(currentPlayer);
    bannerP1.style.color = col;
    bannerP2.style.color = col;
    root.classList.toggle("cr-turn-p1", currentPlayer === 1);
    root.classList.toggle("cr-turn-p2", currentPlayer === 2);
  }

  // ── Explosion animation ───────────────────────────────────────────────────

  function flashCell(idx: number): void {
    const btn = cellEls[idx];
    if (!btn) return;
    btn.classList.add("cr-flash");
    addTimer(() => btn.classList.remove("cr-flash"), 250);
  }

  function pulseCell(idx: number): void {
    const btn = cellEls[idx];
    if (!btn) return;
    btn.classList.add("cr-pulse");
    addTimer(() => btn.classList.remove("cr-pulse"), 300);
  }

  // ── Cascade logic (async, with animation) ────────────────────────────────

  let popDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let chainCount = 0;

  async function runCascade(): Promise<void> {
    let steps = 0;
    while (true) {
      const unstable = findUnstable(board);
      if (unstable.length === 0) break;

      steps++;
      chainCount += unstable.length;

      // Flash exploding cells
      for (const idx of unstable) flashCell(idx);

      // Debounced pop SFX
      if (popDebounceTimer) clearTimeout(popDebounceTimer);
      popDebounceTimer = setTimeout(() => { playSfx("pop"); }, 50);

      navigator.vibrate?.(8);

      board = applyExplosionStep(board);
      renderAll();
      updateScores();

      await sleep(EXPLODE_STEP_MS);

      // Pulse receivers
      const nowUnstable = new Set(findUnstable(board).map(String));
      for (const nb of board.keys()) {
        if (board[nb]!.orbs > 0 && !nowUnstable.has(String(nb))) pulseCell(nb);
      }
    }

    if (chainCount >= 5) {
      playSfx("score");
      navigator.vibrate?.([30, 60, 30]);
    }
  }

  // ── Win check ─────────────────────────────────────────────────────────────

  function checkWin(): 1 | 2 | null {
    if (turnNumber < 2) return null;
    const c1 = countOrbs(board, 1);
    const c2 = countOrbs(board, 2);
    if (c1 === 0 && turnNumber >= 2) return 2;
    if (c2 === 0 && turnNumber >= 2) return 1;
    return null;
  }

  // ── Win overlay ───────────────────────────────────────────────────────────

  function showWinOverlay(winner: 1 | 2): void {
    phase = "gameover";
    const color = playerColor(winner);
    const c1 = countOrbs(board, 1);
    const c2 = countOrbs(board, 2);

    const overlay = document.createElement("div");
    overlay.className = "cr-overlay";
    overlay.innerHTML = `
      <div class="cr-overlay-box">
        <div class="cr-overlay-title" style="color:${color};text-shadow:0 0 20px ${color}">P${winner} VINCE!</div>
        <div class="cr-overlay-score">P1: ${c1} orbs — P2: ${c2} orbs</div>
        <div class="cr-overlay-actions">
          <button class="btn primary cr-ov-btn" id="cr-again">RIVINCITA</button>
          <button class="btn cr-ov-btn" id="cr-menu">MENU</button>
        </div>
      </div>
    `;
    boardWrap.appendChild(overlay);

    overlay.querySelector("#cr-again")?.addEventListener("pointerup", () => {
      overlay.remove();
      startGame();
    });
    overlay.querySelector("#cr-menu")?.addEventListener("pointerup", () => {
      navigate("/");
    });

    playSfx("win");
    navigator.vibrate?.([30, 60, 30, 60, 100]);
  }

  // ── Place orb (tap handler) ───────────────────────────────────────────────

  async function handleTap(idx: number): Promise<void> {
    if (phase !== "playing") return;

    const cell = board[idx]!;
    if (cell.owner !== 0 && cell.owner !== currentPlayer) {
      // Invalid tap: enemy cell
      playSfx("error");
      navigator.vibrate?.(5);
      const btn = cellEls[idx];
      btn?.classList.add("cr-shake");
      addTimer(() => btn?.classList.remove("cr-shake"), 300);
      return;
    }

    phase = "exploding";
    chainCount = 0;

    // Place orb
    board[idx] = { owner: currentPlayer, orbs: cell.orbs + 1 };
    renderCell(idx);
    updateScores();
    playSfx("place");
    navigator.vibrate?.(6);
    turnNumber++;

    // Run cascade
    await runCascade();

    // Check win
    const winner = checkWin();
    if (winner !== null) {
      showWinOverlay(winner);
      return;
    }

    // Switch player
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    phase = "playing";
    updateBanners();
  }

  // ── Game init ─────────────────────────────────────────────────────────────

  function startGame(): void {
    board = Array.from({ length: COLS * ROWS }, () => ({ owner: 0 as Owner, orbs: 0 }));
    currentPlayer = 1;
    phase = showHintFirst ? "hint" : "playing";
    turnNumber = 0;
    chainCount = 0;
    renderAll();
    updateScores();
    updateBanners();
  }

  // ── Event listener ────────────────────────────────────────────────────────

  boardEl.addEventListener("pointerup", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
    if (!target) return;
    const idx = parseInt(target.dataset["idx"] ?? "", 10);
    if (!isNaN(idx)) void handleTap(idx);
  });

  // ── Onboarding hint ───────────────────────────────────────────────────────

  let dismissHint: (() => void) | null = null;

  if (showHintFirst) {
    const hint = document.createElement("div");
    hint.className = "cr-hint";
    hint.innerHTML = `
      <div class="cr-hint-inner">
        <div class="cr-hint-big">TAP TO PLACE ORB</div>
        <div class="cr-hint-sub">Satura la cella per esplodere e conquistare le adiacenti</div>
      </div>
    `;
    hint.style.pointerEvents = "none";
    container.appendChild(hint);

    let dismissed = false;
    function doDissmiss(): void {
      if (dismissed) return;
      dismissed = true;
      hint.remove();
      phase = "playing";
      void markSeenHint();
      dismissHint = null;
    }

    const hintTimer = setTimeout(doDissmiss, HINT_DISMISS_MS);

    const onFirstValidTap = (): void => {
      clearTimeout(hintTimer);
      boardEl.removeEventListener("pointerup", onFirstValidTap);
      doDissmiss();
    };
    boardEl.addEventListener("pointerup", onFirstValidTap);

    dismissHint = () => {
      clearTimeout(hintTimer);
      hint.remove();
      dismissed = true;
      dismissHint = null;
    };
  }

  startGame();

  // ── Cleanup ───────────────────────────────────────────────────────────────

  return function cleanup(): void {
    for (const t of timers) clearTimeout(t);
    if (popDebounceTimer) clearTimeout(popDebounceTimer);
    dismissHint?.();
    root.remove();
  };
}

// ── Mount (shell contract) ────────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.classList.add("cr-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  let cleanupGame: (() => void) | null = null;

  void (async () => {
    const seenHint = await loadSeenHint();
    cleanupGame = buildGame(container, !seenHint);
  })();

  return function cleanup(): void {
    cleanupGame?.();
    container.innerHTML = "";
    container.classList.remove("cr-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles(): void {
  const id = "cr-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .cr-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: ${COLOR_BG};
      user-select: none;
      -webkit-user-select: none;
    }

    .cr-game {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      box-sizing: border-box;
      --p1-glow: transparent;
      --p2-glow: transparent;
    }

    /* ── Score strips ─────────────────────────────────────────────────── */
    .cr-score-strip {
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 1px;
      color: rgba(255,255,255,0.75);
      padding: 2px 0;
      height: 30px;
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .cr-score-p2 { transform: rotate(180deg); }

    /* ── Banners ──────────────────────────────────────────────────────── */
    .cr-banner {
      font-family: monospace;
      font-size: clamp(10px, 2.8vw, 14px);
      font-weight: bold;
      letter-spacing: 2px;
      padding: 4px 10px;
      border-radius: 6px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: color 0.2s, box-shadow 0.3s;
    }
    .cr-banner-p2 {
      transform: rotate(180deg);
      box-shadow: 0 0 0 2px var(--p2-glow), 0 0 12px var(--p2-glow);
    }
    .cr-banner-p1 {
      box-shadow: 0 0 0 2px var(--p1-glow), 0 0 12px var(--p1-glow);
    }
    .cr-turn-p1 { --p1-glow: ${COLOR_P1}; --p2-glow: transparent; }
    .cr-turn-p2 { --p2-glow: ${COLOR_P2}; --p1-glow: transparent; }

    /* ── Board ────────────────────────────────────────────────────────── */
    .cr-board-wrap {
      position: relative;
      flex: 1;
      min-height: 0;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cr-board {
      display: grid;
      grid-template-columns: repeat(${COLS}, 1fr);
      grid-template-rows: repeat(${ROWS}, 1fr);
      gap: 3px;
      padding: 4px;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      box-sizing: border-box;
      /* Keep 6:9 aspect ratio, fit within the flex area */
      width: min(calc((100vh - 160px) * 6 / 9), calc(100vw - 16px));
      aspect-ratio: 6 / 9;
      max-width: 320px;
    }

    /* ── Cells ────────────────────────────────────────────────────────── */
    .cr-cell {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      min-width: 0;
      min-height: 0;
      padding: 4%;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      transition: background 0.1s, border-color 0.15s;
      box-sizing: border-box;
    }
    .cr-cell:active { background: rgba(255,255,255,0.08); }
    .cr-cell:disabled { cursor: default; }
    .cr-cell-p1 { border-color: ${COLOR_P1}44; }
    .cr-cell-p2 { border-color: ${COLOR_P2}44; }

    /* Warning: about to explode */
    @keyframes cr-warning-pulse {
      0%,100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.04); opacity: 0.82; }
    }
    .cr-cell-warning { animation: cr-warning-pulse 0.7s ease-in-out infinite; }

    /* ── Orb SVG ──────────────────────────────────────────────────────── */
    .cr-orbs-svg {
      width: 82%;
      height: 82%;
      display: block;
    }

    /* ── Flash (explode) ──────────────────────────────────────────────── */
    @keyframes cr-flash {
      0% { background: rgba(255,255,255,0.85); }
      100% { background: rgba(255,255,255,0.03); }
    }
    .cr-flash { animation: cr-flash 0.25s ease-out; }

    /* ── Pulse (receive orb) ──────────────────────────────────────────── */
    @keyframes cr-pulse-anim {
      0%   { transform: scale(1); }
      40%  { transform: scale(1.12); }
      100% { transform: scale(1); }
    }
    .cr-pulse { animation: cr-pulse-anim 0.3s ease; }

    /* ── Shake (invalid tap) ──────────────────────────────────────────── */
    @keyframes cr-shake {
      0%,100% { transform: translateX(0); }
      25% { transform: translateX(-4px); }
      75% { transform: translateX(4px); }
    }
    .cr-shake { animation: cr-shake 0.25s ease; }

    /* ── Win overlay ──────────────────────────────────────────────────── */
    .cr-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(10,10,42,0.90);
      border-radius: 8px;
      z-index: 10;
    }
    .cr-overlay-box {
      text-align: center;
      padding: 28px 22px;
    }
    .cr-overlay-title {
      font-family: monospace;
      font-size: clamp(20px, 6vw, 30px);
      font-weight: bold;
      letter-spacing: 4px;
      margin-bottom: 12px;
    }
    .cr-overlay-score {
      font-family: monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.55);
      letter-spacing: 1px;
      margin-bottom: 22px;
    }
    .cr-overlay-actions { display: flex; gap: 12px; justify-content: center; }
    .cr-ov-btn { min-width: 96px; min-height: 44px; font-family: monospace; font-size: 12px; letter-spacing: 1px; }

    /* ── Onboarding hint ──────────────────────────────────────────────── */
    .cr-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 15;
      pointer-events: none;
      animation: cr-hint-in 0.35s ease;
    }
    @keyframes cr-hint-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .cr-hint-inner {
      background: rgba(0,0,0,0.80);
      border-radius: 10px;
      padding: 22px 28px;
      text-align: center;
      pointer-events: auto;
    }
    .cr-hint-big {
      font-family: monospace;
      font-size: 18px;
      font-weight: bold;
      color: #ff44aa;
      letter-spacing: 3px;
      margin-bottom: 8px;
    }
    .cr-hint-sub {
      font-family: monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.7);
      letter-spacing: 0.5px;
      line-height: 1.5;
      max-width: 220px;
    }
  `;
  document.head.appendChild(style);
}
