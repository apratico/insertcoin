import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { db } from "../../lib/storage.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";
import { playSfx } from "../../lib/audio.js";

// ---------- constants ----------

const BUBBLE_COLORS = ["#ff3333", "#00e5ff", "#ffee00", "#ff44ff", "#44ff88"] as const;
const BUBBLE_R_MIN = 14;
const BUBBLE_R_MAX = 20;
const BUBBLE_SPEED_MIN = 40;
const BUBBLE_SPEED_MAX = 80;
const EXPLOSION_RADIUS = 90;
const BUBBLE_EXPLODE_DELAY_MS = 80;
const EXPLOSION_GROW_MS = 200;
const EXPLOSION_SHRINK_MS = 150;
const RING_MS = 300;
const PARTICLE_COUNT = 15;
const PARTICLE_LIFE_MS = 600;
const SHAKE_BASE_MS = 100;
const FLASH_MS = 60;
const DT_CAP = 32;
const HINT_AUTO_DISMISS_MS = 5000;

// ---------- types ----------

type Phase = "idle" | "chain" | "result" | "levelclear" | "levelfail" | "gameover" | "paused";

interface Bubble {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  alive: boolean;
  scheduledExplosion: number | null; // timestamp when it should explode
}

interface Explosion {
  x: number;
  y: number;
  color: string;
  startT: number;
  r: number; // bubble radius at explosion
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  born: number;
  alive: boolean;
}

// ---------- scoring ----------

function calcScore(n: number): number {
  return Math.round(n * (1 + n / 10));
}

// ---------- level config ----------

function levelBubbleCount(level: number): number {
  return 20 + 5 * level;
}

function levelGoal(level: number): number {
  return 5 + 3 * level;
}

// ---------- bubble factory ----------

let nextId = 0;

function makeBubble(cw: number, ch: number, existing: Bubble[]): Bubble {
  const r = BUBBLE_R_MIN + Math.random() * (BUBBLE_R_MAX - BUBBLE_R_MIN);
  const margin = BUBBLE_R_MAX + 2;
  let x = 0;
  let y = 0;
  let attempts = 0;
  do {
    x = margin + Math.random() * (cw - margin * 2);
    y = margin + Math.random() * (ch - margin * 2);
    attempts++;
  } while (
    attempts < 20 &&
    existing.some((b) => b.alive && Math.hypot(b.x - x, b.y - y) < b.r + r + 4)
  );

  const angle = Math.random() * Math.PI * 2;
  const speed = BUBBLE_SPEED_MIN + Math.random() * (BUBBLE_SPEED_MAX - BUBBLE_SPEED_MIN);
  const color = BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)] ?? "#ff3333";

  return {
    id: nextId++,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r,
    color,
    alive: true,
    scheduledExplosion: null,
  };
}

function spawnBubbles(count: number, cw: number, ch: number): Bubble[] {
  const bubbles: Bubble[] = [];
  for (let i = 0; i < count; i++) {
    bubbles.push(makeBubble(cw, ch, bubbles));
  }
  return bubbles;
}

// ---------- physics ----------

function stepBubbles(bubbles: Bubble[], dt: number, cw: number, ch: number): void {
  for (const b of bubbles) {
    if (!b.alive) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); }
    if (b.x + b.r > cw) { b.x = cw - b.r; b.vx = -Math.abs(b.vx); }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); }
    if (b.y + b.r > ch) { b.y = ch - b.r; b.vy = -Math.abs(b.vy); }
  }
}

// ---------- explosion chain ----------

function scheduleNearby(
  bubbles: Bubble[],
  cx: number,
  cy: number,
  now: number
): number {
  let triggered = 0;
  for (const b of bubbles) {
    if (!b.alive || b.scheduledExplosion !== null) continue;
    const dist = Math.hypot(b.x - cx, b.y - cy);
    if (dist <= EXPLOSION_RADIUS + b.r) {
      b.scheduledExplosion = now + BUBBLE_EXPLODE_DELAY_MS;
      triggered++;
    }
  }
  return triggered;
}

// ---------- render ----------

