import { submit, personalBest } from "../../lib/leaderboard.js";
import { navigate } from "../../lib/router.js";
import { computeRank, type RankInfo } from "../../lib/rank.js";

// ---------- types ----------

type Phase = "idle" | "playing" | "gameover";

interface Bird {
  x: number;
  y: number;
  vy: number;
  angle: number;
  wingPhase: number;
}

interface Pipe {
  x: number;
  gapTop: number; // y where gap starts
  scored: boolean;
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  speed: number; // multiplier of scroll
}

// ---------- constants ----------

const GRAVITY = 900;
const FLAP_VY = -320;
const SCROLL_SPEED = 140;
const PIPE_GAP_EASY = 140;
const PIPE_GAP_HARD = 110;
const PIPE_GAP_SCORE = 20;
const PIPE_SPACING = 200;
const BIRD_RADIUS = 14;
const PIPE_WIDTH = 52;
const GROUND_HEIGHT = 32;
const HUD_HEIGHT = 48;

// ---------- helpers ----------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function randomGapTop(canvasH: number, gap: number): number {
  const playH = canvasH - GROUND_HEIGHT;
  const margin = 60;
  return margin + Math.random() * (playH - gap - margin * 2);
}

function initBird(cx: number, cy: number): Bird {
  return { x: cx * 0.28, y: cy * 0.45, vy: 0, angle: 0, wingPhase: 0 };
}

function buildPipes(canvasW: number, canvasH: number, gap: number): Pipe[] {
  const pipes: Pipe[] = [];
  // First pipe further right so player has time to react
  let x = canvasW + 120;
  for (let i = 0; i < 4; i++) {
    pipes.push({ x, gapTop: randomGapTop(canvasH, gap), scored: false });
    x += PIPE_SPACING;
  }
  return pipes;
}

function buildClouds(canvasW: number, canvasH: number): Cloud[] {
  const clouds: Cloud[] = [];
  for (let i = 0; i < 5; i++) {
    clouds.push({
      x: Math.random() * canvasW,
      y: 20 + Math.random() * (canvasH * 0.45),
      w: 50 + Math.random() * 70,
      speed: i < 3 ? 0.3 : 0.6,
    });
  }
  return clouds;
}

// ---------- collision ----------

function birdHitsPipe(bird: Bird, pipe: Pipe, gap: number): boolean {
  const r = BIRD_RADIUS - 2; // slight forgiveness
  const bLeft = bird.x - r;
  const bRight = bird.x + r;
  const bTop = bird.y - r;
  const bBottom = bird.y + r;
  const pLeft = pipe.x;
  const pRight = pipe.x + PIPE_WIDTH;
  if (bRight < pLeft || bLeft > pRight) return false;
  const gapBottom = pipe.gapTop + gap;
  return bTop < pipe.gapTop || bBottom > gapBottom;
}

function birdHitsBounds(bird: Bird, canvasH: number): boolean {
  return bird.y - BIRD_RADIUS <= 0 || bird.y + BIRD_RADIUS >= canvasH - GROUND_HEIGHT;
}

// ---------- draw helpers ----------

function drawPipe(
  ctx: CanvasRenderingContext2D,
  pipe: Pipe,
  canvasH: number,
  gap: number
): void {
  const gapBottom = pipe.gapTop + gap;
  const capH = 18;
  const capExtra = 6;

  // top pipe body
  ctx.fillStyle = "#228B22";
  ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapTop - capH);

  // top pipe cap
  ctx.fillStyle = "#1a6e1a";
  ctx.fillRect(pipe.x - capExtra, pipe.gapTop - capH, PIPE_WIDTH + capExtra * 2, capH);

  // highlight left edge top pipe body
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(pipe.x + 3, 0, 6, pipe.gapTop - capH);

  // dark border top pipe cap
  ctx.fillStyle = "#006400";
  ctx.fillRect(pipe.x - capExtra, pipe.gapTop - capH, PIPE_WIDTH + capExtra * 2, 3);

  // bottom pipe body
  ctx.fillStyle = "#228B22";
  ctx.fillRect(pipe.x, gapBottom + capH, PIPE_WIDTH, canvasH - GROUND_HEIGHT - gapBottom - capH);

  // bottom pipe cap
  ctx.fillStyle = "#1a6e1a";
  ctx.fillRect(pipe.x - capExtra, gapBottom, PIPE_WIDTH + capExtra * 2, capH);

  // highlight left edge bottom pipe body
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(pipe.x + 3, gapBottom + capH, 6, canvasH - GROUND_HEIGHT - gapBottom - capH);

  // dark border bottom pipe cap
  ctx.fillStyle = "#006400";
  ctx.fillRect(pipe.x - capExtra, gapBottom + capH - 3, PIPE_WIDTH + capExtra * 2, 3);
}

