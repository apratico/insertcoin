import { db } from "../../lib/storage.js";
import { navigate } from "../../lib/router.js";

// ── Types ────────────────────────────────────────────────────────────────────

type Cell = 0 | 1 | 2;      // 0=empty, 1=X, 2=O
type Phase = "hint" | "playing" | "roundover";

interface MatchScore { x: number; o: number; tie: number; }

// ── Constants ────────────────────────────────────────────────────────────────

const WIN_PATTERNS = [
  [0,1,2],[3,4,5],[6,7,8],  // rows
  [0,3,6],[1,4,7],[2,5,8],  // cols
  [0,4,8],[2,4,6],          // diags
] as const;

const COLOR_X   = "#00e5ff";   // cyan
const COLOR_O   = "#ff40c8";   // magenta
const COLOR_BG  = "#0b1530";
const COLOR_TIE = "#f6c24c";

// ── Storage helpers ──────────────────────────────────────────────────────────

async function loadNames(): Promise<{ p1: string; p2: string }> {
  try {
    const row = await db.settings.get("tris:names");
    if (row) return JSON.parse(row.value) as { p1: string; p2: string };
  } catch { /* ignore */ }
  return { p1: "P1", p2: "P2" };
}

async function loadSeenHint(): Promise<boolean> {
  try {
    const row = await db.settings.get("tris:seenHint");
    return row?.value === "1";
  } catch { return false; }
}

async function markSeenHint(): Promise<void> {
  await db.settings.put({ key: "tris:seenHint", value: "1" });
}

// ── SVG mark renderers ───────────────────────────────────────────────────────

function svgX(): string {
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" class="tris-mark tris-x">
    <line x1="10" y1="10" x2="38" y2="38" stroke="${COLOR_X}" stroke-width="5" stroke-linecap="round"/>
    <line x1="38" y1="10" x2="10" y2="38" stroke="${COLOR_X}" stroke-width="5" stroke-linecap="round"/>
  </svg>`;
}

function svgO(): string {
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" class="tris-mark tris-o">
    <circle cx="24" cy="24" r="14" fill="none" stroke="${COLOR_O}" stroke-width="5"/>
  </svg>`;
}

// ── Win-line SVG overlay ─────────────────────────────────────────────────────

function buildWinLineSvg(pattern: readonly [number, number, number], color: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 3 3");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.className.baseVal = "tris-win-line";

  const col = (i: number) => (i % 3) + 0.5;
  const row = (i: number) => Math.floor(i / 3) + 0.5;

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(col(pattern[0])));
  line.setAttribute("y1", String(row(pattern[0])));
  line.setAttribute("x2", String(col(pattern[2])));
  line.setAttribute("y2", String(row(pattern[2])));
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "0.22");
  line.setAttribute("stroke-linecap", "round");
  line.className.baseVal = "tris-win-line-path";

  svg.appendChild(line);
  return svg;
}

// ── Onboarding hint ──────────────────────────────────────────────────────────