function renderFrame(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  state: GameState,
  now: number
): void {
  // Shake offset
  let sx = 0;
  let sy = 0;
  const shakeElapsed = now - state.shakeStart;
  if (state.shakeAmt > 0 && shakeElapsed < state.shakeDuration) {
    const t = 1 - shakeElapsed / state.shakeDuration;
    sx = (Math.random() - 0.5) * state.shakeAmt * 2 * t;
    sy = (Math.random() - 0.5) * state.shakeAmt * 2 * t;
  }

  ctx.save();
  ctx.translate(sx, sy);

  // Background flash
  const flashElapsed = now - state.flashStart;
  const flashAlpha = flashElapsed < FLASH_MS ? (1 - flashElapsed / FLASH_MS) * 0.35 : 0;

  // Dark radial background
  const grad = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
  grad.addColorStop(0, `rgba(35,8,50,${1 - flashAlpha})`);
  grad.addColorStop(1, `rgba(10,2,18,${1 - flashAlpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255,200,80,${flashAlpha})`;
    ctx.fillRect(0, 0, cw, ch);
  }

  // Subtle grid
  ctx.strokeStyle = "rgba(255,255,255,0.025)";
  ctx.lineWidth = 0.5;
  const gridStep = 32;
  for (let x = 0; x < cw; x += gridStep) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
  }
  for (let y = 0; y < ch; y += gridStep) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
  }

  // Explosion rings + shrinking bubbles
  for (const exp of state.explosions) {
    const growEnd = exp.startT + EXPLOSION_GROW_MS;
    const shrinkEnd = growEnd + EXPLOSION_SHRINK_MS;
    const ringEnd = exp.startT + RING_MS;

    // Ring
    if (now < ringEnd) {
      const rt = (now - exp.startT) / RING_MS;
      const rr = rt * EXPLOSION_RADIUS;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, rr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,200,80,${(1 - rt) * 0.6})`;
      ctx.lineWidth = 3 * (1 - rt) + 1;
      ctx.shadowBlur = 12;
      ctx.shadowColor = "#ffaa00";
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Bubble scale anim
    let scale = 0;
    if (now < growEnd) {
      scale = 1 + 1.5 * ((now - exp.startT) / EXPLOSION_GROW_MS);
    } else if (now < shrinkEnd) {
      scale = 2.5 * (1 - (now - growEnd) / EXPLOSION_SHRINK_MS);
    }
    if (scale > 0.01) {
      const drawR = exp.r * scale;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, drawR, 0, Math.PI * 2);
      const alpha = Math.min(1, scale / 2.5);
      ctx.fillStyle = exp.color + Math.round(alpha * 255).toString(16).padStart(2, "0");
      ctx.shadowBlur = 20;
      ctx.shadowColor = exp.color;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Particles
  for (const p of state.particles) {
    if (!p.alive) continue;
    const age = now - p.born;
    if (age > PARTICLE_LIFE_MS) { p.alive = false; continue; }
    const lt = 1 - age / PARTICLE_LIFE_MS;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * lt + 1, 0, Math.PI * 2);
    ctx.fillStyle = p.color + Math.round(lt * 200).toString(16).padStart(2, "0");
    ctx.fill();
  }

  // Bubbles
  for (const b of state.bubbles) {
    if (!b.alive) continue;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = b.color;
    ctx.shadowBlur = 8;
    ctx.shadowColor = b.color;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Gloss
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.28, b.y - b.r * 0.28, b.r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fill();
  }

  // Chain counter (big pulse text)
  if (state.phase === "chain" && state.chainCount > 0) {
    const pulse = 1 + 0.08 * Math.sin(now * 0.015);
    const fs = Math.round(28 * pulse);
    ctx.font = `bold ${fs}px monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffaa00";
    ctx.shadowBlur = 16;
    ctx.shadowColor = "#ff6600";
    ctx.fillText(`CHAIN x${state.chainCount}`, cw / 2, ch * 0.18);
    ctx.shadowBlur = 0;
    ctx.textAlign = "left";
  }

  ctx.restore();
}

// ---------- HUD ----------

