import { db } from "../../lib/storage.js";
import { navigate } from "../../lib/router.js";
import { playSfx } from "../../lib/audio.js";

// ── Constants ────────────────────────────────────────────────────────────────

const BEST_OF = 5;
const WINS_NEEDED = 3;
const READY_MS = 500;
const WAIT_MIN_MS = 1500;
const WAIT_MAX_MS = 4000;
const RESULT_MS = 2000;
const HINT_AUTO_DISMISS_MS = 5000;
const MIN_VALID_REACTION_MS = 80; // below this = suspected cheat / accidental

const C_READY   = "#2a2a3a";
const C_GO_FROM = "#22aa22";
const C_GO_TO   = "#44ff66";
const C_WIN_DIM = "#1a5c1a";
const C_LOSE    = "#1a1a2a";
const C_FALSE   = "#aa0000";
const C_TEXT    = "#ffffff";
const C_ACCENT  = "#44ff66";

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "ready" | "wait" | "go" | "result" | "match_over";

interface PlayerState {
  wins: number;
  bestMs: number | null;
  sumMs: number;
  countMs: number;
}

interface RoundResult {
  winner: 1 | 2 | null; // null = both missed (shouldn't happen but typed for safety)
  falseStart: 1 | 2 | null;
  reactionP1: number | null;
  reactionP2: number | null;
}

// ── Storage helpers ──────────────────────────────────────────────────────────

async function loadSeenHint(): Promise<boolean> {
  try {
    const row = await db.settings.get("reaction-duel:seenHint");
    return row?.value === "1";
  } catch { return false; }
}

async function markSeenHint(): Promise<void> {
  await db.settings.put({ key: "reaction-duel:seenHint", value: "1" });
}

// ── Reaction time colour ─────────────────────────────────────────────────────

function reactionColor(ms: number): string {
  if (ms < 200) return "#44ff66";
  if (ms < 400) return "#ffcc00";
  return "#ff4444";
}

// ── Main game builder ────────────────────────────────────────────────────────

