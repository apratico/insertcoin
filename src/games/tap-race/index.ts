import { db } from "../../lib/storage.js";
import { navigate } from "../../lib/router.js";

// ── Constants ────────────────────────────────────────────────────────────────

const ROUNDS_TO_WIN = 2;
const TOTAL_ROUNDS = 3;
const ROUND_DURATION_MS = 10_000;
const READY_MS = 500;
const COUNTDOWN_TICK_MS = 1_000;
const RESULT_MS = 2_000;
const HINT_AUTO_DISMISS_MS = 5_000;

// Suspicious tap rate threshold (tap/s). Flag but don't block.
const SUSPICIOUS_RATE = 25;

const C_READY   = "#2a2a3a";
const C_COUNT   = "#1a1000";
const C_GO_FROM = "#1a3f1a";
const C_GO_TO   = "#1a5c1a";
const C_LOSE    = "#1a1a2a";

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = "ready" | "count" | "go" | "result" | "match_over";

interface PlayerState {
  roundWins: number;
  taps: number;
  suspicious: boolean;
}

interface RoundResult {
  winner: 0 | 1 | "draw";
  tapsP1: number;
  tapsP2: number;
}

// ── Storage helpers ──────────────────────────────────────────────────────────

async function loadSeenHint(): Promise<boolean> {
  try {
    const row = await db.settings.get("tap-race:seenHint");
    return row?.value === "1";
  } catch { return false; }
}

async function markSeenHint(): Promise<void> {
  await db.settings.put({ key: "tap-race:seenHint", value: "1" });
}

// ── Main game builder ────────────────────────────────────────────────────────

