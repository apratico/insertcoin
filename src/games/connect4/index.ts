import { db } from "../../lib/storage.js";
import { navigate } from "../../lib/router.js";
import { playSfx } from "../../lib/audio.js";

// ── Constants ────────────────────────────────────────────────────────────────

const COLS = 7;
const ROWS = 6;

const COLOR_P1   = "#ffcc00";   // yellow
const COLOR_P2   = "#ff3333";   // red
const COLOR_BG   = "#0a1a2a";
const COLOR_TIE  = "#aaaacc";
const COLOR_CELL = "#0d2238";
const COLOR_BORDER = "rgba(255,255,255,0.10)";

// ── Types ────────────────────────────────────────────────────────────────────

type Cell  = 0 | 1 | 2;
type Phase = "hint" | "playing" | "dropping" | "roundover";

interface Coord { col: number; row: number; }
interface MatchScore { p1: number; p2: number; tie: number; }

// ── Storage helpers ──────────────────────────────────────────────────────────

async function loadNames(): Promise<{ p1: string; p2: string }> {
  try {
    const row = await db.settings.get("connect4:names");
    if (row) return JSON.parse(row.value) as { p1: string; p2: string };
  } catch { /* ignore */ }
  return { p1: "P1", p2: "P2" };
}

async function loadSeenHint(): Promise<boolean> {
  try {
    const row = await db.settings.get("connect4:seenHint");
    return row?.value === "1";
  } catch { return false; }
}

async function markSeenHint(): Promise<void> {
  await db.settings.put({ key: "connect4:seenHint", value: "1" });
}

// ── Win detection ────────────────────────────────────────────────────────────

function checkWin(board: Cell[][], player: 1 | 2): Coord[] | null {
  // horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      if (
        board[c]![r] === player &&
        board[c + 1]![r] === player &&
        board[c + 2]![r] === player &&
        board[c + 3]![r] === player
      ) {
        return [
          { col: c, row: r }, { col: c + 1, row: r },
          { col: c + 2, row: r }, { col: c + 3, row: r },
        ];
      }
    }
  }
  // vertical
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      if (
        board[c]![r] === player &&
        board[c]![r + 1] === player &&
        board[c]![r + 2] === player &&
        board[c]![r + 3] === player
      ) {
        return [
          { col: c, row: r }, { col: c, row: r + 1 },
          { col: c, row: r + 2 }, { col: c, row: r + 3 },
        ];
      }
    }
  }
  // diagonal ↘ (col++, row++)
  for (let c = 0; c <= COLS - 4; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      if (
        board[c]![r] === player &&
        board[c + 1]![r + 1] === player &&
        board[c + 2]![r + 2] === player &&
        board[c + 3]![r + 3] === player
      ) {
        return [
          { col: c, row: r }, { col: c + 1, row: r + 1 },
          { col: c + 2, row: r + 2 }, { col: c + 3, row: r + 3 },
        ];
      }
    }
  }
  // diagonal ↙ (col--, row++)
  for (let c = COLS - 1; c >= 3; c--) {
    for (let r = 0; r <= ROWS - 4; r++) {
      if (
        board[c]![r] === player &&
        board[c - 1]![r + 1] === player &&
        board[c - 2]![r + 2] === player &&
        board[c - 3]![r + 3] === player
      ) {
        return [
          { col: c, row: r }, { col: c - 1, row: r + 1 },
          { col: c - 2, row: r + 2 }, { col: c - 3, row: r + 3 },
        ];
      }
    }
  }
  return null;
}

function isBoardFull(board: Cell[][]): boolean {
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (board[c]![r] === 0) return false;
    }
  }
  return true;
}

// ── Onboarding hint ──────────────────────────────────────────────────────────

function showHint(container: HTMLElement, onDismiss: () => void): () => void {
  const hint = document.createElement("div");
  hint.className = "c4-hint";
  hint.innerHTML = `
    <div class="c4-hint-inner">
      <div class="c4-hint-big">TAP A COLUMN TO DROP</div>
      <div class="c4-hint-line">Passa il telefono. 4 di fila vince.</div>
    </div>
  `;
  container.appendChild(hint);

  let dismissed = false;
  function dismiss(): void {
    if (dismissed) return;
    dismissed = true;
    hint.remove();
    void markSeenHint();
    onDismiss();
  }

  const timer = setTimeout(dismiss, 5000);
  hint.addEventListener("pointerup", () => { clearTimeout(timer); dismiss(); });

  return () => { clearTimeout(timer); hint.remove(); dismissed = true; };
}

