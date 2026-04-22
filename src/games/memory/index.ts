import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";

// ---------- types ----------

type Difficulty = "easy" | "medium" | "hard";
type Phase = "playing" | "checking" | "won";

interface CardState {
  symbol: string;
  color: string;
  pairId: number;
  faceUp: boolean;
  matched: boolean;
}

// ---------- constants ----------

const HINT_KEY = "memory:seenHint";
const DIFF_KEY = "memory:difficulty";
const FLIP_MS = 250;
const MISMATCH_WAIT_MS = 1000;

const SYMBOLS: string[] = [
  "★", "♥", "♦", "♠", "♣", "◆", "●", "▲",
  "■", "☀", "☾", "⚡", "✦", "✿", "♪", "♛",
  "⚙", "☢",
];

const COLORS: string[] = [
  "#ffe600", "#ff6eb4", "#ff8c00", "#b366ff", "#44cc66", "#00e5ff",
  "#ff4444", "#66aaff", "#ff9900", "#ff66cc", "#33ffcc", "#ff3d68",
  "#aaffaa", "#ffaa00", "#cc99ff", "#00ccff", "#ff6600", "#ff3333",
];

const GRID: Record<Difficulty, { cols: number; rows: number; pairs: number }> = {
  easy:   { cols: 4, rows: 3,  pairs: 6  },
  medium: { cols: 4, rows: 4,  pairs: 8  },
  hard:   { cols: 6, rows: 5,  pairs: 15 },
};

const DIFF_WEIGHT: Record<Difficulty, number> = {
  easy: 1, medium: 2, hard: 3,
};