function buildGame(container: HTMLElement, showHintFirst: boolean): () => void {

  // ── State ──────────────────────────────────────────────────────────────────

  let phase: Phase = "ready";
  let roundNumber = 0;
  let goStart = 0;
  let goElapsedMs = 0;
  let animFrameId = 0;
  let countdownValue = 3;

  const players: [PlayerState, PlayerState] = [
    { roundWins: 0, taps: 0, suspicious: false },
    { roundWins: 0, taps: 0, suspicious: false },
  ];

  // Track tap timestamps per player for rate detection
  const tapTimes: [number[], number[]] = [[], []];
  let lastRoundResult: RoundResult | null = null;

  // Timer refs for cleanup
  const timers: ReturnType<typeof setTimeout>[] = [];

  function addTimer(fn: () => void, ms: number): void {
    timers.push(setTimeout(fn, ms));
  }

  function clearTimers(): void {
    timers.forEach(clearTimeout);
    timers.length = 0;
  }

  // ── DOM construction ───────────────────────────────────────────────────────

  const root = document.createElement("div");
  root.className = "tr-root";

  // ── P2 half (top, rotated 180°) ──────────────────────────────────────────

  const halfP2 = document.createElement("div");
  halfP2.className = "tr-half tr-half-top";

  const innerP2 = document.createElement("div");
  innerP2.className = "tr-inner tr-inner-p2";

  const hudP2 = document.createElement("div");
  hudP2.className = "tr-hud";

  const countP2 = document.createElement("div");
  countP2.className = "tr-tap-count";

  const labelP2 = document.createElement("div");
  labelP2.className = "tr-phase-label";

  const resultP2 = document.createElement("div");
  resultP2.className = "tr-result-label";

  innerP2.append(hudP2, countP2, labelP2, resultP2);
  halfP2.appendChild(innerP2);

  // ── Divider ───────────────────────────────────────────────────────────────

  const divider = document.createElement("div");
  divider.className = "tr-divider";

  const timerBar = document.createElement("div");
  timerBar.className = "tr-timer-bar-wrap";
  const timerFill = document.createElement("div");
  timerFill.className = "tr-timer-fill";
  timerBar.appendChild(timerFill);

  const timerText = document.createElement("div");
  timerText.className = "tr-timer-text";

  const fsBtn = document.createElement("button");
  fsBtn.className = "tr-fs-btn";
  fsBtn.setAttribute("aria-label", "Fullscreen");
  fsBtn.textContent = "⛶";

  divider.append(timerBar, timerText, fsBtn);

  // ── P1 half (bottom, normal) ──────────────────────────────────────────────

  const halfP1 = document.createElement("div");
  halfP1.className = "tr-half tr-half-bottom";

  const innerP1 = document.createElement("div");
  innerP1.className = "tr-inner tr-inner-p1";

  const hudP1 = document.createElement("div");
  hudP1.className = "tr-hud";

  const countP1 = document.createElement("div");
  countP1.className = "tr-tap-count";

  const labelP1 = document.createElement("div");
  labelP1.className = "tr-phase-label";

  const resultP1 = document.createElement("div");
  resultP1.className = "tr-result-label";

  innerP1.append(hudP1, countP1, labelP1, resultP1);
  halfP1.appendChild(innerP1);

  root.append(halfP2, divider, halfP1);
  container.appendChild(root);

  // ── HUD render ─────────────────────────────────────────────────────────────

  function updateHud(): void {
    const rnd = `ROUND ${roundNumber}/${TOTAL_ROUNDS}`;
    // P2 sees P2 score first (mirror of P1 view)
    hudP2.innerHTML = `
      <div class="tr-hud-round">${rnd}</div>
      <div class="tr-hud-match">${players[1].roundWins} — ${players[0].roundWins}</div>
    `;
    hudP1.innerHTML = `
      <div class="tr-hud-round">${rnd}</div>
      <div class="tr-hud-match">${players[0].roundWins} — ${players[1].roundWins}</div>
    `;
  }

  function setHalfBg(half: HTMLElement, bg: string): void {
    half.style.background = bg;
  }

  function setLabel(el: HTMLElement, text: string, cls: string): void {
    el.textContent = text;
    el.className = `tr-phase-label ${cls}`;
  }

  function clearResults(): void {
    resultP1.innerHTML = "";
    resultP2.innerHTML = "";
    resultP1.className = "tr-result-label";
    resultP2.className = "tr-result-label";
  }

  function setCountDisplay(val: string): void {
    countP1.textContent = val;
    countP2.textContent = val;
  }

  function updateLiveCounts(): void {
    countP1.textContent = String(players[0].taps);
    countP2.textContent = String(players[1].taps);
  }

  function updateTimer(): void {
    if (phase !== "go") {
      timerText.textContent = "";
      timerFill.style.width = "0%";
      return;
    }
    const remaining = Math.max(0, ROUND_DURATION_MS - goElapsedMs);
    const pct = (remaining / ROUND_DURATION_MS) * 100;
    timerFill.style.width = `${pct.toFixed(1)}%`;
    timerText.textContent = `${(remaining / 1000).toFixed(1)}`;
  }

  // ── Phase transitions ──────────────────────────────────────────────────────

  function enterReady(): void {
    clearTimers();
    cancelAnimationFrame(animFrameId);
    phase = "ready";

    players[0].taps = 0; players[0].suspicious = false;
    players[1].taps = 0; players[1].suspicious = false;
    tapTimes[0].length = 0;
    tapTimes[1].length = 0;

    setHalfBg(halfP1, C_READY);
    setHalfBg(halfP2, C_READY);
    halfP1.classList.remove("tr-pulse-go", "tr-pulse-count");
    halfP2.classList.remove("tr-pulse-go", "tr-pulse-count");

    setLabel(labelP1, "READY", "tr-label-ready");
    setLabel(labelP2, "READY", "tr-label-ready");
    setCountDisplay("");
    clearResults();

    timerFill.style.width = "0%";
    timerText.textContent = "";

    updateHud();

    addTimer(enterCount, READY_MS);
  }

  function enterCount(): void {
    phase = "count";
    countdownValue = 3;

    setHalfBg(halfP1, C_COUNT);
    setHalfBg(halfP2, C_COUNT);
    halfP1.classList.add("tr-pulse-count");
    halfP2.classList.add("tr-pulse-count");

    dismissHint();

    function tick(): void {
      navigator.vibrate?.(15);
      setCountDisplay(String(countdownValue));
      setLabel(labelP1, String(countdownValue), "tr-label-count");
      setLabel(labelP2, String(countdownValue), "tr-label-count");

      if (countdownValue > 1) {
        countdownValue--;
        addTimer(tick, COUNTDOWN_TICK_MS);
      } else {
        addTimer(enterGo, COUNTDOWN_TICK_MS);
      }
    }
    tick();
  }

  function enterGo(): void {
    phase = "go";
    goStart = performance.now();
    goElapsedMs = 0;

    halfP1.classList.remove("tr-pulse-count");
    halfP2.classList.remove("tr-pulse-count");
    halfP1.classList.add("tr-pulse-go");
    halfP2.classList.add("tr-pulse-go");

    const goBg = `linear-gradient(135deg, ${C_GO_FROM}, ${C_GO_TO})`;
    setHalfBg(halfP1, goBg);
    setHalfBg(halfP2, goBg);

    setCountDisplay("0");
    setLabel(labelP1, "TAP!", "tr-label-go");
    setLabel(labelP2, "TAP!", "tr-label-go");

    navigator.vibrate?.(15);

    function rafLoop(): void {
      goElapsedMs = performance.now() - goStart;
      updateLiveCounts();
      updateTimer();
      if (goElapsedMs < ROUND_DURATION_MS) {
        animFrameId = requestAnimationFrame(rafLoop);
      } else {
        goElapsedMs = ROUND_DURATION_MS;
        updateLiveCounts();
        updateTimer();
        endGo();
      }
    }
    animFrameId = requestAnimationFrame(rafLoop);
  }

  function endGo(): void {
    cancelAnimationFrame(animFrameId);
    halfP1.classList.remove("tr-pulse-go");
    halfP2.classList.remove("tr-pulse-go");

    const t1 = players[0].taps;
    const t2 = players[1].taps;

    let winner: 0 | 1 | "draw";
    if (t1 > t2) {
      winner = 0;
      players[0].roundWins++;
      navigator.vibrate?.([30, 30, 60]);
    } else if (t2 > t1) {
      winner = 1;
      players[1].roundWins++;
      navigator.vibrate?.([30, 30, 60]);
    } else {
      winner = "draw";
    }

    lastRoundResult = { winner, tapsP1: t1, tapsP2: t2 };
    phase = "result";

    enterResult(lastRoundResult);
  }

  function enterResult(result: RoundResult): void {
    updateHud();

    const delta = Math.abs(result.tapsP1 - result.tapsP2);

    for (let idx = 0; idx < 2; idx++) {
      const pIdx = idx as 0 | 1;
      const halfEl   = pIdx === 0 ? halfP1 : halfP2;
      const labelEl  = pIdx === 0 ? labelP1 : labelP2;
      const resultEl = pIdx === 0 ? resultP1 : resultP2;
      const myTaps   = pIdx === 0 ? result.tapsP1 : result.tapsP2;

      if (result.winner === "draw") {
        setHalfBg(halfEl, C_READY);
        setLabel(labelEl, "DRAW", "tr-label-ready");
        resultEl.innerHTML = `<span class="tr-draw-text">${myTaps} TAPS</span>`;
      } else if (result.winner === pIdx) {
        setHalfBg(halfEl, `linear-gradient(135deg, #1a5c1a, #22aa22)`);
        setLabel(labelEl, "WIN +1", "tr-label-win");
        resultEl.innerHTML = `<span class="tr-win-text">${myTaps} TAPS</span>`;
      } else {
        setHalfBg(halfEl, C_LOSE);
        setLabel(labelEl, "LOSE", "tr-label-lose");
        resultEl.innerHTML = `<span class="tr-lose-text">${myTaps} TAPS  -${delta}</span>`;
      }
    }

    timerFill.style.width = "0%";
    timerText.textContent = "";

    if (players[0].roundWins >= ROUNDS_TO_WIN || players[1].roundWins >= ROUNDS_TO_WIN) {
      addTimer(showMatchOver, RESULT_MS);
    } else {
      addTimer(() => { roundNumber++; enterReady(); }, RESULT_MS);
    }
  }

  function showMatchOver(): void {
    phase = "match_over";
    clearTimers();
    cancelAnimationFrame(animFrameId);

    const matchWinner = players[0].roundWins >= ROUNDS_TO_WIN ? 0 : 1;
    const wState = players[matchWinner];
    const totalRoundsPlayed = roundNumber;
    // best rate = best single-round tap count / 10s
    const bestRate = (Math.max(players[0].taps, players[1].taps) / (ROUND_DURATION_MS / 1000)).toFixed(1);

    navigator.vibrate?.([30, 60, 30, 60, 150]);

    const overlay = document.createElement("div");
    overlay.className = "tr-match-overlay";
    overlay.innerHTML = `
      <div class="tr-match-box">
        <div class="tr-match-title">P${matchWinner + 1} VINCE IL MATCH!</div>
        <div class="tr-match-stats">
          <span>Rounds: <b>${wState.roundWins}/${totalRoundsPlayed}</b></span>
          <span>Best rate: <b>${bestRate} tap/s</b></span>
        </div>
        <div class="tr-match-score">${players[0].roundWins} — ${players[1].roundWins}</div>
        <div class="tr-match-actions">
          <button class="tr-btn tr-btn-primary" id="tr-rematch">RIVINCITA</button>
          <button class="tr-btn" id="tr-menu">MENU</button>
        </div>
      </div>
    `;
    root.appendChild(overlay);

    overlay.querySelector("#tr-rematch")?.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      overlay.remove();
      resetMatch();
    });
    overlay.querySelector("#tr-menu")?.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      navigate("/");
    });
  }

  function resetMatch(): void {
    players[0].roundWins = 0; players[0].taps = 0; players[0].suspicious = false;
    players[1].roundWins = 0; players[1].taps = 0; players[1].suspicious = false;
    tapTimes[0].length = 0;
    tapTimes[1].length = 0;
    roundNumber = 1;
    lastRoundResult = null;
    enterReady();
  }

  // ── Tap handling ───────────────────────────────────────────────────────────

  function registerTap(pIdx: 0 | 1): void {
    if (phase !== "go") return;

    players[pIdx].taps++;
    navigator.vibrate?.(3);

    // Rate check
    const now = performance.now();
    tapTimes[pIdx].push(now);
    // Keep only last 1s of taps
    const cutoff = now - 1000;
    let start = 0;
    while (start < tapTimes[pIdx].length && (tapTimes[pIdx][start] ?? 0) < cutoff) start++;
    if (start > 0) tapTimes[pIdx].splice(0, start);
    const rate = tapTimes[pIdx].length;
    if (rate > SUSPICIOUS_RATE) {
      players[pIdx].suspicious = true;
    }
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  function onPointerDownP1(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest(".tr-match-overlay")) return;
    e.preventDefault();

    if (phase === "go") {
      registerTap(0);
    } else if (phase === "result") {
      skipResult();
    }
  }

  function onPointerDownP2(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest(".tr-match-overlay")) return;
    e.preventDefault();

    if (phase === "go") {
      registerTap(1);
    } else if (phase === "result") {
      skipResult();
    }
  }

  function skipResult(): void {
    if (phase !== "result") return;
    clearTimers();
    if (players[0].roundWins >= ROUNDS_TO_WIN || players[1].roundWins >= ROUNDS_TO_WIN) {
      showMatchOver();
    } else {
      roundNumber++;
      enterReady();
    }
  }

  halfP1.addEventListener("pointerdown", onPointerDownP1);
  halfP2.addEventListener("pointerdown", onPointerDownP2);

  // Keyboard
  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === "p" || key === "l") {
      if (phase === "go") registerTap(0);
      else if (phase === "result") skipResult();
    } else if (key === "q" || key === "a") {
      if (phase === "go") registerTap(1);
      else if (phase === "result") skipResult();
    } else if (key === " ") {
      if (phase === "result") skipResult();
    }
  }
  window.addEventListener("keydown", onKeyDown);

  // Fullscreen
  fsBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    const host = container.closest(".game-host") as HTMLElement | null;
    const target = host ?? container;
    if (!document.fullscreenElement) {
      void target.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  });

  // ── Onboarding hint ────────────────────────────────────────────────────────

  let hintEl: HTMLElement | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let hintDismissed = false;

  function dismissHint(): void {
    if (hintDismissed) return;
    hintDismissed = true;
    if (hintTimer !== null) clearTimeout(hintTimer);
    hintEl?.remove();
    hintEl = null;
    void markSeenHint();
  }

  if (showHintFirst) {
    hintEl = document.createElement("div");
    hintEl.className = "tr-hint";
    hintEl.innerHTML = `
      <div class="tr-hint-inner">
        <div class="tr-hint-big">TAP AS FAST AS YOU CAN</div>
        <div class="tr-hint-line">Top half = P2 &nbsp;·&nbsp; Bottom half = P1</div>
        <div class="tr-hint-line">Device on table between players.</div>
        <div class="tr-hint-line">10 seconds. Most taps wins the round.</div>
      </div>
    `;
    hintEl.style.pointerEvents = "none";
    root.appendChild(hintEl);
    hintTimer = setTimeout(dismissHint, HINT_AUTO_DISMISS_MS);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  roundNumber = 1;

  if (showHintFirst) {
    addTimer(() => {
      dismissHint();
      enterReady();
    }, HINT_AUTO_DISMISS_MS);
  } else {
    addTimer(enterReady, 100);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  return function cleanup(): void {
    clearTimers();
    cancelAnimationFrame(animFrameId);
    if (hintTimer !== null) clearTimeout(hintTimer);
    halfP1.removeEventListener("pointerdown", onPointerDownP1);
    halfP2.removeEventListener("pointerdown", onPointerDownP2);
    window.removeEventListener("keydown", onKeyDown);
    root.remove();
  };
}

// ── Mount (shell contract) ────────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.classList.add("taprace-root");
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
    container.classList.remove("taprace-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles(): void {
  const STYLE_ID = "tap-race-styles";
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .taprace-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #1a001a;
      user-select: none;
      -webkit-user-select: none;
    }

    .tr-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    /* ── Halves ──────────────────────────────────────────────────────── */
    .tr-half {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: stretch;
      justify-content: stretch;
      position: relative;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background 0.15s ease;
    }
    .tr-half-top .tr-inner {
      transform: rotate(180deg);
    }

    .tr-inner {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 16px;
      box-sizing: border-box;
    }

    /* ── Divider ─────────────────────────────────────────────────────── */
    .tr-divider {
      flex: 0 0 30px;
      background: #111;
      border-top: 1px solid rgba(255,255,255,0.12);
      border-bottom: 1px solid rgba(255,255,255,0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      z-index: 2;
      position: relative;
      padding: 0 6px;
    }

    .tr-timer-bar-wrap {
      flex: 1;
      height: 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    .tr-timer-fill {
      height: 100%;
      width: 0%;
      background: #ff44ff;
      border-radius: 3px;
      transition: width 0.08s linear;
    }

    .tr-timer-text {
      font-family: monospace;
      font-size: 11px;
      font-weight: bold;
      color: rgba(255,255,255,0.55);
      min-width: 30px;
      text-align: center;
      letter-spacing: 1px;
    }

    .tr-fs-btn {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 4px;
      color: rgba(255,255,255,0.45);
      font-size: 13px;
      width: 24px;
      height: 24px;
      min-width: 24px;
      min-height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      -webkit-tap-highlight-color: transparent;
    }
    .tr-fs-btn:active { opacity: 0.6; }

    /* ── HUD ─────────────────────────────────────────────────────────── */
    .tr-hud {
      text-align: center;
      font-family: monospace;
    }
    .tr-hud-round {
      font-size: clamp(9px, 2.5vw, 13px);
      color: rgba(255,255,255,0.4);
      letter-spacing: 2px;
    }
    .tr-hud-match {
      font-size: clamp(18px, 6vw, 30px);
      font-weight: bold;
      color: #ffffff;
      letter-spacing: 5px;
    }

    /* ── Tap count (main number) ─────────────────────────────────────── */
    .tr-tap-count {
      font-family: monospace;
      font-size: clamp(48px, 16vw, 90px);
      font-weight: bold;
      color: #ffffff;
      line-height: 1;
      letter-spacing: -2px;
      text-shadow: 0 0 20px rgba(255,255,255,0.3);
      transition: color 0.1s;
      min-height: 1em;
    }

    /* ── Phase label ─────────────────────────────────────────────────── */
    .tr-phase-label {
      font-family: monospace;
      font-size: clamp(14px, 4.5vw, 24px);
      font-weight: bold;
      letter-spacing: 4px;
      text-align: center;
      min-height: 1.2em;
    }
    .tr-label-ready { color: rgba(255,255,255,0.3); }
    .tr-label-count { color: #ffaa22; text-shadow: 0 0 20px #ffaa22; }
    .tr-label-go    { color: #44ff66; text-shadow: 0 0 20px #44ff66; }
    .tr-label-win   { color: #44ff66; text-shadow: 0 0 24px #44ff66; }
    .tr-label-lose  { color: rgba(255,255,255,0.25); }

    /* ── Result label ────────────────────────────────────────────────── */
    .tr-result-label {
      font-family: monospace;
      font-size: clamp(11px, 3vw, 16px);
      letter-spacing: 2px;
      text-align: center;
      min-height: 1.4em;
    }
    .tr-win-text   { color: #44ff66; }
    .tr-lose-text  { color: rgba(255,255,255,0.35); }
    .tr-draw-text  { color: rgba(255,255,255,0.5); }

    /* ── Pulse animations ────────────────────────────────────────────── */
    @keyframes tr-pulse-count {
      0%,100% { filter: brightness(1); }
      50%      { filter: brightness(1.6) saturate(1.4); }
    }
    @keyframes tr-pulse-go {
      0%,100% { filter: brightness(1); }
      50%      { filter: brightness(1.25) saturate(1.5); }
    }
    .tr-pulse-count { animation: tr-pulse-count 0.5s ease-in-out infinite; }
    .tr-pulse-go    { animation: tr-pulse-go    0.35s ease-in-out infinite; }

    /* ── Match over overlay ──────────────────────────────────────────── */
    .tr-match-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.85);
      z-index: 20;
    }
    .tr-match-box {
      background: #0d001a;
      border: 1.5px solid #ff44ff;
      border-radius: 14px;
      padding: 28px 24px;
      min-width: 240px;
      max-width: 88vw;
      display: flex;
      flex-direction: column;
      gap: 14px;
      align-items: center;
      box-shadow: 0 0 40px #ff44ff44;
    }
    .tr-match-title {
      font-family: monospace;
      font-size: clamp(14px, 4vw, 20px);
      font-weight: bold;
      color: #ff44ff;
      letter-spacing: 3px;
      text-align: center;
      text-shadow: 0 0 16px #ff44ff;
    }
    .tr-match-stats {
      font-family: monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.5);
      display: flex;
      gap: 18px;
      letter-spacing: 1px;
    }
    .tr-match-stats b { color: rgba(255,255,255,0.85); }
    .tr-match-score {
      font-family: monospace;
      font-size: clamp(20px, 6vw, 32px);
      font-weight: bold;
      color: #ffffff;
      letter-spacing: 6px;
    }
    .tr-match-actions {
      display: flex;
      gap: 12px;
    }
    .tr-btn {
      min-width: 96px;
      min-height: 44px;
      font-family: monospace;
      font-size: 13px;
      letter-spacing: 2px;
      border-radius: 8px;
      border: 1.5px solid rgba(255,255,255,0.22);
      background: rgba(255,255,255,0.06);
      color: #ffffff;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .tr-btn:active { opacity: 0.7; }
    .tr-btn-primary {
      background: #3a006a;
      border-color: #ff44ff;
      color: #ffffff;
      font-weight: bold;
    }
    .tr-btn-primary:active { opacity: 0.8; }

    /* ── Onboarding hint ─────────────────────────────────────────────── */
    .tr-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 15;
      animation: tr-hint-fade 0.4s ease;
    }
    @keyframes tr-hint-fade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .tr-hint-inner {
      background: rgba(0,0,0,0.88);
      border: 1px solid rgba(255,68,255,0.35);
      border-radius: 10px;
      padding: 22px 28px;
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .tr-hint-big {
      font-family: monospace;
      font-size: clamp(13px, 4vw, 18px);
      font-weight: bold;
      color: #ff44ff;
      letter-spacing: 3px;
    }
    .tr-hint-line {
      font-family: monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.6);
      letter-spacing: 0.5px;
    }
  `;
  document.head.appendChild(style);
}
