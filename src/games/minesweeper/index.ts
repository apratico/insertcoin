import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";
import { playSfx } from "../../lib/audio.js";

// ---------- types ----------

type CellState = "hidden" | "revealed" | "flagged";

interface Cell {
  mine: boolean;
  adjacent: number;
  state: CellState;
}

type Board = Cell[][];

type Difficulty = "easy" | "medium" | "hard";

type InputMode = "reveal" | "flag";

type Phase = "idle" | "playing" | "dead" | "won";

interface Config {
  cols: number;
  rows: number;
  mines: number;
}

// ---------- constants ----------

const DIFF_KEY = "minesweeper:difficulty";

const CONFIGS: Record<Difficulty, Config> = {
  easy:   { cols: 9,  rows: 9,  mines: 10 },
  medium: { cols: 12, rows: 16, mines: 30 },
  hard:   { cols: 14, rows: 20, mines: 60 },
};

// Classic minesweeper number colours
const NUM_COLORS: Record<number, string> = {
  1: "#4fc3f7",
  2: "#69f0ae",
  3: "#ff5252",
  4: "#ce93d8",
  5: "#ff8a65",
  6: "#80deea",
  7: "#fff176",
  8: "#bdbdbd",
};

// Score formula: max(0, 999 - elapsedSeconds) * difficulty_weight
// Weights: easy=1, medium=2, hard=4
const DIFF_WEIGHT: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 4 };

// ---------- board logic ----------

function makeEmptyBoard(cols: number, rows: number): Board {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      mine: false,
      adjacent: 0,
      state: "hidden" as CellState,
    }))
  );
}

function placeMines(board: Board, cols: number, rows: number, count: number, safeR: number, safeC: number): void {
  const safe = new Set<string>();
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const nr = safeR + dr;
      const nc = safeC + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols)
        safe.add(`${nr},${nc}`);
    }

  let placed = 0;
  while (placed < count) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (!board[r]![c]!.mine && !safe.has(`${r},${c}`)) {
      board[r]![c]!.mine = true;
      placed++;
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r]![c]!.mine) continue;
      let adj = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr]![nc]!.mine)
            adj++;
        }
      board[r]![c]!.adjacent = adj;
    }
  }
}

function floodReveal(board: Board, cols: number, rows: number, startR: number, startC: number): void {
  const queue: Array<[number, number]> = [[startR, startC]];
  while (queue.length > 0) {
    const entry = queue.shift()!;
    const r = entry[0];
    const c = entry[1];
    const cell = board[r]![c]!;
    if (cell.state === "revealed") continue;
    if (cell.state === "flagged") continue;
    cell.state = "revealed";
    if (cell.adjacent === 0 && !cell.mine) {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr]![nc]!.state === "hidden")
            queue.push([nr, nc]);
        }
    }
  }
}

function countRevealed(board: Board): number {
  let n = 0;
  for (const row of board)
    for (const cell of row)
      if (cell.state === "revealed") n++;
  return n;
}

function countFlags(board: Board): number {
  let n = 0;
  for (const row of board)
    for (const cell of row)
      if (cell.state === "flagged") n++;
  return n;
}

function calcScore(difficulty: Difficulty, elapsedSeconds: number): number {
  return Math.max(0, 999 - elapsedSeconds) * DIFF_WEIGHT[difficulty];
}

// ---------- settings persistence ----------

async function loadDifficulty(): Promise<Difficulty> {
  try {
    const row = await db.settings.get(DIFF_KEY);
    if (row && (row.value === "easy" || row.value === "medium" || row.value === "hard"))
      return row.value as Difficulty;
  } catch { /* non-critical */ }
  return "medium";
}

async function saveDifficulty(d: Difficulty): Promise<void> {
  try {
    await db.settings.put({ key: DIFF_KEY, value: d });
  } catch { /* non-critical */ }
}

// ---------- canvas helpers ----------

interface CanvasState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  ro: ResizeObserver;
  cellSize: () => number;
}