interface HUDElements {
  scoreEl: HTMLElement;
  bestEl: HTMLElement;
  levelEl: HTMLElement;
  progressBar: HTMLElement;
  progressLabel: HTMLElement;
  bannerEl: HTMLElement;
  pauseBtn: HTMLElement;
  fsBtn: HTMLElement;
}

function buildHUD(container: HTMLElement): HUDElements {
  const hud = document.createElement("div");
  hud.className = "cb-hud";
  hud.innerHTML = `
    <div class="cb-hud-left"><span class="cb-label">SCORE</span><span class="cb-val" id="cb-score">0</span></div>
    <div class="cb-hud-center"><span class="cb-level" id="cb-level">LEVEL 1</span></div>
    <div class="cb-hud-right">
      <span class="cb-label">BEST</span><span class="cb-val" id="cb-best">0</span>
      <button class="btn cb-icon-btn" id="cb-fs" aria-label="Fullscreen">⛶</button>
      <button class="btn cb-icon-btn" id="cb-pause" aria-label="Pause">⏸</button>
    </div>
  `;
  container.appendChild(hud);

  const prog = document.createElement("div");
  prog.className = "cb-progress-wrap";
  prog.innerHTML = `<span class="cb-prog-label" id="cb-prog-label">OBIETTIVO: 0/5</span><div class="cb-prog-bg"><div class="cb-prog-bar" id="cb-prog-bar" style="width:0%"></div></div>`;
  container.appendChild(prog);

  const banner = document.createElement("div");
  banner.className = "cb-banner";
  banner.id = "cb-banner";
  banner.textContent = "TAP TO START CHAIN";
  container.appendChild(banner);

  return {
    scoreEl: hud.querySelector("#cb-score") as HTMLElement,
    bestEl: hud.querySelector("#cb-best") as HTMLElement,
    levelEl: hud.querySelector("#cb-level") as HTMLElement,
    progressBar: prog.querySelector("#cb-prog-bar") as HTMLElement,
    progressLabel: prog.querySelector("#cb-prog-label") as HTMLElement,
    bannerEl: banner,
    pauseBtn: hud.querySelector("#cb-pause") as HTMLElement,
    fsBtn: hud.querySelector("#cb-fs") as HTMLElement,
  };
}

function updateProgress(hud: HUDElements, exploded: number, goal: number): void {
  const pct = Math.min(100, Math.round((exploded / goal) * 100));
  hud.progressBar.style.width = `${pct}%`;
  hud.progressLabel.textContent = `OBIETTIVO: ${exploded}/${goal}`;
}

// ---------- round result overlay ----------

function showRoundOverlay(
  container: HTMLElement,
  cleared: boolean,
  level: number,
  roundScore: number,
  totalScore: number,
  best: number,
  onContinue: () => void,
  onMenu: () => void
): HTMLElement {
  const ov = document.createElement("div");
  ov.className = "cb-round-overlay";
  const isNewBest = totalScore >= best && totalScore > 0;
  ov.innerHTML = `
    <div class="cb-round-box">
      <div class="cb-round-title ${cleared ? "cb-clear" : "cb-fail"}">${cleared ? `LEVEL ${level} CLEAR` : "LEVEL FAILED"}</div>
      ${isNewBest ? `<div class="cb-new-best">NEW BEST!</div>` : ""}
      <div class="cb-round-pts">+${roundScore} pts</div>
      <div class="cb-round-total">TOTAL: ${totalScore}</div>
      <div class="cb-round-actions">
        <button class="btn primary cb-continue-btn" id="cb-continue">${cleared ? "CONTINUE" : "PLAY AGAIN"}</button>
        <button class="btn cb-menu-btn" id="cb-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(ov);
  ov.querySelector("#cb-continue")?.addEventListener("pointerup", () => { ov.remove(); onContinue(); });
  ov.querySelector("#cb-menu")?.addEventListener("pointerup", () => { navigate("/"); });
  void onMenu; // suppress unused warning — bound below
  return ov;
}

function showGameoverOverlay(
  container: HTMLElement,
  totalScore: number,
  best: number,
  onReplay: () => void,
  rank?: RankInfo
): HTMLElement {
  const ov = document.createElement("div");
  ov.className = "cb-round-overlay";
  const isNewBest = totalScore >= best && totalScore > 0;
  const rankHtml = rank ? buildRankCard(rank) : "";
  ov.innerHTML = `
    <div class="cb-round-box">
      <div class="cb-round-title cb-fail">GAME OVER</div>
      ${isNewBest ? `<div class="cb-new-best">NEW BEST!</div>` : ""}
      <div class="cb-round-pts">${totalScore}</div>
      <div class="cb-round-total">FINAL SCORE</div>
      ${rankHtml}
      <div class="cb-round-actions">
        <button class="btn primary cb-continue-btn" id="cb-replay">PLAY AGAIN</button>
        <button class="btn cb-menu-btn" id="cb-go-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(ov);
  ov.querySelector("#cb-replay")?.addEventListener("pointerup", () => { ov.remove(); onReplay(); });
  ov.querySelector("#cb-go-menu")?.addEventListener("pointerup", () => { navigate("/"); });
  return ov;
}

