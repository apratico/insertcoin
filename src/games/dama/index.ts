import { db } from "../../lib/storage.js";
import { navigate } from "../../lib/router.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type Piece = { player: 1 | 2; king: boolean };
type Cell  = Piece | null;
type Board = Cell[][];   // [row][col], row 0 = top (P2 start side)

type Phase = "hint" | "playing" | "animating" | "roundover";

interface Coord { row: number; col: number; }
interface Move  { from: Coord; to: Coord; captured: Coord[] }

interface MatchScore { p1: number; p2: number; }

// ── Constants ─────────────────────────────────────────────────────────────────

const SIZE   = 8;
const BG     = "#1a0f08";
const LIGHT  = "#e8c98a";    // light board square
const DARK   = "#6b3a1f";    // dark board square
const P1_FILL    = "#f5e6c8";
const P1_BORDER  = "#3a2010";
const P2_FILL    = "#4a2418";
const P2_BORDER  = "#f5e6c8";
const ACCENT     = "#c08040";
const KING_COLOR = "#f5c518";
const SELECT_GLO = "#f5c518";
const HINT_COLOR = "rgba(245,197,24,0.35)";
const CAPTURE_WARN = "#ff4444";

// ── Storage helpers ───────────────────────────────────────────────────────────

async function loadSeenHint(): Promise<boolean> {
  try {
    const row = await db.settings.get("dama:seenHint");
    return row?.value === "1";
  } catch { return false; }
}

async function markSeenHint(): Promise<void> {
  await db.settings.put({ key: "dama:seenHint", value: "1" });
}

// ── Board helpers ─────────────────────────────────────────────────────────────

function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null) as Cell[]);
}

function isPlayable(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

function initialBoard(): Board {
  const b = emptyBoard();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!isPlayable(r, c)) continue;
      if (r < 3) b[r]![c] = { player: 2, king: false };
      if (r > 4) b[r]![c] = { player: 1, king: false };
    }
  }
  return b;
}

function cloneBoard(b: Board): Board {
  return b.map(row => row.map(cell => cell ? { ...cell } : null));
}

// ── Movement logic ────────────────────────────────────────────────────────────

function forwardDirs(player: 1 | 2): [number, number][] {
  // P1 moves up (row decreases), P2 moves down (row increases)
  const dr = player === 1 ? -1 : 1;
  return [[dr, -1], [dr, 1]];
}

function allDirs(): [number, number][] {
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function getCaptures(b: Board, from: Coord, player: 1 | 2, king: boolean): Move[] {
  const dirs = king ? allDirs() : forwardDirs(player);
  const moves: Move[] = [];
  for (const [dr, dc] of dirs) {
    const mr = from.row + dr;
    const mc = from.col + dc;
    const lr = from.row + dr * 2;
    const lc = from.col + dc * 2;
    if (!inBounds(mr, mc) || !inBounds(lr, lc)) continue;
    const mid = b[mr]![mc];
    const land = b[lr]![lc];
    if (mid && mid.player !== player && !land) {
      moves.push({ from, to: { row: lr, col: lc }, captured: [{ row: mr, col: mc }] });
    }
  }
  return moves;
}

function getNormals(b: Board, from: Coord, player: 1 | 2, king: boolean): Move[] {
  const dirs = king ? allDirs() : forwardDirs(player);
  const moves: Move[] = [];
  for (const [dr, dc] of dirs) {
    const tr = from.row + dr;
    const tc = from.col + dc;
    if (!inBounds(tr, tc)) continue;
    if (!b[tr]![tc]) {
      moves.push({ from, to: { row: tr, col: tc }, captured: [] });
    }
  }
  return moves;
}

function allMovesForPlayer(b: Board, player: 1 | 2): Move[] {
  const captures: Move[] = [];
  const normals:  Move[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = b[r]![c];
      if (!cell || cell.player !== player) continue;
      const from = { row: r, col: c };
      const caps = getCaptures(b, from, player, cell.king);
      captures.push(...caps);
      normals.push(...getNormals(b, from, player, cell.king));
    }
  }
  return captures.length > 0 ? captures : normals;
}

function capturesForPiece(b: Board, from: Coord): Move[] {
  const cell = b[from.row]![from.col];
  if (!cell) return [];
  return getCaptures(b, from, cell.player, cell.king);
}