function drawBird(
  ctx: CanvasRenderingContext2D,
  bird: Bird
): void {
  const { x, y, angle, wingPhase } = bird;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // body — yellow oval
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#ff8c00";
  ctx.fillStyle = "#ffd700";
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // belly lighter patch
  ctx.fillStyle = "#ffe87c";
  ctx.beginPath();
  ctx.ellipse(2, 2, 8, 7, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // wing — small pulsing shape
  const wingY = 2 + Math.sin(wingPhase) * 4;
  ctx.fillStyle = "#e6a000";
  ctx.beginPath();
  ctx.ellipse(-6, wingY, 7, 4, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // eye white
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(6, -3, 5, 0, Math.PI * 2);
  ctx.fill();

  // pupil
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(7, -3, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // beak
  ctx.fillStyle = "#ff6600";
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(18, -2);
  ctx.lineTo(18, 2);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  clouds: Cloud[]
): void {
  // sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, canvasH);
  grad.addColorStop(0, "#4ec8e0");
  grad.addColorStop(0.7, "#70c5ce");
  grad.addColorStop(1, "#a0d8b8");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // clouds
  clouds.forEach((c) => {
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.w * 0.5, c.w * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(c.x - c.w * 0.22, c.y + 4, c.w * 0.3, c.w * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(c.x + c.w * 0.22, c.y + 4, c.w * 0.3, c.w * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  groundOffset: number
): void {
  // ground strip
  ctx.fillStyle = "#c8a84b";
  ctx.fillRect(0, canvasH - GROUND_HEIGHT, canvasW, GROUND_HEIGHT);
  ctx.fillStyle = "#5aab2e";
  ctx.fillRect(0, canvasH - GROUND_HEIGHT, canvasW, 8);

  // scrolling tick marks on grass
  ctx.fillStyle = "#4a9020";
  const spacing = 24;
  const offset = groundOffset % spacing;
  for (let gx = -offset; gx < canvasW + spacing; gx += spacing) {
    ctx.fillRect(gx, canvasH - GROUND_HEIGHT, 3, 8);
  }
}

function drawHUD(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  score: number
): void {
  ctx.textAlign = "center";
  ctx.font = "bold 36px monospace";
  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 12;
  ctx.shadowColor = "#ff8c00";
  ctx.fillText(String(score), canvasW / 2, 44);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
}

function drawIdleOverlay(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  tick: number
): void {
  const alpha = 0.7 + 0.3 * Math.sin(tick * 0.06);
  ctx.textAlign = "center";
  ctx.font = "bold 22px monospace";
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.shadowBlur = 14;
  ctx.shadowColor = "#ff8c00";
  ctx.fillText("TAP TO FLAP", canvasW / 2, canvasH * 0.72);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
}

// ---------- gameover overlay DOM ----------

function buildRankCard(rank: RankInfo, gameId: string): string {
  const rankLabel = rank.rank > 100 ? "#100+" : `#${rank.rank}`;
  const deltaHtml = rank.toBeat
    ? `<div class="flappy-rank-delta">Beat <strong>${rank.toBeat.nickname}</strong> by +${rank.toBeat.delta} pts</div>`
    : "";
  return `<div class="rank-card">
    <div class="rank-card-title">RANK ${rankLabel} GLOBAL</div>
    ${deltaHtml}
    <button class="btn rank-card-btn" data-scores-id="${gameId}">VIEW LEADERBOARD</button>
  </div>`;
}

function showGameoverOverlay(
  container: HTMLElement,
  score: number,
  best: number,
  onReplay: () => void
): { el: HTMLElement; addRank: (r: RankInfo) => void } {
  const isNew = score >= best && score > 0;
  const overlay = document.createElement("div");
  overlay.className = "flappy-gameover";
  overlay.innerHTML = `
    <div class="flappy-go-box">
      <h2 class="flappy-go-title">GAME OVER</h2>
      ${isNew ? `<div class="flappy-go-new">NEW BEST!</div>` : ""}
      <div class="flappy-go-score">${score}</div>
      <div class="flappy-go-sublabel">SCORE</div>
      <div class="flappy-go-best">BEST ${best}</div>
      <div class="flappy-go-actions">
        <button class="btn primary flappy-go-btn" id="flappy-replay">PLAY AGAIN</button>
        <button class="btn flappy-go-btn" id="flappy-menu">MENU</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector("#flappy-replay")?.addEventListener("pointerup", () => {
    overlay.remove();
    onReplay();
  });
  overlay.querySelector("#flappy-menu")?.addEventListener("pointerup", () => {
    navigate("/");
  });

  function addRank(rank: RankInfo): void {
    const box = overlay.querySelector(".flappy-go-box");
    if (!box || box.querySelector(".rank-card")) return;
    const actions = box.querySelector(".flappy-go-actions");
    if (!actions) return;
    const card = document.createElement("div");
    card.innerHTML = buildRankCard(rank, "flappy");
    const cardEl = card.firstElementChild as HTMLElement | null;
    if (!cardEl) return;
    cardEl.querySelector<HTMLElement>(".rank-card-btn")?.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      navigate("/scores/flappy");
    });
    box.insertBefore(cardEl, actions);
  }

  return { el: overlay, addRank };
}

// ---------- main mount ----------

export function mount(container: HTMLElement): () => void {
  injectStyles();

  container.innerHTML = "";
  container.classList.add("flappy-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // layout wrap
  const wrap = document.createElement("div");
  wrap.className = "flappy-wrap";
  container.appendChild(wrap);

  // HUD bar (top)
  const hud = document.createElement("div");
  hud.className = "flappy-hud";
  hud.innerHTML = `
    <div class="flappy-hud-left">
      <span class="flappy-best-label">BEST</span>
      <span class="flappy-best-val" id="flappy-best">0</span>
    </div>
    <div class="flappy-hud-right">
      <button class="btn flappy-hud-btn" id="flappy-fs" aria-label="Fullscreen">⛶</button>
      <button class="btn flappy-hud-btn" id="flappy-pause" aria-label="Pause">⏸</button>
    </div>
  `;
  wrap.appendChild(hud);

  // canvas area
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "flappy-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "flappy-canvas";
  canvasWrap.appendChild(canvas);

  const ctxRaw = canvas.getContext("2d");
  if (!ctxRaw) throw new Error("No 2D context");
  const ctx: CanvasRenderingContext2D = ctxRaw;

  // state
  let phase: Phase = "idle";
  let score = 0;
  let best = 0;
  let paused = false;
  let rafId = 0;
  let lastTime = 0;
  let tick = 0;
  let flashAlpha = 0;
  let groundOffset = 0;
  let gameoverEl: { el: HTMLElement; addRank: (r: RankInfo) => void } | null = null;

  let canvasW = 0;
  let canvasH = 0;
  let bird: Bird = { x: 0, y: 0, vy: 0, angle: 0, wingPhase: 0 };
  let pipes: Pipe[] = [];
  let clouds: Cloud[] = [];
  let stateReady = false;
  let currentGap = PIPE_GAP_EASY;

  // load best score
  void personalBest("flappy").then((b) => {
    best = b;
    const el = hud.querySelector<HTMLElement>("#flappy-best");
    if (el) el.textContent = String(best);
  });

  // resize
  function onResize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvasWrap.clientWidth;
    const ch = canvasWrap.clientHeight;
    if (cw < 8 || ch < 8) return;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvasW = cw;
    canvasH = ch;
    stateReady = true;
    onAfterResize();
  }

  function onAfterResize(): void {
    if (!stateReady) return;
    if (phase === "idle") {
      resetForIdle();
    }
    drawFrame(0);
  }

  function resetForIdle(): void {
    bird = initBird(canvasW, canvasH);
    currentGap = PIPE_GAP_EASY;
    pipes = buildPipes(canvasW, canvasH, currentGap);
    clouds = buildClouds(canvasW, canvasH);
    groundOffset = 0;
  }

  function startPlaying(): void {
    if (phase !== "idle") return;
    phase = "playing";
    score = 0;
    currentGap = PIPE_GAP_EASY;
    pipes = buildPipes(canvasW, canvasH, currentGap);
    groundOffset = 0;
    bird.vy = FLAP_VY;
    if ("vibrate" in navigator) navigator.vibrate(4);
    lastTime = performance.now();
  }

  function doFlap(): void {
    if (phase === "idle") {
      startPlaying();
      return;
    }
    if (phase === "gameover" || paused) return;
    bird.vy = FLAP_VY;
    if ("vibrate" in navigator) navigator.vibrate(4);
  }

  function triggerGameover(): void {
    phase = "gameover";
    flashAlpha = 1;
    if ("vibrate" in navigator) navigator.vibrate([60, 60, 120]);
    void submit("flappy", score).then(() => {
      void personalBest("flappy").then((b) => {
        best = Math.max(best, b);
        const el = hud.querySelector<HTMLElement>("#flappy-best");
        if (el) el.textContent = String(best);
      });
    });
    setTimeout(() => {
      if (phase !== "gameover") return;
      gameoverEl = showGameoverOverlay(container, score, best, restartGame);
      void computeRank("flappy", score).then((rank) => {
        if (rank && gameoverEl) gameoverEl.addRank(rank);
      });
    }, 500);
  }

  function restartGame(): void {
    score = 0;
    phase = "idle";
    flashAlpha = 0;
    paused = false;
    gameoverEl = null;
    if (stateReady) resetForIdle();
    const el = hud.querySelector<HTMLElement>("#flappy-best");
    if (el) el.textContent = String(best);
    lastTime = performance.now();
  }

  // main loop
  function loop(now: number): void {
    rafId = requestAnimationFrame(loop);
    if (!stateReady) return;

    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(rawDt, 0.05); // cap at 50ms to avoid spiral of death

    tick++;

    if (!paused) {
      update(dt);
    }
    drawFrame(dt);
  }

  function update(dt: number): void {
    // parallax clouds always move slightly
    clouds.forEach((c) => {
      c.x -= SCROLL_SPEED * c.speed * dt;
      if (c.x + c.w < 0) {
        c.x = canvasW + c.w;
        c.y = 20 + Math.random() * (canvasH * 0.45);
      }
    });

    if (phase === "idle") {
      // gentle hover
      bird.vy += GRAVITY * 0.15 * dt;
      bird.y += bird.vy * dt;
      // soft bounce at mid ± 30
      const midY = canvasH * 0.45;
      if (bird.y > midY + 30) bird.vy = -80;
      if (bird.y < midY - 30) bird.vy = 80;
      bird.wingPhase += 6 * dt;
      bird.angle = 0;
      return;
    }

    if (phase === "playing") {
      // physics
      bird.vy += GRAVITY * dt;
      bird.vy = clamp(bird.vy, FLAP_VY, 600);
      bird.y += bird.vy * dt;

      // wing
      bird.wingPhase += (bird.vy < 0 ? 10 : 5) * dt;

      // angle: negative vy → nose up, positive → nose down
      const targetAngle = clamp(bird.vy * 0.003, -0.35, 0.78);
      bird.angle += (targetAngle - bird.angle) * 12 * dt;

      // scroll pipes and ground
      groundOffset += SCROLL_SPEED * dt;

      pipes.forEach((pipe) => {
        pipe.x -= SCROLL_SPEED * dt;
      });

      // score: pipe center passed
      pipes.forEach((pipe) => {
        if (!pipe.scored && pipe.x + PIPE_WIDTH < bird.x) {
          pipe.scored = true;
          score++;
          if (score > best) best = score;
          const el = hud.querySelector<HTMLElement>("#flappy-best");
          if (el) el.textContent = String(best);
          if ("vibrate" in navigator) navigator.vibrate(8);
          // tighten gap after score 20
          currentGap = score >= PIPE_GAP_SCORE ? PIPE_GAP_HARD : PIPE_GAP_EASY;
        }
      });

      // recycle pipes that have left left edge
      pipes.forEach((pipe) => {
        if (pipe.x + PIPE_WIDTH < 0) {
          // find rightmost pipe
          const maxX = pipes.reduce((m, p) => Math.max(m, p.x), 0);
          pipe.x = maxX + PIPE_SPACING;
          pipe.gapTop = randomGapTop(canvasH, currentGap);
          pipe.scored = false;
        }
      });

      // collision
      const hitPipe = pipes.some((p) => birdHitsPipe(bird, p, currentGap));
      const hitBounds = birdHitsBounds(bird, canvasH);
      if (hitPipe || hitBounds) {
        triggerGameover();
      }
    }

    if (phase === "gameover") {
      // bird continues to fall
      bird.vy += GRAVITY * dt;
      bird.y += bird.vy * dt;
      bird.angle = 0.78;
      bird.wingPhase += 2 * dt;

      // flash fades
      flashAlpha = Math.max(0, flashAlpha - dt * 3);
    }
  }

  function drawFrame(_dt: number): void {
    if (!stateReady) return;
    ctx.clearRect(0, 0, canvasW, canvasH);

    drawBackground(ctx, canvasW, canvasH, clouds);

    // pipes (not in gameover to keep them static)
    pipes.forEach((p) => drawPipe(ctx, p, canvasH, currentGap));

    drawGround(ctx, canvasW, canvasH, groundOffset);

    drawBird(ctx, bird);

    // score on canvas (large, top center)
    if (phase === "playing" || phase === "gameover") {
      drawHUD(ctx, canvasW, score);
    }

    if (phase === "idle") {
      drawIdleOverlay(ctx, canvasW, canvasH, tick);
    }

    // white flash on gameover
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
  }

  // resize observer
  const ro = new ResizeObserver(onResize);
  ro.observe(canvasWrap);
  onResize();

  // tap input
  function onPointerDown(e: PointerEvent): void {
    // don't flap if tapping a button
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    doFlap();
  }
  wrap.addEventListener("pointerdown", onPointerDown);

  // keyboard
  function onKey(e: KeyboardEvent): void {
    if (e.key === " " || e.key === "ArrowUp") {
      e.preventDefault();
      doFlap();
    }
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      if (phase === "playing") paused = !paused;
    }
  }
  document.addEventListener("keydown", onKey);

  // HUD buttons
  const fsBtn = hud.querySelector<HTMLElement>("#flappy-fs");
  const pauseBtn = hud.querySelector<HTMLElement>("#flappy-pause");

  fsBtn?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const root = container.closest(".game-host") as HTMLElement | null;
    const target = root ?? container;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen().catch(() => {});
    }
  });

  pauseBtn?.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    if (phase === "playing") paused = !paused;
  });

  // start loop
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);

  return function cleanup(): void {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    document.removeEventListener("keydown", onKey);
    wrap.removeEventListener("pointerdown", onPointerDown);
    container.innerHTML = "";
    container.classList.remove("flappy-root");
    container.style.touchAction = prevTouchAction;
  };
}

// ---------- styles ----------

function injectStyles(): void {
  const id = "flappy-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .flappy-root {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #70c5ce;
      user-select: none;
      -webkit-user-select: none;
      position: relative;
    }
    .flappy-wrap {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .flappy-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: ${HUD_HEIGHT}px;
      min-height: ${HUD_HEIGHT}px;
      padding: 0 8px;
      font-family: monospace;
      color: #fff;
      background: rgba(0,0,0,0.18);
      box-sizing: border-box;
    }
    .flappy-hud-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .flappy-hud-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .flappy-best-label {
      font-size: 10px;
      opacity: 0.75;
      letter-spacing: 1px;
    }
    .flappy-best-val {
      font-size: 16px;
      font-weight: bold;
      min-width: 28px;
      color: #ded895;
      text-shadow: 0 0 6px #ded895;
    }
    .flappy-hud-btn {
      min-width: 44px;
      min-height: 44px;
      font-size: 18px;
      background: transparent;
      border-color: rgba(255,255,255,0.4);
      color: #fff;
    }
    .flappy-canvas-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }
    .flappy-canvas {
      display: block;
      touch-action: none;
    }
    .flappy-gameover {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.65);
      z-index: 10;
    }
    .flappy-go-box {
      text-align: center;
      padding: 28px 24px;
      background: #1a3040;
      border: 2px solid #ded895;
      border-radius: 14px;
      min-width: 230px;
      font-family: monospace;
    }
    .flappy-go-title {
      margin: 0 0 6px;
      font-size: 24px;
      color: #ff4444;
      letter-spacing: 3px;
      text-shadow: 0 0 14px #ff4444;
    }
    .flappy-go-new {
      color: #ded895;
      font-size: 13px;
      letter-spacing: 2px;
      margin-bottom: 6px;
      text-shadow: 0 0 8px #ded895;
    }
    .flappy-go-score {
      font-size: 56px;
      font-weight: bold;
      color: #ffffff;
      text-shadow: 0 0 18px #ff8c00;
      line-height: 1;
    }
    .flappy-go-sublabel {
      font-size: 11px;
      color: #aaa;
      letter-spacing: 2px;
      margin-bottom: 4px;
    }
    .flappy-go-best {
      font-size: 13px;
      color: #ded895;
      margin-bottom: 18px;
    }
    .flappy-go-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
    }
    .flappy-go-btn {
      min-width: 100px;
      min-height: 44px;
      font-family: monospace;
      font-size: 13px;
      letter-spacing: 1px;
    }
    .flappy-rank-delta {
      font-size: 12px;
      color: #ccc;
      margin: 4px 0;
    }
  `;
  document.head.appendChild(style);
}