function buildRankCard(rank: RankInfo): string {
  const label = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const delta = rank.toBeat
    ? `<div class="cb-rank-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta}</div>`
    : "";
  return `<div class="cb-rank-card"><div class="cb-rank-title">RANK ${label} GLOBAL</div>${delta}</div>`;
}

// ---------- onboarding hint ----------

async function shouldShowHint(): Promise<boolean> {
  try {
    const row = await db.settings.get("chain-blast:seenHint");
    return !row;
  } catch {
    return true;
  }
}

async function markHintSeen(): Promise<void> {
  try {
    await db.settings.put({ key: "chain-blast:seenHint", value: "1" });
  } catch { /* ignore */ }
}

function buildHint(container: HTMLElement): HTMLElement {
  const hint = document.createElement("div");
  hint.className = "cb-hint";
  hint.innerHTML = `
    <div class="cb-hint-inner">
      <svg width="60" height="60" viewBox="0 0 60 60" class="cb-hint-svg">
        <circle cx="30" cy="30" r="10" fill="none" stroke="#ff6600" stroke-width="2.5">
          <animate attributeName="r" values="10;20;10" dur="1.4s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite"/>
        </circle>
        <circle cx="30" cy="30" r="6" fill="#ff6600" opacity="0.9"/>
        <line x1="30" y1="10" x2="30" y2="2" stroke="#ff6600" stroke-width="2" opacity="0.7"/>
        <line x1="30" y1="50" x2="30" y2="58" stroke="#ff6600" stroke-width="2" opacity="0.7"/>
        <line x1="10" y1="30" x2="2" y2="30" stroke="#ff6600" stroke-width="2" opacity="0.7"/>
        <line x1="50" y1="30" x2="58" y2="30" stroke="#ff6600" stroke-width="2" opacity="0.7"/>
      </svg>
      <div class="cb-hint-text">TAP TO EXPLODE</div>
      <div class="cb-hint-sub">Reach bubbles for chain reaction.</div>
    </div>
  `;
  container.appendChild(hint);
  return hint;
}

// ---------- game state ----------

interface GameState {
  phase: Phase;
  bubbles: Bubble[];
  explosions: Explosion[];
  particles: Particle[];
  chainCount: number;
  shakeStart: number;
  shakeAmt: number;
  shakeDuration: number;
  flashStart: number;
  totalScore: number;
  best: number;
  level: number;
  roundScore: number;
  roundExploded: number;
  pausedPhase: Phase;
  prevPhase: Phase;
}