function applyMove(b: Board, move: Move): Board {
  const nb = cloneBoard(b);
  const piece = nb[move.from.row]![move.from.col]!;
  nb[move.to.row]![move.to.col] = piece;
  nb[move.from.row]![move.from.col] = null;
  for (const cap of move.captured) {
    nb[cap.row]![cap.col] = null;
  }
  // Promotion
  if (!piece.king) {
    if (piece.player === 1 && move.to.row === 0)     piece.king = true;
    if (piece.player === 2 && move.to.row === SIZE - 1) piece.king = true;
  }
  return nb;
}

function countPieces(b: Board, player: 1 | 2): number {
  let n = 0;
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (b[r]![c]?.player === player) n++;
  return n;
}

// ── Onboarding hint ───────────────────────────────────────────────────────────

function showHint(container: HTMLElement, onDismiss: () => void): () => void {
  const hint = document.createElement("div");
  hint.className = "dm-hint";
  hint.innerHTML = `
    <div class="dm-hint-inner">
      <div class="dm-hint-big">TAP TO SELECT, TAP TO MOVE</div>
      <div class="dm-hint-line">Mangia obbligatoria. Arrivo fondo = dama.</div>
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

  const timer = setTimeout(dismiss, 6000);
  hint.addEventListener("pointerup", () => { clearTimeout(timer); dismiss(); });

  return () => { clearTimeout(timer); hint.remove(); dismissed = true; };
}

// ── Game builder ──────────────────────────────────────────────────────────────

function buildGame(
  container: HTMLElement,
  showHintFirst: boolean
): () => void {

  // ── State ──────────────────────────────────────────────────────────────────

  let board: Board = initialBoard();
  let currentPlayer: 1 | 2 = 1;
  let phase: Phase = "playing";
  let selected: Coord | null = null;
  let legalMoves: Move[] = [];        // legal moves for selected piece
  let chainPiece: Coord | null = null; // locked piece during multi-capture
  const score: MatchScore = { p1: 0, p2: 0 };

  // ── DOM ────────────────────────────────────────────────────────────────────

  const root = document.createElement("div");
  root.className = "dm-game";

  const scoreP2 = document.createElement("div");
  scoreP2.className = "dm-score-strip dm-score-p2";

  const bannerP2 = document.createElement("div");
  bannerP2.className = "dm-banner dm-banner-p2";

  const boardWrap = document.createElement("div");
  boardWrap.className = "dm-board-wrap";

  const boardEl = document.createElement("div");
  boardEl.className = "dm-board";
  boardEl.setAttribute("role", "grid");
  boardEl.setAttribute("aria-label", "Dama board");

  boardWrap.appendChild(boardEl);

  const bannerP1 = document.createElement("div");
  bannerP1.className = "dm-banner dm-banner-p1";

  const scoreP1 = document.createElement("div");
  scoreP1.className = "dm-score-strip dm-score-p1";

  root.appendChild(scoreP2);
  root.appendChild(bannerP2);
  root.appendChild(boardWrap);
  root.appendChild(bannerP1);
  root.appendChild(scoreP1);
  container.appendChild(root);

  // ── Cell elements: cellEls[row][col] ──────────────────────────────────────

  const cellEls: HTMLDivElement[][] = Array.from({ length: SIZE }, () =>
    Array(SIZE).fill(null) as HTMLDivElement[]
  );

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement("div");
      cell.className = "dm-cell " + (isPlayable(r, c) ? "dm-cell-dark" : "dm-cell-light");
      cell.dataset["row"] = String(r);
      cell.dataset["col"] = String(c);
      cellEls[r]![c] = cell;
      boardEl.appendChild(cell);
    }
  }

  // ── Piece elements: pieceEls[row][col] ────────────────────────────────────
  // Each piece is a positioned div inside the cell.

  const pieceEls: (HTMLDivElement | null)[][] = Array.from({ length: SIZE }, () =>
    Array(SIZE).fill(null) as (HTMLDivElement | null)[]
  );

  function createPieceEl(player: 1 | 2, king: boolean): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `dm-piece dm-piece-p${player}${king ? " dm-king" : ""}`;
    el.innerHTML = king ? '<span class="dm-crown">♛</span>' : "";
    return el;
  }

  function renderAllPieces(): void {
    // Remove all existing piece elements
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const existing = pieceEls[r]![c];
        if (existing) { existing.remove(); pieceEls[r]![c] = null; }
      }
    }
    // Recreate from board state
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = board[r]![c];
        if (!cell) continue;
        const el = createPieceEl(cell.player, cell.king);
        cellEls[r]![c]!.appendChild(el);
        pieceEls[r]![c] = el;
      }
    }
  }

  // ── Highlight helpers ─────────────────────────────────────────────────────

  function clearHighlights(): void {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const el = cellEls[r]![c]!;
        el.classList.remove("dm-selected", "dm-hint-move", "dm-capture-only");
        const pe = pieceEls[r]![c];
        if (pe) pe.classList.remove("dm-piece-selected", "dm-piece-chain");
      }
    }
  }

  function applyHighlights(): void {
    clearHighlights();
    if (!selected) return;

    // Highlight selected piece
    const se = cellEls[selected.row]![selected.col]!;
    se.classList.add("dm-selected");
    const sp = pieceEls[selected.row]![selected.col];
    if (sp) sp.classList.add("dm-piece-selected");

    // Highlight valid destinations
    for (const m of legalMoves) {
      cellEls[m.to.row]![m.to.col]!.classList.add("dm-hint-move");
    }

    // If chain piece locked, highlight it too
    if (chainPiece) {
      const cp = pieceEls[chainPiece.row]![chainPiece.col];
      if (cp) cp.classList.add("dm-piece-chain");
    }
  }

  // ── Banners & score ───────────────────────────────────────────────────────

  function updateBanners(): void {
    const text = `TURNO: P${currentPlayer}`;
    bannerP1.textContent = text;
    bannerP2.textContent = text;
    const c1 = currentPlayer === 1 ? P1_FILL : "rgba(255,255,255,0.3)";
    const c2 = currentPlayer === 2 ? P2_BORDER : "rgba(255,255,255,0.3)";
    bannerP1.style.color = c1;
    bannerP2.style.color = c2;
    root.style.setProperty("--p1-glow", currentPlayer === 1 ? P1_FILL : "transparent");
    root.style.setProperty("--p2-glow", currentPlayer === 2 ? P2_BORDER : "transparent");
    root.classList.toggle("dm-turn-p1", currentPlayer === 1);
    root.classList.toggle("dm-turn-p2", currentPlayer === 2);
  }

  function buildScoreHtml(flip: boolean): string {
    const p1cnt = countPieces(board, 1);
    const p2cnt = countPieces(board, 2);
    if (flip) {
      return `<span class="dm-sc dm-sc-p2">VINTE: ${score.p2}</span>`
           + `<span class="dm-sc dm-sc-p2-pieces">♟ ${p2cnt}</span>`;
    }
    return `<span class="dm-sc dm-sc-p1-pieces">♟ ${p1cnt}</span>`
         + `<span class="dm-sc dm-sc-p1">VINTE: ${score.p1}</span>`;
  }

  function updateScoreDisplay(): void {
    scoreP1.innerHTML = buildScoreHtml(false);
    scoreP2.innerHTML = buildScoreHtml(true);
  }

  // ── Move animation ────────────────────────────────────────────────────────

  function animateMove(move: Move, onDone: () => void): void {
    const pieceEl = pieceEls[move.from.row]![move.from.col];
    if (!pieceEl) { onDone(); return; }

    const fromRect = cellEls[move.from.row]![move.from.col]!.getBoundingClientRect();
    const toRect   = cellEls[move.to.row]![move.to.col]!.getBoundingClientRect();
    const boardRect = boardEl.getBoundingClientRect();

    if (boardRect.width < 4) { onDone(); return; }

    const dx = toRect.left - fromRect.left;
    const dy = toRect.top  - fromRect.top;

    pieceEl.style.transition = "transform 200ms ease-out";
    pieceEl.style.transform  = `translate(${dx}px,${dy}px)`;
    pieceEl.style.zIndex     = "10";

    const onEnd = (): void => {
      pieceEl.style.transition = "";
      pieceEl.style.transform  = "";
      pieceEl.style.zIndex     = "";
      onDone();
    };
    pieceEl.addEventListener("transitionend", onEnd, { once: true });
    setTimeout(onEnd, 260);
  }

  function animateCapture(capCoords: Coord[], onDone: () => void): void {
    let pending = capCoords.length;
    if (!pending) { onDone(); return; }

    for (const cap of capCoords) {
      const el = pieceEls[cap.row]![cap.col];
      if (!el) { if (--pending === 0) onDone(); continue; }
      el.style.transition = "opacity 180ms ease, transform 180ms ease";
      el.style.opacity    = "0";
      el.style.transform  = "scale(0.4)";
      const cleanup = (): void => {
        el.remove();
        pieceEls[cap.row]![cap.col] = null;
        if (--pending === 0) onDone();
      };
      el.addEventListener("transitionend", cleanup, { once: true });
      setTimeout(cleanup, 220);
    }
  }

  // ── Core turn logic ───────────────────────────────────────────────────────

  function computeLegalMoves(coord: Coord): Move[] {
    const all = allMovesForPlayer(board, currentPlayer);
    const hasCaps = all.some(m => m.captured.length > 0);

    // If there is a locked chain piece, only that piece can move (capture only)
    if (chainPiece) {
      if (coord.row !== chainPiece.row || coord.col !== chainPiece.col) return [];
      return capturesForPiece(board, coord);
    }

    // If captures exist globally, only return captures for this piece
    if (hasCaps) {
      return all.filter(m =>
        m.from.row === coord.row && m.from.col === coord.col && m.captured.length > 0
      );
    }

    // Normal moves
    return all.filter(m =>
      m.from.row === coord.row && m.from.col === coord.col
    );
  }

  function commitMove(move: Move): void {
    phase = "animating";
    clearHighlights();

    animateMove(move, () => {
      // Fade out captured pieces
      animateCapture(move.captured, () => {
        // Apply move to board
        board = applyMove(board, move);
        renderAllPieces();
        updateScoreDisplay();

        // Check chain capture
        if (move.captured.length > 0) {
          const continuations = capturesForPiece(board, move.to);
          const wasJustKinged = (() => {
            const piece = board[move.to.row]![move.to.col];
            if (!piece) return false;
            // Was it just promoted? (destination is back-rank)
            const backRank = piece.player === 1 ? 0 : SIZE - 1;
            return move.to.row === backRank && continuations.length > 0;
          })();

          // Chain continues if captures available and not just promoted (Italian rule: no chain after promotion)
          if (continuations.length > 0 && !wasJustKinged) {
            chainPiece = move.to;
            selected   = move.to;
            legalMoves = continuations;
            phase = "playing";
            applyHighlights();
            return;
          }
        }

        // Chain done / normal move done
        chainPiece = null;
        selected   = null;
        legalMoves = [];

        // Check victory
        const winner = checkVictory();
        if (winner !== 0) {
          if (winner === 1) score.p1++;
          else score.p2++;
          updateScoreDisplay();
          navigator.vibrate?.([40, 40, 100]);
          setTimeout(() => showRoundOverlay(winner), 500);
          phase = "roundover";
          return;
        }

        // Switch turn
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        phase = "playing";
        updateBanners();
        updateScoreDisplay();
      });
    });
  }

  function checkVictory(): 1 | 2 | 0 {
    const cnt1 = countPieces(board, 1);
    const cnt2 = countPieces(board, 2);
    if (cnt1 === 0) return 2;
    if (cnt2 === 0) return 1;
    // Next player to move is the opponent of whoever just moved (currentPlayer)
    const nextPlayer: 1 | 2 = currentPlayer === 1 ? 2 : 1;
    const nextMoves = allMovesForPlayer(board, nextPlayer);
    if (nextMoves.length === 0) {
      // Next player has no legal moves → current player wins
      return currentPlayer;
    }
    return 0;
  }

  // ── Tap handling ──────────────────────────────────────────────────────────

  function handleCellTap(row: number, col: number): void {
    if (phase !== "playing") return;
    if (!isPlayable(row, col)) return;

    const tapped = board[row]![col];

    // Tap on own piece: select / reselect
    if (tapped && tapped.player === currentPlayer) {
      if (chainPiece) return; // locked during chain
      selected   = { row, col };
      legalMoves = computeLegalMoves({ row, col });
      applyHighlights();
      navigator.vibrate?.(6);
      return;
    }

    // Tap on destination
    if (selected) {
      const match = legalMoves.find(m => m.to.row === row && m.to.col === col);
      if (match) {
        navigator.vibrate?.(10);
        commitMove(match);
        return;
      }
      // Tap elsewhere → deselect (only if not in chain)
      if (!chainPiece) {
        selected   = null;
        legalMoves = [];
        clearHighlights();
      }
    }
  }

  // ── Round overlay ─────────────────────────────────────────────────────────

  function showRoundOverlay(winner: 1 | 2): void {
    const color  = winner === 1 ? P1_FILL : P2_BORDER;
    const title  = `P${winner} VINCE!`;

    const overlay = document.createElement("div");
    overlay.className = "dm-overlay";
    overlay.innerHTML = `
      <div class="dm-overlay-box">
        <div class="dm-overlay-title" style="color:${color};text-shadow:0 0 20px ${color}">${title}</div>
        <div class="dm-overlay-score">P1: ${score.p1} — P2: ${score.p2}</div>
        <div class="dm-overlay-actions">
          <button class="btn primary dm-ov-btn" id="dm-again">RIVINCITA</button>
          <button class="btn dm-ov-btn" id="dm-menu">MENU</button>
        </div>
      </div>
    `;

    boardWrap.appendChild(overlay);

    overlay.querySelector("#dm-again")?.addEventListener("pointerup", () => {
      overlay.remove();
      startRound();
    });
    overlay.querySelector("#dm-menu")?.addEventListener("pointerup", () => {
      navigate("/");
    });
  }

  // ── Round init ────────────────────────────────────────────────────────────

  function startRound(): void {
    board         = initialBoard();
    currentPlayer = 1;
    phase         = "playing";
    selected      = null;
    legalMoves    = [];
    chainPiece    = null;

    clearHighlights();
    renderAllPieces();
    updateBanners();
    updateScoreDisplay();
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  function onBoardTap(e: Event): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!target) return;
    const row = parseInt(target.dataset["row"] ?? "", 10);
    const col = parseInt(target.dataset["col"] ?? "", 10);
    if (!isNaN(row) && !isNaN(col)) handleCellTap(row, col);
  }

  boardEl.addEventListener("pointerup", onBoardTap);

  // ── Init ──────────────────────────────────────────────────────────────────

  startRound();

  let dismissHintFn: (() => void) | null = null;

  if (showHintFirst) {
    dismissHintFn = showHint(container, () => { dismissHintFn = null; });

    const onFirstTap = (): void => {
      boardEl.removeEventListener("pointerup", onFirstTap);
      dismissHintFn?.();
    };
    boardEl.addEventListener("pointerup", onFirstTap);
  }

  return function cleanup(): void {
    dismissHintFn?.();
    root.remove();
  };
}

// ── Mount (shell contract) ────────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.classList.add("dama-root");
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
    container.classList.remove("dama-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles(): void {
  const id = "dama-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    /* ── Root ──────────────────────────────────────────────────────────────── */
    .dama-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: ${BG};
      user-select: none;
      -webkit-user-select: none;
    }

    /* ── Game layout ────────────────────────────────────────────────────────── */
    .dm-game {
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

    /* ── Score strips ───────────────────────────────────────────────────────── */
    .dm-score-strip {
      display: flex;
      gap: 12px;
      font-family: monospace;
      font-size: 11px;
      letter-spacing: 1px;
      padding: 2px 0;
    }
    .dm-score-p2 { transform: rotate(180deg); }
    .dm-sc-p1         { color: ${P1_FILL}; }
    .dm-sc-p1-pieces  { color: ${P1_FILL}; opacity: 0.7; }
    .dm-sc-p2         { color: #c8a080; }
    .dm-sc-p2-pieces  { color: #c8a080; opacity: 0.7; }

    /* ── Turn banners ───────────────────────────────────────────────────────── */
    .dm-banner {
      font-family: monospace;
      font-size: clamp(10px, 2.8vw, 14px);
      font-weight: bold;
      letter-spacing: 2px;
      padding: 5px 10px;
      border-radius: 6px;
      transition: color 0.2s, box-shadow 0.3s;
      text-align: center;
    }
    .dm-banner-p2 {
      transform: rotate(180deg);
      box-shadow: 0 0 0 2px var(--p2-glow), 0 0 14px var(--p2-glow);
    }
    .dm-banner-p1 {
      box-shadow: 0 0 0 2px var(--p1-glow), 0 0 14px var(--p1-glow);
    }

    /* ── Board wrap ─────────────────────────────────────────────────────────── */
    .dm-board-wrap {
      position: relative;
      flex: 0 0 auto;
      width: min(96vw, calc(100vh - 140px), 380px);
      aspect-ratio: 1 / 1;
    }

    /* ── Board grid ─────────────────────────────────────────────────────────── */
    .dm-board {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      grid-template-rows: repeat(8, 1fr);
      width: 100%;
      height: 100%;
      border: 2px solid ${DARK};
      border-radius: 4px;
      overflow: hidden;
      box-sizing: border-box;
    }

    /* ── Cells ──────────────────────────────────────────────────────────────── */
    .dm-cell {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      min-width: 0;
      min-height: 0;
    }
    .dm-cell-light { background: ${LIGHT}; }
    .dm-cell-dark  { background: ${DARK}; }

    .dm-cell.dm-selected {
      background: ${SELECT_GLO}44;
      outline: 2px solid ${SELECT_GLO};
      outline-offset: -2px;
    }
    .dm-cell.dm-hint-move {
      background: ${HINT_COLOR};
    }
    .dm-cell.dm-hint-move::after {
      content: "";
      display: block;
      width: 28%;
      height: 28%;
      border-radius: 50%;
      background: ${ACCENT};
      opacity: 0.75;
    }
    .dm-cell.dm-capture-only {
      outline: 1.5px solid ${CAPTURE_WARN}66;
      outline-offset: -1.5px;
    }

    /* ── Pieces ─────────────────────────────────────────────────────────────── */
    .dm-piece {
      position: absolute;
      width: 76%;
      height: 76%;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0;
      transition: box-shadow 0.15s;
      box-sizing: border-box;
    }

    /* P1: creamy light piece */
    .dm-piece-p1 {
      background: radial-gradient(circle at 35% 35%, #fff8ee, ${P1_FILL} 60%, #d4c09a);
      border: 2.5px solid ${P1_BORDER};
      box-shadow:
        inset 0 -2px 4px rgba(0,0,0,0.25),
        inset 0 2px 4px rgba(255,255,255,0.5),
        0 1px 3px rgba(0,0,0,0.5);
    }
    /* P2: dark brown piece */
    .dm-piece-p2 {
      background: radial-gradient(circle at 35% 35%, #7a3a28, ${P2_FILL} 55%, #2a1008);
      border: 2.5px solid ${P2_BORDER};
      box-shadow:
        inset 0 -2px 4px rgba(0,0,0,0.5),
        inset 0 2px 4px rgba(255,255,255,0.15),
        0 1px 3px rgba(0,0,0,0.6);
    }

    /* Inner ring detail */
    .dm-piece-p1::before,
    .dm-piece-p2::before {
      content: "";
      position: absolute;
      inset: 20%;
      border-radius: 50%;
      border: 1.5px solid rgba(255,255,255,0.2);
    }

    /* King crown */
    .dm-king .dm-crown {
      font-size: clamp(11px, 3vw, 16px);
      line-height: 1;
      color: ${KING_COLOR};
      text-shadow: 0 0 6px ${KING_COLOR};
      position: relative;
      z-index: 2;
    }

    /* Selected glow */
    .dm-piece-selected {
      box-shadow:
        inset 0 -2px 4px rgba(0,0,0,0.25),
        inset 0 2px 4px rgba(255,255,255,0.5),
        0 0 0 3px ${SELECT_GLO},
        0 0 12px ${SELECT_GLO}88;
    }
    /* Chain locked piece */
    .dm-piece-chain {
      box-shadow:
        inset 0 -2px 4px rgba(0,0,0,0.25),
        0 0 0 3px ${CAPTURE_WARN},
        0 0 14px ${CAPTURE_WARN}88;
    }

    /* ── Round overlay ──────────────────────────────────────────────────────── */
    .dm-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(10,6,3,0.88);
      border-radius: 4px;
      z-index: 10;
    }
    .dm-overlay-box { text-align: center; padding: 24px 20px; }
    .dm-overlay-title {
      font-family: monospace;
      font-size: clamp(18px, 5vw, 26px);
      font-weight: bold;
      letter-spacing: 3px;
      margin-bottom: 10px;
    }
    .dm-overlay-score {
      font-family: monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.5);
      margin-bottom: 18px;
      letter-spacing: 1px;
    }
    .dm-overlay-actions { display: flex; gap: 12px; justify-content: center; }
    .dm-ov-btn { min-width: 100px; min-height: 44px; font-family: monospace; font-size: 13px; letter-spacing: 1px; }

    /* ── Onboarding hint ────────────────────────────────────────────────────── */
    .dm-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 15;
      animation: dm-hint-fade 0.4s ease;
    }
    @keyframes dm-hint-fade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .dm-hint-inner {
      background: rgba(0,0,0,0.82);
      border-radius: 10px;
      padding: 18px 26px;
      text-align: center;
      pointer-events: auto;
    }
    .dm-hint-big {
      font-family: monospace;
      font-size: 15px;
      font-weight: bold;
      color: ${ACCENT};
      letter-spacing: 2px;
      margin-bottom: 8px;
    }
    .dm-hint-line {
      font-family: monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.70);
      letter-spacing: 1px;
    }
  `;
  document.head.appendChild(style);
}