function showHint(container: HTMLElement, onDismiss: () => void): () => void {
  const hint = document.createElement("div");
  hint.className = "tris-hint";
  hint.innerHTML = `
    <div class="tris-hint-inner">
      <div class="tris-hint-line tris-hint-big">TAP TO PLACE</div>
      <div class="tris-hint-line">Passa il telefono al tuo avversario.</div>
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

  const timer = setTimeout(dismiss, 4000);

  hint.addEventListener("pointerup", () => {
    clearTimeout(timer);
    dismiss();
  });

  return () => {
    clearTimeout(timer);
    hint.remove();
    dismissed = true;
  };
}

// ── Game builder ─────────────────────────────────────────────────────────────

function buildGame(
  container: HTMLElement,
  p1: string,
  p2: string,
  showHintFirst: boolean
): () => void {
  // ── State ────────────────────────────────────────────────────────────────

  let board: Cell[] = Array(9).fill(0) as Cell[];
  let currentPlayer: 1 | 2 = 1;
  let phase: Phase = "playing";
  const score: MatchScore = { x: 0, o: 0, tie: 0 };

  // ── Build DOM ────────────────────────────────────────────────────────────

  const root = document.createElement("div");
  root.className = "tris-game";

  // ── Score strip (P2 side — rotated 180°) ────────────────────────────────
  const scoreP2 = document.createElement("div");
  scoreP2.className = "tris-score-strip tris-score-p2";
  scoreP2.innerHTML = `
    <span class="tris-score-item tris-score-x" id="tris-score-x">X: 0</span>
    <span class="tris-score-item tris-score-tie" id="tris-score-tie">TIE: 0</span>
    <span class="tris-score-item tris-score-o" id="tris-score-o">O: 0</span>
  `;

  // ── Turn banner P2 (top, rotated 180°) ──────────────────────────────────
  const bannerP2 = document.createElement("div");
  bannerP2.className = "tris-banner tris-banner-p2";
  bannerP2.id = "tris-banner-p2";

  // ── Board area ───────────────────────────────────────────────────────────
  const boardWrap = document.createElement("div");
  boardWrap.className = "tris-board-wrap";

  const boardEl = document.createElement("div");
  boardEl.className = "tris-board";
  boardEl.setAttribute("role", "grid");
  boardEl.setAttribute("aria-label", "Tris board");

  const cellEls: HTMLButtonElement[] = [];
  for (let i = 0; i < 9; i++) {
    const btn = document.createElement("button");
    btn.className = "tris-cell";
    btn.setAttribute("role", "gridcell");
    btn.setAttribute("aria-label", `Cell ${i + 1}`);
    btn.dataset["idx"] = String(i);
    cellEls.push(btn);
    boardEl.appendChild(btn);
  }
  boardWrap.appendChild(boardEl);

  // ── Turn banner P1 (bottom, normal) ─────────────────────────────────────
  const bannerP1 = document.createElement("div");
  bannerP1.className = "tris-banner tris-banner-p1";
  bannerP1.id = "tris-banner-p1";

  // ── Score strip (P1 side — normal) ──────────────────────────────────────
  const scoreP1 = document.createElement("div");
  scoreP1.className = "tris-score-strip tris-score-p1";
  scoreP1.innerHTML = `
    <span class="tris-score-item tris-score-x">X: 0</span>
    <span class="tris-score-item tris-score-tie">TIE: 0</span>
    <span class="tris-score-item tris-score-o">O: 0</span>
  `;

  root.appendChild(scoreP2);
  root.appendChild(bannerP2);
  root.appendChild(boardWrap);
  root.appendChild(bannerP1);
  root.appendChild(scoreP1);

  container.appendChild(root);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function playerName(p: 1 | 2): string { return p === 1 ? p1 : p2; }
  function playerColor(p: 1 | 2): string { return p === 1 ? COLOR_X : COLOR_O; }
  function playerSymbol(p: 1 | 2): string { return p === 1 ? "X" : "O"; }

  function updateBanners(): void {
    const name = playerName(currentPlayer);
    const sym  = playerSymbol(currentPlayer);
    const text = `TURNO: ${sym} — ${name}`;
    bannerP1.textContent = text;
    bannerP2.textContent = text;

    bannerP1.style.color  = playerColor(currentPlayer);
    bannerP2.style.color  = playerColor(currentPlayer);

    // Glow border on active side
    root.style.setProperty("--p1-glow", currentPlayer === 1 ? playerColor(1) : "transparent");
    root.style.setProperty("--p2-glow", currentPlayer === 2 ? playerColor(2) : "transparent");

    root.classList.toggle("tris-turn-p1", currentPlayer === 1);
    root.classList.toggle("tris-turn-p2", currentPlayer === 2);
  }

  function updateScoreDisplay(): void {
    const items = [
      { sel: "#tris-score-x",   text: `X: ${score.x}` },
      { sel: "#tris-score-tie", text: `TIE: ${score.tie}` },
      { sel: "#tris-score-o",   text: `O: ${score.o}` },
    ];
    items.forEach(({ sel, text }) => {
      const el = root.querySelector<HTMLElement>(sel);
      if (el) el.textContent = text;
    });
    // mirror in P1 strip
    root.querySelectorAll<HTMLElement>(".tris-score-p1 .tris-score-x").forEach(el => { el.textContent = `X: ${score.x}`; });
    root.querySelectorAll<HTMLElement>(".tris-score-p1 .tris-score-tie").forEach(el => { el.textContent = `TIE: ${score.tie}`; });
    root.querySelectorAll<HTMLElement>(".tris-score-p1 .tris-score-o").forEach(el => { el.textContent = `O: ${score.o}`; });
  }

  function renderCell(idx: number): void {
    const btn = cellEls[idx];
    if (!btn) return;
    const val = board[idx];
    if (val === 1) {
      btn.innerHTML = svgX();
    } else if (val === 2) {
      btn.innerHTML = svgO();
    } else {
      btn.innerHTML = "";
    }
    btn.classList.toggle("tris-cell-x", val === 1);
    btn.classList.toggle("tris-cell-o", val === 2);
  }

  function checkWin(b: Cell[], player: 1 | 2): readonly [number, number, number] | null {
    for (const pat of WIN_PATTERNS) {
      if (pat.every(i => b[i] === player)) return pat;
    }
    return null;
  }

  function checkTie(b: Cell[]): boolean {
    return b.every(c => c !== 0);
  }

  function showRoundOverlay(winner: 1 | 2 | 0): void {
    phase = "roundover";
    boardEl.querySelectorAll<HTMLButtonElement>(".tris-cell").forEach(b => { b.disabled = true; });

    const overlay = document.createElement("div");
    overlay.className = "tris-overlay";

    let title = "";
    let color = COLOR_TIE;
    if (winner === 0) {
      title = "PAREGGIO";
    } else {
      title = `${playerName(winner)} VINCE`;
      color = playerColor(winner);
    }

    overlay.innerHTML = `
      <div class="tris-overlay-box">
        <div class="tris-overlay-title" style="color:${color};text-shadow:0 0 18px ${color}">${title}</div>
        <div class="tris-overlay-score">X: ${score.x} — TIE: ${score.tie} — O: ${score.o}</div>
        <div class="tris-overlay-actions">
          <button class="btn primary tris-ov-btn" id="tris-again">ANCORA</button>
          <button class="btn tris-ov-btn" id="tris-menu">MENU</button>
        </div>
      </div>
    `;

    boardWrap.appendChild(overlay);

    overlay.querySelector("#tris-again")?.addEventListener("pointerup", () => {
      overlay.remove();
      startRound();
    });
    overlay.querySelector("#tris-menu")?.addEventListener("pointerup", () => {
      navigate("/");
    });
  }

  function startRound(): void {
    board = Array(9).fill(0) as Cell[];
    currentPlayer = 1;
    phase = "playing";

    // Remove old win line
    boardWrap.querySelectorAll(".tris-win-line").forEach(el => el.remove());

    cellEls.forEach((btn, i) => {
      btn.disabled = false;
      btn.className = "tris-cell";
      renderCell(i);
    });

    updateBanners();
  }

  function handleCellTap(idx: number): void {
    if (phase !== "playing") return;
    if (board[idx] !== 0) {
      navigator.vibrate?.(5);
      // small shake on cell
      const btn = cellEls[idx];
      btn?.classList.add("tris-cell-shake");
      setTimeout(() => btn?.classList.remove("tris-cell-shake"), 300);
      return;
    }

    board[idx] = currentPlayer;
    renderCell(idx);
    navigator.vibrate?.(8);

    const wp = checkWin(board, currentPlayer);
    if (wp) {
      const winner = currentPlayer;

      // Draw win line
      const lineSvg = buildWinLineSvg(wp, playerColor(winner));
      boardWrap.appendChild(lineSvg);

      if (winner === 1) score.x++;
      else score.o++;
      updateScoreDisplay();
      updateBanners();

      navigator.vibrate?.([40, 40, 100]);
      setTimeout(() => showRoundOverlay(winner), 700);
      return;
    }

    if (checkTie(board)) {
      score.tie++;
      updateScoreDisplay();
      navigator.vibrate?.(15);
      setTimeout(() => showRoundOverlay(0), 400);
      return;
    }

    currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateBanners();
  }

  // ── Event listeners ──────────────────────────────────────────────────────

  boardEl.addEventListener("pointerup", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
    if (!target) return;
    const idx = parseInt(target.dataset["idx"] ?? "", 10);
    if (!isNaN(idx)) handleCellTap(idx);
  });

  // ── Init ─────────────────────────────────────────────────────────────────

  startRound();

  let dismissHintFn: (() => void) | null = null;

  if (showHintFirst) {
    phase = "hint";
    // show hint and re-enable playing when dismissed
    dismissHintFn = showHint(container, () => {
      phase = "playing";
      dismissHintFn = null;
    });

    // first valid tap on board dismisses hint
    const onFirstTap = (e: Event): void => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
      if (target && phase === "hint") {
        boardEl.removeEventListener("pointerup", onFirstTap);
        dismissHintFn?.();
      }
    };
    boardEl.addEventListener("pointerup", onFirstTap);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  return function cleanup(): void {
    dismissHintFn?.();
    root.remove();
  };
}

// ── Mount (shell contract) ───────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.classList.add("tris-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  let cleanupGame: (() => void) | null = null;

  void (async () => {
    const names = await loadNames();
    const seenHint = await loadSeenHint();
    cleanupGame = buildGame(container, names.p1, names.p2, !seenHint);
  })();

  return function cleanup(): void {
    cleanupGame?.();
    container.innerHTML = "";
    container.classList.remove("tris-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ── Styles ───────────────────────────────────────────────────────────────────

function injectStyles(): void {
  const id = "tris-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .tris-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: ${COLOR_BG};
      user-select: none;
      -webkit-user-select: none;
    }

    /* ── Full-game layout ─────────────────────────────────────────────── */
    .tris-game {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      box-sizing: border-box;
      --p1-glow: transparent;
      --p2-glow: transparent;
    }

    /* ── Score strips ─────────────────────────────────────────────────── */
    .tris-score-strip {
      display: flex;
      gap: 16px;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 1px;
      padding: 2px 0;
    }
    .tris-score-p2 { transform: rotate(180deg); }
    .tris-score-x   { color: ${COLOR_X}; }
    .tris-score-o   { color: ${COLOR_O}; }
    .tris-score-tie { color: ${COLOR_TIE}; }

    /* ── Turn banners ─────────────────────────────────────────────────── */
    .tris-banner {
      font-family: monospace;
      font-size: clamp(11px, 3vw, 15px);
      font-weight: bold;
      letter-spacing: 2px;
      padding: 6px 12px;
      border-radius: 6px;
      transition: color 0.2s, box-shadow 0.3s;
      text-align: center;
    }
    .tris-banner-p2 {
      transform: rotate(180deg);
      box-shadow: 0 0 0 2px var(--p2-glow), 0 0 14px var(--p2-glow);
    }
    .tris-banner-p1 {
      box-shadow: 0 0 0 2px var(--p1-glow), 0 0 14px var(--p1-glow);
    }

    /* ── Board ────────────────────────────────────────────────────────── */
    .tris-board-wrap {
      position: relative;
      flex: 0 0 auto;
      /* square board, max constrained by both axes */
      width: min(80vw, 60vh, 340px);
      aspect-ratio: 1 / 1;
    }
    .tris-board {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(3, 1fr);
      width: 100%;
      height: 100%;
      gap: 4px;
      background: rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 4px;
      box-sizing: border-box;
    }
    .tris-cell {
      background: rgba(255,255,255,0.04);
      border: 1.5px solid rgba(255,255,255,0.12);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      min-width: 0;
      min-height: 0;
      padding: 8%;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      transition: background 0.1s;
    }
    .tris-cell:active { background: rgba(255,255,255,0.10); }
    .tris-cell:disabled { cursor: default; }
    .tris-cell-x { border-color: ${COLOR_X}33; }
    .tris-cell-o { border-color: ${COLOR_O}33; }

    /* ── SVG marks ────────────────────────────────────────────────────── */
    .tris-mark {
      width: 62%;
      height: 62%;
      display: block;
    }
    .tris-x { filter: drop-shadow(0 0 6px ${COLOR_X}); }
    .tris-o { filter: drop-shadow(0 0 6px ${COLOR_O}); }

    /* ── Win line SVG overlay ─────────────────────────────────────────── */
    .tris-win-line {
      position: absolute;
      inset: 4px;
      width: calc(100% - 8px);
      height: calc(100% - 8px);
      pointer-events: none;
      animation: tris-line-draw 0.5s ease forwards;
    }
    .tris-win-line-path {
      stroke-dasharray: 10;
      stroke-dashoffset: 10;
      animation: tris-line-draw 0.5s ease forwards;
    }
    @keyframes tris-line-draw {
      to { stroke-dashoffset: 0; }
    }

    /* ── Cell shake (invalid tap) ─────────────────────────────────────── */
    @keyframes tris-shake {
      0%,100% { transform: translateX(0); }
      25% { transform: translateX(-4px); }
      75% { transform: translateX(4px); }
    }
    .tris-cell-shake { animation: tris-shake 0.25s ease; }

    /* ── Round overlay ────────────────────────────────────────────────── */
    .tris-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(11,21,48,0.88);
      border-radius: 8px;
      z-index: 10;
    }
    .tris-overlay-box {
      text-align: center;
      padding: 24px 20px;
    }
    .tris-overlay-title {
      font-family: monospace;
      font-size: clamp(18px, 5vw, 26px);
      font-weight: bold;
      letter-spacing: 3px;
      margin-bottom: 12px;
    }
    .tris-overlay-score {
      font-family: monospace;
      font-size: 13px;
      color: rgba(255,255,255,0.6);
      margin-bottom: 20px;
      letter-spacing: 1px;
    }
    .tris-overlay-actions { display: flex; gap: 12px; justify-content: center; }
    .tris-ov-btn { min-width: 96px; min-height: 44px; font-family: monospace; font-size: 13px; letter-spacing: 1px; }

    /* ── Names dialog ─────────────────────────────────────────────────── */
    .tris-dialog-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.72);
      z-index: 20;
    }
    .tris-dialog {
      background: #0f1e40;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 12px;
      padding: 28px 24px;
      min-width: 240px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .tris-dialog-title {
      font-family: monospace;
      font-size: 16px;
      font-weight: bold;
      letter-spacing: 3px;
      color: ${COLOR_TIE};
      text-align: center;
    }
    .tris-dialog-row { display: flex; align-items: center; gap: 10px; }
    .tris-dialog-label {
      font-family: monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.6);
      min-width: 44px;
    }
    .tris-dialog-input {
      flex: 1;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 6px;
      padding: 8px 10px;
      font-family: monospace;
      font-size: 14px;
      color: #fff;
      outline: none;
    }
    .tris-dialog-input:focus { border-color: ${COLOR_TIE}; }
    .tris-dialog-btn { min-height: 44px; font-family: monospace; font-size: 14px; letter-spacing: 1px; }

    /* ── Onboarding hint ──────────────────────────────────────────────── */
    .tris-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 15;
      animation: tris-hint-fade 0.4s ease;
    }
    @keyframes tris-hint-fade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .tris-hint-inner {
      background: rgba(0,0,0,0.78);
      border-radius: 10px;
      padding: 20px 28px;
      text-align: center;
      pointer-events: auto;
    }
    .tris-hint-line {
      font-family: monospace;
      font-size: 13px;
      color: rgba(255,255,255,0.75);
      margin-top: 6px;
      letter-spacing: 1px;
    }
    .tris-hint-big {
      font-size: 20px;
      font-weight: bold;
      color: ${COLOR_TIE};
      letter-spacing: 4px;
      margin-bottom: 4px;
    }
  `;
  document.head.appendChild(style);
}
