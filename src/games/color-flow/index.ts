import { submit } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { playSfx } from "../../lib/audio.js";
import { db } from "../../lib/storage.js";

// ---------- constants ----------

const CAPACITY = 4;
const LEVEL_KEY = "color-flow:level";
const STATE_KEY = "color-flow:state";
const HINT_KEY = "color-flow:seenHint";
const MAX_UNDOS = 3;
const MAX_HINTS = 1;

const COLORS: readonly string[] = [
  "#ff3344", // red
  "#00eeff", // cyan
  "#ffee00", // yellow
  "#44ff66", // green
  "#aa44ff", // purple
  "#ff8822", // orange
  "#ff44aa", // pink
  "#ccff44", // lime
];

// ---------- types ----------

type Tube = string[]; // array of color strings, index 0 = bottom

interface LevelConfig {
  colors: number;
  tubes: number;
  filled: number;
}

interface UndoEntry {
  tubes: Tube[];
  moves: number;
}

// ---------- level config ----------

function getLevelConfig(level: number): LevelConfig {
  if (level <= 5)  return { colors: 4, tubes: 5,  filled: 4 };
  if (level <= 15) return { colors: 5, tubes: 7,  filled: 5 };
  if (level <= 30) return { colors: 6, tubes: 8,  filled: 6 };
  if (level <= 50) return { colors: 7, tubes: 9,  filled: 7 };
  return               { colors: 8, tubes: 10, filled: 8 };
}

// ---------- generator ----------

function cloneTubes(tubes: Tube[]): Tube[] {
  return tubes.map((t) => [...t]);
}

function generateLevel(level: number): Tube[] {
  const { colors, tubes, filled } = getLevelConfig(level);
  const palette = COLORS.slice(0, colors);

  // Start from solved state: each color fills exactly one tube
  const solved: Tube[] = palette.map((c) => Array(CAPACITY).fill(c) as string[]);
  // Add empty buffer tubes
  for (let i = filled; i < tubes; i++) {
    solved.push([]);
  }

  const shuffleMoves = Math.max(4, level * 2);
  let state = cloneTubes(solved);

  // Reverse-pour: pick a non-empty tube, pick a different tube with room, move top block
  const rng = (n: number): number => Math.floor(Math.random() * n);

  for (let m = 0; m < shuffleMoves; m++) {
    // Collect all candidate sources (non-empty)
    const sources = state
      .map((t, i) => ({ i, t }))
      .filter(({ t }) => t.length > 0);

    if (sources.length === 0) break;

    // Pick a random source
    const src = sources[rng(sources.length)]!;
    const topColor = src.t[src.t.length - 1]!;

    // Count consecutive top units of same color
    let blockSize = 0;
    for (let j = src.t.length - 1; j >= 0; j--) {
      if (src.t[j] === topColor) blockSize++;
      else break;
    }

    // Candidate destinations: different tube, has room for blockSize, not same single-color-full
    const dests = state
      .map((t, i) => ({ i, t }))
      .filter(({ i, t }) => {
        if (i === src.i) return false;
        const room = CAPACITY - t.length;
        if (room < blockSize) return false;
        // Avoid moving back onto exactly same top color (would be no-op)
        if (t.length > 0 && t[t.length - 1] === topColor) return false;
        return true;
      });

    if (dests.length === 0) continue;

    const dst = dests[rng(dests.length)]!;

    // Execute the split: remove block from src, add to dst
    const newState = cloneTubes(state);
    for (let j = 0; j < blockSize; j++) {
      const unit = newState[src.i]!.pop();
      if (unit !== undefined) newState[dst.i]!.push(unit);
    }
    state = newState;
  }

  return state;
}

// ---------- pour logic ----------

function topColor(tube: Tube): string | null {
  return tube.length > 0 ? (tube[tube.length - 1] ?? null) : null;
}

function topBlockSize(tube: Tube): number {
  if (tube.length === 0) return 0;
  const color = topColor(tube)!;
  let count = 0;
  for (let i = tube.length - 1; i >= 0; i--) {
    if (tube[i] === color) count++;
    else break;
  }
  return count;
}