// ---------- helpers ----------

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function calcScore(diff: Difficulty, moves: number, seconds: number): number {
  return Math.max(0, DIFF_WEIGHT[diff] * 1000 - moves * 5 - seconds * 2);
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function buildDeck(diff: Difficulty): CardState[] {
  const { pairs } = GRID[diff];
  const deck: CardState[] = [];
  for (let p = 0; p < pairs; p++) {
    const symbol = SYMBOLS[p]!;
    const color  = COLORS[p]!;
    for (let k = 0; k < 2; k++) {
      deck.push({ symbol, color, pairId: p, faceUp: false, matched: false });
    }
  }
  return shuffle(deck);
}

// ---------- persistence helpers ----------

async function loadDiff(): Promise<Difficulty> {
  try {
    const row = await db.settings.get(DIFF_KEY);
    if (row && (row.value === "easy" || row.value === "medium" || row.value === "hard")) {
      return row.value;
    }
  } catch { /* ignore */ }
  return "medium";
}

async function saveDiff(d: Difficulty): Promise<void> {
  try {
    await db.settings.put({ key: DIFF_KEY, value: d });
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
  const id = "mem-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .memory-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #1b003b;
      user-select: none;
      -webkit-user-select: none;
    }
    .mem-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-height: 0;
      padding: 8px 8px 10px;
      gap: 8px;
      box-sizing: border-box;
    }
    /* HUD top */
    .mem-hud-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-width: 420px;
      flex-shrink: 0;
      font-family: var(--font-mono, monospace);
      gap: 6px;
    }
    .mem-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: #2d0057;
      border-radius: 6px;
      padding: 4px 8px;
      min-width: 52px;
      flex: 1;
    }
    .mem-stat-label {
      font-size: 9px;
      letter-spacing: 1.5px;
      color: #7c3aed;
      margin-bottom: 1px;
    }
    .mem-stat-val {
      font-size: 15px;
      font-weight: bold;
      color: #c084fc;
      text-shadow: 0 0 8px rgba(192,132,252,0.5);
      min-width: 34px;
      text-align: center;
    }
    .mem-diff-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: #2d0057;
      border-radius: 6px;
      padding: 4px 8px;
      min-width: 52px;
      flex: 1;
      border: 1px solid #7c3aed;
      cursor: pointer;
      min-height: 44px;
      font-family: var(--font-mono, monospace);
    }
    .mem-diff-btn:active { background: #3d0073; }
    /* HUD bottom */
    .mem-hud-bottom {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      max-width: 420px;
      flex-shrink: 0;
    }
    .mem-btn {
      min-width: 44px;
      min-height: 44px;
      font-size: 13px;
      font-family: var(--font-mono, monospace);
      letter-spacing: 1px;
      border: 1px solid #7c3aed;
      color: #c084fc;
      background: #2d0057;
      border-radius: 8px;
      cursor: pointer;
      padding: 0 12px;
      transition: background 80ms;
    }
    .mem-btn:active { background: #3d0073; }
    .mem-btn-wide { flex: 1; max-width: 160px; }
    /* Grid area */
    .mem-grid-area {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      max-width: 420px;
      position: relative;
    }
    /* CSS grid */
    .mem-grid {
      display: grid;
      gap: 6px;
      padding: 6px;
      background: #2d0057;
      border-radius: 10px;
      border: 1px solid #7c3aed;
      box-sizing: border-box;
    }
    /* Card */
    .mem-card {
      border-radius: 8px;
      cursor: pointer;
      perspective: 600px;
      aspect-ratio: 3 / 4;
      position: relative;
    }
    .mem-card-inner {
      width: 100%;
      height: 100%;
      position: relative;
      transform-style: preserve-3d;
      transition: transform ${FLIP_MS}ms ease;
      border-radius: 8px;
    }
    .mem-card.face-up .mem-card-inner {
      transform: rotateY(180deg);
    }
    .mem-card-back,
    .mem-card-front {
      position: absolute;
      inset: 0;
      border-radius: 8px;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mem-card-back {
      background: #3d0073;
      border: 1px solid #7c3aed;
      flex-direction: column;
      gap: 4px;
    }
    .mem-card-back-pattern {
      width: 60%;
      height: 60%;
      background: repeating-linear-gradient(
        45deg,
        transparent,
        transparent 4px,
        rgba(124,58,237,0.25) 4px,
        rgba(124,58,237,0.25) 8px
      );
      border-radius: 4px;
    }
    .mem-card-back-q {
      position: absolute;
      font-size: clamp(14px, 3.5vw, 20px);
      color: rgba(192,132,252,0.2);
      font-family: var(--font-mono, monospace);
      font-weight: bold;
    }
    .mem-card-front {
      transform: rotateY(180deg);
      background: #1b003b;
      border: 1px solid #7c3aed;
    }
    .mem-card-symbol {
      font-size: clamp(18px, 5.5vw, 36px);
      line-height: 1;
    }
    .mem-card.matched .mem-card-front {
      border-color: currentColor;
      box-shadow: 0 0 10px 2px currentColor;
    }
    @keyframes mem-match-pop {
      0%   { transform: rotateY(180deg) scale(1); }
      50%  { transform: rotateY(180deg) scale(1.12); }
      100% { transform: rotateY(180deg) scale(1); }
    }
    .mem-card.matched .mem-card-inner {
      animation: mem-match-pop 300ms ease both;
    }
    /* Overlays */
    .mem-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.82);
      z-index: 20;
      border-radius: 10px;
    }
    .mem-overlay-box {
      text-align: center;
      padding: 28px 24px;
      background: #1b003b;
      border: 1px solid #7c3aed;
      border-radius: 14px;
      min-width: 240px;
      max-width: 92vw;
    }
    .mem-ov-title {
      margin: 0 0 8px;
      font-family: var(--font-mono, monospace);
      font-size: 20px;
      color: #c084fc;
      letter-spacing: 3px;
      text-shadow: 0 0 14px rgba(192,132,252,0.8);
    }
    .mem-ov-row {
      font-family: var(--font-mono, monospace);
      font-size: 13px;
      color: #a78bfa;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .mem-ov-score {
      font-family: var(--font-mono, monospace);
      font-size: 48px;
      font-weight: bold;
      color: #c084fc;
      text-shadow: 0 0 18px rgba(192,132,252,0.7);
      line-height: 1;
      margin: 10px 0 4px;
    }
    .mem-ov-label {
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      color: #7c3aed;
      letter-spacing: 2px;
      margin-bottom: 18px;
    }
    .mem-ov-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .mem-ov-btn {
      min-width: 96px;
      min-height: 44px;
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      letter-spacing: 1px;
    }
    /* Rank card */
    .mem-rank-card {
      background: #2d0057;
      border: 1px solid #7c3aed;
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 12px;
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      color: #a78bfa;
    }
    .mem-rank-title { font-size: 14px; color: #c084fc; margin-bottom: 4px; }
    .mem-rank-delta { font-size: 11px; color: #7c3aed; margin-bottom: 6px; }
    .mem-rank-btn {
      min-height: 36px;
      font-size: 11px;
      letter-spacing: 1px;
    }
    /* Hint overlay */
    .mem-hint-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      pointer-events: none;
      background: rgba(0,0,0,0.55);
      transition: opacity 350ms ease;
      border-radius: 10px;
    }
    .mem-hint-overlay.mem-hint-fade { opacity: 0; }
    .mem-hint-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 20px 26px 16px;
      background: rgba(27,0,59,0.92);
      border: 1px solid rgba(192,132,252,0.4);
      border-radius: 14px;
    }
    .mem-hint-title {
      font-family: var(--font-mono, monospace);
      font-size: clamp(16px, 4vw, 20px);
      font-weight: bold;
      letter-spacing: 3px;
      color: #c084fc;
      text-shadow: 0 0 14px rgba(192,132,252,0.8);
    }
    .mem-hint-sub {
      font-family: var(--font-mono, monospace);
      font-size: clamp(10px, 2.5vw, 12px);
      color: #7c3aed;
      letter-spacing: 1px;
      text-align: center;
    }
    /* Diff picker */
    .mem-picker-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.78);
      z-index: 30;
      border-radius: 10px;
    }
    .mem-picker-box {
      background: #1b003b;
      border: 1px solid #7c3aed;
      border-radius: 14px;
      padding: 24px 20px;
      min-width: 200px;
      text-align: center;
    }
    .mem-picker-title {
      font-family: var(--font-mono, monospace);
      font-size: 14px;
      color: #a78bfa;
      letter-spacing: 2px;
      margin-bottom: 14px;
    }
    .mem-picker-opts {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .mem-picker-opt {
      min-height: 44px;
      font-family: var(--font-mono, monospace);
      font-size: 13px;
      letter-spacing: 1px;
      border: 1px solid #7c3aed;
      color: #c084fc;
      background: #2d0057;
      border-radius: 8px;
      cursor: pointer;
    }
    .mem-picker-opt:active,
    .mem-picker-opt.selected { background: #7c3aed; color: #fff; }
    .mem-picker-cancel {
      margin-top: 12px;
      min-height: 36px;
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      letter-spacing: 1px;
      border: 1px solid #4b2060;
      color: #7c3aed;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      width: 100%;
    }
    .mem-picker-cancel:active { background: #2d0057; }
  `;
  document.head.appendChild(style);
}

// ---------- rank card helper ----------

function buildRankCard(rank: RankInfo): HTMLElement {
  const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="mem-rank-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta} pts</div>`
    : "";
  const card = document.createElement("div");
  card.className = "mem-rank-card";
  card.innerHTML = `
    <div class="mem-rank-title">RANK ${rankLabel} GLOBAL</div>
    ${deltaHtml}
    <button class="btn mem-rank-btn" data-scores-id="memory">VIEW LEADERBOARD</button>
  `;
  card.querySelector<HTMLElement>(".mem-rank-btn")?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    navigate("/scores/memory");
  });
  return card;
}

