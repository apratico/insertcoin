import { submit } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";
import { playSfx } from "../../lib/audio.js";

// ---------- types ----------

type Difficulty = "easy" | "medium" | "hard";
type Phase = "playing" | "gameover" | "won";

// 0 = empty
type Board = number[][];
// notes: per-cell Set of pencil marks
type Notes = Set<number>[][];

interface GameState {
  given: boolean[][];   // true = prefilled, immutable
  board: Board;
  notes: Notes;
  solution: Board;
  selected: [number, number] | null;
  errors: number;
  noteMode: boolean;
  phase: Phase;
  startTime: number;
  elapsed: number;       // accumulated ms when paused
  difficulty: Difficulty;
  history: HistoryEntry[];
}

interface HistoryEntry {
  r: number;
  c: number;
  prevVal: number;
  prevNotes: number[];
}

// ---------- constants ----------

const DIFF_KEY = "sudoku:difficulty";
const HINT_KEY = "sudoku:seenHint";
const STATE_KEY = "sudoku:state";

const GIVEN_COUNT: Record<Difficulty, number> = { easy: 45, medium: 35, hard: 28 };
const DIFF_WEIGHT: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 4 };
const MAX_ERRORS = 3;

// ---------- persistence helpers ----------

async function loadSetting(key: string): Promise<string | null> {
  try {
    const row = await db.settings.get(key);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function saveSetting(key: string, value: string): Promise<void> {
  try {
    await db.settings.put({ key, value });
  } catch { /* non-critical */ }
}

async function deleteSetting(key: string): Promise<void> {
  try {
    await db.settings.delete(key);
  } catch { /* non-critical */ }
}

// ---------- serialisable state for persistence ----------

interface SerialState {
  given: boolean[][];
  board: Board;
  notes: number[][][];   // notes[r][c] = Array.from(set)
  solution: Board;
  errors: number;
  noteMode: boolean;
  phase: Phase;
  startTime: number;
  elapsed: number;
  difficulty: Difficulty;
}

function serialise(s: GameState): string {
  const ser: SerialState = {
    given: s.given,
    board: s.board,
    notes: s.notes.map((row) => row.map((set) => Array.from(set))),
    solution: s.solution,
    errors: s.errors,
    noteMode: s.noteMode,
    phase: s.phase,
    startTime: s.startTime,
    elapsed: s.elapsed,
    difficulty: s.difficulty,
  };
  return JSON.stringify(ser);
}

function deserialise(raw: string): GameState | null {
  try {
    const s = JSON.parse(raw) as SerialState;
    return {
      given: s.given,
      board: s.board,
      notes: s.notes.map((row) => row.map((arr) => new Set(arr))),
      solution: s.solution,
      selected: null,
      errors: s.errors,
      noteMode: s.noteMode,
      phase: s.phase,
      startTime: s.startTime,
      elapsed: s.elapsed,
      difficulty: s.difficulty,
      history: [],
    };
  } catch {
    return null;
  }
}

// ---------- Sudoku generator ----------

function emptyBoard(): Board {
  return Array.from({ length: 9 }, () => Array(9).fill(0) as number[]);
}

function emptyNotes(): Notes {
  return Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => new Set<number>())
  );
}

function isValidPlacement(board: Board, r: number, c: number, n: number): boolean {
  for (let i = 0; i < 9; i++) {
    if (board[r]![i] === n) return false;
    if (board[i]![c] === n) return false;
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++)
    for (let dc = 0; dc < 3; dc++)
      if (board[br + dr]![bc + dc] === n) return false;
  return true;
}

// Fills board in-place using backtracking. Returns true on success.
function solveFill(board: Board): boolean {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r]![c] !== 0) continue;
      const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (const n of nums) {
        if (isValidPlacement(board, r, c, n)) {
          board[r]![c] = n;
          if (solveFill(board)) return true;
          board[r]![c] = 0;
        }
      }
      return false;
    }
  }
  return true;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

function deepCopyBoard(b: Board): Board {
  return b.map((row) => [...row]);
}