function canPour(src: Tube, dst: Tube): boolean {
  if (src.length === 0) return false;
  const srcTop = topColor(src)!;
  const dstTop = topColor(dst);
  const blockSize = topBlockSize(src);
  const room = CAPACITY - dst.length;

  if (dst.length === 0) return room >= 1; // can always pour into empty (at least 1 unit)
  if (dstTop !== srcTop) return false;
  return room >= blockSize;
}

function pourTubes(tubes: Tube[], srcIdx: number, dstIdx: number): Tube[] {
  const newTubes = cloneTubes(tubes);
  const src = newTubes[srcIdx]!;
  const dst = newTubes[dstIdx]!;
  const color = topColor(src)!;
  const blockSize = topBlockSize(src);
  const room = CAPACITY - dst.length;
  const amount = Math.min(blockSize, room);
  for (let i = 0; i < amount; i++) {
    src.pop();
    dst.push(color);
  }
  return newTubes;
}

function isWon(tubes: Tube[]): boolean {
  return tubes.every((t) => t.length === 0 || (t.length === CAPACITY && new Set(t).size === 1));
}

// ---------- persistence ----------

async function loadLevel(): Promise<number> {
  try {
    const row = await db.settings.get(LEVEL_KEY);
    const v = row ? parseInt(row.value, 10) : NaN;
    return isNaN(v) || v < 1 ? 1 : v;
  } catch { return 1; }
}

async function saveLevel(level: number): Promise<void> {
  try { await db.settings.put({ key: LEVEL_KEY, value: String(level) }); } catch { /* non-critical */ }
}

async function loadState(): Promise<Tube[] | null> {
  try {
    const row = await db.settings.get(STATE_KEY);
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return null;
    return parsed as Tube[];
  } catch { return null; }
}

async function saveState(tubes: Tube[]): Promise<void> {
  try { await db.settings.put({ key: STATE_KEY, value: JSON.stringify(tubes) }); } catch { /* non-critical */ }
}