// ---------- mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("memory-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  if (container.clientWidth < 8 || container.clientHeight < 8) {
    return function cleanup() {
      container.classList.remove("memory-root");
      container.style.touchAction = prevTouchAction;
    };
  }

  // --- state ---
  let difficulty: Difficulty = "medium";
  let deck: CardState[] = [];
  let phase: Phase = "playing";
  let flipped: number[] = [];   // indices of currently face-up, unmatched cards (max 2)
  let moves = 0;
  let matched = 0;
  let elapsed = 0;
  let best = 0;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let timerRunning = false;
  let hintOverlay: HTMLElement | null = null;
  let activeOverlay: HTMLElement | null = null;
  let mismatchTimer: ReturnType<typeof setTimeout> | null = null;

  // --- layout ---
  const wrap = document.createElement("div");
  wrap.className = "mem-wrap";
  container.appendChild(wrap);

  // HUD top
  const hudTop = document.createElement("div");
  hudTop.className = "mem-hud-top";
  wrap.appendChild(hudTop);

  const timerStat = document.createElement("div");
  timerStat.className = "mem-stat";
  timerStat.innerHTML = `<span class="mem-stat-label">TIMER</span><span class="mem-stat-val" id="mem-timer">00:00</span>`;

  const movesStat = document.createElement("div");
  movesStat.className = "mem-stat";
  movesStat.innerHTML = `<span class="mem-stat-label">MOVES</span><span class="mem-stat-val" id="mem-moves">0</span>`;

  const diffBtn = document.createElement("button");
  diffBtn.className = "mem-diff-btn";
  diffBtn.innerHTML = `<span class="mem-stat-label">DIFF</span><span class="mem-stat-val" id="mem-diff-val">MED</span>`;

  const bestStat = document.createElement("div");
  bestStat.className = "mem-stat";
  bestStat.innerHTML = `<span class="mem-stat-label">BEST</span><span class="mem-stat-val" id="mem-best">-</span>`;

  hudTop.appendChild(timerStat);
  hudTop.appendChild(movesStat);
  hudTop.appendChild(diffBtn);
  hudTop.appendChild(bestStat);

  const timerEl  = hudTop.querySelector("#mem-timer")   as HTMLElement;
  const movesEl  = hudTop.querySelector("#mem-moves")   as HTMLElement;
  const diffVal  = hudTop.querySelector("#mem-diff-val") as HTMLElement;
  const bestEl   = hudTop.querySelector("#mem-best")    as HTMLElement;

  // Grid area
  const gridArea = document.createElement("div");
  gridArea.className = "mem-grid-area";
  wrap.appendChild(gridArea);

  const grid = document.createElement("div");
  grid.className = "mem-grid";
  gridArea.appendChild(grid);

  // HUD bottom
  const hudBottom = document.createElement("div");
  hudBottom.className = "mem-hud-bottom";
  wrap.appendChild(hudBottom);

  const newBtn = document.createElement("button");
  newBtn.className = "mem-btn mem-btn-wide";
  newBtn.textContent = "NEW GAME";

  const fsBtn = document.createElement("button");
  fsBtn.className = "mem-btn";
  fsBtn.textContent = "⛶";
  fsBtn.setAttribute("aria-label", "Fullscreen");

  hudBottom.appendChild(newBtn);
  hudBottom.appendChild(fsBtn);

  // Card DOM pool (rebuilt on each new game)
  let cardEls: HTMLElement[] = [];

  // ---------- timer ----------

  function startTimer(): void {
    if (timerRunning) return;
    timerRunning = true;
    timerInterval = setInterval(() => {
      elapsed++;
      timerEl.textContent = fmtTime(elapsed);
    }, 1000);
  }

  function stopTimer(): void {
    timerRunning = false;
    if (timerInterval !== null) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // ---------- grid sizing ----------

  function sizeGrid(): void {
    const { cols, rows } = GRID[difficulty];
    const areaW = gridArea.clientWidth  || 340;
    const areaH = gridArea.clientHeight || 440;
    const pad   = 12;   // total grid padding (6px each side)
    const gap   = 6;

    // Max card width/height respecting 3/4 aspect ratio
    const maxCardW = (areaW - pad - (cols - 1) * gap) / cols;
    const maxCardH = (areaH - pad - (rows - 1) * gap) / rows;

    // Fit within both axes while keeping 3:4 ratio
    let cardW = Math.min(maxCardW, maxCardH * 0.75);
    cardW = Math.max(cardW, 36); // never collapse

    const gridW = cols * cardW + (cols - 1) * gap + pad;
    const gridH = rows * (cardW / 0.75) + (rows - 1) * gap + pad;

    grid.style.gridTemplateColumns = `repeat(${cols}, ${cardW}px)`;
    grid.style.gridTemplateRows    = `repeat(${rows}, ${cardW / 0.75}px)`;
    grid.style.width  = `${gridW}px`;
    grid.style.height = `${gridH}px`;
  }

  // ---------- render ----------

  function buildCards(): void {
    // Remove old cards
    grid.innerHTML = "";
    cardEls = [];

    for (let i = 0; i < deck.length; i++) {
      const card = deck[i]!;
      const el = document.createElement("div");
      el.className = "mem-card";
      el.dataset["idx"] = String(i);
      el.innerHTML = `
        <div class="mem-card-inner">
          <div class="mem-card-back">
            <div class="mem-card-back-pattern"></div>
            <span class="mem-card-back-q">?</span>
          </div>
          <div class="mem-card-front">
            <span class="mem-card-symbol" style="color:${card.color}">${card.symbol}</span>
          </div>
        </div>
      `;
      cardEls.push(el);
      grid.appendChild(el);
    }
  }

  function syncCard(idx: number): void {
    const card = deck[idx]!;
    const el   = cardEls[idx]!;
    if (card.faceUp || card.matched) {
      el.classList.add("face-up");
    } else {
      el.classList.remove("face-up");
    }
    if (card.matched) {
      el.classList.add("matched");
      const front = el.querySelector<HTMLElement>(".mem-card-front");
      if (front) front.style.borderColor = card.color;
      const inner = el.querySelector<HTMLElement>(".mem-card-inner");
      if (inner) inner.style.boxShadow = `0 0 10px 2px ${card.color}`;
    }
  }

  // ---------- game logic ----------

  function startNewGame(): void {
    // Clear any pending mismatch timer
    if (mismatchTimer !== null) {
      clearTimeout(mismatchTimer);
      mismatchTimer = null;
    }
    stopTimer();

    phase   = "playing";
    flipped = [];
    moves   = 0;
    matched = 0;
    elapsed = 0;
    timerRunning = false;
    movesEl.textContent  = "0";
    timerEl.textContent  = "00:00";

    deck = buildDeck(difficulty);
    buildCards();
    sizeGrid();
    updateDiffDisplay();
  }

  function updateDiffDisplay(): void {
    const labels: Record<Difficulty, string> = { easy: "EZY", medium: "MED", hard: "HRD" };
    diffVal.textContent = labels[difficulty];
  }

  function flipCard(idx: number): void {
    if (phase !== "playing") return;
    const card = deck[idx]!;
    if (card.faceUp || card.matched) return;
    if (flipped.length >= 2) return;

    // Dismiss hint on first flip
    if (hintOverlay) dismissHint();
    // Start timer on first flip
    if (moves === 0 && elapsed === 0 && flipped.length === 0) startTimer();

    navigator.vibrate?.(4);
    card.faceUp = true;
    flipped.push(idx);
    syncCard(idx);

    if (flipped.length === 2) {
      moves++;
      movesEl.textContent = String(moves);
      phase = "checking";

      const [i0, i1] = flipped as [number, number];
      const c0 = deck[i0]!;
      const c1 = deck[i1]!;

      if (c0.pairId === c1.pairId) {
        // Match
        navigator.vibrate?.(15);
        setTimeout(() => {
          c0.matched = true;
          c1.matched = true;
          c0.faceUp  = true;
          c1.faceUp  = true;
          syncCard(i0);
          syncCard(i1);
          flipped = [];
          matched += 2;
          phase = "playing";

          if (matched === deck.length) {
            handleWin();
          }
        }, FLIP_MS + 20);
      } else {
        // Mismatch
        navigator.vibrate?.(5);
        mismatchTimer = setTimeout(() => {
          mismatchTimer = null;
          c0.faceUp = false;
          c1.faceUp = false;
          syncCard(i0);
          syncCard(i1);
          flipped = [];
          phase = "playing";
        }, MISMATCH_WAIT_MS);
      }
    }
  }

  function handleWin(): void {
    stopTimer();
    phase = "won";
    const score = calcScore(difficulty, moves, elapsed);
    navigator.vibrate?.([30, 60, 30, 60, 100]);
    void submit("memory", score);
    void personalBest("memory").then((pb) => {
      if (score > 0 && score >= pb) {
        best = score;
        bestEl.textContent = String(best);
      }
    });
    showWinOverlay(score);
  }

  // ---------- overlays ----------

  function showWinOverlay(score: number): void {
    const ov = document.createElement("div");
    ov.className = "mem-overlay";
    ov.innerHTML = `
      <div class="mem-overlay-box">
        <h2 class="mem-ov-title">COMPLETATO!</h2>
        <div class="mem-ov-row">Tempo: ${fmtTime(elapsed)}</div>
        <div class="mem-ov-row">Mosse: ${moves}</div>
        <div class="mem-ov-score">${score}</div>
        <div class="mem-ov-label">SCORE</div>
        <div class="mem-ov-actions">
          <button class="btn primary mem-ov-btn" id="mem-ov-new">NEW GAME</button>
          <button class="btn mem-ov-btn" id="mem-ov-menu">MENU</button>
        </div>
      </div>
    `;
    gridArea.appendChild(ov);
    activeOverlay = ov;

    ov.querySelector("#mem-ov-new")?.addEventListener("pointerup", () => {
      ov.remove();
      activeOverlay = null;
      startNewGame();
    });
    ov.querySelector("#mem-ov-menu")?.addEventListener("pointerup", () => {
      navigate("/");
    });

    void computeRank("memory", score).then((rank) => {
      if (!rank) return;
      const box     = ov.querySelector(".mem-overlay-box");
      const actions = ov.querySelector(".mem-ov-actions");
      if (!box || !actions) return;
      box.insertBefore(buildRankCard(rank), actions);
    });
  }

  function showDiffPicker(): void {
    if (activeOverlay) return;
    const ov = document.createElement("div");
    ov.className = "mem-picker-overlay";
    ov.innerHTML = `
      <div class="mem-picker-box">
        <div class="mem-picker-title">DIFFICOLTA'</div>
        <div class="mem-picker-opts">
          <button class="mem-picker-opt${difficulty === "easy"   ? " selected" : ""}" data-d="easy">EASY — 4×3</button>
          <button class="mem-picker-opt${difficulty === "medium" ? " selected" : ""}" data-d="medium">MEDIUM — 4×4</button>
          <button class="mem-picker-opt${difficulty === "hard"   ? " selected" : ""}" data-d="hard">HARD — 6×5</button>
        </div>
        <button class="mem-picker-cancel" id="mem-picker-cancel">CANCEL</button>
      </div>
    `;
    gridArea.appendChild(ov);
    activeOverlay = ov;

    ov.querySelectorAll<HTMLElement>(".mem-picker-opt").forEach((btn) => {
      btn.addEventListener("pointerup", () => {
        const d = btn.dataset["d"] as Difficulty | undefined;
        if (!d) return;
        difficulty = d;
        void saveDiff(d);
        ov.remove();
        activeOverlay = null;
        startNewGame();
        void personalBest("memory").then((pb) => {
          if (pb > 0) { best = pb; bestEl.textContent = String(pb); }
        });
      });
    });
    ov.querySelector("#mem-picker-cancel")?.addEventListener("pointerup", () => {
      ov.remove();
      activeOverlay = null;
    });
  }

  // ---------- hint ----------

  function buildHintOverlay(): HTMLElement {
    const ov = document.createElement("div");
    ov.className = "mem-hint-overlay";
    ov.innerHTML = `
      <div class="mem-hint-box">
        <div class="mem-hint-title">TAP TO FLIP</div>
        <div class="mem-hint-sub">Trova tutte le coppie.</div>
      </div>
    `;
    gridArea.appendChild(ov);
    return ov;
  }

  function dismissHint(): void {
    if (!hintOverlay) return;
    hintOverlay.classList.add("mem-hint-fade");
    const h = hintOverlay;
    setTimeout(() => { h.remove(); }, 350);
    hintOverlay = null;
    void markHintSeen();
  }

  // ---------- input ----------

  function onPointerUp(e: PointerEvent): void {
    if (activeOverlay) return;
    const target = e.target as HTMLElement;
    const cardEl = target.closest<HTMLElement>(".mem-card");
    if (!cardEl) return;
    const idxStr = cardEl.dataset["idx"];
    if (idxStr === undefined) return;
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx)) return;
    flipCard(idx);
  }

  grid.addEventListener("pointerup", onPointerUp);

  newBtn.addEventListener("pointerup", () => {
    if (activeOverlay) return;
    startNewGame();
  });

  diffBtn.addEventListener("pointerup", () => {
    showDiffPicker();
  });

  fsBtn.addEventListener("pointerup", () => {
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen().catch(() => {});
    }
  });

  // ---------- ResizeObserver ----------
  const ro = new ResizeObserver(() => {
    if (gridArea.clientWidth < 8 || gridArea.clientHeight < 8) return;
    sizeGrid();
  });
  ro.observe(gridArea);

  // ---------- boot ----------
  void (async () => {
    difficulty = await loadDiff();
    updateDiffDisplay();
    startNewGame();

    void personalBest("memory").then((pb) => {
      if (pb > 0) { best = pb; bestEl.textContent = String(pb); }
    });

    const seen = await hasSeenHint();
    if (!seen) {
      hintOverlay = buildHintOverlay();
      setTimeout(() => { if (hintOverlay) dismissHint(); }, 5000);
    }
  })();

  // ---------- cleanup ----------
  return function cleanup(): void {
    ro.disconnect();
    stopTimer();
    if (mismatchTimer !== null) {
      clearTimeout(mismatchTimer);
      mismatchTimer = null;
    }
    grid.removeEventListener("pointerup", onPointerUp);
    container.innerHTML = "";
    container.classList.remove("memory-root");
    container.style.touchAction = prevTouchAction;
  };
}