function makeState(level: number, totalScore: number, best: number, cw: number, ch: number): GameState {
  return {
    phase: "idle",
    bubbles: spawnBubbles(levelBubbleCount(level), cw, ch),
    explosions: [],
    particles: [],
    chainCount: 0,
    shakeStart: -9999,
    shakeAmt: 0,
    shakeDuration: 0,
    flashStart: -9999,
    totalScore,
    best,
    level,
    roundScore: 0,
    roundExploded: 0,
    pausedPhase: "idle",
    prevPhase: "idle",
  };
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("chainblast-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // Layout wrap
  const wrap = document.createElement("div");
  wrap.className = "cb-wrap";
  container.appendChild(wrap);

  // HUD
  const hud = buildHUD(wrap);

  // Canvas area
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "cb-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "cb-canvas";
  canvasWrap.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx = ctxRaw;

  let cw = 0;
  let ch = 0;
  let dpr = 1;

  let stateReady = false;

  function onAfterResize(): void {
    if (!stateReady) return;
    renderCurrentFrame();
  }

  function resizeCanvas(): void {
    dpr = window.devicePixelRatio || 1;
    const w = canvasWrap.clientWidth;
    const h = canvasWrap.clientHeight;
    if (w < 8 || h < 8) return;
    cw = w;
    ch = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onAfterResize();
  }

  const ro = new ResizeObserver(resizeCanvas);
  ro.observe(canvasWrap);
  resizeCanvas();

  // Game state
  let state: GameState = makeState(1, 0, 0, cw || 300, ch || 400);
  let rafId = 0;
  let lastFrameT = 0;
  let hintEl: HTMLElement | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let roundOverlayEl: HTMLElement | null = null;

  void personalBest("chain-blast").then((b) => {
    state.best = b;
    hud.bestEl.textContent = String(b);
  });

  // Hint
  void shouldShowHint().then((show) => {
    if (!show) return;
    hintEl = buildHint(wrap);
    hintTimer = setTimeout(() => dismissHint(), HINT_AUTO_DISMISS_MS);
  });

  function dismissHint(): void {
    if (hintEl) { hintEl.remove(); hintEl = null; }
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    void markHintSeen();
  }

  // HUD button wiring
  hud.fsBtn.addEventListener("pointerup", () => {
    const host = container.closest(".game-host") as HTMLElement | null;
    const target = host ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen?.().catch(() => {});
    }
  });

  hud.pauseBtn.addEventListener("pointerup", () => {
    if (state.phase === "gameover" || state.phase === "levelclear" || state.phase === "levelfail") return;
    if (state.phase === "paused") {
      state.phase = state.pausedPhase;
      lastFrameT = performance.now();
    } else {
      state.pausedPhase = state.phase;
      state.phase = "paused";
    }
  });

  // Touch / click on canvas area
  canvasWrap.addEventListener("pointerdown", onTap);

  function onTap(e: PointerEvent): void {
    e.preventDefault();

    if (hintEl) dismissHint();

    if (state.phase === "paused") return;
    if (state.phase === "chain") return; // ignore during chain
    if (state.phase === "result" || state.phase === "levelclear" || state.phase === "levelfail" || state.phase === "gameover") return;

    if (state.phase === "idle") {
      const rect = canvas.getBoundingClientRect();
      const tapX = e.clientX - rect.left;
      const tapY = e.clientY - rect.top;
      fireDetonation(tapX, tapY);
    }
  }

  function fireDetonation(tapX: number, tapY: number): void {
    if (cw < 8 || ch < 8) return;
    navigator.vibrate?.(15);

    const now = performance.now();
    state.phase = "chain";
    playSfx("pop");
    state.chainCount = 0;
    hud.bannerEl.textContent = "CHAIN!";
    hud.bannerEl.className = "cb-banner cb-banner-chain";

    // Trigger initial explosion at tap point
    triggerExplosionAt(tapX, tapY, "#ffaa00", BUBBLE_R_MIN, now);
    scheduleNearby(state.bubbles, tapX, tapY, now);

    triggerShake(2, SHAKE_BASE_MS);
    triggerFlash(now);
  }

  function triggerExplosionAt(x: number, y: number, color: string, r: number, now: number): void {
    state.explosions.push({ x, y, color, startT: now, r });
  }

  function triggerShake(amt: number, duration: number): void {
    const now = performance.now();
    if (amt > state.shakeAmt || now > state.shakeStart + state.shakeDuration) {
      state.shakeAmt = amt;
      state.shakeDuration = duration;
      state.shakeStart = now;
    }
  }

  function triggerFlash(now: number): void {
    state.flashStart = now;
  }

  function endChain(): void {
    const n = state.roundExploded;
    const rScore = calcScore(n);
    state.roundScore = rScore;
    state.totalScore += rScore;
    if (state.totalScore > state.best) state.best = state.totalScore;

    hud.scoreEl.textContent = String(state.totalScore);
    hud.bestEl.textContent = String(state.best);
    hud.bannerEl.textContent = `+${rScore} POINTS`;
    hud.bannerEl.className = "cb-banner cb-banner-result";

    const goal = levelGoal(state.level);
    const cleared = n >= goal;
    state.phase = "result";

    // Small delay then show overlay
    setTimeout(() => {
      if (cleared) {
        playSfx("win");
        navigator.vibrate?.([30, 30, 100]);
        roundOverlayEl = showRoundOverlay(
          wrap,
          true,
          state.level,
          rScore,
          state.totalScore,
          state.best,
          () => { startLevel(state.level + 1); },
          () => {}
        );
      } else {
        playSfx("lose");
        navigator.vibrate?.([80, 80, 200]);
        void submit("chain-blast", state.totalScore);
        void computeRank("chain-blast", state.totalScore).then((rank) => {
          showGameoverOverlay(wrap, state.totalScore, state.best, restartGame, rank ?? undefined);
        });
        // show overlay immediately, rank card added async after
        roundOverlayEl = showRoundOverlay(
          wrap,
          false,
          state.level,
          rScore,
          state.totalScore,
          state.best,
          restartGame,
          () => {}
        );
      }
    }, 900);
  }

  function startLevel(level: number): void {
    roundOverlayEl?.remove();
    roundOverlayEl = null;
    state = makeState(level, state.totalScore, state.best, cw || 300, ch || 400);
    hud.levelEl.textContent = `LEVEL ${level}`;
    hud.bannerEl.textContent = "TAP TO START CHAIN";
    hud.bannerEl.className = "cb-banner";
    updateProgress(hud, 0, levelGoal(level));
  }

  function restartGame(): void {
    roundOverlayEl?.remove();
    roundOverlayEl = null;
    void personalBest("chain-blast").then((b) => {
      state = makeState(1, 0, b, cw || 300, ch || 400);
      hud.scoreEl.textContent = "0";
      hud.bestEl.textContent = String(b);
      hud.levelEl.textContent = "LEVEL 1";
      hud.bannerEl.textContent = "TAP TO START CHAIN";
      hud.bannerEl.className = "cb-banner";
      updateProgress(hud, 0, levelGoal(1));
    });
  }

  function renderCurrentFrame(): void {
    if (cw < 8 || ch < 8) return;
    renderFrame(ctx, cw, ch, state, performance.now());
  }

  // Main loop
  function loop(now: number): void {
    rafId = requestAnimationFrame(loop);
    const rawDt = now - lastFrameT;
    lastFrameT = now;
    const dt = Math.min(rawDt, DT_CAP) / 1000;

    if (state.phase === "paused") {
      // draw pause overlay
      if (cw >= 8 && ch >= 8) {
        renderFrame(ctx, cw, ch, state, now);
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(0, 0, cw, ch);
        ctx.font = "bold 28px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#ff6600";
        ctx.shadowBlur = 16;
        ctx.shadowColor = "#ff6600";
        ctx.fillText("PAUSED", cw / 2, ch / 2);
        ctx.shadowBlur = 0;
        ctx.textAlign = "left";
        const subFs = 13;
        ctx.font = `${subFs}px monospace`;
        ctx.fillStyle = "#ffffff88";
        ctx.textAlign = "center";
        ctx.fillText("tap ⏸ to resume", cw / 2, ch / 2 + 32);
        ctx.textAlign = "left";
      }
      return;
    }

    // Move bubbles
    if (state.phase === "idle" || state.phase === "chain") {
      stepBubbles(state.bubbles, dt, cw, ch);
    }

    // Process scheduled explosions
    if (state.phase === "chain") {
      let anyPending = false;
      for (const b of state.bubbles) {
        if (!b.alive || b.scheduledExplosion === null) continue;
        if (now >= b.scheduledExplosion) {
          // Explode this bubble
          b.alive = false;
          b.scheduledExplosion = null;
          state.chainCount++;
          state.roundExploded++;

          triggerExplosionAt(b.x, b.y, b.color, b.r, now);
          spawnParticles(b.x, b.y, b.color, now);

          navigator.vibrate?.(4);
          triggerShake(
            Math.min(6, 1.5 + state.chainCount * 0.2),
            SHAKE_BASE_MS + Math.min(state.chainCount * 5, 300)
          );
          triggerFlash(now);

          // Propagate chain
          scheduleNearby(state.bubbles, b.x, b.y, now);

          updateProgress(hud, state.roundExploded, levelGoal(state.level));
        } else {
          anyPending = true;
        }
      }

      // Check if chain is complete
      const stillScheduled = state.bubbles.some((b) => b.alive && b.scheduledExplosion !== null);
      const anyExploding = state.explosions.some((exp) => now < exp.startT + EXPLOSION_GROW_MS + EXPLOSION_SHRINK_MS);

      if (!stillScheduled && !anyPending && !anyExploding && state.phase === "chain") {
        // Wait for the very last explosion animation
        const lastExpEnd = state.explosions.reduce(
          (max, exp) => Math.max(max, exp.startT + EXPLOSION_GROW_MS + EXPLOSION_SHRINK_MS),
          0
        );
        if (now > lastExpEnd) {
          endChain();
        }
      }
    }

    // Cull old explosions
    state.explosions = state.explosions.filter(
      (exp) => now < exp.startT + Math.max(EXPLOSION_GROW_MS + EXPLOSION_SHRINK_MS, RING_MS)
    );

    // Update particles
    for (const p of state.particles) {
      if (!p.alive) continue;
      const age = now - p.born;
      if (age > PARTICLE_LIFE_MS) { p.alive = false; continue; }
      const dt2 = Math.min(rawDt, DT_CAP) / 1000;
      p.x += p.vx * dt2;
      p.y += p.vy * dt2;
      p.vy += 60 * dt2; // mild gravity
    }

    if (cw >= 8 && ch >= 8) {
      renderFrame(ctx, cw, ch, state, now);
    }
  }

  function spawnParticles(x: number, y: number, color: string, now: number): void {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 60 + Math.random() * 140;
      state.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        born: now,
        alive: true,
      });
    }
    // Trim particle pool
    if (state.particles.length > 600) {
      state.particles = state.particles.filter((p) => p.alive);
    }
  }

  // Keyboard
  function onKey(e: KeyboardEvent): void {
    if (e.key === " ") {
      e.preventDefault();
      if (state.phase === "idle") {
        // Fire at center if no specific tap
        fireDetonation(cw / 2, ch / 2);
      } else if (state.phase === "result") {
        // trigger continue via overlay button
        const btn = wrap.querySelector<HTMLElement>("#cb-continue");
        btn?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      }
    }
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      hud.pauseBtn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    }
  }
  document.addEventListener("keydown", onKey);

  updateProgress(hud, 0, levelGoal(1));
  stateReady = true;
  lastFrameT = performance.now();
  rafId = requestAnimationFrame(loop);

  return function cleanup(): void {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    document.removeEventListener("keydown", onKey);
    canvasWrap.removeEventListener("pointerdown", onTap);
    if (hintTimer) clearTimeout(hintTimer);
    container.innerHTML = "";
    container.classList.remove("chainblast-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "chainblast-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .chainblast-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #160814;
      user-select: none;
      -webkit-user-select: none;
    }
    .cb-wrap {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .cb-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      height: 44px;
      min-height: 44px;
      font-family: monospace;
      font-size: 12px;
      color: #ffffff;
      background: rgba(0,0,0,0.45);
      flex-shrink: 0;
    }
    .cb-hud-left, .cb-hud-right {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .cb-hud-center {
      flex: 1;
      text-align: center;
    }
    .cb-label {
      font-size: 9px;
      opacity: 0.6;
      letter-spacing: 1px;
    }
    .cb-val {
      font-size: 15px;
      font-weight: bold;
      min-width: 28px;
    }
    .cb-level {
      font-size: 13px;
      font-weight: bold;
      color: #ff9900;
      letter-spacing: 2px;
    }
    .cb-icon-btn {
      min-width: 36px;
      min-height: 36px;
      font-size: 16px;
      background: transparent;
      border-color: rgba(255,255,255,0.2);
      color: #ffffff;
      padding: 0;
    }
    .cb-progress-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 8px;
      height: 20px;
      min-height: 20px;
      background: rgba(0,0,0,0.3);
      flex-shrink: 0;
    }
    .cb-prog-label {
      font-family: monospace;
      font-size: 9px;
      color: rgba(255,255,255,0.55);
      letter-spacing: 1px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .cb-prog-bg {
      flex: 1;
      height: 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    .cb-prog-bar {
      height: 100%;
      background: linear-gradient(90deg, #ff6600, #ffcc00);
      border-radius: 3px;
      transition: width 0.15s ease;
    }
    .cb-canvas-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }
    .cb-canvas {
      display: block;
      touch-action: none;
    }
    .cb-banner {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: monospace;
      font-size: 18px;
      font-weight: bold;
      color: rgba(255,255,255,0.75);
      letter-spacing: 2px;
      text-align: center;
      pointer-events: none;
      white-space: nowrap;
      text-shadow: 0 0 12px rgba(255,255,255,0.4);
      transition: color 0.2s;
    }
    .cb-banner-chain {
      color: #ffcc00;
      font-size: 22px;
      text-shadow: 0 0 20px #ff6600;
    }
    .cb-banner-result {
      color: #44ff88;
      font-size: 20px;
      text-shadow: 0 0 16px #00ff88;
    }
    .cb-round-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.78);
      z-index: 20;
    }
    .cb-round-box {
      text-align: center;
      padding: 28px 24px;
      background: #1a0520;
      border: 1px solid #ff6600;
      border-radius: 12px;
      min-width: 220px;
      max-width: 300px;
    }
    .cb-round-title {
      font-family: monospace;
      font-size: 16px;
      font-weight: bold;
      letter-spacing: 2px;
      margin-bottom: 10px;
    }
    .cb-clear { color: #44ff88; text-shadow: 0 0 10px #00cc66; }
    .cb-fail  { color: #ff4444; text-shadow: 0 0 10px #cc0000; }
    .cb-new-best {
      color: #ffcc00;
      font-family: monospace;
      font-size: 11px;
      letter-spacing: 2px;
      margin-bottom: 6px;
      text-shadow: 0 0 8px #ffaa00;
    }
    .cb-round-pts {
      font-family: monospace;
      font-size: 36px;
      font-weight: bold;
      color: #ff6600;
      text-shadow: 0 0 12px #ff6600;
      line-height: 1.1;
    }
    .cb-round-total {
      font-family: monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.5);
      letter-spacing: 1px;
      margin-bottom: 16px;
    }
    .cb-round-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .cb-continue-btn, .cb-menu-btn {
      min-width: 100px;
      min-height: 44px;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 1px;
    }
    .cb-rank-card {
      background: rgba(255,102,0,0.12);
      border: 1px solid rgba(255,102,0,0.3);
      border-radius: 8px;
      padding: 8px 12px;
      margin: 8px 0 14px;
    }
    .cb-rank-title {
      font-family: monospace;
      font-size: 11px;
      color: #ff9900;
      letter-spacing: 1px;
    }
    .cb-rank-delta {
      font-family: monospace;
      font-size: 10px;
      color: rgba(255,255,255,0.6);
      margin-top: 4px;
    }
    .cb-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 15;
    }
    .cb-hint-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .cb-hint-text {
      font-family: monospace;
      font-size: 18px;
      font-weight: bold;
      color: #ff6600;
      letter-spacing: 2px;
      text-shadow: 0 0 12px #ff6600;
    }
    .cb-hint-sub {
      font-family: monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.6);
      text-align: center;
    }
  `;
  document.head.appendChild(style);
}