function buildGame(container: HTMLElement, showHintFirst: boolean): () => void {
  // ── State ────────────────────────────────────────────────────────────────

  let phase: Phase = "idle";
  let goTimestamp = 0;
  const players: [PlayerState, PlayerState] = [
    { wins: 0, bestMs: null, sumMs: 0, countMs: 0 },
    { wins: 0, bestMs: null, sumMs: 0, countMs: 0 },
  ];
  let lastResult: RoundResult | null = null;

  // Active pointer IDs per half (to ignore secondary touches)
  const activePointer: [number | null, number | null] = [null, null];

  // Timer refs for cleanup
  const timers: ReturnType<typeof setTimeout>[] = [];

  function addTimer(fn: () => void, ms: number): void {
    timers.push(setTimeout(fn, ms));
  }

  function clearTimers(): void {
    timers.forEach(clearTimeout);
    timers.length = 0;
  }

  // ── DOM construction ─────────────────────────────────────────────────────

  const root = document.createElement("div");
  root.className = "rd-root";

  // Top half — P2 (rotated 180°)
  const halfP2 = document.createElement("div");
  halfP2.className = "rd-half rd-half-top";

  const innerP2 = document.createElement("div");
  innerP2.className = "rd-inner rd-inner-p2";

  const hudP2 = document.createElement("div");
  hudP2.className = "rd-hud";

  const stateP2 = document.createElement("div");
  stateP2.className = "rd-state-label";

  const reactionP2 = document.createElement("div");
  reactionP2.className = "rd-reaction-label";

  const resultP2 = document.createElement("div");
  resultP2.className = "rd-result-label";

  innerP2.appendChild(hudP2);
  innerP2.appendChild(stateP2);
  innerP2.appendChild(reactionP2);
  innerP2.appendChild(resultP2);
  halfP2.appendChild(innerP2);

  // Divider
  const divider = document.createElement("div");
  divider.className = "rd-divider";
  const vsLabel = document.createElement("span");
  vsLabel.className = "rd-vs";
  vsLabel.textContent = "VS";
  const fsBtn = document.createElement("button");
  fsBtn.className = "rd-fullscreen-btn";
  fsBtn.setAttribute("aria-label", "Fullscreen");
  fsBtn.textContent = "⛶";
  divider.appendChild(vsLabel);
  divider.appendChild(fsBtn);

  // Bottom half — P1
  const halfP1 = document.createElement("div");
  halfP1.className = "rd-half rd-half-bottom";

  const innerP1 = document.createElement("div");
  innerP1.className = "rd-inner rd-inner-p1";

  const hudP1 = document.createElement("div");
  hudP1.className = "rd-hud";

  const stateP1 = document.createElement("div");
  stateP1.className = "rd-state-label";

  const reactionP1 = document.createElement("div");
  reactionP1.className = "rd-reaction-label";

  const resultP1 = document.createElement("div");
  resultP1.className = "rd-result-label";

  innerP1.appendChild(hudP1);
  innerP1.appendChild(stateP1);
  innerP1.appendChild(reactionP1);
  innerP1.appendChild(resultP1);
  halfP1.appendChild(innerP1);

  root.appendChild(halfP2);
  root.appendChild(divider);
  root.appendChild(halfP1);
  container.appendChild(root);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function avgMs(p: PlayerState): number | null {
    if (p.countMs === 0) return null;
    return Math.round(p.sumMs / p.countMs);
  }

  function updateHud(): void {
    const score = `${players[1].wins} — ${players[0].wins}`;
    const scoreP1 = `${players[0].wins} — ${players[1].wins}`;

    function bestAvgLine(p: PlayerState): string {
      const b = p.bestMs !== null ? `best ${p.bestMs}ms` : "";
      const a = avgMs(p) !== null ? `avg ${avgMs(p)}ms` : "";
      return [b, a].filter(Boolean).join("  ");
    }

    hudP2.innerHTML = `
      <div class="rd-hud-score">${score}</div>
      <div class="rd-hud-times">${bestAvgLine(players[1])}</div>
    `;
    hudP1.innerHTML = `
      <div class="rd-hud-score">${scoreP1}</div>
      <div class="rd-hud-times">${bestAvgLine(players[0])}</div>
    `;
  }

  function setHalfColor(half: HTMLElement, bg: string): void {
    half.style.background = bg;
  }

  function setStateLabel(el: HTMLElement, text: string, cls: string): void {
    el.textContent = text;
    el.className = `rd-state-label ${cls}`;
  }

  function setResultLabel(el: HTMLElement, html: string): void {
    el.innerHTML = html;
  }

  function clearLabels(): void {
    stateP1.textContent = "";
    stateP2.textContent = "";
    reactionP1.textContent = "";
    reactionP2.textContent = "";
    resultP1.innerHTML = "";
    resultP2.innerHTML = "";
  }

  // ── Phase transitions ────────────────────────────────────────────────────

  function enterReady(): void {
    clearTimers();
    clearLabels();
    phase = "ready";
    lastResult = null;
    activePointer[0] = null;
    activePointer[1] = null;

    setHalfColor(halfP1, C_READY);
    setHalfColor(halfP2, C_READY);
    setStateLabel(stateP1, "READY", "rd-label-ready");
    setStateLabel(stateP2, "READY", "rd-label-ready");
    halfP1.classList.remove("rd-pulse-wait", "rd-pulse-go", "rd-pulse-false");
    halfP2.classList.remove("rd-pulse-wait", "rd-pulse-go", "rd-pulse-false");

    addTimer(enterWait, READY_MS);
  }

  function enterWait(): void {
    phase = "wait";
    playSfx("countdown");
    const waitMs = WAIT_MIN_MS + Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS);

    setHalfColor(halfP1, C_FALSE);
    setHalfColor(halfP2, C_FALSE);
    setStateLabel(stateP1, "WAIT...", "rd-label-wait");
    setStateLabel(stateP2, "WAIT...", "rd-label-wait");
    halfP1.classList.add("rd-pulse-wait");
    halfP2.classList.add("rd-pulse-wait");

    addTimer(enterGo, waitMs);
  }

  function enterGo(): void {
    phase = "go";
    playSfx("go");
    goTimestamp = performance.now();

    const goBg = `linear-gradient(135deg, ${C_GO_FROM}, ${C_GO_TO})`;
    halfP1.style.background = goBg;
    halfP2.style.background = goBg;
    halfP1.classList.remove("rd-pulse-wait");
    halfP2.classList.remove("rd-pulse-wait");
    halfP1.classList.add("rd-pulse-go");
    halfP2.classList.add("rd-pulse-go");

    setStateLabel(stateP1, "TAP!", "rd-label-go");
    setStateLabel(stateP2, "TAP!", "rd-label-go");
  }

  function handleFalseStart(playerIdx: 0 | 1): void {
    if (phase !== "wait") return;
    clearTimers();

    const winner: 1 | 2 = playerIdx === 0 ? 2 : 1; // other player wins
    const falsePlayer: 1 | 2 = playerIdx === 0 ? 1 : 2;

    players[winner - 1].wins++;
    lastResult = {
      winner,
      falseStart: falsePlayer,
      reactionP1: null,
      reactionP2: null,
    };

    phase = "result";
    enterResult(lastResult);
  }

  function handleTap(playerIdx: 0 | 1): void {
    if (phase === "wait") {
      handleFalseStart(playerIdx);
      return;
    }

    if (phase !== "go") return;

    const elapsedMs = Math.round(performance.now() - goTimestamp);

    // Suspected pre-tap (< MIN_VALID_REACTION_MS): treat as false start
    if (elapsedMs < MIN_VALID_REACTION_MS) {
      clearTimers();
      const winner: 1 | 2 = playerIdx === 0 ? 2 : 1;
      const falsePlayer: 1 | 2 = playerIdx === 0 ? 1 : 2;
      players[winner - 1].wins++;
      lastResult = {
        winner,
        falseStart: falsePlayer,
        reactionP1: null,
        reactionP2: null,
      };
      phase = "result";
      enterResult(lastResult);
      return;
    }

    // Valid tap
    clearTimers();
    const winner: 1 | 2 = playerIdx === 0 ? 1 : 2;
    const loser: 1 | 2 = playerIdx === 0 ? 2 : 1;

    const winnerState = players[winner - 1];
    winnerState.wins++;
    winnerState.sumMs += elapsedMs;
    winnerState.countMs++;
    if (winnerState.bestMs === null || elapsedMs < winnerState.bestMs) {
      winnerState.bestMs = elapsedMs;
    }

    // We don't have the loser's time — show "TOO SLOW"
    lastResult = {
      winner,
      falseStart: null,
      reactionP1: winner === 1 ? elapsedMs : null,
      reactionP2: winner === 2 ? elapsedMs : null,
    };

    phase = "result";

    // Haptics
    navigator.vibrate?.(50);
    // Loser pattern — we trigger from the winning side; losing side player sees their feedback
    // (can't target per-player vibration on a shared device)
    void loser; // referenced to avoid unused-variable error

    enterResult(lastResult);
  }

  function handleLate(playerIdx: 0 | 1, elapsedMs: number): void {
    // Second player taps after winner already determined
    const loserState = players[playerIdx];
    loserState.sumMs += elapsedMs;
    loserState.countMs++;
    if (loserState.bestMs === null || elapsedMs < loserState.bestMs) {
      loserState.bestMs = elapsedMs;
    }
  }

  // Tracks first tap per side during "go" for late registration
  const tappedInGo: [boolean, boolean] = [false, false];

  function handleGoTap(playerIdx: 0 | 1): void {
    if (tappedInGo[playerIdx]) return;

    if (phase === "go") {
      tappedInGo[playerIdx] = true;
      const elapsedMs = Math.round(performance.now() - goTimestamp);

      if (!tappedInGo[playerIdx === 0 ? 1 : 0]) {
        // First tapper — becomes winner candidate
        handleTap(playerIdx);
      } else {
        // Second tapper — register late time
        if (elapsedMs >= MIN_VALID_REACTION_MS) {
          handleLate(playerIdx, elapsedMs);
        }
      }
    }
  }

  function enterResult(result: RoundResult): void {
    updateHud();

    // Determine per-player outcomes
    for (let idx = 0; idx < 2; idx++) {
      const pIdx = idx as 0 | 1;
      const pNum: 1 | 2 = pIdx === 0 ? 1 : 2;
      const stateEl = pIdx === 0 ? stateP1 : stateP2;
      const reactEl = pIdx === 0 ? reactionP1 : reactionP2;
      const resultEl = pIdx === 0 ? resultP1 : resultP2;
      const halfEl   = pIdx === 0 ? halfP1 : halfP2;

      halfEl.classList.remove("rd-pulse-go", "rd-pulse-wait");

      if (result.falseStart === pNum) {
        // This player false-started
        setHalfColor(halfEl, C_FALSE);
        halfEl.classList.add("rd-pulse-false");
        setStateLabel(stateEl, "FALSE START", "rd-label-false");
        reactEl.textContent = "";
        setResultLabel(resultEl, `<span class="rd-lose-text">LOSE</span>`);
        playSfx("error");
        navigator.vibrate?.([80, 80, 80, 80, 200]);
      } else if (result.winner === pNum) {
        // Winner
        const ms = pIdx === 0 ? result.reactionP1 : result.reactionP2;
        setHalfColor(halfEl, `linear-gradient(135deg, ${C_GO_FROM}, ${C_WIN_DIM})`);
        setStateLabel(stateEl, "WIN", "rd-label-win");
        if (ms !== null) {
          const col = reactionColor(ms);
          reactEl.innerHTML = `<span style="color:${col}">${ms} ms</span>`;
        } else {
          reactEl.textContent = "";
        }
        setResultLabel(resultEl, `<span class="rd-win-text">WIN +1</span>`);
        playSfx("win");
        navigator.vibrate?.(50);
      } else {
        // Loser (not false start)
        const ms = pIdx === 0 ? result.reactionP1 : result.reactionP2;
        const winnerMs = pIdx === 0 ? result.reactionP2 : result.reactionP1;
        setHalfColor(halfEl, C_LOSE);
        setStateLabel(stateEl, "LOSE", "rd-label-lose");
        if (ms !== null && winnerMs !== null) {
          const delta = ms - winnerMs;
          const col = reactionColor(ms);
          reactEl.innerHTML = `<span style="color:${col}">${ms} ms</span>`;
          setResultLabel(resultEl, `<span class="rd-lose-text">TOO SLOW +${delta}ms</span>`);
        } else if (ms !== null) {
          const col = reactionColor(ms);
          reactEl.innerHTML = `<span style="color:${col}">${ms} ms</span>`;
          setResultLabel(resultEl, `<span class="rd-lose-text">LOSE</span>`);
        } else {
          reactEl.textContent = "";
          setResultLabel(resultEl, `<span class="rd-lose-text">LOSE</span>`);
        }
        navigator.vibrate?.([30, 30, 30]);
      }
    }

    // Check match over
    if (players[0].wins >= WINS_NEEDED || players[1].wins >= WINS_NEEDED) {
      addTimer(showMatchOver, RESULT_MS);
    } else {
      addTimer(startNextRound, RESULT_MS);
    }
  }

  function startNextRound(): void {
    tappedInGo[0] = false;
    tappedInGo[1] = false;
    enterReady();
  }

  function showMatchOver(): void {
    phase = "match_over";
    clearTimers();

    const matchWinner = players[0].wins >= WINS_NEEDED ? 1 : 2;
    const winnerState = players[matchWinner - 1];

    const bestTime = winnerState.bestMs !== null ? `${winnerState.bestMs} ms` : "—";
    const avgTime  = avgMs(winnerState) !== null ? `${avgMs(winnerState)} ms` : "—";

    const overlay = document.createElement("div");
    overlay.className = "rd-match-overlay";
    overlay.innerHTML = `
      <div class="rd-match-box">
        <div class="rd-match-title">P${matchWinner} WINS THE MATCH</div>
        <div class="rd-match-stats">
          <span>Best: <b>${bestTime}</b></span>
          <span>Avg: <b>${avgTime}</b></span>
        </div>
        <div class="rd-match-final-score">${players[0].wins} — ${players[1].wins}</div>
        <div class="rd-match-actions">
          <button class="rd-btn rd-btn-primary" id="rd-rematch">RIVINCITA</button>
          <button class="rd-btn" id="rd-menu">MENU</button>
        </div>
      </div>
    `;
    root.appendChild(overlay);

    overlay.querySelector("#rd-rematch")?.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      overlay.remove();
      resetMatch();
    });
    overlay.querySelector("#rd-menu")?.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      navigate("/");
    });
  }

  function resetMatch(): void {
    players[0].wins = 0; players[0].bestMs = null; players[0].sumMs = 0; players[0].countMs = 0;
    players[1].wins = 0; players[1].bestMs = null; players[1].sumMs = 0; players[1].countMs = 0;
    tappedInGo[0] = false;
    tappedInGo[1] = false;
    updateHud();
    enterReady();
  }

  // ── Input ────────────────────────────────────────────────────────────────

  function onPointerDownHalf(playerIdx: 0 | 1, e: PointerEvent): void {
    // Ignore if overlay button was the target
    if ((e.target as HTMLElement).closest(".rd-match-overlay")) return;

    // Only track first pointer per half
    if (activePointer[playerIdx] !== null) return;
    activePointer[playerIdx] = e.pointerId;

    if (phase === "wait") {
      handleFalseStart(playerIdx);
    } else if (phase === "go") {
      handleGoTap(playerIdx);
    } else if (phase === "result" || phase === "match_over") {
      // Tap during result = skip pause (but not during match_over)
      if (phase === "result") {
        clearTimers();
        if (players[0].wins >= WINS_NEEDED || players[1].wins >= WINS_NEEDED) {
          showMatchOver();
        } else {
          startNextRound();
        }
      }
    }
    // ready/idle: ignore
  }

  function onPointerUpHalf(playerIdx: 0 | 1, e: PointerEvent): void {
    if (activePointer[playerIdx] === e.pointerId) {
      activePointer[playerIdx] = null;
    }
  }

  // Attach listeners
  const onP2Down = (e: PointerEvent): void => onPointerDownHalf(1, e);
  const onP1Down = (e: PointerEvent): void => onPointerDownHalf(0, e);
  const onP2Up   = (e: PointerEvent): void => onPointerUpHalf(1, e);
  const onP1Up   = (e: PointerEvent): void => onPointerUpHalf(0, e);

  halfP2.addEventListener("pointerdown", onP2Down);
  halfP1.addEventListener("pointerdown", onP1Down);
  halfP2.addEventListener("pointerup",   onP2Up);
  halfP1.addEventListener("pointerup",   onP1Up);

  // Keyboard shortcuts (desktop)
  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === "q" || key === "a") {
      onPointerDownHalf(1, new PointerEvent("pointerdown", { pointerId: 9001 }));
    } else if (key === "p" || key === "l") {
      onPointerDownHalf(0, new PointerEvent("pointerdown", { pointerId: 9002 }));
    } else if (key === " ") {
      // Advance or skip
      if (phase === "result") {
        clearTimers();
        if (players[0].wins >= WINS_NEEDED || players[1].wins >= WINS_NEEDED) {
          showMatchOver();
        } else {
          startNextRound();
        }
      }
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    if (key === "q" || key === "a") {
      onPointerUpHalf(1, new PointerEvent("pointerup", { pointerId: 9001 }));
    } else if (key === "p" || key === "l") {
      onPointerUpHalf(0, new PointerEvent("pointerup", { pointerId: 9002 }));
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // Fullscreen
  fsBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (!document.fullscreenElement) {
      void container.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  });

  // ── Onboarding hint ──────────────────────────────────────────────────────

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
    hintEl.className = "rd-hint";
    hintEl.innerHTML = `
      <div class="rd-hint-inner">
        <div class="rd-hint-big">TAP ON GREEN</div>
        <div class="rd-hint-line">Don't tap early or you lose the round.</div>
        <div class="rd-hint-line">Device between players. Both tap on their side.</div>
      </div>
    `;
    hintEl.style.pointerEvents = "none";
    root.appendChild(hintEl);
    hintTimer = setTimeout(dismissHint, HINT_AUTO_DISMISS_MS);
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  updateHud();

  // Brief idle before first round starts (allow hint to show)
  if (showHintFirst) {
    addTimer(() => {
      dismissHint();
      enterReady();
    }, HINT_AUTO_DISMISS_MS);
  } else {
    addTimer(enterReady, 100);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  return function cleanup(): void {
    clearTimers();
    if (hintTimer !== null) clearTimeout(hintTimer);
    halfP2.removeEventListener("pointerdown", onP2Down);
    halfP1.removeEventListener("pointerdown", onP1Down);
    halfP2.removeEventListener("pointerup",   onP2Up);
    halfP1.removeEventListener("pointerup",   onP1Up);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup",   onKeyUp);
    root.remove();
  };
}

// ── Mount (shell contract) ───────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.classList.add("reaction-root");
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
    container.classList.remove("reaction-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ── Styles ───────────────────────────────────────────────────────────────────

function injectStyles(): void {
  const id = "reaction-duel-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .reaction-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: ${C_READY};
      user-select: none;
      -webkit-user-select: none;
    }

    /* ── Root layout ─────────────────────────────────────────────────── */
    .rd-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    /* ── Each half ───────────────────────────────────────────────────── */
    .rd-half {
      flex: 1;
      display: flex;
      align-items: stretch;
      justify-content: stretch;
      position: relative;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background 0.15s ease;
    }
    .rd-half-top .rd-inner {
      transform: rotate(180deg);
    }

    /* ── Inner content ───────────────────────────────────────────────── */
    .rd-inner {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 16px;
      box-sizing: border-box;
    }

    /* ── Divider ─────────────────────────────────────────────────────── */
    .rd-divider {
      flex: 0 0 28px;
      background: #111;
      border-top: 2px solid rgba(255,255,255,0.15);
      border-bottom: 2px solid rgba(255,255,255,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      z-index: 2;
      position: relative;
    }
    .rd-vs {
      font-family: monospace;
      font-size: 11px;
      font-weight: bold;
      color: rgba(255,255,255,0.4);
      letter-spacing: 3px;
    }
    .rd-fullscreen-btn {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 4px;
      color: rgba(255,255,255,0.5);
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
    .rd-fullscreen-btn:active { opacity: 0.6; }

    /* ── HUD ─────────────────────────────────────────────────────────── */
    .rd-hud {
      text-align: center;
      font-family: monospace;
    }
    .rd-hud-score {
      font-size: clamp(22px, 7vw, 36px);
      font-weight: bold;
      color: ${C_TEXT};
      letter-spacing: 6px;
    }
    .rd-hud-times {
      font-size: 11px;
      color: rgba(255,255,255,0.45);
      letter-spacing: 1px;
      min-height: 14px;
    }

    /* ── State label ─────────────────────────────────────────────────── */
    .rd-state-label {
      font-family: monospace;
      font-size: clamp(24px, 8vw, 52px);
      font-weight: bold;
      letter-spacing: 4px;
      text-align: center;
      transition: color 0.1s;
    }
    .rd-label-ready { color: rgba(255,255,255,0.35); }
    .rd-label-wait  { color: #ff4444; }
    .rd-label-go    { color: ${C_TEXT}; text-shadow: 0 0 24px ${C_ACCENT}, 0 0 8px ${C_ACCENT}; }
    .rd-label-win   { color: ${C_ACCENT}; text-shadow: 0 0 20px ${C_ACCENT}; }
    .rd-label-lose  { color: rgba(255,255,255,0.3); }
    .rd-label-false { color: #ff2222; }

    /* ── Reaction time label ──────────────────────────────────────────── */
    .rd-reaction-label {
      font-family: monospace;
      font-size: clamp(16px, 5vw, 28px);
      font-weight: bold;
      letter-spacing: 2px;
      min-height: 1.2em;
      text-align: center;
    }

    /* ── Result label ────────────────────────────────────────────────── */
    .rd-result-label {
      font-family: monospace;
      font-size: clamp(12px, 3.5vw, 18px);
      letter-spacing: 2px;
      text-align: center;
      min-height: 1.4em;
    }
    .rd-win-text  { color: ${C_ACCENT}; }
    .rd-lose-text { color: rgba(255,255,255,0.45); }

    /* ── Pulse animations ────────────────────────────────────────────── */
    @keyframes rd-pulse-wait {
      0%,100% { filter: brightness(1); }
      50%      { filter: brightness(1.3); }
    }
    @keyframes rd-pulse-go {
      0%,100% { filter: brightness(1); }
      50%      { filter: brightness(1.2) saturate(1.4); }
    }
    @keyframes rd-pulse-false {
      0%,100% { filter: brightness(1); }
      50%      { filter: brightness(1.5); }
    }
    .rd-pulse-wait  { animation: rd-pulse-wait  0.6s ease-in-out infinite; }
    .rd-pulse-go    { animation: rd-pulse-go    0.4s ease-in-out infinite; }
    .rd-pulse-false { animation: rd-pulse-false 0.3s ease-in-out infinite; }

    /* ── Match over overlay ──────────────────────────────────────────── */
    .rd-match-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.82);
      z-index: 20;
    }
    .rd-match-box {
      background: #0d1a0d;
      border: 1.5px solid ${C_ACCENT};
      border-radius: 14px;
      padding: 28px 24px;
      min-width: 240px;
      max-width: 88vw;
      display: flex;
      flex-direction: column;
      gap: 14px;
      align-items: center;
      box-shadow: 0 0 40px ${C_ACCENT}44;
    }
    .rd-match-title {
      font-family: monospace;
      font-size: clamp(16px, 4.5vw, 22px);
      font-weight: bold;
      color: ${C_ACCENT};
      letter-spacing: 3px;
      text-align: center;
      text-shadow: 0 0 16px ${C_ACCENT};
    }
    .rd-match-stats {
      font-family: monospace;
      font-size: 13px;
      color: rgba(255,255,255,0.55);
      display: flex;
      gap: 20px;
      letter-spacing: 1px;
    }
    .rd-match-stats b { color: rgba(255,255,255,0.85); }
    .rd-match-final-score {
      font-family: monospace;
      font-size: clamp(20px, 6vw, 32px);
      font-weight: bold;
      color: ${C_TEXT};
      letter-spacing: 6px;
    }
    .rd-match-actions {
      display: flex;
      gap: 12px;
    }
    .rd-btn {
      min-width: 96px;
      min-height: 44px;
      font-family: monospace;
      font-size: 13px;
      letter-spacing: 2px;
      border-radius: 8px;
      border: 1.5px solid rgba(255,255,255,0.25);
      background: rgba(255,255,255,0.06);
      color: ${C_TEXT};
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .rd-btn:active { opacity: 0.7; }
    .rd-btn-primary {
      background: ${C_GO_FROM};
      border-color: ${C_ACCENT};
      color: #000;
      font-weight: bold;
    }
    .rd-btn-primary:active { opacity: 0.8; }

    /* ── Onboarding hint ─────────────────────────────────────────────── */
    .rd-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 15;
      animation: rd-hint-fade 0.4s ease;
    }
    @keyframes rd-hint-fade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .rd-hint-inner {
      background: rgba(0,0,0,0.82);
      border-radius: 10px;
      padding: 22px 28px;
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .rd-hint-big {
      font-family: monospace;
      font-size: 20px;
      font-weight: bold;
      color: ${C_ACCENT};
      letter-spacing: 4px;
    }
    .rd-hint-line {
      font-family: monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.65);
      letter-spacing: 0.5px;
    }
  `;
  document.head.appendChild(style);
}

// Re-export BEST_OF for potential future use by shell
export { BEST_OF };