function makeCanvas(wrap: HTMLElement, cols: number, rows: number, onAfterResize?: () => void): CanvasState {
  const canvas = document.createElement("canvas");
  canvas.className = "ms-canvas";
  canvas.style.touchAction = "none";
  wrap.appendChild(canvas);

  const raw = canvas.getContext("2d");
  if (!raw) throw new Error("No 2D context");
  const ctx = raw;

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    if (cw < 8 || ch < 8) return;
    const cellW = Math.floor((cw - 2) / cols);
    const cellH = Math.floor((ch - 2) / rows);
    const cell = Math.max(4, Math.min(cellW, cellH));
    const w = cell * cols;
    const h = cell * rows;
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onAfterResize?.();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  function cellSize(): number {
    return parseFloat(canvas.style.width || "200") / cols;
  }

  return { canvas, ctx, ro, cellSize };
}

// ---------- draw ----------

function drawCell(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
  x: number,
  y: number,
  cs: number,
  exploded: boolean,
  gameOver: boolean
): void {
  const pad = 0.5;
  const cx = x + pad;
  const cy = y + pad;
  const cw = cs - pad * 2;
  const ch = cs - pad * 2;

  if (cell.state === "revealed") {
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(cx, cy, cw, ch);

    if (cell.mine) {
      // Mine cell background
      ctx.fillStyle = exploded ? "#6b0000" : "#1a0a0a";
      ctx.fillRect(cx, cy, cw, ch);
      drawMine(ctx, x + cs / 2, y + cs / 2, cs * 0.3);
    } else if (cell.adjacent > 0) {
      const col = NUM_COLORS[cell.adjacent] ?? "#ffffff";
      ctx.fillStyle = col;
      ctx.font = `bold ${Math.round(cs * 0.55)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(cell.adjacent), x + cs / 2, y + cs / 2);
    }
  } else if (cell.state === "flagged") {
    drawCoveredCell(ctx, cx, cy, cw, ch);
    drawFlag(ctx, x + cs / 2, y + cs / 2, cs * 0.28);
    if (gameOver && !cell.mine) {
      // Wrong flag — X overlay
      ctx.strokeStyle = "#ff4040";
      ctx.lineWidth = cs * 0.1;
      ctx.beginPath();
      ctx.moveTo(x + cs * 0.2, y + cs * 0.2);
      ctx.lineTo(x + cs * 0.8, y + cs * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + cs * 0.8, y + cs * 0.2);
      ctx.lineTo(x + cs * 0.2, y + cs * 0.8);
      ctx.stroke();
    }
  } else {
    // hidden
    if (gameOver && cell.mine) {
      ctx.fillStyle = "#1a0a0a";
      ctx.fillRect(cx, cy, cw, ch);
      drawMine(ctx, x + cs / 2, y + cs / 2, cs * 0.28);
    } else {
      drawCoveredCell(ctx, cx, cy, cw, ch);
    }
  }
}

function drawCoveredCell(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number
): void {
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(x, y, w, h);
  // highlight top/left edge
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x, y, w, 1.5);
  ctx.fillRect(x, y, 1.5, h);
  // shadow bottom/right edge
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x, y + h - 1.5, w, 1.5);
  ctx.fillRect(x + w - 1.5, y, 1.5, h);
}

function drawMine(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = "#cc0000";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // spikes
  ctx.strokeStyle = "#cc0000";
  ctx.lineWidth = Math.max(1, r * 0.2);
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * r * 0.9, cy + Math.sin(angle) * r * 0.9);
    ctx.lineTo(cx + Math.cos(angle) * r * 1.55, cy + Math.sin(angle) * r * 1.55);
    ctx.stroke();
  }
  // glint
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.25, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlag(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const px = cx - r * 0.15;
  const poleTop = cy - r * 1.1;
  const poleBot = cy + r * 0.9;
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.moveTo(px, poleTop);
  ctx.lineTo(px, poleBot);
  ctx.stroke();
  // flag triangle
  ctx.fillStyle = "#ff3333";
  ctx.beginPath();
  ctx.moveTo(px, poleTop);
  ctx.lineTo(px + r * 1.1, poleTop + r * 0.5);
  ctx.lineTo(px, poleTop + r);
  ctx.closePath();
  ctx.fill();
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  cols: number,
  rows: number,
  cs: number,
  explodedR: number,
  explodedC: number,
  gameOver: boolean
): void {
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, cols * cs, rows * cs);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r]![c]!;
      const exploded = gameOver && cell.mine && r === explodedR && c === explodedC;
      drawCell(ctx, cell, c * cs, r * cs, cs, exploded, gameOver);
    }
  }
}

// ---------- HUD ----------

interface HudElements {
  mineCountEl: HTMLElement;
  timerEl: HTMLElement;
  modeBtn: HTMLElement;
  newBtn: HTMLElement;
  fsBtn: HTMLElement;
  diffBtn: HTMLElement;
}

function buildHUD(parent: HTMLElement, mines: number, difficulty: Difficulty): HudElements {
  const hud = document.createElement("div");
  hud.className = "ms-hud";
  hud.innerHTML = `
    <div class="ms-hud-left">
      <span class="ms-icon">⚑</span>
      <span class="ms-mine-count" id="ms-mine-count">${mines}</span>
      <span class="ms-sep">|</span>
      <span class="ms-icon">⏱</span>
      <span class="ms-timer" id="ms-timer">0</span>
    </div>
    <div class="ms-hud-right">
      <button class="btn ms-btn" id="ms-diff" aria-label="Difficulty">${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}</button>
      <button class="btn ms-btn ms-mode-btn ms-mode-reveal" id="ms-mode" aria-label="Toggle input mode">⛏</button>
      <button class="btn ms-btn" id="ms-new" aria-label="New game">⟳</button>
      <button class="btn ms-btn" id="ms-fs" aria-label="Fullscreen">⛶</button>
    </div>
  `;
  parent.appendChild(hud);

  return {
    mineCountEl: hud.querySelector("#ms-mine-count") as HTMLElement,
    timerEl:     hud.querySelector("#ms-timer") as HTMLElement,
    modeBtn:     hud.querySelector("#ms-mode") as HTMLElement,
    newBtn:      hud.querySelector("#ms-new") as HTMLElement,
    fsBtn:       hud.querySelector("#ms-fs") as HTMLElement,
    diffBtn:     hud.querySelector("#ms-diff") as HTMLElement,
  };
}

// ---------- overlays ----------

function showGameoverOverlay(
  container: HTMLElement,
  revealed: number,
  elapsed: number,
  onReplay: () => void
): HTMLElement {
  const ov = document.createElement("div");
  ov.className = "ms-overlay";
  ov.innerHTML = `
    <div class="ms-overlay-box">
      <h2 class="ms-ov-title ms-ov-dead">GAME OVER</h2>
      <div class="ms-ov-stat">${revealed} cells revealed</div>
      <div class="ms-ov-stat">${elapsed}s</div>
      <div class="ms-ov-actions">
        <button class="btn primary ms-ov-btn" id="ms-ov-replay">PLAY AGAIN</button>
        <button class="btn ms-ov-btn" id="ms-ov-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(ov);
  ov.querySelector("#ms-ov-replay")?.addEventListener("pointerup", () => { ov.remove(); onReplay(); });
  ov.querySelector("#ms-ov-menu")?.addEventListener("pointerup", () => { navigate("/"); });
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

function showWinOverlay(
  container: HTMLElement,
  score: number,
  best: number,
  elapsed: number,
  onReplay: () => void
): HTMLElement {
  const isNewBest = score > 0 && score >= best;
  const ov = document.createElement("div");
  ov.className = "ms-overlay";
  ov.innerHTML = `
    <div class="ms-overlay-box">
      <h2 class="ms-ov-title ms-ov-win">YOU WIN!</h2>
      ${isNewBest ? `<div class="ms-ov-best-flag">NEW BEST!</div>` : ""}
      <div class="ms-ov-score">${score}</div>
      <div class="ms-ov-label">SCORE</div>
      <div class="ms-ov-stat">${elapsed}s</div>
      <div class="ms-ov-actions">
        <button class="btn primary ms-ov-btn" id="ms-ov-replay">PLAY AGAIN</button>
        <button class="btn ms-ov-btn" id="ms-ov-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(ov);
  ov.querySelector("#ms-ov-replay")?.addEventListener("pointerup", () => { ov.remove(); onReplay(); });
  ov.querySelector("#ms-ov-menu")?.addEventListener("pointerup", () => { navigate("/"); });
  void computeRank("minesweeper", score).then((rank) => {
    if (!rank) return;
    const box = ov.querySelector(".ms-overlay-box");
    const actions = ov.querySelector(".ms-ov-actions");
    if (!box || !actions) return;
    box.insertBefore(buildRankCard(rank, "minesweeper"), actions);
  });
  return ov;
}

function showConfirmOverlay(
  container: HTMLElement,
  message: string,
  onConfirm: () => void
): HTMLElement {
  const ov = document.createElement("div");
  ov.className = "ms-overlay";
  ov.innerHTML = `
    <div class="ms-overlay-box">
      <h2 class="ms-ov-title">${message}</h2>
      <div class="ms-ov-actions">
        <button class="btn primary ms-ov-btn" id="ms-ov-yes">YES</button>
        <button class="btn ms-ov-btn" id="ms-ov-no">CANCEL</button>
      </div>
    </div>
  `;
  container.appendChild(ov);
  ov.querySelector("#ms-ov-yes")?.addEventListener("pointerup", () => { ov.remove(); onConfirm(); });
  ov.querySelector("#ms-ov-no")?.addEventListener("pointerup", () => { ov.remove(); });
  return ov;
}

function showDiffOverlay(
  container: HTMLElement,
  current: Difficulty,
  onPick: (d: Difficulty) => void
): HTMLElement {
  const ov = document.createElement("div");
  ov.className = "ms-overlay";
  ov.innerHTML = `
    <div class="ms-overlay-box">
      <h2 class="ms-ov-title">DIFFICULTY</h2>
      <div class="ms-diff-list">
        <button class="btn ms-ov-btn ms-diff-opt${current === "easy" ? " ms-diff-active" : ""}" data-d="easy">Easy  9×9  10⚑</button>
        <button class="btn ms-ov-btn ms-diff-opt${current === "medium" ? " ms-diff-active" : ""}" data-d="medium">Medium 12×16  30⚑</button>
        <button class="btn ms-ov-btn ms-diff-opt${current === "hard" ? " ms-diff-active" : ""}" data-d="hard">Hard 14×20  60⚑</button>
        <button class="btn ms-ov-btn" id="ms-diff-cancel">CANCEL</button>
      </div>
    </div>
  `;
  container.appendChild(ov);
  ov.querySelectorAll<HTMLElement>(".ms-diff-opt").forEach((btn) => {
    btn.addEventListener("pointerup", () => {
      const d = btn.dataset["d"] as Difficulty | undefined;
      if (d) { ov.remove(); onPick(d); }
    });
  });
  ov.querySelector("#ms-diff-cancel")?.addEventListener("pointerup", () => { ov.remove(); });
  return ov;
}

// ---------- shake animation ----------

function shakeCanvas(canvas: HTMLCanvasElement): void {
  canvas.classList.add("ms-shake");
  setTimeout(() => canvas.classList.remove("ms-shake"), 320);
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("minesweeper-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // State
  let difficulty: Difficulty = "medium";
  let cfg: Config = CONFIGS[difficulty];
  let board: Board = makeEmptyBoard(cfg.cols, cfg.rows);
  let phase: Phase = "idle";
  let inputMode: InputMode = "reveal";
  let startTime = 0;
  let elapsed = 0;
  let timerHandle = 0;
  let explodedR = -1;
  let explodedC = -1;
  let best = 0;
  let activeOverlay: HTMLElement | null = null;

  // Layout: HUD + canvas area
  const wrap = document.createElement("div");
  wrap.className = "ms-wrap";
  container.appendChild(wrap);

  const canvasArea = document.createElement("div");
  canvasArea.className = "ms-canvas-area";
  wrap.appendChild(canvasArea);

  // Canvas is created fresh on each newGame — kept in a wrapper
  let cs: CanvasState | null = null;

  let hud: HudElements;

  // Load persisted difficulty, then build HUD and start
  void loadDifficulty().then((d) => {
    difficulty = d;
    cfg = CONFIGS[difficulty];
    hud = buildHUD(wrap, cfg.mines, difficulty);
    wrap.insertBefore(wrap.querySelector(".ms-hud")!, canvasArea);
    wireHUD();
    void personalBest("minesweeper").then((b) => { best = b; });
    startNewGame();
  });

  function wireHUD(): void {
    hud.fsBtn.addEventListener("pointerup", () => {
      const root = container.closest(".game-host") as HTMLElement | null;
      const target = root ?? container;
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void target.requestFullscreen().catch(() => {});
      }
    });

    hud.newBtn.addEventListener("pointerup", () => {
      if (activeOverlay) return;
      if (phase === "playing") {
        activeOverlay = showConfirmOverlay(container, "NEW GAME?", () => {
          activeOverlay = null;
          startNewGame();
        });
        activeOverlay.querySelector("#ms-ov-no")?.addEventListener("pointerup", () => {
          activeOverlay = null;
        });
      } else {
        startNewGame();
      }
    });

    hud.modeBtn.addEventListener("pointerup", () => {
      inputMode = inputMode === "reveal" ? "flag" : "reveal";
      hud.modeBtn.textContent = inputMode === "reveal" ? "⛏" : "⚑";
      hud.modeBtn.classList.toggle("ms-mode-flag", inputMode === "flag");
      hud.modeBtn.classList.toggle("ms-mode-reveal", inputMode === "reveal");
    });

    hud.diffBtn.addEventListener("pointerup", () => {
      if (activeOverlay) return;
      activeOverlay = showDiffOverlay(container, difficulty, (d) => {
        activeOverlay = null;
        const changed = d !== difficulty;
        difficulty = d;
        cfg = CONFIGS[difficulty];
        void saveDifficulty(difficulty);
        hud.diffBtn.textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
        if (changed) {
          if (phase === "playing") {
            activeOverlay = showConfirmOverlay(container, "CHANGE DIFFICULTY?", () => {
              activeOverlay = null;
              startNewGame();
            });
            activeOverlay.querySelector("#ms-ov-no")?.addEventListener("pointerup", () => {
              activeOverlay = null;
            });
          } else {
            startNewGame();
          }
        }
      });
    });
  }

  function startNewGame(): void {
    stopTimer();
    phase = "idle";
    explodedR = -1;
    explodedC = -1;
    elapsed = 0;
    inputMode = "reveal";
    if (hud) {
      hud.modeBtn.textContent = "⛏";
      hud.modeBtn.classList.remove("ms-mode-flag");
      hud.modeBtn.classList.add("ms-mode-reveal");
      hud.mineCountEl.textContent = String(cfg.mines);
      hud.timerEl.textContent = "0";
    }

    board = makeEmptyBoard(cfg.cols, cfg.rows);

    // Destroy old canvas
    if (cs) {
      cs.ro.disconnect();
      cs.canvas.remove();
      cs = null;
    }
    cs = makeCanvas(canvasArea, cfg.cols, cfg.rows, () => renderBoard());
    wireCanvasInput(cs.canvas);
    requestAnimationFrame(() => { renderBoard(); });
  }

  function startTimer(): void {
    startTime = Date.now();
    timerHandle = window.setInterval(() => {
      elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (hud) hud.timerEl.textContent = String(elapsed);
    }, 500);
  }

  function stopTimer(): void {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = 0; }
    if (startTime > 0) {
      elapsed = Math.floor((Date.now() - startTime) / 1000);
    }
    startTime = 0;
  }

  function renderBoard(): void {
    if (!cs) return;
    const cellSz = cs.cellSize();
    drawBoard(cs.ctx, board, cfg.cols, cfg.rows, cellSz, explodedR, explodedC, phase === "dead");
  }

  function cellFromPointer(e: PointerEvent): { r: number; c: number } | null {
    if (!cs) return null;
    const rect = cs.canvas.getBoundingClientRect();
    const cellSz = cs.cellSize();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor(x / cellSz);
    const r = Math.floor(y / cellSz);
    if (r < 0 || r >= cfg.rows || c < 0 || c >= cfg.cols) return null;
    return { r, c };
  }

  function doReveal(r: number, c: number): void {
    const cell = board[r]![c]!;
    if (cell.state !== "hidden") return;
    if (phase === "dead" || phase === "won") return;

    if (phase === "idle") {
      placeMines(board, cfg.cols, cfg.rows, cfg.mines, r, c);
      phase = "playing";
      startTimer();
    }

    floodReveal(board, cfg.cols, cfg.rows, r, c);
    playSfx("click");
    navigator.vibrate?.(10);

    if (cell.mine) {
      explodedR = r;
      explodedC = c;
      phase = "dead";
      stopTimer();
      playSfx("gameover");
      navigator.vibrate?.([50, 50, 100]);
      renderBoard();
      shakeCanvas(cs!.canvas);
      setTimeout(() => {
        if (activeOverlay) return;
        activeOverlay = showGameoverOverlay(container, countRevealed(board), elapsed, () => {
          activeOverlay = null;
          startNewGame();
        });
      }, 400);
      return;
    }

    updateMineCount();
    renderBoard();
    checkWin();
  }

  function doFlag(r: number, c: number): void {
    const cell = board[r]![c]!;
    if (phase === "dead" || phase === "won") return;
    if (cell.state === "revealed") return;

    if (cell.state === "hidden") {
      cell.state = "flagged";
    } else {
      cell.state = "hidden";
    }
    playSfx("place");
    navigator.vibrate?.(5);
    updateMineCount();
    renderBoard();
  }

  function updateMineCount(): void {
    if (hud) hud.mineCountEl.textContent = String(cfg.mines - countFlags(board));
  }

  function checkWin(): void {
    const total = cfg.cols * cfg.rows;
    if (countRevealed(board) === total - cfg.mines) {
      phase = "won";
      stopTimer();
      playSfx("win");
      navigator.vibrate?.([30, 60, 30, 60, 100]);
      const score = calcScore(difficulty, elapsed);
      void submit("minesweeper", score);
      void personalBest("minesweeper").then((b) => {
        best = b;
        if (activeOverlay) return;
        activeOverlay = showWinOverlay(container, score, best, elapsed, () => {
          activeOverlay = null;
          startNewGame();
        });
      });
    }
  }

  // ---------- pointer input ----------

  function wireCanvasInput(canvas: HTMLCanvasElement): void {
    const LONG_PRESS_MS = 500;
    const DOUBLE_TAP_MS = 500;
    const MOVE_THRESHOLD = 10;

    let downR = -1;
    let downC = -1;
    let downX = 0;
    let downY = 0;
    let longPressHandle = 0;
    let longFired = false;

    // Double-tap = flag fallback for users whose long-press is unreliable
    let lastTapR = -1;
    let lastTapC = -1;
    let lastTapTime = 0;

    function onPointerDown(e: PointerEvent): void {
      if (activeOverlay || phase === "dead" || phase === "won") return;
      e.preventDefault();
      const pos = cellFromPointer(e);
      if (!pos) return;
      downR = pos.r;
      downC = pos.c;
      downX = e.clientX;
      downY = e.clientY;
      longFired = false;

      longPressHandle = window.setTimeout(() => {
        longFired = true;
        navigator.vibrate?.(15);
        doFlag(downR, downC);
      }, LONG_PRESS_MS);
    }

    function onPointerUp(e: PointerEvent): void {
      clearTimeout(longPressHandle);
      if (activeOverlay || phase === "dead" || phase === "won") return;
      if (longFired) {
        // consume — long-press already flagged
        lastTapR = -1;
        lastTapC = -1;
        return;
      }

      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      const moved = Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD;
      if (moved) return;

      const pos = cellFromPointer(e);
      if (!pos) return;
      if (pos.r !== downR || pos.c !== downC) return;

      const now = e.timeStamp;
      const isDoubleTap =
        lastTapR === pos.r && lastTapC === pos.c && now - lastTapTime < DOUBLE_TAP_MS;
      lastTapR = pos.r;
      lastTapC = pos.c;
      lastTapTime = now;

      if (inputMode === "flag") {
        // Flag mode: tap only ADDS a flag; removal requires long-press.
        // Avoids the oscillation users saw when tapping repeatedly.
        const cell = board[pos.r]![pos.c]!;
        if (cell.state === "hidden") doFlag(pos.r, pos.c);
        return;
      }

      // Reveal mode
      const cell = board[pos.r]![pos.c]!;
      if (cell.state === "flagged") return;

      if (isDoubleTap && cell.state === "hidden") {
        // Double-tap fallback = place flag when long-press was missed
        doFlag(pos.r, pos.c);
        lastTapR = -1;
        lastTapC = -1;
        return;
      }

      doReveal(pos.r, pos.c);
    }

    function onPointerCancel(): void {
      clearTimeout(longPressHandle);
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const pos = cellFromPointer(e as unknown as PointerEvent);
      if (pos) doFlag(pos.r, pos.c);
    });
  }

  // ---------- keyboard ----------

  function onKey(e: KeyboardEvent): void {
    if (e.key === "f" || e.key === "F") {
      hud.modeBtn.dispatchEvent(new PointerEvent("pointerup"));
    }
    if (e.key === "n" || e.key === "N") {
      hud.newBtn.dispatchEvent(new PointerEvent("pointerup"));
    }
  }
  document.addEventListener("keydown", onKey);

  // ---------- cleanup ----------

  return function cleanup(): void {
    stopTimer();
    document.removeEventListener("keydown", onKey);
    if (cs) { cs.ro.disconnect(); }
    container.innerHTML = "";
    container.classList.remove("minesweeper-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "ms-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .minesweeper-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #0f172a;
      user-select: none;
      -webkit-user-select: none;
    }
    .ms-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-height: 0;
      padding: 6px;
      gap: 6px;
      box-sizing: border-box;
    }
    .ms-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-width: 520px;
      font-family: monospace;
      flex-shrink: 0;
      padding: 2px 0;
    }
    .ms-hud-left {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 14px;
      color: #94a3b8;
    }
    .ms-hud-right {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .ms-icon { font-size: 13px; }
    .ms-mine-count, .ms-timer {
      font-size: 16px;
      font-weight: bold;
      color: #e2e8f0;
      min-width: 28px;
    }
    .ms-sep { color: #334155; margin: 0 2px; }
    .ms-btn {
      min-width: 44px;
      min-height: 44px;
      font-size: 15px;
      border-color: #334155;
      color: #94a3b8;
      background: #1e293b;
      font-family: monospace;
      padding: 0 8px;
    }
    .ms-btn:active { background: #2d3f55; }
    .ms-mode-btn { font-size: 17px; }
    .ms-mode-flag {
      background: #1a2e1a;
      border-color: #ff5555;
      color: #ff8888;
    }
    .ms-mode-reveal {
      background: #1a2040;
      border-color: #4fc3f7;
      color: #7dd3fc;
    }
    .ms-canvas-area {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    }
    .ms-canvas {
      display: block;
      cursor: pointer;
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
    }
    @keyframes ms-shake {
      0%  { transform: translateX(0); }
      15% { transform: translateX(-6px) rotate(-1deg); }
      30% { transform: translateX(6px) rotate(1deg); }
      45% { transform: translateX(-4px); }
      60% { transform: translateX(4px); }
      75% { transform: translateX(-2px); }
      100%{ transform: translateX(0); }
    }
    .ms-shake { animation: ms-shake 320ms ease; }
    .ms-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.82);
      z-index: 20;
    }
    .ms-overlay-box {
      text-align: center;
      padding: 28px 24px;
      background: #0f1e35;
      border: 1px solid #334155;
      border-radius: 12px;
      min-width: 220px;
      max-width: 88vw;
    }
    .ms-ov-title {
      margin: 0 0 12px;
      font-family: monospace;
      font-size: 20px;
      color: #e2e8f0;
      letter-spacing: 3px;
    }
    .ms-ov-dead {
      color: #ff5252;
      text-shadow: 0 0 12px rgba(255,82,82,0.7);
    }
    .ms-ov-win {
      color: #69f0ae;
      text-shadow: 0 0 16px rgba(105,240,174,0.7);
    }
    .ms-ov-best-flag {
      color: #ffd54f;
      font-family: monospace;
      font-size: 11px;
      letter-spacing: 2px;
      margin-bottom: 6px;
    }
    .ms-ov-score {
      font-family: monospace;
      font-size: 46px;
      font-weight: bold;
      color: #4fc3f7;
      text-shadow: 0 0 16px rgba(79,195,247,0.7);
      line-height: 1;
    }
    .ms-ov-label {
      font-family: monospace;
      font-size: 10px;
      color: #64748b;
      letter-spacing: 2px;
      margin-bottom: 14px;
    }
    .ms-ov-stat {
      font-family: monospace;
      font-size: 13px;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .ms-ov-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    .ms-ov-btn {
      min-width: 96px;
      min-height: 44px;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 1px;
    }
    .ms-diff-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: stretch;
    }
    .ms-diff-opt {
      font-size: 13px;
      letter-spacing: 0.5px;
    }
    .ms-diff-active {
      border-color: #4fc3f7 !important;
      color: #4fc3f7 !important;
    }
  `;
  document.head.appendChild(style);
}