async function clearState(): Promise<void> {
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

// ---------- hint finder ----------

function findHintMove(tubes: Tube[]): [number, number] | null {
  for (let s = 0; s < tubes.length; s++) {
    for (let d = 0; d < tubes.length; d++) {
      if (s === d) continue;
      if (canPour(tubes[s]!, tubes[d]!)) {
        return [s, d];
      }
    }
  }
  return null;
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "cflow-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .cflow-root {
      display: flex;
      flex: 1;
      min-height: 0;
      flex-direction: column;
      background: #0a1a2a;
      user-select: none;
      -webkit-user-select: none;
      position: relative;
    }
    .cflow-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      min-height: 40px;
      font-family: monospace;
      color: #ffffff;
      flex-shrink: 0;
    }
    .cflow-hud-left { font-size: 12px; color: #22ffaa; letter-spacing: 1px; }
    .cflow-hud-center { font-size: 12px; color: #aaffdd; }
    .cflow-hud-right { display: flex; gap: 6px; }
    .cflow-hud-right button {
      background: transparent;
      border: 1px solid rgba(34,255,170,0.3);
      border-radius: 6px;
      color: #22ffaa;
      font-size: 16px;
      min-width: 44px;
      min-height: 44px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .cflow-hud-right button:active { background: rgba(34,255,170,0.15); }
    .cflow-arena {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
      box-sizing: border-box;
    }
    .cflow-grid {
      display: grid;
      gap: 8px;
    }
    .cflow-tube-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: transform 150ms ease;
    }
    .cflow-tube-wrap.selected {
      transform: translateY(-10px);
    }
    .cflow-tube-wrap.shake {
      animation: cflow-shake 320ms ease;
    }
    @keyframes cflow-shake {
      0%   { transform: translateX(0); }
      20%  { transform: translateX(-6px); }
      40%  { transform: translateX(6px); }
      60%  { transform: translateX(-4px); }
      80%  { transform: translateX(4px); }
      100% { transform: translateX(0); }
    }
    .cflow-tube {
      position: relative;
      border: 2px solid rgba(200,220,240,0.35);
      border-radius: 0 0 100px 100px;
      background: rgba(10,26,42,0.7);
      overflow: hidden;
      flex-shrink: 0;
    }
    .cflow-tube.selected-tube {
      border-color: #22ffaa;
      box-shadow: 0 0 10px rgba(34,255,170,0.5);
    }
    .cflow-tube.hint-tube {
      border-color: #ffee00;
      box-shadow: 0 0 12px rgba(255,238,0,0.6);
    }
    .cflow-layer {
      position: absolute;
      left: 0;
      right: 0;
      transition: height 250ms ease, bottom 250ms ease;
    }
    .cflow-controls {
      display: flex;
      justify-content: center;
      gap: 10px;
      padding: 8px 10px;
      min-height: 50px;
      flex-shrink: 0;
    }
    .cflow-controls button {
      min-width: 80px;
      min-height: 44px;
      background: rgba(34,255,170,0.08);
      border: 1px solid rgba(34,255,170,0.3);
      border-radius: 8px;
      color: #22ffaa;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 1px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .cflow-controls button:active { background: rgba(34,255,170,0.2); }
    .cflow-controls button:disabled {
      opacity: 0.35;
      pointer-events: none;
    }
    .cflow-onboard {
      position: absolute;
      top: 50px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.82);
      border: 1px solid rgba(34,255,170,0.4);
      border-radius: 12px;
      padding: 14px 20px;
      text-align: center;
      pointer-events: none;
      z-index: 5;
      color: #ffffff;
      font-family: monospace;
      font-size: 13px;
    }
    .cflow-onboard .arrow { font-size: 20px; color: #22ffaa; margin-bottom: 4px; }
    .cflow-onboard .sub { font-size: 10px; color: #aaffdd; margin-top: 4px; }
    .cflow-win {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.85);
      z-index: 10;
    }
    .cflow-win-box {
      text-align: center;
      padding: 32px 28px;
      background: #0a1a2a;
      border: 1px solid #22ffaa;
      border-radius: 14px;
      min-width: 240px;
    }
    .cflow-win-title {
      font-family: monospace;
      font-size: 18px;
      color: #22ffaa;
      letter-spacing: 3px;
      text-shadow: 0 0 14px #22ffaa;
      margin: 0 0 12px;
    }
    .cflow-win-info {
      font-family: monospace;
      font-size: 12px;
      color: #aaffdd;
      margin-bottom: 20px;
    }
    .cflow-win-actions { display: flex; gap: 12px; justify-content: center; }
    .cflow-win-actions button {
      min-width: 100px;
      min-height: 44px;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 1px;
      border-radius: 8px;
      cursor: pointer;
    }
    .cflow-btn-next {
      background: #22ffaa;
      color: #0a1a2a;
      border: none;
    }
    .cflow-btn-menu {
      background: transparent;
      color: #22ffaa;
      border: 1px solid #22ffaa;
    }
    .cflow-particle {
      position: absolute;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      pointer-events: none;
      animation: cflow-fall 1s ease-out forwards;
    }
    @keyframes cflow-fall {
      0%   { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.3); }
    }
  `;
  document.head.appendChild(style);
}

// ---------- DOM builder ----------

function buildHUD(container: HTMLElement): {
  levelEl: HTMLElement;
  movesEl: HTMLElement;
  fsBtn: HTMLButtonElement;
} {
  const hud = document.createElement("div");
  hud.className = "cflow-hud";
  hud.innerHTML = `
    <div class="cflow-hud-left" id="cflow-level">LEVEL 1</div>
    <div class="cflow-hud-center" id="cflow-moves">MOVES: 0</div>
    <div class="cflow-hud-right">
      <button id="cflow-fs" aria-label="Fullscreen">⛶</button>
    </div>
  `;
  container.appendChild(hud);
  return {
    levelEl: hud.querySelector("#cflow-level") as HTMLElement,
    movesEl: hud.querySelector("#cflow-moves") as HTMLElement,
    fsBtn: hud.querySelector("#cflow-fs") as HTMLButtonElement,
  };
}

function buildControls(container: HTMLElement): {
  undoBtn: HTMLButtonElement;
  hintBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
} {
  const ctrl = document.createElement("div");
  ctrl.className = "cflow-controls";
  ctrl.innerHTML = `
    <button id="cflow-undo" aria-label="Undo">↶ UNDO</button>
    <button id="cflow-hint" aria-label="Hint">HINT</button>
    <button id="cflow-reset" aria-label="Reset">↻ RESET</button>
  `;
  container.appendChild(ctrl);
  return {
    undoBtn: ctrl.querySelector("#cflow-undo") as HTMLButtonElement,
    hintBtn: ctrl.querySelector("#cflow-hint") as HTMLButtonElement,
    resetBtn: ctrl.querySelector("#cflow-reset") as HTMLButtonElement,
  };
}

// ---------- tube rendering ----------

function buildTubeEl(tubeW: number, tubeH: number): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "cflow-tube-wrap";
  const tube = document.createElement("div");
  tube.className = "cflow-tube";
  tube.style.width = `${tubeW}px`;
  tube.style.height = `${tubeH}px`;
  wrap.appendChild(tube);
  return wrap;
}

function renderTubeLayers(tubeEl: HTMLElement, tube: Tube, tubeH: number): void {
  // Remove existing layers
  const inner = tubeEl.querySelector(".cflow-tube") as HTMLElement;
  inner.querySelectorAll(".cflow-layer").forEach((l) => l.remove());

  const unitH = tubeH / CAPACITY;
  // Build from bottom up: layer i is the i-th from bottom
  for (let i = 0; i < tube.length; i++) {
    const layer = document.createElement("div");
    layer.className = "cflow-layer";
    layer.style.backgroundColor = tube[i]!;
    layer.style.bottom = `${i * unitH}px`;
    layer.style.height = `${unitH - 1}px`;
    inner.appendChild(layer);
  }
}

function setTubeSelected(wrapEl: HTMLElement, selected: boolean): void {
  const inner = wrapEl.querySelector(".cflow-tube") as HTMLElement;
  wrapEl.classList.toggle("selected", selected);
  inner.classList.toggle("selected-tube", selected);
}

function setTubeHint(wrapEl: HTMLElement, on: boolean): void {
  const inner = wrapEl.querySelector(".cflow-tube") as HTMLElement;
  inner.classList.toggle("hint-tube", on);
}

function shakeWrap(wrapEl: HTMLElement): void {
  wrapEl.classList.remove("shake");
  // Force reflow
  void (wrapEl as HTMLElement & { offsetWidth: number }).offsetWidth;
  wrapEl.classList.add("shake");
  wrapEl.addEventListener("animationend", () => wrapEl.classList.remove("shake"), { once: true });
}

// ---------- particles ----------

function spawnParticles(container: HTMLElement): void {
  const count = 24;
  const cx = container.clientWidth / 2;
  const cy = container.clientHeight / 2;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "cflow-particle";
    const angle = (i / count) * Math.PI * 2;
    const dist = 60 + Math.random() * 80;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 40;
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.backgroundColor = COLORS[i % COLORS.length]!;
    p.style.setProperty("--dx", `${dx}px`);
    p.style.setProperty("--dy", `${dy}px`);
    container.appendChild(p);
    p.addEventListener("animationend", () => p.remove(), { once: true });
  }
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("cflow-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // State
  let level = 1;
  let tubes: Tube[] = [];
  let initialTubes: Tube[] = [];
  let moves = 0;
  let selectedIdx: number | null = null;
  let inputLocked = false;
  let undoStack: UndoEntry[] = [];
  let undosLeft = MAX_UNDOS;
  let hintsLeft = MAX_HINTS;
  let hintHighlight: [number, number] | null = null;

  // Build layout
  const { levelEl, movesEl, fsBtn } = buildHUD(container);
  const arena = document.createElement("div");
  arena.className = "cflow-arena";
  container.appendChild(arena);
  const { undoBtn, hintBtn, resetBtn } = buildControls(container);

  // Tube wrap elements (rebuilt each level)
  let tubeWraps: HTMLDivElement[] = [];
  let tubeW = 50;
  let tubeH = 200;

  // ResizeObserver
  const ro = new ResizeObserver(() => recalcLayout());
  ro.observe(container);

  function recalcLayout(): void {
    if (tubes.length === 0) return;
    const availW = arena.clientWidth - 16;
    const availH = arena.clientHeight - 16;
    const cols = Math.ceil(tubes.length / 2);
    const rows = 2;
    const gap = 8;
    const maxW = Math.floor((availW - gap * (cols - 1)) / cols);
    const rawW = Math.min(60, maxW);
    tubeW = Math.max(28, rawW);
    tubeH = tubeW * 4;

    // Check if 2-row layout fits height
    const neededH = rows * tubeH + gap;
    if (neededH > availH) {
      const scale = availH / (neededH + 16);
      tubeH = Math.floor(tubeH * scale);
      tubeW = Math.floor(tubeH / 4);
    }

    const grid = arena.querySelector(".cflow-grid") as HTMLElement | null;
    if (grid) {
      grid.style.gridTemplateColumns = `repeat(${cols}, ${tubeW}px)`;
    }

    tubeWraps.forEach((wrap, i) => {
      const inner = wrap.querySelector(".cflow-tube") as HTMLElement;
      inner.style.width = `${tubeW}px`;
      inner.style.height = `${tubeH}px`;
      renderTubeLayers(wrap, tubes[i]!, tubeH);
    });
  }

  function renderAll(): void {
    tubeWraps.forEach((wrap, i) => {
      renderTubeLayers(wrap, tubes[i]!, tubeH);
      setTubeSelected(wrap, selectedIdx === i);
      setTubeHint(wrap, hintHighlight !== null && (hintHighlight[0] === i || hintHighlight[1] === i));
    });
    movesEl.textContent = `MOVES: ${moves}`;
    undoBtn.disabled = undoStack.length === 0 || undosLeft === 0;
    hintBtn.disabled = hintsLeft === 0;
  }

  function buildGrid(): void {
    arena.innerHTML = "";
    tubeWraps = [];

    const cols = Math.ceil(tubes.length / 2);
    const grid = document.createElement("div");
    grid.className = "cflow-grid";
    grid.style.gridTemplateColumns = `repeat(${cols}, ${tubeW}px)`;
    grid.style.gap = "8px";

    tubes.forEach((_, i) => {
      const wrap = buildTubeEl(tubeW, tubeH);
      wrap.addEventListener("pointerup", () => onTubeClick(i));
      grid.appendChild(wrap);
      tubeWraps.push(wrap);
    });

    arena.appendChild(grid);
    renderAll();
    recalcLayout();
  }

  function startLevel(lvl: number, savedTubes?: Tube[]): void {
    level = lvl;
    moves = 0;
    selectedIdx = null;
    inputLocked = false;
    undoStack = [];
    undosLeft = MAX_UNDOS;
    hintsLeft = MAX_HINTS;
    hintHighlight = null;

    tubes = savedTubes ?? generateLevel(lvl);
    initialTubes = cloneTubes(tubes);

    levelEl.textContent = `LEVEL ${lvl}`;
    buildGrid();
    void saveState(tubes);
    void saveLevel(lvl);
  }

  function onTubeClick(idx: number): void {
    if (inputLocked) return;

    // Dismiss hint highlight on any interaction
    hintHighlight = null;

    if (selectedIdx === null) {
      // Nothing selected: select this tube if it has liquid
      if (tubes[idx]!.length === 0) return;
      selectedIdx = idx;
      playSfx("click");
      if ("vibrate" in navigator) navigator.vibrate?.(4);
      renderAll();
      return;
    }

    if (selectedIdx === idx) {
      // Re-tap same: deselect
      selectedIdx = null;
      renderAll();
      return;
    }

    // Attempt pour from selectedIdx to idx
    const src = tubes[selectedIdx]!;
    const dst = tubes[idx]!;

    if (!canPour(src, dst)) {
      // Invalid: shake + error
      shakeWrap(tubeWraps[idx]!);
      playSfx("error");
      if ("vibrate" in navigator) navigator.vibrate?.(5);
      // Switch selection to idx if it has liquid
      if (dst.length > 0) {
        selectedIdx = idx;
        renderAll();
      }
      return;
    }

    // Valid pour: save undo state
    undoStack.push({ tubes: cloneTubes(tubes), moves });

    const prevSrc = selectedIdx;
    tubes = pourTubes(tubes, selectedIdx, idx);
    moves++;
    selectedIdx = null;

    playSfx("place");
    if ("vibrate" in navigator) navigator.vibrate?.(10);

    // Dismiss onboarding hint after first valid pour
    void dismissOnboarding();

    renderAll();
    void saveState(tubes);

    // Animate: briefly show pour visual cue
    animatePour(prevSrc, idx, () => {
      if (isWon(tubes)) {
        setTimeout(() => showWin(), 100);
      }
    });
  }

  // Minimal pour animation: tilt source, then restore
  function animatePour(srcIdx: number, _dstIdx: number, onDone: () => void): void {
    const srcWrap = tubeWraps[srcIdx];
    if (!srcWrap) { onDone(); return; }
    inputLocked = true;
    const srcInner = srcWrap.querySelector(".cflow-tube") as HTMLElement;
    srcInner.style.transition = "transform 200ms ease";
    srcInner.style.transform = "rotate(-15deg)";
    setTimeout(() => {
      srcInner.style.transform = "rotate(0deg)";
      setTimeout(() => {
        srcInner.style.transition = "";
        inputLocked = false;
        onDone();
      }, 150);
    }, 250);
  }

  function showWin(): void {
    spawnParticles(container);
    playSfx("levelup");
    if ("vibrate" in navigator) navigator.vibrate?.([30, 60, 30, 60, 100]);

    const score = level * 100 - moves * 5;
    void submit("color-flow", Math.max(score, 10));

    const overlay = document.createElement("div");
    overlay.className = "cflow-win";
    overlay.innerHTML = `
      <div class="cflow-win-box">
        <h2 class="cflow-win-title">LIVELLO ${level}!</h2>
        <div class="cflow-win-info">Mosse: ${moves}</div>
        <div class="cflow-win-actions">
          <button class="cflow-btn-next" id="cflow-next">AVANTI</button>
          <button class="cflow-btn-menu" id="cflow-menu">MENU</button>
        </div>
      </div>
    `;
    container.appendChild(overlay);

    overlay.querySelector("#cflow-next")?.addEventListener("pointerup", () => {
      overlay.remove();
      void clearState();
      startLevel(level + 1);
    });
    overlay.querySelector("#cflow-menu")?.addEventListener("pointerup", () => {
      navigate("/");
    });
  }

  // ---------- controls ----------

  undoBtn.addEventListener("pointerup", () => {
    if (undoStack.length === 0 || undosLeft === 0) return;
    const entry = undoStack.pop()!;
    tubes = entry.tubes;
    moves = entry.moves;
    selectedIdx = null;
    undosLeft--;
    hintHighlight = null;
    playSfx("flip");
    if ("vibrate" in navigator) navigator.vibrate?.(4);
    renderAll();
    void saveState(tubes);
  });

  hintBtn.addEventListener("pointerup", () => {
    if (hintsLeft === 0) return;
    const hint = findHintMove(tubes);
    if (!hint) return;
    hintHighlight = hint;
    hintsLeft--;
    renderAll();
  });

  resetBtn.addEventListener("pointerup", () => {
    playSfx("click");
    tubes = cloneTubes(initialTubes);
    moves = 0;
    selectedIdx = null;
    undoStack = [];
    undosLeft = MAX_UNDOS;
    hintsLeft = MAX_HINTS;
    hintHighlight = null;
    renderAll();
    void saveState(tubes);
  });

  fsBtn.addEventListener("pointerup", () => {
    const target = (container.closest(".game-host") as HTMLElement | null) ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen?.().catch(() => {});
    }
  });

  // ---------- onboarding ----------

  let onboardEl: HTMLElement | null = null;

  async function showOnboarding(): Promise<void> {
    if (await hasSeenHint()) return;
    const el = document.createElement("div");
    el.className = "cflow-onboard";
    el.innerHTML = `
      <div class="arrow">TAP &rarr; TAP</div>
      <div>Versa colori uguali insieme</div>
      <div class="sub">Inizia a giocare per continuare</div>
    `;
    container.appendChild(el);
    onboardEl = el;
    setTimeout(() => el.remove(), 5000);
  }

  async function dismissOnboarding(): Promise<void> {
    if (onboardEl) {
      onboardEl.remove();
      onboardEl = null;
    }
    await markHintSeen();
  }

  // ---------- init ----------

  async function init(): Promise<void> {
    const lvl = await loadLevel();
    const savedTubes = await loadState();
    startLevel(lvl, savedTubes ?? undefined);
    void showOnboarding();
  }

  void init();

  return function cleanup(): void {
    ro.disconnect();
    container.innerHTML = "";
    container.classList.remove("cflow-root");
    container.style.touchAction = prevTouchAction;
  };
}