function generatePuzzle(difficulty: Difficulty): { puzzle: Board; solution: Board } {
  // Build a complete valid solution
  const solution = emptyBoard();
  // Seed a few random cells to get variety
  const seedPositions: [number, number][] = [
    [0, 0], [4, 4], [8, 8], [2, 6], [6, 2],
  ];
  for (const [r, c] of seedPositions) {
    const n = Math.ceil(Math.random() * 9);
    if (isValidPlacement(solution, r, c, n)) solution[r]![c] = n;
  }
  solveFill(solution);

  // Remove cells to reach target given count
  const puzzle = deepCopyBoard(solution);
  const targetGiven = GIVEN_COUNT[difficulty];
  const positions = shuffle(
    Array.from({ length: 81 }, (_, i) => i)
  );
  let givenLeft = 81;
  for (const idx of positions) {
    if (givenLeft <= targetGiven) break;
    const r = Math.floor(idx / 9);
    const c = idx % 9;
    puzzle[r]![c] = 0;
    givenLeft--;
  }

  // Note: uniqueness of solution is NOT guaranteed (MVP trade-off).
  // A secondary solve pass to verify uniqueness would add ~50+ lines;
  // skipped per spec. The puzzle may accept multiple solutions.

  return { puzzle, solution };
}

// ---------- validation helpers ----------

function isBoardComplete(board: Board): boolean {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r]![c] === 0) return false;
  return true;
}

function isBoardCorrect(board: Board, solution: Board): boolean {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r]![c] !== solution[r]![c]) return false;
  return true;
}

// ---------- score formula ----------

function calcScore(difficulty: Difficulty, elapsedMs: number, errors: number): number {
  const secs = Math.floor(elapsedMs / 1000);
  const weight = DIFF_WEIGHT[difficulty];
  return Math.round(weight * Math.max(0, 1000 - secs) * (1 - errors * 0.2));
}

// ---------- DOM helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<Record<string, string>> = {},
  cls?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) e.setAttribute(k, v);
  }
  return e;
}

// ---------- Rank card helper ----------