// ── Game builder ─────────────────────────────────────────────────────────────

function buildGame(
  container: HTMLElement,
  p1Name: string,
  p2Name: string,
  showHintFirst: boolean
): () => void {
  // board[col][row], row 0 = bottom
  let board: Cell[][] = Array.from({ length: COLS }, () => Array(ROWS).fill(0) as Cell[]);
  let currentPlayer: 1 | 2 = 1;
  let phase: Phase = "playing";
  const score: MatchScore = { p1: 0, p2: 0, tie: 0 };

  // ── DOM structure ─────────────────────────────────────────────────────────

  const root = document.createElement("div");
  root.className = "c4-game";

  // Score strip P2 (rotated)
  const scoreP2 = document.createElement("div");
  scoreP2.className = "c4-score-strip c4-score-p2";
  scoreP2.innerHTML = buildScoreHtml();

  // Banner P2 (top, rotated 180°)
  const bannerP2 = document.createElement("div");
  bannerP2.className = "c4-banner c4-banner-p2";

  // Board area
  const boardWrap = document.createElement("div");
  boardWrap.className = "c4-board-wrap";

  // Pending-disc row (hover indicators) above the board
  const pendingRow = document.createElement("div");
  pendingRow.className = "c4-pending-row";
  const pendingDiscs: HTMLDivElement[] = [];
  for (let c = 0; c < COLS; c++) {
    const pd = document.createElement("div");
    pd.className = "c4-pending";
    pd.dataset["col"] = String(c);
    pendingDiscs.push(pd);
    pendingRow.appendChild(pd);
  }

  // Board grid (ROWS rows displayed top-to-bottom, row ROWS-1 = bottom)
  const boardEl = document.createElement("div");
  boardEl.className = "c4-board";
  boardEl.setAttribute("role", "grid");
  boardEl.setAttribute("aria-label", "4 in Fila board");

  // cellEls[col][row] — row 0 = bottom, rendered at grid row ROWS-1-row
  const cellEls: HTMLDivElement[][] = Array.from({ length: COLS }, () => Array(ROWS).fill(null) as HTMLDivElement[]);

  for (let r = ROWS - 1; r >= 0; r--) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "c4-cell";
      cell.dataset["col"] = String(c);
      cell.dataset["row"] = String(r);
      cellEls[c]![r] = cell;
      boardEl.appendChild(cell);
    }
  }

  boardWrap.appendChild(pendingRow);
  boardWrap.appendChild(boardEl);

  // Banner P1 (bottom)
  const bannerP1 = document.createElement("div");
  bannerP1.className = "c4-banner c4-banner-p1";

  // Score strip P1
  const scoreP1 = document.createElement("div");
  scoreP1.className = "c4-score-strip c4-score-p1";
  scoreP1.innerHTML = buildScoreHtml();

  root.appendChild(scoreP2);
  root.appendChild(bannerP2);
  root.appendChild(boardWrap);
  root.appendChild(bannerP1);
  root.appendChild(scoreP1);

  container.appendChild(root);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function playerName(p: 1 | 2): string { return p === 1 ? p1Name : p2Name; }
  function playerColor(p: 1 | 2): string { return p === 1 ? COLOR_P1 : COLOR_P2; }

  function buildScoreHtml(): string {
    return `
      <span class="c4-sc c4-sc-p1">P1: 0</span>
      <span class="c4-sc c4-sc-tie">TIE: 0</span>
      <span class="c4-sc c4-sc-p2">P2: 0</span>
    `;
  }

  function updateBanners(): void {
    const text = `TURNO: ${playerName(currentPlayer)}`;
    bannerP1.textContent = text;
    bannerP2.textContent = text;
    bannerP1.style.color = playerColor(currentPlayer);
    bannerP2.style.color = playerColor(currentPlayer);

    root.style.setProperty("--p1-glow", currentPlayer === 1 ? COLOR_P1 : "transparent");
    root.style.setProperty("--p2-glow", currentPlayer === 2 ? COLOR_P2 : "transparent");
    root.classList.toggle("c4-turn-p1", currentPlayer === 1);
    root.classList.toggle("c4-turn-p2", currentPlayer === 2);
  }

  function updateScoreDisplay(): void {
    root.querySelectorAll<HTMLElement>(".c4-sc-p1").forEach(el => {
      el.textContent = `P1: ${score.p1}`;
    });
    root.querySelectorAll<HTMLElement>(".c4-sc-p2").forEach(el => {
      el.textContent = `P2: ${score.p2}`;
    });
    root.querySelectorAll<HTMLElement>(".c4-sc-tie").forEach(el => {
      el.textContent = `TIE: ${score.tie}`;
    });
  }

  function updatePendingDiscs(): void {
    const color = playerColor(currentPlayer);
    pendingDiscs.forEach((pd, c) => {
      const isFull = board[c]![ROWS - 1] !== 0;
      pd.style.background = isFull ? "transparent" : color;
      pd.style.boxShadow = isFull ? "none" : `0 0 10px ${color}88`;
      pd.style.opacity = isFull ? "0.15" : "0.85";
    });
  }

  function renderCell(col: number, row: number): void {
    const cell = cellEls[col]![row];
    if (!cell) return;
    const val = board[col]![row];
    cell.classList.toggle("c4-cell-p1", val === 1);
    cell.classList.toggle("c4-cell-p2", val === 2);
  }

  // ── Drop animation ────────────────────────────────────────────────────────
  // Strategy: create a flying disc element that starts above the board and
  // transitions down to the target row position, then commits to the grid.

  function dropDisc(col: number, targetRow: number, player: 1 | 2, onLand: () => void): void {
    const color = playerColor(player);

    // Measure slot dimensions from the target cell
    const targetCell = cellEls[col]![targetRow];
    if (!targetCell) { onLand(); return; }

    const boardRect = boardEl.getBoundingClientRect();
    const cellRect  = targetCell.getBoundingClientRect();

    if (boardRect.width < 8 || boardRect.height < 8) { onLand(); return; }

    const cellSize = cellRect.width;
    const cellLeft = cellRect.left - boardRect.left;

    const cellTop = cellRect.top - boardRect.top;

    // Start just above the board (negative offset from board top)
    const startTop = -cellSize - 4;

    const disc = document.createElement("div");
    disc.className = "c4-flying-disc";
    disc.style.cssText = `
      position: absolute;
      width: ${cellSize - 8}px;
      height: ${cellSize - 8}px;
      border-radius: 50%;
      background: ${color};
      box-shadow: 0 0 12px ${color}cc;
      left: ${cellLeft + 4}px;
      top: ${startTop}px;
      pointer-events: none;
      z-index: 5;
    `;

    boardEl.style.position = "relative";
    boardEl.appendChild(disc);

    // Distance in px from startTop to cellTop
    const distance = cellTop - startTop;
    // Duration: proportional to distance, 150ms minimum, 320ms max
    const duration = Math.min(320, Math.max(150, distance * 0.6));

    // Force reflow so the browser registers the start position
    disc.getBoundingClientRect();

    disc.style.transition = `top ${duration}ms cubic-bezier(0.55, 0, 1, 1)`;
    disc.style.top = `${cellTop + 4}px`;

    const onEnd = (): void => {
      disc.remove();
      // Mark cell as filled
      board[col]![targetRow] = player;
      renderCell(col, targetRow);
      onLand();
    };

    disc.addEventListener("transitionend", onEnd, { once: true });
    // Safety timeout in case transitionend fires oddly
    setTimeout(onEnd, duration + 60);
  }

  // ── Column tap ────────────────────────────────────────────────────────────

  function findDropRow(col: number): number {
    // row 0 = bottom. Find lowest empty row (first 0 from bottom).
    for (let r = 0; r < ROWS; r++) {
      if (board[col]![r] === 0) return r;
    }
    return -1; // column full
  }

  function handleColTap(col: number): void {
    if (phase !== "playing") return;

    const row = findDropRow(col);
    if (row === -1) {
      navigator.vibrate?.(5);
      // shake the pending disc in that column
      const pd = pendingDiscs[col];
      if (pd) {
        pd.classList.add("c4-pending-shake");
        setTimeout(() => pd.classList.remove("c4-pending-shake"), 300);
      }
      return;
    }

    phase = "dropping";
    playSfx("place");
    navigator.vibrate?.(8);

    dropDisc(col, row, currentPlayer, () => {
      if (phase !== "dropping") return; // cleanup already ran

      const winner = currentPlayer;
      const winCoords = checkWin(board, winner);

      if (winCoords) {
        if (winner === 1) score.p1++;
        else score.p2++;
        updateScoreDisplay();
        playSfx("win");
        navigator.vibrate?.([40, 40, 100]);
        highlightWin(winCoords, playerColor(winner));
        setTimeout(() => showRoundOverlay(winner), 700);
        phase = "roundover";
        return;
      }

      if (isBoardFull(board)) {
        score.tie++;
        updateScoreDisplay();
        navigator.vibrate?.(15);
        setTimeout(() => showRoundOverlay(0), 400);
        phase = "roundover";
        return;
      }

      currentPlayer = currentPlayer === 1 ? 2 : 1;
      phase = "playing";
      updateBanners();
      updatePendingDiscs();
    });
  }

  // ── Win highlight (SVG line over the 4 cells) ─────────────────────────────

  function highlightWin(coords: Coord[], color: string): void {
    if (coords.length < 2) return;

    const first = coords[0]!;
    const last  = coords[coords.length - 1]!;

    const firstCell = cellEls[first.col]![first.row];
    const lastCell  = cellEls[last.col]![last.row];
    if (!firstCell || !lastCell) return;

    const boardRect = boardEl.getBoundingClientRect();
    const fr = firstCell.getBoundingClientRect();
    const lr = lastCell.getBoundingClientRect();

    const cx1 = fr.left - boardRect.left + fr.width / 2;
    const cy1 = fr.top  - boardRect.top  + fr.height / 2;
    const cx2 = lr.left - boardRect.left + lr.width / 2;
    const cy2 = lr.top  - boardRect.top  + lr.height / 2;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "c4-win-svg");
    svg.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 6;
      overflow: visible;
    `;

    const len = Math.hypot(cx2 - cx1, cy2 - cy1);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(cx1));
    line.setAttribute("y1", String(cy1));
    line.setAttribute("x2", String(cx2));
    line.setAttribute("y2", String(cy2));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "5");
    line.setAttribute("stroke-linecap", "round");
    line.style.cssText = `
      stroke-dasharray: ${len};
      stroke-dashoffset: ${len};
      animation: c4-line-draw 0.5s ease forwards;
    `;

    svg.appendChild(line);
    boardEl.style.position = "relative";
    boardEl.appendChild(svg);
  }

  // ── Round overlay ─────────────────────────────────────────────────────────

  function showRoundOverlay(winner: 1 | 2 | 0): void {
    const overlay = document.createElement("div");
    overlay.className = "c4-overlay";

    let title = "PAREGGIO";
    let color = COLOR_TIE;
    if (winner !== 0) {
      title = `${playerName(winner)} VINCE`;
      color = playerColor(winner);
    }

    overlay.innerHTML = `
      <div class="c4-overlay-box">
        <div class="c4-overlay-title" style="color:${color};text-shadow:0 0 18px ${color}">${title}</div>
        <div class="c4-overlay-score">P1: ${score.p1} — TIE: ${score.tie} — P2: ${score.p2}</div>
        <div class="c4-overlay-actions">
          <button class="btn primary c4-ov-btn" id="c4-again">ANCORA</button>
          <button class="btn c4-ov-btn" id="c4-menu">MENU</button>
        </div>
      </div>
    `;

    boardWrap.appendChild(overlay);

    overlay.querySelector("#c4-again")?.addEventListener("pointerup", () => {
      overlay.remove();
      startRound();
    });
    overlay.querySelector("#c4-menu")?.addEventListener("pointerup", () => {
      navigate("/");
    });
  }

  // ── Round init ────────────────────────────────────────────────────────────

  function startRound(): void {
    board = Array.from({ length: COLS }, () => Array(ROWS).fill(0) as Cell[]);
    currentPlayer = 1;
    phase = "playing";

    // Clear win SVG + flying discs
    boardEl.querySelectorAll(".c4-win-svg, .c4-flying-disc").forEach(el => el.remove());

    // Reset all cells
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const cell = cellEls[c]![r];
        if (cell) {
          cell.classList.remove("c4-cell-p1", "c4-cell-p2");
        }
      }
    }

    updateBanners();
    updatePendingDiscs();
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  // Touch target: full column strip (pending + board cells)
  function onColTouch(e: Event): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    if (!target) return;
    const col = parseInt(target.dataset["col"] ?? "", 10);
    if (!isNaN(col)) handleColTap(col);
  }

  boardWrap.addEventListener("pointerup", onColTouch);

  // ── Init ──────────────────────────────────────────────────────────────────

  startRound();

  let dismissHintFn: (() => void) | null = null;

  if (showHintFirst) {
    phase = "hint";
    dismissHintFn = showHint(container, () => {
      phase = "playing";
      dismissHintFn = null;
    });

    const onFirstTap = (e: Event): void => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
      if (target && phase === "hint") {
        boardWrap.removeEventListener("pointerup", onFirstTap);
        dismissHintFn?.();
      }
    };
    boardWrap.addEventListener("pointerup", onFirstTap);
  }

  return function cleanup(): void {
    dismissHintFn?.();
    root.remove();
  };
}

// ── Mount (shell contract) ────────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.classList.add("connect4-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  let cleanupGame: (() => void) | null = null;

  void (async () => {
    const names    = await loadNames();
    const seenHint = await loadSeenHint();
    cleanupGame = buildGame(container, names.p1, names.p2, !seenHint);
  })();

  return function cleanup(): void {
    cleanupGame?.();
    container.innerHTML = "";
    container.classList.remove("connect4-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles(): void {
  const id = "connect4-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    /* ── Root ──────────────────────────────────────────────────────────── */
    .connect4-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: ${COLOR_BG};
      user-select: none;
      -webkit-user-select: none;
    }

    /* ── Game layout ────────────────────────────────────────────────────── */
    .c4-game {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      box-sizing: border-box;
      --p1-glow: transparent;
      --p2-glow: transparent;
    }

    /* ── Score strips ────────────────────────────────────────────────────── */
    .c4-score-strip {
      display: flex;
      gap: 12px;
      font-family: monospace;
      font-size: 11px;
      letter-spacing: 1px;
      padding: 2px 0;
    }
    .c4-score-p2 { transform: rotate(180deg); }
    .c4-sc-p1  { color: ${COLOR_P1}; }
    .c4-sc-p2  { color: ${COLOR_P2}; }
    .c4-sc-tie { color: ${COLOR_TIE}; }

    /* ── Turn banners ────────────────────────────────────────────────────── */
    .c4-banner {
      font-family: monospace;
      font-size: clamp(10px, 2.8vw, 14px);
      font-weight: bold;
      letter-spacing: 2px;
      padding: 5px 10px;
      border-radius: 6px;
      transition: color 0.2s, box-shadow 0.3s;
      text-align: center;
    }
    .c4-banner-p2 {
      transform: rotate(180deg);
      box-shadow: 0 0 0 2px var(--p2-glow), 0 0 14px var(--p2-glow);
    }
    .c4-banner-p1 {
      box-shadow: 0 0 0 2px var(--p1-glow), 0 0 14px var(--p1-glow);
    }

    /* ── Board wrap ──────────────────────────────────────────────────────── */
    .c4-board-wrap {
      display: flex;
      flex-direction: column;
      flex: 0 0 auto;
      width: min(95vw, calc((100vh - 200px) * 7 / 6), 420px);
      touch-action: none;
    }

    /* ── Pending disc row ────────────────────────────────────────────────── */
    .c4-pending-row {
      display: grid;
      grid-template-columns: repeat(${COLS}, 1fr);
      gap: 3px;
      padding: 0 3px;
      height: 20px;
      margin-bottom: 3px;
    }
    .c4-pending {
      border-radius: 50%;
      height: 14px;
      width: 14px;
      margin: auto;
      transition: background 0.15s, box-shadow 0.15s;
    }
    @keyframes c4-pending-shake {
      0%,100% { transform: translateX(0); }
      25% { transform: translateX(-3px); }
      75% { transform: translateX(3px); }
    }
    .c4-pending-shake { animation: c4-pending-shake 0.25s ease; }

    /* ── Board grid ──────────────────────────────────────────────────────── */
    .c4-board {
      display: grid;
      grid-template-columns: repeat(${COLS}, 1fr);
      grid-template-rows: repeat(${ROWS}, 1fr);
      gap: 3px;
      background: #0b2d4a;
      border-radius: 8px;
      padding: 4px;
      box-sizing: border-box;
      position: relative;
      aspect-ratio: 7 / 6;
      overflow: visible;
    }

    /* ── Cells ───────────────────────────────────────────────────────────── */
    .c4-cell {
      background: ${COLOR_CELL};
      border: 1.5px solid ${COLOR_BORDER};
      border-radius: 50%;
      transition: background 0.12s, box-shadow 0.12s;
      min-width: 0;
      min-height: 0;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .c4-cell-p1 {
      background: ${COLOR_P1};
      box-shadow: 0 0 8px ${COLOR_P1}88;
      border-color: ${COLOR_P1}66;
    }
    .c4-cell-p2 {
      background: ${COLOR_P2};
      box-shadow: 0 0 8px ${COLOR_P2}88;
      border-color: ${COLOR_P2}66;
    }

    /* ── Win line ────────────────────────────────────────────────────────── */
    @keyframes c4-line-draw {
      to { stroke-dashoffset: 0; }
    }

    /* ── Round overlay ───────────────────────────────────────────────────── */
    .c4-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(10,26,42,0.90);
      border-radius: 8px;
      z-index: 10;
    }
    .c4-overlay-box {
      text-align: center;
      padding: 24px 20px;
    }
    .c4-overlay-title {
      font-family: monospace;
      font-size: clamp(16px, 5vw, 24px);
      font-weight: bold;
      letter-spacing: 3px;
      margin-bottom: 10px;
    }
    .c4-overlay-score {
      font-family: monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.55);
      margin-bottom: 18px;
      letter-spacing: 1px;
    }
    .c4-overlay-actions { display: flex; gap: 12px; justify-content: center; }
    .c4-ov-btn { min-width: 90px; min-height: 44px; font-family: monospace; font-size: 13px; letter-spacing: 1px; }

    /* ── Names dialog ────────────────────────────────────────────────────── */
    .c4-dialog-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.72);
      z-index: 20;
    }
    .c4-dialog {
      background: #0b1f35;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 12px;
      padding: 26px 22px;
      min-width: 240px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .c4-dialog-title {
      font-family: monospace;
      font-size: 15px;
      font-weight: bold;
      letter-spacing: 3px;
      color: ${COLOR_P1};
      text-align: center;
    }
    .c4-dialog-row { display: flex; align-items: center; gap: 8px; }
    .c4-dialog-disc {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .c4-disc-p1 { background: ${COLOR_P1}; box-shadow: 0 0 6px ${COLOR_P1}88; }
    .c4-disc-p2 { background: ${COLOR_P2}; box-shadow: 0 0 6px ${COLOR_P2}88; }
    .c4-dialog-label {
      font-family: monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.55);
      min-width: 24px;
    }
    .c4-dialog-input {
      flex: 1;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 6px;
      padding: 8px 10px;
      font-family: monospace;
      font-size: 14px;
      color: #fff;
      outline: none;
    }
    .c4-dialog-input:focus { border-color: ${COLOR_P1}; }
    .c4-dialog-btn { min-height: 44px; font-family: monospace; font-size: 14px; letter-spacing: 1px; }

    /* ── Hint overlay ────────────────────────────────────────────────────── */
    .c4-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 15;
      animation: c4-hint-fade 0.4s ease;
    }
    @keyframes c4-hint-fade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .c4-hint-inner {
      background: rgba(0,0,0,0.80);
      border-radius: 10px;
      padding: 18px 26px;
      text-align: center;
      pointer-events: auto;
    }
    .c4-hint-big {
      font-family: monospace;
      font-size: 17px;
      font-weight: bold;
      color: ${COLOR_P1};
      letter-spacing: 3px;
      margin-bottom: 8px;
    }
    .c4-hint-line {
      font-family: monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.70);
      letter-spacing: 1px;
    }
  `;
  document.head.appendChild(style);
}