function buildRankCard(rank: RankInfo, gameId: string): HTMLElement {
  const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="sdk-rank-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta}</div>`
    : "";
  const card = el("div", {}, "rank-card");
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

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("sudoku-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // Mutable game state (will be set in startGame / restoreState)
  let state: GameState = createInitialState("medium");

  // DOM refs
  let cellEls: HTMLButtonElement[][] = [];
  let timerEl: HTMLElement;
  let diffBtn: HTMLElement;
  let errorsEl: HTMLElement;
  let noteBtn: HTMLButtonElement;
  let undoBtn: HTMLButtonElement;
  let hintBtn: HTMLButtonElement;
  let hintOverlay: HTMLElement | null = null;
  let activeOverlay: HTMLElement | null = null;
  let timerInterval = 0;

  // ---------- build layout ----------

  const wrap = el("div", {}, "sdk-wrap");
  container.appendChild(wrap);

  // HUD
  const hud = el("div", {}, "sdk-hud");
  wrap.appendChild(hud);

  timerEl = el("div", {}, "sdk-hud-item sdk-timer");
  timerEl.textContent = "00:00";

  diffBtn = el("button", { "aria-label": "Change difficulty" }, "btn sdk-diff-btn");

  errorsEl = el("div", {}, "sdk-hud-item sdk-errors");

  const fsBtn = el("button", { "aria-label": "Fullscreen" }, "btn sdk-fs-btn");
  fsBtn.textContent = "⛶";

  hud.appendChild(timerEl);
  hud.appendChild(diffBtn);
  hud.appendChild(errorsEl);
  hud.appendChild(fsBtn);

  // Grid
  const gridWrap = el("div", {}, "sdk-grid-wrap");
  wrap.appendChild(gridWrap);

  const gridEl = el("div", { role: "grid", "aria-label": "Sudoku grid" }, "sdk-grid");
  gridWrap.appendChild(gridEl);

  // Controls
  const controls = el("div", {}, "sdk-controls");
  wrap.appendChild(controls);

  const numPad = el("div", {}, "sdk-numpad");
  controls.appendChild(numPad);

  for (let n = 1; n <= 9; n++) {
    const btn = el("button", { "aria-label": `${n}` }, "btn sdk-num-btn");
    btn.textContent = String(n);
    btn.addEventListener("pointerup", () => inputNumber(n));
    numPad.appendChild(btn);
  }

  const actionRow = el("div", {}, "sdk-actions");
  controls.appendChild(actionRow);

  const eraseBtn = el("button", { "aria-label": "Erase" }, "btn sdk-action-btn");
  eraseBtn.textContent = "ERASE";
  eraseBtn.addEventListener("pointerup", () => inputNumber(0));

  noteBtn = el("button", { "aria-label": "Note mode toggle" }, "btn sdk-action-btn");
  noteBtn.textContent = "NOTE";

  undoBtn = el("button", { "aria-label": "Undo" }, "btn sdk-action-btn");
  undoBtn.textContent = "UNDO";

  hintBtn = el("button", { "aria-label": "Hint" }, "btn sdk-action-btn");
  hintBtn.textContent = "HINT";

  actionRow.appendChild(eraseBtn);
  actionRow.appendChild(noteBtn);
  actionRow.appendChild(undoBtn);
  actionRow.appendChild(hintBtn);

  noteBtn.addEventListener("pointerup", toggleNoteMode);
  undoBtn.addEventListener("pointerup", handleUndo);
  hintBtn.addEventListener("pointerup", handleHint);

  fsBtn.addEventListener("pointerup", () => {
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen().catch(() => {});
    }
  });

  // ---------- build cell grid ----------

  function buildCells(): void {
    gridEl.innerHTML = "";
    cellEls = [];
    for (let r = 0; r < 9; r++) {
      const row: HTMLButtonElement[] = [];
      for (let c = 0; c < 9; c++) {
        const btn = el("button", {
          "aria-label": `row ${r + 1} col ${c + 1}`,
          role: "gridcell",
        }, "sdk-cell");
        btn.addEventListener("pointerup", () => selectCell(r, c));
        gridEl.appendChild(btn);
        row.push(btn);
      }
      cellEls.push(row);
    }
  }

  buildCells();

  // ---------- game init ----------

  function createInitialState(diff: Difficulty): GameState {
    const { puzzle, solution } = generatePuzzle(diff);
    const given: boolean[][] = Array.from({ length: 9 }, (_, r) =>
      Array.from({ length: 9 }, (__, c) => puzzle[r]![c] !== 0)
    );
    return {
      given,
      board: deepCopyBoard(puzzle),
      notes: emptyNotes(),
      solution,
      selected: null,
      errors: 0,
      noteMode: false,
      phase: "playing",
      startTime: Date.now(),
      elapsed: 0,
      difficulty: diff,
      history: [],
    };
  }

  function startGame(diff: Difficulty): void {
    stopTimer();
    state = createInitialState(diff);
    renderAll();
    startTimer();
    void saveSetting(STATE_KEY, serialise(state));
  }

  // ---------- timer ----------

  function startTimer(): void {
    stopTimer();
    if (state.phase !== "playing") return;
    timerInterval = window.setInterval(() => {
      if (state.phase !== "playing") return;
      const now = Date.now();
      const total = state.elapsed + (now - state.startTime);
      timerEl.textContent = formatTime(total);
    }, 500);
  }

  function stopTimer(): void {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = 0;
    }
  }

  function getCurrentElapsed(): number {
    if (state.phase !== "playing") return state.elapsed;
    return state.elapsed + (Date.now() - state.startTime);
  }

  function formatTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  // ---------- input ----------

  function selectCell(r: number, c: number): void {
    if (state.phase !== "playing") return;
    if (hintOverlay) dismissHint();
    state.selected = [r, c];
    renderHighlights();
  }

  function inputNumber(n: number): void {
    if (state.phase !== "playing") return;
    if (!state.selected) return;
    const [r, c] = state.selected;
    if (state.given[r]![c]) return;

    if (hintOverlay) dismissHint();

    if (state.noteMode && n !== 0) {
      // Toggle note
      const noteSet = state.notes[r]![c]!;
      const snap = Array.from(noteSet);
      state.history.push({ r, c, prevVal: state.board[r]![c]!, prevNotes: snap });
      if (noteSet.has(n)) {
        noteSet.delete(n);
      } else {
        noteSet.add(n);
      }
      renderCell(r, c);
    } else {
      const prevVal = state.board[r]![c]!;
      const prevNotes = Array.from(state.notes[r]![c]!);
      state.history.push({ r, c, prevVal, prevNotes });

      if (n === 0) {
        state.board[r]![c] = 0;
        state.notes[r]![c] = new Set();
      } else {
        const wasWrong = prevVal !== 0 && prevVal !== state.solution[r]![c];
        state.board[r]![c] = n;
        state.notes[r]![c] = new Set();

        // Check violation (wrong = not matching solution)
        const correct = state.solution[r]![c];
        if (n !== correct && !wasWrong) {
          playSfx("error");
          state.errors++;
          updateErrorsDisplay();
          if (state.errors >= MAX_ERRORS) {
            triggerGameOver();
            return;
          }
        } else if (n === correct) {
          playSfx("place");
        }
      }

      // Clear notes in same row/col/box for this number
      if (n !== 0) clearRelatedNotes(r, c, n);

      renderCell(r, c);
      renderHighlights();

      if (isBoardComplete(state.board) && isBoardCorrect(state.board, state.solution)) {
        triggerWin();
        return;
      }

      void saveSetting(STATE_KEY, serialise(state));
    }
  }

  function clearRelatedNotes(r: number, c: number, n: number): void {
    for (let i = 0; i < 9; i++) {
      state.notes[r]![i]!.delete(n);
      state.notes[i]![c]!.delete(n);
      renderCell(r, i);
      renderCell(i, c);
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) {
        state.notes[br + dr]![bc + dc]!.delete(n);
        renderCell(br + dr, bc + dc);
      }
    }
  }

  function toggleNoteMode(): void {
    state.noteMode = !state.noteMode;
    noteBtn.classList.toggle("sdk-note-active", state.noteMode);
  }

  function handleUndo(): void {
    if (state.phase !== "playing") return;
    const entry = state.history.pop();
    if (!entry) return;
    state.board[entry.r]![entry.c] = entry.prevVal;
    state.notes[entry.r]![entry.c] = new Set(entry.prevNotes);
    renderCell(entry.r, entry.c);
    renderHighlights();
    void saveSetting(STATE_KEY, serialise(state));
  }

  function handleHint(): void {
    if (state.phase !== "playing") return;
    if (!state.selected) return;
    const [r, c] = state.selected;
    if (state.given[r]![c]) return;
    const correct = state.solution[r]![c]!;
    const prevVal = state.board[r]![c]!;
    const prevNotes = Array.from(state.notes[r]![c]!);
    state.history.push({ r, c, prevVal, prevNotes });
    state.board[r]![c] = correct;
    state.notes[r]![c] = new Set();
    // 10-second penalty
    state.elapsed += 10000;
    clearRelatedNotes(r, c, correct);
    renderCell(r, c);
    renderHighlights();

    if (isBoardComplete(state.board) && isBoardCorrect(state.board, state.solution)) {
      triggerWin();
      return;
    }
    void saveSetting(STATE_KEY, serialise(state));
  }

  // ---------- win / gameover ----------

  function triggerWin(): void {
    stopTimer();
    state.phase = "won";
    const elapsed = getCurrentElapsed();
    const score = calcScore(state.difficulty, elapsed, state.errors);
    playSfx("win");
    void submit("sudoku", score);
    void deleteSetting(STATE_KEY);
    activeOverlay = showWinOverlay(elapsed, state.errors, score, () => {
      activeOverlay = null;
      startGame(state.difficulty);
    });
    void computeRank("sudoku", score).then((rank) => {
      if (!rank || !activeOverlay) return;
      const box = activeOverlay.querySelector(".sdk-overlay-box");
      const actions = activeOverlay.querySelector(".sdk-ov-actions");
      if (!box || !actions) return;
      if (box.querySelector(".rank-card")) return;
      box.insertBefore(buildRankCard(rank, "sudoku"), actions);
    });
  }

  function triggerGameOver(): void {
    stopTimer();
    state.phase = "gameover";
    void submit("sudoku", 0);
    void deleteSetting(STATE_KEY);
    activeOverlay = showGameoverOverlay(() => {
      activeOverlay = null;
      startGame(state.difficulty);
    });
  }

  // ---------- render ----------

  function renderAll(): void {
    updateDiffDisplay();
    updateErrorsDisplay();
    updateNoteBtn();
    timerEl.textContent = formatTime(getCurrentElapsed());
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        renderCell(r, c);
    renderHighlights();
  }

  function renderCell(r: number, c: number): void {
    const btn = cellEls[r]![c]!;
    const val = state.board[r]![c]!;
    const isGiven = state.given[r]![c]!;
    const notes = state.notes[r]![c]!;
    const isWrong = !isGiven && val !== 0 && val !== state.solution[r]![c];

    btn.className = "sdk-cell";
    if (isGiven) btn.classList.add("sdk-given");
    if (isWrong) btn.classList.add("sdk-error");

    btn.innerHTML = "";
    if (notes.size > 0 && val === 0) {
      const noteGrid = el("div", {}, "sdk-notes");
      for (let n = 1; n <= 9; n++) {
        const nEl = el("span", {}, "sdk-note-num");
        nEl.textContent = notes.has(n) ? String(n) : "";
        noteGrid.appendChild(nEl);
      }
      btn.appendChild(noteGrid);
    } else if (val !== 0) {
      btn.textContent = String(val);
    }
  }

  function renderHighlights(): void {
    const sel = state.selected;
    const selVal = sel ? (state.board[sel[0]]![sel[1]]!) : 0;

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const btn = cellEls[r]![c]!;
        btn.classList.remove(
          "sdk-selected", "sdk-peer", "sdk-same-num"
        );

        if (!sel) continue;
        const [sr, sc] = sel;

        if (r === sr && c === sc) {
          btn.classList.add("sdk-selected");
          continue;
        }

        const sameBox =
          Math.floor(r / 3) === Math.floor(sr / 3) &&
          Math.floor(c / 3) === Math.floor(sc / 3);

        if (r === sr || c === sc || sameBox) {
          btn.classList.add("sdk-peer");
        }

        const val = state.board[r]![c]!;
        if (selVal !== 0 && val === selVal) {
          btn.classList.add("sdk-same-num");
        }
      }
    }
  }

  function updateDiffDisplay(): void {
    diffBtn.textContent = state.difficulty.toUpperCase();
  }

  function updateErrorsDisplay(): void {
    errorsEl.textContent = `ERR ${state.errors}/${MAX_ERRORS}`;
    errorsEl.classList.toggle("sdk-errors-danger", state.errors >= MAX_ERRORS - 1);
  }

  function updateNoteBtn(): void {
    noteBtn.classList.toggle("sdk-note-active", state.noteMode);
  }

  // ---------- difficulty modal ----------

  diffBtn.addEventListener("pointerup", () => {
    if (activeOverlay) return;
    activeOverlay = showDiffModal(() => { activeOverlay = null; });
  });

  function showDiffModal(onClose: () => void): HTMLElement {
    const ov = el("div", {}, "sdk-overlay");
    const box = el("div", {}, "sdk-overlay-box");
    box.innerHTML = `<h2 class="sdk-ov-title">DIFFICULTY</h2>`;
    const btns = el("div", {}, "sdk-ov-actions");
    for (const d of ["easy", "medium", "hard"] as Difficulty[]) {
      const b = el("button", {}, `btn sdk-ov-btn${d === state.difficulty ? " primary" : ""}`);
      b.textContent = d.toUpperCase();
      b.addEventListener("pointerup", () => {
        ov.remove();
        onClose();
        void saveSetting(DIFF_KEY, d);
        startGame(d);
      });
      btns.appendChild(b);
    }
    const cancelBtn = el("button", {}, "btn sdk-ov-btn");
    cancelBtn.textContent = "CANCEL";
    cancelBtn.addEventListener("pointerup", () => { ov.remove(); onClose(); });
    btns.appendChild(cancelBtn);
    box.appendChild(btns);
    ov.appendChild(box);
    container.appendChild(ov);
    return ov;
  }

  // ---------- win overlay ----------

  function showWinOverlay(
    elapsedMs: number,
    errCount: number,
    score: number,
    onNew: () => void
  ): HTMLElement {
    const ov = el("div", {}, "sdk-overlay");
    const box = el("div", {}, "sdk-overlay-box");
    box.innerHTML = `
      <h2 class="sdk-ov-title sdk-ov-win">CONGRATULAZIONI!</h2>
      <div class="sdk-ov-stat">${formatTime(elapsedMs)}</div>
      <div class="sdk-ov-label">TIME</div>
      <div class="sdk-ov-stat">${errCount}</div>
      <div class="sdk-ov-label">ERRORS</div>
      <div class="sdk-ov-stat sdk-ov-score">${score}</div>
      <div class="sdk-ov-label">SCORE</div>
    `;
    const actions = el("div", {}, "sdk-ov-actions");
    const newBtn2 = el("button", {}, "btn primary sdk-ov-btn");
    newBtn2.textContent = "NEW PUZZLE";
    newBtn2.addEventListener("pointerup", () => { ov.remove(); onNew(); });
    const menuBtn = el("button", {}, "btn sdk-ov-btn");
    menuBtn.textContent = "MENU";
    menuBtn.addEventListener("pointerup", () => { navigate("/"); });
    actions.appendChild(newBtn2);
    actions.appendChild(menuBtn);
    box.appendChild(actions);
    ov.appendChild(box);
    container.appendChild(ov);
    return ov;
  }

  // ---------- gameover overlay ----------

  function showGameoverOverlay(onReplay: () => void): HTMLElement {
    const ov = el("div", {}, "sdk-overlay");
    const box = el("div", {}, "sdk-overlay-box");
    box.innerHTML = `
      <h2 class="sdk-ov-title">GAME OVER</h2>
      <div class="sdk-ov-label">Too many errors.</div>
    `;
    const actions = el("div", {}, "sdk-ov-actions");
    const replayBtn = el("button", {}, "btn primary sdk-ov-btn");
    replayBtn.textContent = "PLAY AGAIN";
    replayBtn.addEventListener("pointerup", () => { ov.remove(); onReplay(); });
    const menuBtn = el("button", {}, "btn sdk-ov-btn");
    menuBtn.textContent = "MENU";
    menuBtn.addEventListener("pointerup", () => { navigate("/"); });
    actions.appendChild(replayBtn);
    actions.appendChild(menuBtn);
    box.appendChild(actions);
    ov.appendChild(box);
    container.appendChild(ov);
    return ov;
  }

  // ---------- onboarding hint ----------

  function showHintOverlay(): void {
    if (hintOverlay) return;
    const ov = el("div", {}, "sdk-hint-overlay");
    ov.innerHTML = `
      <div class="sdk-hint-box">
        <div class="sdk-hint-title">TAP CELL, TAP NUMBER</div>
        <div class="sdk-hint-sub">Every row / col / box: 1–9 unique.</div>
      </div>
    `;
    container.appendChild(ov);
    hintOverlay = ov;
    setTimeout(() => dismissHint(), 5000);
  }

  function dismissHint(): void {
    if (!hintOverlay) return;
    hintOverlay.classList.add("sdk-hint-fade");
    setTimeout(() => {
      hintOverlay?.remove();
      hintOverlay = null;
    }, 350);
    void saveSetting(HINT_KEY, "1");
  }

  // ---------- keyboard ----------

  function onKey(e: KeyboardEvent): void {
    if (state.phase !== "playing") return;

    if (e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      if (hintOverlay) dismissHint();
      inputNumber(parseInt(e.key, 10));
      return;
    }
    if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      inputNumber(0);
      return;
    }
    if (e.key === "n" || e.key === "N") {
      toggleNoteMode();
      return;
    }
    if (e.key === "z" || e.key === "Z") {
      handleUndo();
      return;
    }

    const sel = state.selected;
    if (!sel) return;
    let [r, c] = sel;
    const arrowMap: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    const delta = arrowMap[e.key];
    if (delta) {
      e.preventDefault();
      r = Math.max(0, Math.min(8, r + delta[0]));
      c = Math.max(0, Math.min(8, c + delta[1]));
      selectCell(r, c);
    }
  }

  document.addEventListener("keydown", onKey);

  // ---------- bootstrap ----------

  async function bootstrap(): Promise<void> {
    // Load saved difficulty
    const savedDiff = await loadSetting(DIFF_KEY) as Difficulty | null;
    const initialDiff: Difficulty =
      savedDiff === "easy" || savedDiff === "medium" || savedDiff === "hard"
        ? savedDiff
        : "medium";

    // Try restoring saved state
    const rawState = await loadSetting(STATE_KEY);
    if (rawState) {
      const restored = deserialise(rawState);
      if (restored && restored.phase === "playing") {
        state = restored;
        // Recalibrate startTime so timer continues from elapsed
        state.startTime = Date.now();
        renderAll();
        startTimer();
        // Check hint
        const seenHint = await loadSetting(HINT_KEY);
        if (!seenHint) showHintOverlay();
        return;
      }
    }

    // Fresh game
    state = createInitialState(initialDiff);
    renderAll();
    startTimer();
    const seenHint = await loadSetting(HINT_KEY);
    if (!seenHint) showHintOverlay();
    void saveSetting(STATE_KEY, serialise(state));
  }

  void bootstrap();

  // ---------- cleanup ----------

  return function cleanup(): void {
    stopTimer();
    document.removeEventListener("keydown", onKey);
    container.innerHTML = "";
    container.classList.remove("sudoku-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "sudoku-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .sudoku-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #1a1a2e;
      user-select: none;
      -webkit-user-select: none;
    }
    .sdk-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-height: 0;
      padding: 6px 8px 10px;
      gap: 6px;
      box-sizing: border-box;
    }

    /* HUD */
    .sdk-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-width: 380px;
      font-family: monospace;
      flex-shrink: 0;
      gap: 6px;
    }
    .sdk-hud-item {
      font-size: 13px;
      font-family: monospace;
      color: #e0e0ff;
      letter-spacing: 1px;
    }
    .sdk-timer {
      font-size: 15px;
      font-weight: bold;
      min-width: 52px;
    }
    .sdk-diff-btn {
      font-size: 11px;
      padding: 0 10px;
      min-height: 36px;
      border-color: #4fc3f7;
      color: #4fc3f7;
      background: transparent;
      letter-spacing: 1.5px;
    }
    .sdk-errors {
      font-size: 12px;
      color: #e0e0ff;
      min-width: 52px;
      text-align: right;
    }
    .sdk-errors-danger { color: #ff5555; }
    .sdk-fs-btn {
      min-width: 36px;
      min-height: 36px;
      font-size: 16px;
      border-color: #3a3a5a;
      color: #c8c0b0;
      background: transparent;
    }

    /* Grid */
    .sdk-grid-wrap {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    }
    .sdk-grid {
      display: grid;
      grid-template-columns: repeat(9, 1fr);
      grid-template-rows: repeat(9, 1fr);
      width: min(94vw, min(calc(100vh - 220px), 360px));
      aspect-ratio: 1 / 1;
      border: 2px solid #e0e0ff;
      box-sizing: border-box;
      background: #12122a;
    }
    .sdk-cell {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: monospace;
      font-size: clamp(14px, 3.5vw, 22px);
      color: #4fc3f7;
      background: #1a1a2e;
      border: none;
      border-right: 1px solid #2a2a4e;
      border-bottom: 1px solid #2a2a4e;
      cursor: pointer;
      padding: 0;
      margin: 0;
      outline: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      box-sizing: border-box;
      transition: background 80ms;
    }
    /* Thick box borders — right edge of col 2, 5 */
    .sdk-cell:nth-child(9n+3),
    .sdk-cell:nth-child(9n+6) {
      border-right: 2px solid #7070b0;
    }
    /* Thick box borders — bottom edge of row 2, 5 */
    .sdk-cell:nth-child(n+19):nth-child(-n+27),
    .sdk-cell:nth-child(n+46):nth-child(-n+54) {
      border-bottom: 2px solid #7070b0;
    }
    /* Remove outer right/bottom borders (grid border covers them) */
    .sdk-cell:nth-child(9n) { border-right: none; }
    .sdk-cell:nth-child(n+73) { border-bottom: none; }

    .sdk-cell.sdk-given {
      color: #e0e0ff;
      font-weight: bold;
      background: #20204a;
    }
    .sdk-cell.sdk-error {
      color: #ff5555;
    }
    .sdk-cell.sdk-selected {
      background: #0a5080 !important;
    }
    .sdk-cell.sdk-peer {
      background: #222245;
    }
    .sdk-cell.sdk-same-num {
      background: #1a3560;
    }
    .sdk-cell:active { background: #1a3040; }

    /* Notes grid inside cell */
    .sdk-notes {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(3, 1fr);
      width: 100%;
      height: 100%;
      padding: 1px;
      box-sizing: border-box;
    }
    .sdk-note-num {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: clamp(6px, 1.2vw, 9px);
      color: #7090c0;
      line-height: 1;
    }

    /* Controls */
    .sdk-controls {
      width: 100%;
      max-width: 380px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }
    .sdk-numpad {
      display: grid;
      grid-template-columns: repeat(9, 1fr);
      gap: 3px;
    }
    .sdk-num-btn {
      min-height: 40px;
      font-size: clamp(14px, 3.5vw, 20px);
      font-weight: bold;
      font-family: monospace;
      background: #20204a;
      border-color: #3a3a6a;
      color: #4fc3f7;
      padding: 0;
    }
    .sdk-num-btn:active { background: #2a2a6a; }
    .sdk-actions {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
    }
    .sdk-action-btn {
      min-height: 40px;
      font-size: 11px;
      letter-spacing: 0.5px;
      font-family: monospace;
      background: #20204a;
      border-color: #3a3a6a;
      color: #a0a0cc;
    }
    .sdk-action-btn:active { background: #2a2a6a; }
    .sdk-note-active {
      background: #1a4060 !important;
      border-color: #4fc3f7 !important;
      color: #4fc3f7 !important;
    }

    /* Overlays */
    .sdk-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.82);
      z-index: 20;
    }
    .sdk-overlay-box {
      text-align: center;
      padding: 28px 24px;
      background: #1a1a2e;
      border: 1px solid #3a3a6a;
      border-radius: 14px;
      min-width: 220px;
      max-width: 88vw;
      font-family: monospace;
    }
    .sdk-ov-title {
      margin: 0 0 12px;
      font-family: monospace;
      font-size: 20px;
      color: #ff5555;
      letter-spacing: 3px;
      text-shadow: 0 0 12px rgba(255,85,85,0.6);
    }
    .sdk-ov-win {
      color: #4fc3f7;
      text-shadow: 0 0 14px rgba(79,195,247,0.7);
    }
    .sdk-ov-stat {
      font-family: monospace;
      font-size: 36px;
      font-weight: bold;
      color: #e0e0ff;
      line-height: 1.1;
    }
    .sdk-ov-score { color: #f6c24c; text-shadow: 0 0 12px rgba(246,194,76,0.6); }
    .sdk-ov-label {
      font-size: 10px;
      color: #5a5a8a;
      letter-spacing: 2px;
      margin-bottom: 8px;
    }
    .sdk-ov-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    .sdk-ov-btn {
      min-width: 96px;
      min-height: 44px;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 1px;
    }

    /* Hint overlay */
    .sdk-hint-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 80px;
      z-index: 10;
      pointer-events: none;
      transition: opacity 350ms ease;
    }
    .sdk-hint-overlay.sdk-hint-fade { opacity: 0; }
    .sdk-hint-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 16px 24px;
      background: rgba(26,26,46,0.9);
      border: 1px solid rgba(79,195,247,0.4);
      border-radius: 12px;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .sdk-hint-title {
      font-family: monospace;
      font-size: clamp(14px, 3.5vw, 18px);
      font-weight: bold;
      letter-spacing: 2px;
      color: #4fc3f7;
      text-shadow: 0 0 10px rgba(79,195,247,0.8);
    }
    .sdk-hint-sub {
      font-family: monospace;
      font-size: clamp(10px, 2.5vw, 12px);
      color: #7090b0;
      letter-spacing: 0.5px;
      text-align: center;
    }
    .sdk-rank-delta {
      font-family: monospace;
      font-size: 12px;
      color: #a0a0cc;
      margin: 4px 0;
    }
  `;
  document.head.appendChild(style);
}
