import * as Phaser from "phaser";
import { submit } from "../../lib/leaderboard.js";
import { playSfx } from "../../lib/audio.js";

// ─── constants ────────────────────────────────────────────────────────────────

const GAME_ID = "star-void";
const DESIGN_W = 360;
const DESIGN_H = 640;

// ─── types ────────────────────────────────────────────────────────────────────

type WeaponLevel = 1 | 2 | 3 | 4 | 5;
type WeaponType = "basic" | "spread" | "wide" | "laser" | "homing";
type EnemyKind =
  | "grunt" | "chaser" | "diver" | "gunner" | "shooter"
  | "zigzag" | "tank" | "swarm"
  | "boss1" | "boss2" | "boss3";
type BossKind = "boss1" | "boss2" | "boss3";

interface WaveEvent {
  at: number;
  type: EnemyKind;
  count?: number;
  pattern?: string;
  round?: number;
}

// ─── round system ─────────────────────────────────────────────────────────────
// Each round = stream of waves terminated by a boss. Boss kill grants a
// permanent weapon reward, plays a banner, then next round starts.

interface RoundDef {
  name: string;
  color: string;
  reward: WeaponType;
  rewardLabel: string;
}

const ROUNDS: RoundDef[] = [
  { name: "SECTOR ALPHA", color: "#88ddff", reward: "spread", rewardLabel: "SPREAD SHOT" },
  { name: "SECTOR BETA",  color: "#ffcc22", reward: "wide",   rewardLabel: "WIDE CANNON" },
  { name: "SECTOR OMEGA", color: "#ff3366", reward: "homing", rewardLabel: "HOMING MISSILES" },
];

// ─── wave timeline ────────────────────────────────────────────────────────────
// Dense pacing: an event every 3-5s so the screen never empties.

const WAVE_TIMELINE: WaveEvent[] = [
  // ─── ROUND 1: Sector Alpha (ends with boss1) ───
  { at: 2,   type: "grunt",   count: 8,  pattern: "straight-line", round: 1 },
  { at: 6,   type: "grunt",   count: 6,  pattern: "v-formation",   round: 1 },
  { at: 10,  type: "chaser",  count: 4,                             round: 1 },
  { at: 14,  type: "swarm",   count: 14,                            round: 1 },
  { at: 18,  type: "zigzag",  count: 5,                             round: 1 },
  { at: 23,  type: "diver",   count: 6,                             round: 1 },
  { at: 28,  type: "grunt",   count: 10, pattern: "v-formation",   round: 1 },
  { at: 33,  type: "chaser",  count: 5,                             round: 1 },
  { at: 38,  type: "zigzag",  count: 6,                             round: 1 },
  { at: 43,  type: "swarm",   count: 18,                            round: 1 },
  { at: 48,  type: "gunner",  count: 2,                             round: 1 },
  { at: 55,  type: "boss1",                                          round: 1 },
  // ─── ROUND 2: Sector Beta (ends with boss2) ───
  { at: 75,  type: "chaser",  count: 6,                             round: 2 },
  { at: 80,  type: "zigzag",  count: 8,                             round: 2 },
  { at: 85,  type: "tank",    count: 1,                             round: 2 },
  { at: 90,  type: "swarm",   count: 20,                            round: 2 },
  { at: 95,  type: "diver",   count: 8,                             round: 2 },
  { at: 100, type: "zigzag",  count: 10,                            round: 2 },
  { at: 105, type: "gunner",  count: 3,                             round: 2 },
  { at: 110, type: "grunt",   count: 14, pattern: "v-formation",   round: 2 },
  { at: 115, type: "shooter", count: 2,                             round: 2 },
  { at: 120, type: "tank",    count: 2,                             round: 2 },
  { at: 125, type: "chaser",  count: 10,                            round: 2 },
  { at: 132, type: "boss2",                                          round: 2 },
  // ─── ROUND 3: Sector Omega (ends with boss3) ───
  { at: 152, type: "zigzag",  count: 12,                            round: 3 },
  { at: 157, type: "swarm",   count: 28,                            round: 3 },
  { at: 162, type: "tank",    count: 2,                             round: 3 },
  { at: 167, type: "shooter", count: 3,                             round: 3 },
  { at: 172, type: "diver",   count: 12,                            round: 3 },
  { at: 177, type: "chaser",  count: 10,                            round: 3 },
  { at: 182, type: "gunner",  count: 4,                             round: 3 },
  { at: 187, type: "zigzag",  count: 14,                            round: 3 },
  { at: 192, type: "tank",    count: 3,                             round: 3 },
  { at: 197, type: "swarm",   count: 36,                            round: 3 },
  { at: 202, type: "grunt",   count: 20, pattern: "v-formation",   round: 3 },
  { at: 210, type: "boss3",                                          round: 3 },
];

// ─── score values ─────────────────────────────────────────────────────────────

const SCORE_TABLE: Record<EnemyKind, number> = {
  grunt: 10, chaser: 15, diver: 20, gunner: 50, shooter: 100,
  zigzag: 25, tank: 300, swarm: 5,
  boss1: 5000, boss2: 10000, boss3: 20000,
};

// ─── BootScene ────────────────────────────────────────────────────────────────

class BootScene extends Phaser.Scene {
  constructor() { super({ key: "Boot" }); }

  create(): void {
    this.makePlayerShip();
    this.makeBullets();
    this.makeEnemies();
    this.makeBoss1();
    this.makePickups();
    this.makeParticle();
    this.makeStarLayers();

    this.scene.start("Play");
    this.scene.launch("UI");
  }

  private makePlayerShip(): void {
    // 48x56 fighter — realistic silhouette w/ outer wings, fuselage, cockpit glow, twin engines
    const W = 48, H = 56;
    const ct = this.textures.createCanvas("player-ship", W, H);
    if (!ct) return;
    const ctx = ct.context;

    // === outer wings (sweep-back) ===
    // dark base
    ctx.fillStyle = "#0a1a3a";
    ctx.beginPath();
    ctx.moveTo(0, 52); ctx.lineTo(10, 28); ctx.lineTo(20, 38); ctx.lineTo(16, 50);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W, 52); ctx.lineTo(W - 10, 28); ctx.lineTo(W - 20, 38); ctx.lineTo(W - 16, 50);
    ctx.closePath(); ctx.fill();
    // wing top-plate highlight
    ctx.fillStyle = "#1e4a82";
    ctx.beginPath();
    ctx.moveTo(3, 50); ctx.lineTo(11, 30); ctx.lineTo(18, 38); ctx.lineTo(15, 47);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W - 3, 50); ctx.lineTo(W - 11, 30); ctx.lineTo(W - 18, 38); ctx.lineTo(W - 15, 47);
    ctx.closePath(); ctx.fill();
    // wingtip lights (red port / green starboard)
    ctx.fillStyle = "#ff3344";
    ctx.beginPath(); ctx.arc(1, 51, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#22ff88";
    ctx.beginPath(); ctx.arc(W - 1, 51, 1.6, 0, Math.PI * 2); ctx.fill();

    // === fuselage (dart) ===
    // dark outline
    ctx.fillStyle = "#071229";
    ctx.beginPath();
    ctx.moveTo(24, 0);
    ctx.lineTo(34, 22);
    ctx.lineTo(38, 44);
    ctx.lineTo(32, 52);
    ctx.lineTo(24, 48);
    ctx.lineTo(16, 52);
    ctx.lineTo(10, 44);
    ctx.lineTo(14, 22);
    ctx.closePath(); ctx.fill();
    // mid-tone hull
    ctx.fillStyle = "#1e4a82";
    ctx.beginPath();
    ctx.moveTo(24, 3);
    ctx.lineTo(32, 22);
    ctx.lineTo(35, 42);
    ctx.lineTo(30, 49);
    ctx.lineTo(24, 46);
    ctx.lineTo(18, 49);
    ctx.lineTo(13, 42);
    ctx.lineTo(16, 22);
    ctx.closePath(); ctx.fill();
    // highlight left strip
    ctx.fillStyle = "#3a78c8";
    ctx.beginPath();
    ctx.moveTo(24, 6);
    ctx.lineTo(30, 22);
    ctx.lineTo(32, 40);
    ctx.lineTo(28, 47);
    ctx.lineTo(24, 44);
    ctx.closePath(); ctx.fill();
    // specular sheen
    ctx.fillStyle = "#aacfff";
    ctx.fillRect(23, 6, 2, 14);
    ctx.fillStyle = "#6aa8e8";
    ctx.fillRect(22, 20, 1, 20);

    // panel seams
    ctx.strokeStyle = "#041027";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(19, 26); ctx.lineTo(29, 26);
    ctx.moveTo(18, 36); ctx.lineTo(30, 36);
    ctx.stroke();

    // === cockpit canopy ===
    // canopy glass frame
    ctx.fillStyle = "#00152a";
    ctx.beginPath();
    ctx.ellipse(24, 20, 5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // canopy glass
    const cg = ctx.createLinearGradient(24, 12, 24, 28);
    cg.addColorStop(0, "#88eaff");
    cg.addColorStop(0.5, "#22a8ff");
    cg.addColorStop(1, "#005099");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(24, 20, 4, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // highlight on glass
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.ellipse(22.5, 17, 1, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // === nose cone ===
    ctx.fillStyle = "#001a40";
    ctx.beginPath();
    ctx.moveTo(24, 0);
    ctx.lineTo(27, 8);
    ctx.lineTo(21, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ff3366";
    ctx.beginPath();
    ctx.arc(24, 7, 1.4, 0, Math.PI * 2);
    ctx.fill();

    // === engine nacelles (twin at tail) ===
    // housings
    ctx.fillStyle = "#0a1a3a";
    ctx.fillRect(15, 44, 7, 10);
    ctx.fillRect(26, 44, 7, 10);
    ctx.fillStyle = "#1e4a82";
    ctx.fillRect(16, 45, 5, 8);
    ctx.fillRect(27, 45, 5, 8);
    // engine rim
    ctx.fillStyle = "#030712";
    ctx.fillRect(16, 52, 5, 3);
    ctx.fillRect(27, 52, 5, 3);
    // engine glow
    const eg1 = ctx.createRadialGradient(18.5, 55, 0, 18.5, 55, 5);
    eg1.addColorStop(0, "#ffffff");
    eg1.addColorStop(0.3, "#ffdd66");
    eg1.addColorStop(0.7, "#ff8822");
    eg1.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = eg1;
    ctx.beginPath(); ctx.arc(18.5, 55, 5, 0, Math.PI * 2); ctx.fill();
    const eg2 = ctx.createRadialGradient(29.5, 55, 0, 29.5, 55, 5);
    eg2.addColorStop(0, "#ffffff");
    eg2.addColorStop(0.3, "#ffdd66");
    eg2.addColorStop(0.7, "#ff8822");
    eg2.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = eg2;
    ctx.beginPath(); ctx.arc(29.5, 55, 5, 0, Math.PI * 2); ctx.fill();

    // === wing-mounted cannons ===
    ctx.fillStyle = "#2a3a4a";
    ctx.fillRect(10, 32, 2, 8);
    ctx.fillRect(36, 32, 2, 8);
    ctx.fillStyle = "#88a0b8";
    ctx.fillRect(10, 31, 2, 2);
    ctx.fillRect(36, 31, 2, 2);

    ct.refresh();
  }

  private makeBullets(): void {
    const keys = ["bullet-p-basic","bullet-p-spread","bullet-p-wide","bullet-p-laser","bullet-p-homing"] as const;
    const colors = ["#88ffff","#00ff88","#ffff00","#ff44ff","#ff8800"];
    keys.forEach((key, i) => {
      const ct = this.textures.createCanvas(key, 4, 10);
      if (!ct) return;
      const ctx = ct.context;
      ctx.fillStyle = colors[i]!;
      ctx.fillRect(0, 0, 4, 10);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(1, 0, 2, 3);
      ct.refresh();
    });

    // enemy bullets
    const ekeys = ["bullet-enemy-red","bullet-enemy-pink"] as const;
    const ecolors = ["#ff2200","#ff88aa"];
    ekeys.forEach((key, i) => {
      const ct = this.textures.createCanvas(key, 8, 8);
      if (!ct) return;
      const ctx = ct.context;
      ctx.fillStyle = ecolors[i]!;
      ctx.beginPath();
      ctx.arc(4, 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(3, 3, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ct.refresh();
    });
  }

  private makeEnemies(): void {
    // ─── grunt: crimson interceptor arrowhead (40x40, nose-down) ───
    {
      const W = 40, H = 40;
      const ct = this.textures.createCanvas("enemy-grunt", W, H);
      if (ct) {
        const ctx = ct.context;
        // dark outline
        ctx.fillStyle = "#2a0000";
        ctx.beginPath();
        ctx.moveTo(20, 40); ctx.lineTo(40, 4); ctx.lineTo(32, 0); ctx.lineTo(8, 0); ctx.lineTo(0, 4);
        ctx.closePath(); ctx.fill();
        // mid
        ctx.fillStyle = "#aa1a0c";
        ctx.beginPath();
        ctx.moveTo(20, 36); ctx.lineTo(35, 6); ctx.lineTo(30, 3); ctx.lineTo(10, 3); ctx.lineTo(5, 6);
        ctx.closePath(); ctx.fill();
        // highlight
        ctx.fillStyle = "#ff5522";
        ctx.beginPath();
        ctx.moveTo(20, 30); ctx.lineTo(30, 10); ctx.lineTo(26, 7); ctx.lineTo(14, 7); ctx.lineTo(10, 10);
        ctx.closePath(); ctx.fill();
        // cockpit
        ctx.fillStyle = "#120200";
        ctx.beginPath(); ctx.ellipse(20, 14, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
        const cg = ctx.createRadialGradient(20, 13, 0, 20, 14, 5);
        cg.addColorStop(0, "#ffff88");
        cg.addColorStop(0.5, "#ffaa22");
        cg.addColorStop(1, "#551100");
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.ellipse(20, 14, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
        // wing tip engines (exhaust at top — enemy faces down)
        ctx.fillStyle = "#2a0000";
        ctx.fillRect(4, 2, 6, 4);
        ctx.fillRect(30, 2, 6, 4);
        ctx.fillStyle = "#ff6622";
        ctx.fillRect(5, 0, 4, 3);
        ctx.fillRect(31, 0, 4, 3);
        // panel seams
        ctx.strokeStyle = "#2a0000";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(13, 22); ctx.lineTo(27, 22);
        ctx.stroke();
        // nose tip
        ctx.fillStyle = "#ffaa00";
        ctx.beginPath(); ctx.arc(20, 38, 1.5, 0, Math.PI * 2); ctx.fill();
        ct.refresh();
      }
    }
    // ─── chaser: violet dart interceptor (44x32, diamond sleek) ───
    {
      const W = 44, H = 32;
      const ct = this.textures.createCanvas("enemy-chaser", W, H);
      if (ct) {
        const ctx = ct.context;
        // dark body
        ctx.fillStyle = "#1a0030";
        ctx.beginPath();
        ctx.moveTo(22, 0); ctx.lineTo(44, 16); ctx.lineTo(22, 32); ctx.lineTo(0, 16);
        ctx.closePath(); ctx.fill();
        // mid hull
        ctx.fillStyle = "#6a1aaa";
        ctx.beginPath();
        ctx.moveTo(22, 4); ctx.lineTo(39, 16); ctx.lineTo(22, 28); ctx.lineTo(5, 16);
        ctx.closePath(); ctx.fill();
        // bright core plate
        ctx.fillStyle = "#a044ee";
        ctx.beginPath();
        ctx.moveTo(22, 10); ctx.lineTo(32, 16); ctx.lineTo(22, 22); ctx.lineTo(12, 16);
        ctx.closePath(); ctx.fill();
        // glowing eye
        const eg = ctx.createRadialGradient(22, 16, 0, 22, 16, 6);
        eg.addColorStop(0, "#ffffff");
        eg.addColorStop(0.4, "#ff88ff");
        eg.addColorStop(1, "rgba(150,0,200,0)");
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(22, 16, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(22, 16, 2, 0, Math.PI * 2); ctx.fill();
        // side blades
        ctx.fillStyle = "#3a0066";
        ctx.fillRect(0, 15, 6, 2);
        ctx.fillRect(38, 15, 6, 2);
        // wing-tip glow
        ctx.fillStyle = "#ff88ff";
        ctx.beginPath(); ctx.arc(1, 16, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(W - 1, 16, 1.4, 0, Math.PI * 2); ctx.fill();
        ct.refresh();
      }
    }
    // ─── diver: amber diamond bomber (40x40) ───
    {
      const W = 40, H = 40;
      const ct = this.textures.createCanvas("enemy-diver", W, H);
      if (ct) {
        const ctx = ct.context;
        // dark hull
        ctx.fillStyle = "#2a1000";
        ctx.beginPath();
        ctx.moveTo(20, 0); ctx.lineTo(40, 20); ctx.lineTo(20, 40); ctx.lineTo(0, 20);
        ctx.closePath(); ctx.fill();
        // mid
        ctx.fillStyle = "#aa5500";
        ctx.beginPath();
        ctx.moveTo(20, 4); ctx.lineTo(36, 20); ctx.lineTo(20, 36); ctx.lineTo(4, 20);
        ctx.closePath(); ctx.fill();
        // highlight
        ctx.fillStyle = "#ffaa22";
        ctx.beginPath();
        ctx.moveTo(20, 9); ctx.lineTo(31, 20); ctx.lineTo(20, 31); ctx.lineTo(9, 20);
        ctx.closePath(); ctx.fill();
        // armored ridges
        ctx.strokeStyle = "#2a1000";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(20, 9); ctx.lineTo(20, 31);
        ctx.moveTo(9, 20); ctx.lineTo(31, 20);
        ctx.stroke();
        // eye / lens
        const eg = ctx.createRadialGradient(20, 20, 0, 20, 20, 5);
        eg.addColorStop(0, "#ffffee");
        eg.addColorStop(0.5, "#ffaa00");
        eg.addColorStop(1, "#331100");
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(20, 20, 4, 0, Math.PI * 2); ctx.fill();
        // tip thrusters
        ctx.fillStyle = "#ff6622";
        ctx.fillRect(19, 37, 2, 3);
        ctx.fillRect(37, 19, 3, 2);
        ctx.fillRect(0, 19, 3, 2);
        ct.refresh();
      }
    }
    // ─── gunner: olive turret platform (56x48) ───
    {
      const W = 56, H = 48;
      const ct = this.textures.createCanvas("enemy-gunner", W, H);
      if (ct) {
        const ctx = ct.context;
        // outer hull plates
        ctx.fillStyle = "#0a1a00";
        ctx.fillRect(8, 8, 40, 32);
        ctx.fillStyle = "#224400";
        ctx.fillRect(10, 10, 36, 28);
        // top armor strip
        ctx.fillStyle = "#336600";
        ctx.fillRect(12, 12, 32, 8);
        // main plate
        ctx.fillStyle = "#558822";
        ctx.fillRect(14, 20, 28, 14);
        // rivets
        ctx.fillStyle = "#111";
        [16, 24, 32, 40].forEach(x => {
          ctx.beginPath(); ctx.arc(x, 16, 1, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x, 34, 1, 0, Math.PI * 2); ctx.fill();
        });
        // side cannons (shoot down)
        ctx.fillStyle = "#111a00";
        ctx.fillRect(0, 18, 10, 10);
        ctx.fillRect(46, 18, 10, 10);
        ctx.fillStyle = "#334400";
        ctx.fillRect(1, 19, 8, 8);
        ctx.fillRect(47, 19, 8, 8);
        ctx.fillStyle = "#2a1000";
        ctx.fillRect(3, 27, 4, 6);
        ctx.fillRect(49, 27, 4, 6);
        // muzzle glow
        ctx.fillStyle = "#ffdd22";
        ctx.fillRect(4, 31, 2, 3);
        ctx.fillRect(50, 31, 2, 3);
        // central turret dome
        const tg = ctx.createRadialGradient(28, 26, 0, 28, 26, 9);
        tg.addColorStop(0, "#ccff66");
        tg.addColorStop(0.6, "#66aa22");
        tg.addColorStop(1, "#112200");
        ctx.fillStyle = tg;
        ctx.beginPath(); ctx.arc(28, 26, 7, 0, Math.PI * 2); ctx.fill();
        // turret barrel (down)
        ctx.fillStyle = "#224400";
        ctx.fillRect(26, 33, 4, 8);
        ctx.fillStyle = "#ffff88";
        ctx.fillRect(27, 40, 2, 2);
        // antennae
        ctx.strokeStyle = "#556622";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(14, 12); ctx.lineTo(11, 4);
        ctx.moveTo(42, 12); ctx.lineTo(45, 4);
        ctx.stroke();
        ctx.fillStyle = "#ff3333";
        ctx.beginPath(); ctx.arc(11, 4, 1.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(45, 4, 1.2, 0, Math.PI * 2); ctx.fill();
        ct.refresh();
      }
    }
    // ─── shooter: spiked battlesphere (64x64) ───
    {
      const W = 64, H = 64;
      const ct = this.textures.createCanvas("enemy-shooter", W, H);
      if (ct) {
        const ctx = ct.context;
        const cx = 32, cy = 32;
        // outer spikes (12 pointed)
        ctx.fillStyle = "#001a44";
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(0, -30); ctx.lineTo(4, -22); ctx.lineTo(-4, -22);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = "#0066cc";
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(0, -28); ctx.lineTo(3, -22); ctx.lineTo(-3, -22);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        // outer shell
        ctx.fillStyle = "#001130";
        ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.fill();
        // shell gradient
        const sg = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 24);
        sg.addColorStop(0, "#55aaff");
        sg.addColorStop(0.35, "#0a66cc");
        sg.addColorStop(0.8, "#001a55");
        sg.addColorStop(1, "#000814");
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.fill();
        // latitude/longitude lines
        ctx.strokeStyle = "#000a22";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 22, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy, 7, 22, 0, 0, Math.PI * 2);
        ctx.stroke();
        // rivets around equator
        ctx.fillStyle = "#002a66";
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const rx = cx + Math.cos(a) * 18;
          const ry = cy + Math.sin(a) * 18;
          ctx.beginPath(); ctx.arc(rx, ry, 1.4, 0, Math.PI * 2); ctx.fill();
        }
        // glowing eye/core
        const eg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 10);
        eg.addColorStop(0, "#ffffff");
        eg.addColorStop(0.25, "#88eaff");
        eg.addColorStop(0.55, "#1177dd");
        eg.addColorStop(1, "rgba(0,40,120,0)");
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
        // pupil
        ctx.fillStyle = "#000814";
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ff2266";
        ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2); ctx.fill();
        // specular highlight
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.beginPath(); ctx.ellipse(cx - 8, cy - 10, 4, 2, -0.5, 0, Math.PI * 2); ctx.fill();
        ct.refresh();
      }
    }

    // ─── zigzag: teal spiked skimmer (36x28) — sine side-to-side ───
    {
      const W = 36, H = 28;
      const ct = this.textures.createCanvas("enemy-zigzag", W, H);
      if (ct) {
        const ctx = ct.context;
        // dark hull
        ctx.fillStyle = "#003844";
        ctx.beginPath();
        ctx.moveTo(18, 28); ctx.lineTo(36, 12); ctx.lineTo(28, 0); ctx.lineTo(8, 0); ctx.lineTo(0, 12);
        ctx.closePath(); ctx.fill();
        // mid
        ctx.fillStyle = "#00aabb";
        ctx.beginPath();
        ctx.moveTo(18, 24); ctx.lineTo(32, 12); ctx.lineTo(26, 3); ctx.lineTo(10, 3); ctx.lineTo(4, 12);
        ctx.closePath(); ctx.fill();
        // highlight
        ctx.fillStyle = "#88ffff";
        ctx.beginPath();
        ctx.moveTo(18, 18); ctx.lineTo(26, 12); ctx.lineTo(22, 6); ctx.lineTo(14, 6); ctx.lineTo(10, 12);
        ctx.closePath(); ctx.fill();
        // core
        const eg = ctx.createRadialGradient(18, 13, 0, 18, 13, 5);
        eg.addColorStop(0, "#ffffff");
        eg.addColorStop(0.5, "#00ddff");
        eg.addColorStop(1, "#002233");
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(18, 13, 4, 0, Math.PI * 2); ctx.fill();
        // side spikes
        ctx.fillStyle = "#003844";
        ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(-4, 10); ctx.lineTo(0, 16); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(W, 12); ctx.lineTo(W + 4, 10); ctx.lineTo(W, 16); ctx.closePath(); ctx.fill();
        ct.refresh();
      }
    }

    // ─── tank: heavy armored dreadnought (64x56) ───
    {
      const W = 64, H = 56;
      const ct = this.textures.createCanvas("enemy-tank", W, H);
      if (ct) {
        const ctx = ct.context;
        // thick outer plates
        ctx.fillStyle = "#1a1200";
        ctx.fillRect(4, 6, W - 8, H - 10);
        // main hull
        ctx.fillStyle = "#553a00";
        ctx.fillRect(6, 8, W - 12, H - 14);
        // armored ridge
        ctx.fillStyle = "#886200";
        ctx.fillRect(10, 12, W - 20, H - 22);
        // riveted bands
        ctx.fillStyle = "#221a00";
        ctx.fillRect(10, 20, W - 20, 3);
        ctx.fillRect(10, 32, W - 20, 3);
        // rivet dots
        ctx.fillStyle = "#000";
        for (let rx = 14; rx < W - 12; rx += 8) {
          ctx.beginPath(); ctx.arc(rx, 14, 1, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(rx, 40, 1, 0, Math.PI * 2); ctx.fill();
        }
        // side cannons
        ctx.fillStyle = "#0a0800";
        ctx.fillRect(0, 18, 8, 20);
        ctx.fillRect(W - 8, 18, 8, 20);
        ctx.fillStyle = "#332400";
        ctx.fillRect(1, 19, 6, 18);
        ctx.fillRect(W - 7, 19, 6, 18);
        // barrels (down)
        ctx.fillStyle = "#0f0a00";
        ctx.fillRect(2, 36, 3, 10);
        ctx.fillRect(W - 5, 36, 3, 10);
        // muzzle glow
        ctx.fillStyle = "#ffcc22";
        ctx.fillRect(2, 45, 3, 2);
        ctx.fillRect(W - 5, 45, 3, 2);
        // central turret
        const tg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 14);
        tg.addColorStop(0, "#ffcc44");
        tg.addColorStop(0.6, "#996600");
        tg.addColorStop(1, "#1a0f00");
        ctx.fillStyle = tg;
        ctx.beginPath(); ctx.arc(W / 2, H / 2, 11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#2a1a00";
        ctx.beginPath(); ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2); ctx.fill();
        // main barrel
        ctx.fillStyle = "#1a1000";
        ctx.fillRect(W / 2 - 3, H / 2 + 8, 6, 12);
        ctx.fillStyle = "#ffaa22";
        ctx.fillRect(W / 2 - 2, H / 2 + 18, 4, 3);
        // top antennae
        ctx.strokeStyle = "#886200";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(14, 10); ctx.lineTo(10, 0);
        ctx.moveTo(W - 14, 10); ctx.lineTo(W - 10, 0);
        ctx.stroke();
        ctx.fillStyle = "#ff2200";
        ctx.beginPath(); ctx.arc(10, 1, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(W - 10, 1, 1.4, 0, Math.PI * 2); ctx.fill();
        ct.refresh();
      }
    }

    // ─── swarm: tiny crimson insect (14x14) ───
    {
      const W = 14, H = 14;
      const ct = this.textures.createCanvas("enemy-swarm", W, H);
      if (ct) {
        const ctx = ct.context;
        ctx.fillStyle = "#330000";
        ctx.beginPath(); ctx.arc(7, 7, 6, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(7, 7, 0, 7, 7, 6);
        g.addColorStop(0, "#ff6644");
        g.addColorStop(0.6, "#aa2200");
        g.addColorStop(1, "#330000");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(7, 7, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffff22";
        ctx.beginPath(); ctx.arc(6, 5, 1.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(9, 5, 1.2, 0, Math.PI * 2); ctx.fill();
        ct.refresh();
      }
    }
  }

  private makeBoss1(): void {
    // boss1: 96×80 large ship
    const ct = this.textures.createCanvas("boss1", 96, 80);
    if (ct) {
      const ctx = ct.context;
      // main hull
      ctx.fillStyle = "#550000";
      ctx.beginPath();
      ctx.moveTo(48, 80); ctx.lineTo(96, 20); ctx.lineTo(72, 0); ctx.lineTo(24, 0); ctx.lineTo(0, 20);
      ctx.closePath(); ctx.fill();
      // inner hull
      ctx.fillStyle = "#aa0000";
      ctx.beginPath();
      ctx.moveTo(48, 72); ctx.lineTo(82, 22); ctx.lineTo(66, 4); ctx.lineTo(30, 4); ctx.lineTo(14, 22);
      ctx.closePath(); ctx.fill();
      // core
      ctx.fillStyle = "#ff4400";
      ctx.beginPath();
      ctx.arc(48, 36, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffaa00";
      ctx.beginPath();
      ctx.arc(48, 36, 8, 0, Math.PI * 2);
      ctx.fill();
      // wing cannons
      ctx.fillStyle = "#882200";
      ctx.fillRect(0, 30, 20, 8);
      ctx.fillRect(76, 30, 20, 8);
      ctx.fillStyle = "#ff6600";
      ctx.fillRect(0, 34, 6, 4);
      ctx.fillRect(90, 34, 6, 4);
      // details
      ctx.fillStyle = "#ff2200";
      ctx.fillRect(20, 10, 6, 6);
      ctx.fillRect(70, 10, 6, 6);
      ct.refresh();
    }

    // boss2: 96×80 larger more complex ship
    const ct2 = this.textures.createCanvas("boss2", 96, 80);
    if (ct2) {
      const ctx = ct2.context;
      ctx.fillStyle = "#003355";
      ctx.beginPath();
      ctx.moveTo(48, 80); ctx.lineTo(96, 15); ctx.lineTo(80, 0); ctx.lineTo(16, 0); ctx.lineTo(0, 15);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#0066aa";
      ctx.beginPath();
      ctx.moveTo(48, 70); ctx.lineTo(86, 18); ctx.lineTo(74, 4); ctx.lineTo(22, 4); ctx.lineTo(10, 18);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#0099ff";
      ctx.beginPath();
      ctx.arc(48, 34, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#00ccff";
      ctx.beginPath();
      ctx.arc(48, 34, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(48, 34, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#003366";
      ctx.fillRect(0, 28, 22, 10);
      ctx.fillRect(74, 28, 22, 10);
      ctx.fillRect(0, 32, 8, 4);
      ctx.fillRect(88, 32, 8, 4);
      ctx.fillRect(20, 8, 8, 8);
      ctx.fillRect(68, 8, 8, 8);
      ctx.fillRect(35, 8, 8, 8);
      ctx.fillRect(53, 8, 8, 8);
      ct2.refresh();
    }

    // boss3: 128×112 mega dreadnought — magenta/black
    const ct3 = this.textures.createCanvas("boss3", 128, 112);
    if (ct3) {
      const ctx = ct3.context;
      const W = 128, H = 112;
      // outer hull (broad crescent)
      ctx.fillStyle = "#1a0022";
      ctx.beginPath();
      ctx.moveTo(W / 2, H);
      ctx.lineTo(W, 28);
      ctx.lineTo(108, 4);
      ctx.lineTo(20, 4);
      ctx.lineTo(0, 28);
      ctx.closePath(); ctx.fill();
      // mid plate
      ctx.fillStyle = "#550066";
      ctx.beginPath();
      ctx.moveTo(W / 2, H - 6);
      ctx.lineTo(W - 8, 32);
      ctx.lineTo(100, 10);
      ctx.lineTo(28, 10);
      ctx.lineTo(8, 32);
      ctx.closePath(); ctx.fill();
      // bright edge
      ctx.fillStyle = "#aa22dd";
      ctx.beginPath();
      ctx.moveTo(W / 2, H - 14);
      ctx.lineTo(W - 20, 38);
      ctx.lineTo(92, 18);
      ctx.lineTo(36, 18);
      ctx.lineTo(20, 38);
      ctx.closePath(); ctx.fill();
      // three cores
      [32, 64, 96].forEach((x, i) => {
        const r = i === 1 ? 16 : 12;
        const g = ctx.createRadialGradient(x, 50, 0, x, 50, r);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.3, "#ff44ff");
        g.addColorStop(0.7, "#660088");
        g.addColorStop(1, "rgba(20,0,40,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, 50, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#220033";
        ctx.beginPath(); ctx.arc(x, 50, r * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ff88ff";
        ctx.beginPath(); ctx.arc(x, 50, r * 0.25, 0, Math.PI * 2); ctx.fill();
      });
      // wing cannon pods (x4)
      ctx.fillStyle = "#0a0015";
      ctx.fillRect(0, 44, 14, 20);
      ctx.fillRect(W - 14, 44, 14, 20);
      ctx.fillRect(16, 70, 16, 18);
      ctx.fillRect(W - 32, 70, 16, 18);
      ctx.fillStyle = "#330044";
      ctx.fillRect(1, 45, 12, 18);
      ctx.fillRect(W - 13, 45, 12, 18);
      ctx.fillRect(17, 71, 14, 16);
      ctx.fillRect(W - 31, 71, 14, 16);
      // barrel muzzles
      ctx.fillStyle = "#ff44ff";
      ctx.fillRect(4, 62, 6, 3);
      ctx.fillRect(W - 10, 62, 6, 3);
      ctx.fillRect(22, 86, 6, 3);
      ctx.fillRect(W - 28, 86, 6, 3);
      // panel seams
      ctx.strokeStyle = "#220033";
      ctx.lineWidth = 1;
      for (let y = 22; y < 96; y += 10) {
        ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 30, y); ctx.stroke();
      }
      // antennae
      ctx.strokeStyle = "#aa44cc";
      ctx.beginPath();
      ctx.moveTo(40, 4); ctx.lineTo(36, -6);
      ctx.moveTo(W - 40, 4); ctx.lineTo(W - 36, -6);
      ctx.stroke();
      ctx.fillStyle = "#ff44ff";
      ctx.beginPath(); ctx.arc(36, 0, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(W - 36, 0, 1.6, 0, Math.PI * 2); ctx.fill();
      ct3.refresh();
    }
  }

  private makePickups(): void {
    const items: Array<[string, string, string]> = [
      ["pickup-W", "#ffcc00", "W"],
      ["pickup-L", "#ff44ff", "L"],
      ["pickup-S", "#00ff88", "S"],
      ["pickup-H", "#ff8800", "H"],
      ["pickup-B", "#ff2266", "B"],
    ];
    items.forEach(([key, color, letter]) => {
      const ct = this.textures.createCanvas(key, 16, 16);
      if (!ct) return;
      const ctx = ct.context;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(8, 8, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000000";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, 8, 9);
      ct.refresh();
    });
  }

  private makeParticle(): void {
    const ct = this.textures.createCanvas("explosion-particle", 6, 6);
    if (ct) {
      const ctx = ct.context;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(3, 3, 3, 0, Math.PI * 2);
      ctx.fill();
      ct.refresh();
    }
    // engine thrust particle
    const ct2 = this.textures.createCanvas("thrust-particle", 4, 4);
    if (ct2) {
      const ctx = ct2.context;
      ctx.fillStyle = "#ffcc00";
      ctx.beginPath();
      ctx.arc(2, 2, 2, 0, Math.PI * 2);
      ctx.fill();
      ct2.refresh();
    }
  }

  private makeStarLayers(): void {
    // Night-sky look: deep navy background + dense small white/blue stars
    // with soft halos. A handful of hero stars get 4-point diffraction spikes.
    // No colorful nebula — only a very subtle dark-blue fog for depth.

    type LayerCfg = {
      key: string;
      size: number;
      count: number;
      seed: number;
      heroChance: number;
      minR: number;
      maxR: number;
      colors: string[];
    };
    const layers: LayerCfg[] = [
      // Far / small dusty stars (lots of tiny points)
      { key: "star-slow", size: 512, count: 600, seed: 53,
        heroChance: 0.0,
        minR: 0.3, maxR: 0.7,
        colors: ["#b8c8e0", "#8c9cc0", "#a0b5d8"] },
      // Mid layer: small white + pale-blue stars with halo
      { key: "star-mid",  size: 512, count: 260, seed: 29,
        heroChance: 0.005,
        minR: 0.5, maxR: 1.0,
        colors: ["#ffffff", "#dce9ff", "#b8d0ff"] },
      // Near layer: subtle luminous stars, very rare hero spikes
      { key: "star-fast", size: 512, count: 70, seed: 11,
        heroChance: 0.015,
        minR: 0.6, maxR: 1.2,
        colors: ["#ffffff", "#cfeaff", "#e8f1ff"] },
    ];

    for (const cfg of layers) {
      const ct = this.textures.createCanvas(cfg.key, cfg.size, cfg.size);
      if (!ct) continue;
      const ctx = ct.context;
      ctx.clearRect(0, 0, cfg.size, cfg.size);
      const rng = seededRng(cfg.seed);
      const S = cfg.size;

      // Draw each star up to 9× (center + 8 wraps) so the texture tiles
      // seamlessly across the tileSprite — no visible horizontal/vertical
      // seam when tilePositionY wraps past size.
      const drawStar = (x: number, y: number, r: number, color: string, hero: boolean, spikeLen: number) => {
        const haloR = r * 3;
        const grd = ctx.createRadialGradient(x, y, 0, x, y, haloR);
        grd.addColorStop(0, hexWithAlpha(color, 0.7));
        grd.addColorStop(0.4, hexWithAlpha(color, 0.2));
        grd.addColorStop(1, hexWithAlpha(color, 0));
        ctx.fillStyle = grd;
        ctx.fillRect(x - haloR, y - haloR, haloR * 2, haloR * 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (hero) {
          const gradH = ctx.createLinearGradient(x - spikeLen, y, x + spikeLen, y);
          gradH.addColorStop(0,   hexWithAlpha(color, 0));
          gradH.addColorStop(0.5, hexWithAlpha(color, 0.95));
          gradH.addColorStop(1,   hexWithAlpha(color, 0));
          ctx.strokeStyle = gradH;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(x - spikeLen, y); ctx.lineTo(x + spikeLen, y);
          ctx.stroke();
          const gradV = ctx.createLinearGradient(x, y - spikeLen, x, y + spikeLen);
          gradV.addColorStop(0,   hexWithAlpha(color, 0));
          gradV.addColorStop(0.5, hexWithAlpha(color, 0.95));
          gradV.addColorStop(1,   hexWithAlpha(color, 0));
          ctx.strokeStyle = gradV;
          ctx.beginPath();
          ctx.moveTo(x, y - spikeLen); ctx.lineTo(x, y + spikeLen);
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      for (let i = 0; i < cfg.count; i++) {
        const x = rng() * S;
        const y = rng() * S;
        const color = cfg.colors[Math.floor(rng() * cfg.colors.length)]!;
        const r = cfg.minR + rng() * (cfg.maxR - cfg.minR);
        const hero = r > 0.9 && rng() < cfg.heroChance;
        const spikeLen = 4 + rng() * 5;

        // Only wrap stars whose bloom would extend past the edge to save fills.
        const reach = Math.max(r * 3, hero ? spikeLen : 0) + 1;
        const nearL = x < reach, nearR = x > S - reach;
        const nearT = y < reach, nearB = y > S - reach;

        drawStar(x, y, r, color, hero, spikeLen);
        if (nearL) drawStar(x + S, y, r, color, hero, spikeLen);
        if (nearR) drawStar(x - S, y, r, color, hero, spikeLen);
        if (nearT) drawStar(x, y + S, r, color, hero, spikeLen);
        if (nearB) drawStar(x, y - S, r, color, hero, spikeLen);
        if (nearL && nearT) drawStar(x + S, y + S, r, color, hero, spikeLen);
        if (nearR && nearT) drawStar(x - S, y + S, r, color, hero, spikeLen);
        if (nearL && nearB) drawStar(x + S, y - S, r, color, hero, spikeLen);
        if (nearR && nearB) drawStar(x - S, y - S, r, color, hero, spikeLen);
      }
      ct.refresh();
    }

    // Subtle "deep fog" — very faint blue haze for vertical depth gradient.
    // Replaces the old nebula so we keep the same tileSprite hook but with
    // a gentle blue wash consistent with the reference image.
    const nSize = 512;
    const ct = this.textures.createCanvas("nebula", nSize, nSize);
    if (ct) {
      const ctx = ct.context;
      ctx.clearRect(0, 0, nSize, nSize);
      const rng = seededRng(137);

      // Gentle blue haze clouds — each drawn with 9 wraps so tiled edges blend
      const blues = [[30, 50, 110], [40, 70, 140], [50, 90, 170], [20, 40, 90]];
      const S = nSize;
      const drawBlob = (cx: number, cy: number, radius: number, rgb: number[], a0: number, a1: number) => {
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grd.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a0})`);
        grd.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a1})`);
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      };
      for (let i = 0; i < 10; i++) {
        const cx = rng() * S;
        const cy = rng() * S;
        const radius = 140 + rng() * 220;
        const rgb = blues[Math.floor(rng() * blues.length)]!;
        const a0 = 0.10 + rng() * 0.09;
        const a1 = 0.03 + rng() * 0.04;
        for (const dx of [-S, 0, S]) {
          for (const dy of [-S, 0, S]) {
            drawBlob(cx + dx, cy + dy, radius, rgb, a0, a1);
          }
        }
      }
      ct.refresh();
    }
  }
}

function hexWithAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ─── simple deterministic RNG ─────────────────────────────────────────────────

function seededRng(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ─── bullet pattern helpers ───────────────────────────────────────────────────

function radial(x: number, y: number, n: number, speed: number, bulletKey: string, group: Phaser.GameObjects.Group): void {
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const b = group.get(x, y, bulletKey) as Phaser.Physics.Arcade.Image | null;
    if (!b) return;
    b.setActive(true).setVisible(true);
    b.setDepth(3);
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.reset(x, y);
    body.setVelocity(Math.sin(angle) * speed, -Math.cos(angle) * speed);
  }
}

function aimed(x: number, y: number, tx: number, ty: number, n: number, spreadDeg: number, speed: number, bulletKey: string, group: Phaser.GameObjects.Group): void {
  const base = Math.atan2(ty - y, tx - x);
  const spread = (spreadDeg * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const angle = n === 1 ? base : base - spread / 2 + (i / (n - 1)) * spread;
    const b = group.get(x, y, bulletKey) as Phaser.Physics.Arcade.Image | null;
    if (!b) return;
    b.setActive(true).setVisible(true);
    b.setDepth(3);
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.reset(x, y);
    body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }
}

function wall(y: number, count: number, gapCenter: number, gapSize: number, speed: number, bulletKey: string, group: Phaser.GameObjects.Group, worldW: number): void {
  const step = worldW / count;
  for (let i = 0; i < count; i++) {
    const bx = step * i + step / 2;
    const distFromGap = Math.abs(bx - gapCenter);
    if (distFromGap < gapSize / 2) continue;
    const b = group.get(bx, y, bulletKey) as Phaser.Physics.Arcade.Image | null;
    if (!b) return;
    b.setActive(true).setVisible(true);
    b.setDepth(3);
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.reset(bx, y);
    body.setVelocity(0, speed);
  }
}

// ─── PlayScene ────────────────────────────────────────────────────────────────

class PlayScene extends Phaser.Scene {
  // player state
  private playerShip!: Phaser.Physics.Arcade.Image;
  private playerLives = 3;
  private playerBombs = 3;
  private weaponLevel: WeaponLevel = 1;
  private weaponType: WeaponType = "basic";
  private invulnTimer = 0;
  private score = 0;
  private waveIndex = 0;
  private gameTime = 0;
  private noHitStreak = 0;
  private waveNumber = 1;
  private currentRound = 1;
  private dead = false;
  private loopPass = 0;

  // ship upgrade tier (milestones by score). Tier 0 = basic.
  private upgradeTier = 0;
  private readonly upgradeMilestones = [3000, 8000, 20000, 45000];

  // focus mode: toggle FOCUS → slower move + bigger bullets + more damage
  private focusActive = false;
  private focusHalo: Phaser.GameObjects.Arc | null = null;

  // drag input
  private pointerDown = false;
  private targetX = 0;
  private targetY = 0;

  // groups / pools
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private pickupGroup!: Phaser.Physics.Arcade.StaticGroup;
  private explosionEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];

  // timers
  private fireTimer = 0;
  private laserTimer = 0;

  // boss state
  private bossAlive = false;
  private bossPhase = 0;
  private bossPhaseTimer = 0;
  private bossSpiralAngle = 0;
  private bossRef: Phaser.Physics.Arcade.Image | null = null;
  private bossHP = 0;
  private bossMaxHP = 0;

  // starfield tiles
  private starFast!: Phaser.GameObjects.TileSprite;
  private starMid!: Phaser.GameObjects.TileSprite;
  private starSlow!: Phaser.GameObjects.TileSprite;
  private nebula!: Phaser.GameObjects.TileSprite;

  // thrust emitter
  private thrustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  // laser beam graphics
  private laserBeam!: Phaser.GameObjects.Graphics;

  // bomb flash overlay
  private bombFlash!: Phaser.GameObjects.Rectangle;

  // debounce
  private lastVibrate = 0;
  private lastBossDmgVibrate = 0;

  constructor() { super({ key: "Play" }); }

  create(): void {
    // Reset all mutable state — class field defaults only run at construction,
    // NOT on scene.start after scene.stop. Without this, dead=true / 0 lives /
    // upgrade tier etc. leak between runs and the restarted game is broken.
    this.playerLives = 3;
    this.playerBombs = 3;
    this.weaponLevel = 1;
    this.weaponType = "basic";
    this.invulnTimer = 0;
    this.score = 0;
    this.waveIndex = 0;
    this.gameTime = 0;
    this.noHitStreak = 0;
    this.waveNumber = 1;
    this.currentRound = 1;
    this.dead = false;
    this.loopPass = 0;
    this.upgradeTier = 0;
    this.focusActive = false;
    this.focusHalo = null;
    this.pointerDown = false;
    this.fireTimer = 0;
    this.laserTimer = 0;
    this.bossAlive = false;
    this.bossPhase = 0;
    this.bossPhaseTimer = 0;
    this.bossSpiralAngle = 0;
    this.bossRef = null;
    this.bossHP = 0;
    this.bossMaxHP = 0;
    this.explosionEmitters = [];
    this.lastVibrate = 0;
    this.lastBossDmgVibrate = 0;

    const W = this.scale.width;
    const H = this.scale.height;

    // starfield background
    this.starSlow = this.add.tileSprite(W / 2, H / 2, W, H, "star-slow").setDepth(0).setScrollFactor(0);
    this.starMid  = this.add.tileSprite(W / 2, H / 2, W, H, "star-mid").setDepth(0).setScrollFactor(0);
    this.nebula   = this.add.tileSprite(W / 2, H / 2, W, H, "nebula").setDepth(0).setScrollFactor(0).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD);
    this.starFast = this.add.tileSprite(W / 2, H / 2, W, H, "star-fast").setDepth(0).setScrollFactor(0);

    // groups
    this.enemyGroup = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: 60, runChildUpdate: false });
    this.playerBullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: 300, runChildUpdate: false });
    this.enemyBullets  = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: 500, runChildUpdate: false });
    this.pickupGroup   = this.physics.add.staticGroup();

    // player
    this.playerShip = this.physics.add.image(W / 2, H * 0.78, "player-ship");
    this.playerShip.setDepth(10).setCollideWorldBounds(true);
    (this.playerShip.body as Phaser.Physics.Arcade.Body).setSize(10, 10).setOffset(19, 23);
    this.targetX = W / 2;
    this.targetY = H * 0.78;

    // thrust emitter (twin nozzles at tail)
    this.thrustEmitter = this.add.particles(this.playerShip.x, this.playerShip.y + 26, "thrust-particle", {
      speed: { min: 50, max: 130 },
      angle: { min: 80, max: 100 },
      scale: { start: 1.4, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: 380,
      frequency: 30,
      quantity: 3,
    }).setDepth(9);

    // laser beam graphics
    this.laserBeam = this.add.graphics().setDepth(8);

    // bomb flash overlay
    this.bombFlash = this.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 0).setDepth(30).setScrollFactor(0);

    // explosion emitter pool (3)
    for (let i = 0; i < 3; i++) {
      const em = this.add.particles(0, 0, "explosion-particle", {
        speed: { min: 40, max: 180 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.5, end: 0 },
        alpha: { start: 1, end: 0 },
        lifespan: { min: 300, max: 600 },
        quantity: 0,
        frequency: -1,
        tint: [0xff4400, 0xffaa00, 0xffffff, 0xff8800],
      }).setDepth(15);
      this.explosionEmitters.push(em);
    }

    // physics world bounds = scene size
    this.physics.world.setBounds(0, 0, W, H);

    // input
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.pointerDown = true;
      this.targetX = p.x;
      this.targetY = p.y;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.pointerDown) return;
      this.targetX = p.x;
      this.targetY = p.y;
    });
    this.input.on("pointerup", () => { this.pointerDown = false; });

    // keyboard
    const cursors = this.input.keyboard?.createCursorKeys();
    const wasd = this.input.keyboard?.addKeys("W,A,S,D") as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key } | undefined;
    this.input.keyboard?.on("keydown-SPACE", () => { this.fireBomb(); });

    // store refs for update
    if (cursors) this.data.set("cursors", cursors);
    if (wasd) this.data.set("wasd", wasd);

    // collisions: enemy bullets vs player
    this.physics.add.overlap(this.playerShip, this.enemyBullets, (_player, bullet) => {
      this.onPlayerHit(bullet as Phaser.Physics.Arcade.Image);
    });
    // enemy body vs player — contact damage (rams, kamikaze, blocking)
    this.physics.add.overlap(this.playerShip, this.enemyGroup, (_player, enemy) => {
      this.onPlayerEnemyContact(enemy as Phaser.Physics.Arcade.Image);
    });
    // player bullets vs enemies
    this.physics.add.overlap(this.playerBullets, this.enemyGroup, (bullet, enemy) => {
      this.onBulletHitEnemy(bullet as Phaser.Physics.Arcade.Image, enemy as Phaser.Physics.Arcade.Image);
    });
    // player vs pickups
    this.physics.add.overlap(this.playerShip, this.pickupGroup, (_player, pickup) => {
      this.onPickup(pickup as Phaser.Physics.Arcade.Image);
    });
    // enemy bullets vs player bullets (optional clear) — skip for perf

    // listen for bomb from UI scene
    this.events.on("bomb", () => { this.fireBomb(); });
    this.events.on("focus-on",  () => { this.setFocusState(true);  });
    this.events.on("focus-off", () => { this.setFocusState(false); });
    this.events.on("star-void:restart", () => { this.softReset(); });

    // hint dismiss
    const hint = document.getElementById("sv-hint");
    if (hint) {
      this.input.once("pointerdown", () => hint.remove());
      setTimeout(() => hint.remove(), 5000);
    }

    // init HUD
    this.syncHUD();

    // opening banner
    const r1 = ROUNDS[0]!;
    this.time.delayedCall(200, () => {
      this.registry.set("round-banner", JSON.stringify({
        text: `R1 · ${r1.name}`,
        sub: "survive to boss",
        color: r1.color,
        ts: Date.now(),
      }));
    });

    // scale listener for resize
    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      this.onResize(gameSize.width, gameSize.height);
    });
  }

  private onResize(W: number, H: number): void {
    this.starSlow.setPosition(W / 2, H / 2).setSize(W, H);
    this.starMid.setPosition(W / 2, H / 2).setSize(W, H);
    this.nebula.setPosition(W / 2, H / 2).setSize(W, H);
    this.starFast.setPosition(W / 2, H / 2).setSize(W, H);
    this.bombFlash.setPosition(W / 2, H / 2).setSize(W, H);
    this.targetX = Phaser.Math.Clamp(this.targetX, 20, W - 20);
    this.targetY = Phaser.Math.Clamp(this.targetY, 20, H - 20);
  }

  update(_time: number, delta: number): void {
    if (this.dead) return;
    const dt = Math.min(delta, 50);
    const W = this.scale.width;
    const H = this.scale.height;

    this.gameTime += dt / 1000;
    this.noHitStreak += dt / 1000;

    // starfield scroll
    this.starFast.tilePositionY -= 0.18 * dt;
    this.starMid.tilePositionY  -= 0.08 * dt;
    this.starSlow.tilePositionY -= 0.025 * dt;
    this.nebula.tilePositionY   -= 0.012 * dt;
    // twinkle: alpha sine on the fast layer for shimmer
    this.starFast.alpha = 0.55 + Math.sin(this.gameTime * 3) * 0.08;

    // keyboard movement
    const cursors = this.data.get("cursors") as Phaser.Types.Input.Keyboard.CursorKeys | undefined;
    const wasd = this.data.get("wasd") as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key } | undefined;
    if (cursors || wasd) {
      const left  = cursors?.left.isDown  || wasd?.A.isDown;
      const right = cursors?.right.isDown || wasd?.D.isDown;
      const up    = cursors?.up.isDown    || wasd?.W.isDown;
      const down  = cursors?.down.isDown  || wasd?.S.isDown;
      if (left || right || up || down) {
        const spd = 200;
        if (left)  this.targetX = Math.max(20, this.targetX - spd * dt / 1000);
        if (right) this.targetX = Math.min(W - 20, this.targetX + spd * dt / 1000);
        if (up)    this.targetY = Math.max(20, this.targetY - spd * dt / 1000);
        if (down)  this.targetY = Math.min(H - 20, this.targetY + spd * dt / 1000);
      }
    }

    // player lerp to target
    // Tier 2+: faster lerp. Focus mode SLOW precision (×0.3).
    let lerpFactor = 0.25 + this.upgradeTier * 0.05;
    if (this.focusActive) lerpFactor *= 0.3;
    this.playerShip.x = Phaser.Math.Linear(this.playerShip.x, this.targetX, lerpFactor);
    this.playerShip.y = Phaser.Math.Linear(this.playerShip.y, this.targetY, lerpFactor);

    // clamp
    this.playerShip.x = Phaser.Math.Clamp(this.playerShip.x, 28, W - 28);
    this.playerShip.y = Phaser.Math.Clamp(this.playerShip.y, 32, H - 32);

    // thrust emitter follow (behind twin engines)
    this.thrustEmitter.setPosition(this.playerShip.x, this.playerShip.y + 26);
    if (this.focusHalo && this.focusHalo.visible) {
      this.focusHalo.setPosition(this.playerShip.x, this.playerShip.y);
    }

    // invuln blink
    if (this.invulnTimer > 0) {
      this.invulnTimer -= dt;
      this.playerShip.setAlpha(Math.floor(this.invulnTimer / 120) % 2 === 0 ? 1 : 0.3);
    } else {
      this.playerShip.setAlpha(1);
    }

    // auto-fire
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.autoFire();
    }

    // laser beam
    this.laserBeam.clear();
    if (this.weaponType === "laser") {
      this.laserTimer += dt;
      if (this.laserTimer >= 16) {
        this.laserTimer = 0;
        // damage enemies in beam path
        this.damageLaserEnemies(dt);
      }
      this.drawLaserBeam();
    }

    // wave spawning
    this.processWaves();

    // update active enemy bullets — cull out of bounds
    this.enemyBullets.getChildren().forEach((obj) => {
      const b = obj as Phaser.Physics.Arcade.Image;
      if (!b.active) return;
      if (b.y > H + 20 || b.y < -20 || b.x < -20 || b.x > W + 20) {
        b.setActive(false).setVisible(false);
        (b.body as Phaser.Physics.Arcade.Body).reset(-200, -200);
      }
    });

    // cull player bullets
    this.playerBullets.getChildren().forEach((obj) => {
      const b = obj as Phaser.Physics.Arcade.Image;
      if (!b.active) return;
      if (b.y < -20 || b.y > H + 20 || b.x < -20 || b.x > W + 20) {
        b.setActive(false).setVisible(false);
        (b.body as Phaser.Physics.Arcade.Body).reset(-200, -200);
      }
    });

    // homing missile tracking
    if (this.weaponType === "homing") {
      this.updateHomingBullets(dt);
    }

    // enemy AI
    this.updateEnemies(dt);

    // boss
    if (this.bossAlive && this.bossRef?.active) {
      this.updateBoss(dt);
    }

    // (no streak auto-score — score comes only from kills/pickups)

    // sync HUD every 200ms approx
    if (Math.floor(this.gameTime * 5) !== Math.floor((this.gameTime - dt / 1000) * 5)) {
      this.syncHUD();
    }
  }

  // ─── firing ──────────────────────────────────────────────────────────────────

  private autoFire(): void {
    const rpmTable: Record<WeaponLevel, number> = { 1: 300, 2: 280, 3: 250, 4: 600, 5: 240 };
    // upgrade tier: +15% RPM per tier, focus: +50% RPM (clearly noticeable)
    let rpm = rpmTable[this.weaponLevel] * (1 + this.upgradeTier * 0.15);
    if (this.focusActive) rpm *= 1.5;
    const intervalMs = 60000 / rpm;
    this.fireTimer = intervalMs;

    if (this.weaponType === "laser") {
      // laser handled continuously in update
      return;
    }

    const x = this.playerShip.x;
    const y = this.playerShip.y - 26;
    const bulletKey = this.weaponBulletKey();

    playSfx("shoot");

    // Max 2 bullets per volley. L1 = 1 bullet centered, L2+ = 2 parallel-ish.
    // Bullet size + damage scale with weaponLevel (pill progression).
    const twin = this.weaponLevel >= 2;
    const spacing = 10 + this.weaponLevel * 2;

    switch (this.weaponType) {
      case "basic": {
        if (twin) {
          const bL = this.spawnPlayerBullet(x - spacing, y, bulletKey);
          const bR = this.spawnPlayerBullet(x + spacing, y, bulletKey);
          if (bL) (bL.body as Phaser.Physics.Arcade.Body).setVelocity(0, -520);
          if (bR) (bR.body as Phaser.Physics.Arcade.Body).setVelocity(0, -520);
        } else {
          const b = this.spawnPlayerBullet(x, y, bulletKey);
          if (b) (b.body as Phaser.Physics.Arcade.Body).setVelocity(0, -500);
        }
        break;
      }
      case "spread": {
        // narrow fan
        const deg = 6 + this.weaponLevel * 1.5;
        if (twin) {
          const a = (deg * Math.PI) / 180;
          const bL = this.spawnPlayerBullet(x - spacing * 0.4, y, bulletKey);
          const bR = this.spawnPlayerBullet(x + spacing * 0.4, y, bulletKey);
          if (bL) (bL.body as Phaser.Physics.Arcade.Body).setVelocity(-Math.sin(a) * 520, -Math.cos(a) * 520);
          if (bR) (bR.body as Phaser.Physics.Arcade.Body).setVelocity(Math.sin(a) * 520, -Math.cos(a) * 520);
        } else {
          const b = this.spawnPlayerBullet(x, y, bulletKey);
          if (b) (b.body as Phaser.Physics.Arcade.Body).setVelocity(0, -500);
        }
        break;
      }
      case "wide": {
        // heavy twin slugs, slight outward angle
        const deg = 10 + this.weaponLevel * 2;
        if (twin) {
          const a = (deg * Math.PI) / 180;
          const bL = this.spawnPlayerBullet(x - spacing * 0.7, y, bulletKey);
          const bR = this.spawnPlayerBullet(x + spacing * 0.7, y, bulletKey);
          if (bL) (bL.body as Phaser.Physics.Arcade.Body).setVelocity(-Math.sin(a) * 480, -Math.cos(a) * 480);
          if (bR) (bR.body as Phaser.Physics.Arcade.Body).setVelocity(Math.sin(a) * 480, -Math.cos(a) * 480);
        } else {
          const b = this.spawnPlayerBullet(x, y, bulletKey);
          if (b) (b.body as Phaser.Physics.Arcade.Body).setVelocity(0, -480);
        }
        break;
      }
      case "homing": {
        if (twin) {
          const b1 = this.spawnPlayerBullet(x - spacing, y + 6, bulletKey);
          const b2 = this.spawnPlayerBullet(x + spacing, y + 6, bulletKey);
          if (b1) (b1.body as Phaser.Physics.Arcade.Body).setVelocity(-20, -420);
          if (b2) (b2.body as Phaser.Physics.Arcade.Body).setVelocity(20, -420);
        } else {
          const b = this.spawnPlayerBullet(x, y + 6, bulletKey);
          if (b) (b.body as Phaser.Physics.Arcade.Body).setVelocity(0, -420);
        }
        break;
      }
    }

    // Tier 3+: wing cannons fire helper bullets (laser path already returned)
    if (this.upgradeTier >= 3) {
      const wL = this.spawnPlayerBullet(x - 20, y + 6, "bullet-p-basic");
      const wR = this.spawnPlayerBullet(x + 20, y + 6, "bullet-p-basic");
      if (wL) (wL.body as Phaser.Physics.Arcade.Body).setVelocity(0, -480);
      if (wR) (wR.body as Phaser.Physics.Arcade.Body).setVelocity(0, -480);
    }
  }

  private weaponBulletKey(): string {
    const map: Record<WeaponType, string> = {
      basic: "bullet-p-basic",
      spread: "bullet-p-spread",
      wide: "bullet-p-wide",
      laser: "bullet-p-laser",
      homing: "bullet-p-homing",
    };
    return map[this.weaponType];
  }

  private spawnPlayerBullet(x: number, y: number, key: string): Phaser.Physics.Arcade.Image | null {
    const b = this.playerBullets.get(x, y, key) as Phaser.Physics.Arcade.Image | null;
    if (!b) return null;
    b.setActive(true).setVisible(true).setDepth(5);
    // Bullet size + damage scale with weaponLevel (pill progression).
    // L1 = 1×/1dmg, L2 = 1.3×/2dmg, L3 = 1.6×/3dmg, L4 = 1.9×/5dmg, L5 = 2.3×/7dmg.
    const sizeMap: Record<WeaponLevel, number> = { 1: 1.0, 2: 1.3, 3: 1.6, 4: 1.9, 5: 2.3 };
    const dmgMap:  Record<WeaponLevel, number> = { 1: 1,   2: 2,   3: 3,   4: 5,   5: 7 };
    const focusScaleX = this.focusActive ? 2.6 : 1;   // width 2.6× (fat beam)
    const focusScaleY = this.focusActive ? 2.0 : 1;   // length 2× (long trail)
    const focusDmgBonus = this.focusActive ? 2 : 1;
    const baseScale = sizeMap[this.weaponLevel];
    b.setScale(baseScale * focusScaleX, baseScale * focusScaleY);
    b.setData("dmg", Math.ceil(dmgMap[this.weaponLevel] * focusDmgBonus));
    if (this.focusActive) {
      b.setTint(0xffff00);          // yellow-hot plasma (clear contrast)
      b.setBlendMode(Phaser.BlendModes.ADD); // glowing additive
    } else {
      b.clearTint();
      b.setBlendMode(Phaser.BlendModes.NORMAL);
    }
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.reset(x, y);
    body.setAllowGravity(false);
    return b;
  }

  private updateHomingBullets(dt: number): void {
    const enemies = this.enemyGroup.getChildren().filter(o => (o as Phaser.Physics.Arcade.Image).active);
    this.playerBullets.getChildren().forEach((obj) => {
      const b = obj as Phaser.Physics.Arcade.Image;
      if (!b.active || b.texture.key !== "bullet-p-homing") return;
      if (enemies.length === 0) return;
      // find nearest
      let nearest: Phaser.Physics.Arcade.Image | null = null;
      let nearDist = Infinity;
      enemies.forEach((eo) => {
        const e = eo as Phaser.Physics.Arcade.Image;
        const d = Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y);
        if (d < nearDist) { nearDist = d; nearest = e; }
      });
      if (!nearest) return;
      const target = nearest as Phaser.Physics.Arcade.Image;
      const angle = Math.atan2(target.y - b.y, target.x - b.x);
      const speed = 420;
      const body = b.body as Phaser.Physics.Arcade.Body;
      const curAngle = Math.atan2(body.velocity.y, body.velocity.x);
      const turnRate = (3 * Math.PI * dt) / 1000;
      let diff = angle - curAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const newAngle = curAngle + Phaser.Math.Clamp(diff, -turnRate, turnRate);
      body.setVelocity(Math.cos(newAngle) * speed, Math.sin(newAngle) * speed);
    });
  }

  private drawLaserBeam(): void {
    const g = this.laserBeam;
    g.clear();
    const x = this.playerShip.x;
    const y = this.playerShip.y - 26;
    // outer glow
    g.lineStyle(6, 0xff44ff, 0.3);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, -10);
    g.strokePath();
    // inner beam
    g.lineStyle(2, 0xff88ff, 0.9);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, -10);
    g.strokePath();
    // core
    g.lineStyle(1, 0xffffff, 1);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, -10);
    g.strokePath();
  }

  private damageLaserEnemies(_dt: number): void {
    const x = this.playerShip.x;
    const dmg = 3;
    this.enemyGroup.getChildren().forEach((obj) => {
      const e = obj as Phaser.Physics.Arcade.Image;
      if (!e.active) return;
      // skip boss here — handled by bossRef branch below to stay in sync
      const k = e.getData("kind") as EnemyKind;
      if (k === "boss1" || k === "boss2" || k === "boss3") return;
      if (Math.abs(e.x - x) < 10) {
        this.hitEnemy(e, dmg);
      }
    });
    if (this.bossAlive && this.bossRef?.active && Math.abs((this.bossRef.x) - x) < 50) {
      this.hitBoss(dmg);
    }
  }

  // ─── bomb ─────────────────────────────────────────────────────────────────────

  fireBomb(): void {
    if (this.playerBombs <= 0 || this.dead) return;
    this.playerBombs--;
    this.syncHUD();
    playSfx("go");
    setTimeout(() => playSfx("score"), 150);

    // nuke all enemy bullets
    this.enemyBullets.getChildren().forEach((obj) => {
      const b = obj as Phaser.Physics.Arcade.Image;
      b.setActive(false).setVisible(false);
      (b.body as Phaser.Physics.Arcade.Body).reset(-200, -200);
    });

    // damage all on-screen enemies (skip boss — uses own HP bar)
    this.enemyGroup.getChildren().forEach((obj) => {
      const e = obj as Phaser.Physics.Arcade.Image;
      if (!e.active) return;
      const k = e.getData("kind") as EnemyKind;
      if (k === "boss1" || k === "boss2" || k === "boss3") return;
      this.hitEnemy(e, 50);
    });

    // boss damage
    if (this.bossAlive && this.bossRef?.active) {
      this.hitBoss(50);
    }

    // invuln
    this.invulnTimer = 1000;

    // screen shake
    this.cameras.main.shake(300, 0.012);

    // flash
    this.tweens.add({
      targets: this.bombFlash,
      alpha: { from: 0.6, to: 0 },
      duration: 400,
      ease: "Power2",
    });

    // vibrate
    if (navigator.vibrate) navigator.vibrate([50, 50, 100]);
  }

  // ─── enemy AI ────────────────────────────────────────────────────────────────

  private updateEnemies(dt: number): void {
    const H = this.scale.height;
    const W = this.scale.width;
    const px = this.playerShip.x;

    this.enemyGroup.getChildren().forEach((obj) => {
      const e = obj as Phaser.Physics.Arcade.Image;
      if (!e.active) return;

      const kind = e.getData("kind") as EnemyKind;
      const shootCd = (e.getData("shootCd") as number) - dt;
      e.setData("shootCd", shootCd);

      // out-of-bounds cull (enemies that went off bottom)
      if (e.y > H + 60) {
        e.setActive(false).setVisible(false);
        return;
      }

      switch (kind) {
        case "grunt": {
          // light swerve toward player when crossing mid-screen
          const body = e.body as Phaser.Physics.Arcade.Body;
          if (e.y > 120 && e.y < H - 200) {
            const dx = px - e.x;
            body.setVelocityX(Phaser.Math.Clamp(dx * 0.4, -50, 50));
          }
          break;
        }
        case "chaser": {
          // Horizontal chase + dash-down when aligned with player
          const body = e.body as Phaser.Physics.Arcade.Body;
          const dx = px - e.x;
          const spd = 140;
          body.setVelocityX(Math.abs(dx) < 6 ? 0 : dx > 0 ? spd : -spd);
          // Dash when roughly aligned
          if (Math.abs(dx) < 24 && e.y < H * 0.5) {
            body.setVelocityY(Math.max(body.velocity.y, 260));
          }
          break;
        }
        case "diver": {
          // Kamikaze: accelerate toward player when within strike range
          const body = e.body as Phaser.Physics.Arcade.Body;
          const dist = Phaser.Math.Distance.Between(e.x, e.y, px, this.playerShip.y);
          if (dist < 180 && e.y < this.playerShip.y) {
            const ang = Math.atan2(this.playerShip.y - e.y, px - e.x);
            const boost = 40;
            body.setVelocity(body.velocity.x + Math.cos(ang) * boost * dt / 100,
                             body.velocity.y + Math.sin(ang) * boost * dt / 100);
          }
          // fire aimed bullet with lead prediction
          if (shootCd <= 0) {
            e.setData("shootCd", 2500);
            aimed(e.x, e.y + 8, px, this.playerShip.y, 1, 0, 200, "bullet-enemy-red", this.enemyBullets);
          }
          break;
        }
        case "gunner": {
          // Strafe sideways while holding vertical position
          const body = e.body as Phaser.Physics.Arcade.Body;
          body.setVelocityY(0);
          const strafePhase = (e.getData("phase") as number) + dt / 500;
          e.setData("phase", strafePhase);
          body.setVelocityX(Math.sin(strafePhase) * 70);
          if (shootCd <= 0) {
            e.setData("shootCd", 1000);
            aimed(e.x, e.y + 8, px, this.playerShip.y, 3, 20, 210, "bullet-enemy-red", this.enemyBullets);
          }
          break;
        }
        case "zigzag": {
          const body = e.body as Phaser.Physics.Arcade.Body;
          const baseX = e.getData("baseX") as number;
          const phase = (e.getData("phase") as number) + dt / 150;
          e.setData("phase", phase);
          const target = baseX + Math.sin(phase) * 70;
          body.setVelocityX((target - e.x) * 4);
          if (shootCd <= 0) {
            e.setData("shootCd", 1800);
            aimed(e.x, e.y + 10, px, this.playerShip.y, 1, 0, 220, "bullet-enemy-red", this.enemyBullets);
          }
          break;
        }
        case "tank": {
          // Slow horizontal creep + periodic ramming charge downward
          const body = e.body as Phaser.Physics.Arcade.Body;
          const phase = (e.getData("phase") as number) + dt / 1000;
          e.setData("phase", phase);
          body.setVelocityX(Math.sin(phase * 0.6) * 40);
          // Ram charge every ~5s if above player
          const ram = (e.getData("ramTimer") as number | undefined) ?? 5000;
          const nextRam = ram - dt;
          e.setData("ramTimer", nextRam);
          if (nextRam <= 0 && e.y < this.playerShip.y) {
            body.setVelocityY(180);
            e.setData("ramTimer", 5000);
          } else if (nextRam > 3500) {
            body.setVelocityY(40);
          }
          if (shootCd <= 0) {
            e.setData("shootCd", 1400);
            // side cannons spread
            aimed(e.x - 26, e.y + 18, px, this.playerShip.y, 2, 24, 190, "bullet-enemy-red", this.enemyBullets);
            aimed(e.x + 26, e.y + 18, px, this.playerShip.y, 2, 24, 190, "bullet-enemy-red", this.enemyBullets);
            // central turret single
            aimed(e.x, e.y + 22, px, this.playerShip.y, 1, 0, 230, "bullet-enemy-pink", this.enemyBullets);
          }
          break;
        }
        case "swarm": {
          // Flock toward player X, sinusoidal drift
          const body = e.body as Phaser.Physics.Arcade.Body;
          const phase = (e.getData("phase") as number) + dt / 200;
          e.setData("phase", phase);
          const flockX = (px - e.x) * 0.8;
          body.setVelocityX(Phaser.Math.Clamp(flockX + Math.sin(phase) * 50, -120, 120));
          break;
        }
        case "shooter": {
          // Short teleport every ~4s within upper screen
          const body = e.body as Phaser.Physics.Arcade.Body;
          body.setVelocityY(0);
          const tp = (e.getData("tpTimer") as number | undefined) ?? 4000;
          const nextTp = tp - dt;
          e.setData("tpTimer", nextTp);
          if (nextTp <= 0) {
            e.setData("tpTimer", 4000 + Math.random() * 1500);
            const newX = 60 + Math.random() * (W - 120);
            const newY = 80 + Math.random() * 120;
            this.tweens.add({ targets: e, alpha: 0, duration: 180, yoyo: true,
              onYoyo: () => { e.x = newX; e.y = newY; body.reset(newX, newY); } });
          }
          if (shootCd <= 0) {
            e.setData("shootCd", 2000);
            radial(e.x, e.y, 8, 180, "bullet-enemy-pink", this.enemyBullets);
          }
          // spiral emit
          {
            const sa = (e.getData("spiralAngle") as number) + (2 * Math.PI * dt) / 2000;
            e.setData("spiralAngle", sa);
            if (Math.floor(sa * 4) !== Math.floor((sa - (2 * Math.PI * dt) / 2000) * 4)) {
              const b = this.enemyBullets.get(e.x, e.y, "bullet-enemy-pink") as Phaser.Physics.Arcade.Image | null;
              if (b) {
                b.setActive(true).setVisible(true).setDepth(3);
                const body2 = b.body as Phaser.Physics.Arcade.Body;
                body2.reset(e.x, e.y);
                body2.setVelocity(Math.cos(sa) * 160, Math.sin(sa) * 160);
                body2.setAllowGravity(false);
              }
            }
          }
          break;
        }
      }

      // oob check for off-top
      if (e.y < -80) {
        e.setActive(false).setVisible(false);
      }
    });

    // make sure enemy bullets don't hit player during invuln
    if (this.invulnTimer > 0) {
      (this.playerShip.body as Phaser.Physics.Arcade.Body).enable = false;
    } else {
      (this.playerShip.body as Phaser.Physics.Arcade.Body).enable = true;
    }

    // pickup drift downward
    this.pickupGroup.getChildren().forEach((obj) => {
      const p = obj as Phaser.Physics.Arcade.Image;
      if (!p.active) return;
      p.y += 40 * dt / 1000;
      (p.body as Phaser.Physics.Arcade.StaticBody).reset(p.x, p.y);
      if (p.y > H + 20) p.destroy();
    });

    void W; // used in wall() calls below
  }

  // ─── boss ─────────────────────────────────────────────────────────────────────

  private updateBoss(dt: number): void {
    if (!this.bossRef) return;
    const boss = this.bossRef;
    const W = this.scale.width;
    const px = this.playerShip.x;
    const bossKey = boss.getData("kind") as BossKind;
    const isB2 = bossKey === "boss2";
    const isB3 = bossKey === "boss3";
    const difficulty = isB3 ? 1.5 : isB2 ? 1.15 : 1;

    this.bossPhaseTimer -= dt;

    switch (this.bossPhase) {
      case 0: {
        // phase 1: aimed spread
        if (this.bossPhaseTimer <= 0) {
          this.bossPhaseTimer = isB3 ? 900 : 1400;
          const spreadCount = isB3 ? 5 : 3;
          aimed(boss.x, boss.y + 10, px, this.playerShip.y, spreadCount, 18, 200 * difficulty, "bullet-enemy-red", this.enemyBullets);
        }
        const body = boss.body as Phaser.Physics.Arcade.Body;
        body.setVelocityX(Math.sin(this.gameTime * 1.2) * 80);
        body.setVelocityY(0);
        if (this.bossHP < this.bossMaxHP * 0.66) {
          this.bossPhase = 1;
          this.bossPhaseTimer = 0;
          this.bossSpiralAngle = 0;
        }
        break;
      }
      case 1: {
        // phase 2: spiral
        this.bossSpiralAngle += ((isB3 ? 3.4 : 2.5) * Math.PI * dt) / 1000;
        if (this.bossPhaseTimer <= 0) {
          this.bossPhaseTimer = isB3 ? 55 : 80;
          const b = this.enemyBullets.get(boss.x, boss.y, "bullet-enemy-pink") as Phaser.Physics.Arcade.Image | null;
          if (b) {
            b.setActive(true).setVisible(true).setDepth(3);
            const body2 = b.body as Phaser.Physics.Arcade.Body;
            body2.reset(boss.x, boss.y);
            const spd = isB3 ? 240 : isB2 ? 220 : 180;
            body2.setVelocity(Math.cos(this.bossSpiralAngle) * spd, Math.sin(this.bossSpiralAngle) * spd);
            body2.setAllowGravity(false);
          }
        }
        const body = boss.body as Phaser.Physics.Arcade.Body;
        body.setVelocityX(Math.sin(this.gameTime * 0.8) * 60);
        body.setVelocityY(Math.cos(this.gameTime * 0.6) * 30);
        if (this.bossHP < this.bossMaxHP * 0.33) {
          this.bossPhase = 2;
          this.bossPhaseTimer = isB3 ? 1500 : 2500;
        }
        break;
      }
      case 2: {
        // phase 3: wall curtain + aimed
        if (this.bossPhaseTimer <= 0) {
          this.bossPhaseTimer = isB3 ? 1300 : isB2 ? 1800 : 2500;
          const gapCenter = px;
          wall(boss.y + 20, isB3 ? 14 : 16, gapCenter, 70, 240 * difficulty, "bullet-enemy-red", this.enemyBullets, W);
          aimed(boss.x, boss.y + 10, px, this.playerShip.y, isB3 ? 5 : 3, 25, 180 * difficulty, "bullet-enemy-pink", this.enemyBullets);
          if (isB3) radial(boss.x, boss.y, 16, 200, "bullet-enemy-pink", this.enemyBullets);
        }
        const body = boss.body as Phaser.Physics.Arcade.Body;
        body.setVelocityX(Math.sin(this.gameTime * 1.5) * 100);
        body.setVelocityY(0);
        break;
      }
    }

    // boss2/3 periodic radial burst in phase 0
    if ((isB2 || isB3) && this.bossPhase === 0) {
      if (this.bossPhaseTimer > 0 && this.bossPhaseTimer % 3000 < 50) {
        radial(boss.x, boss.y, isB3 ? 16 : 12, 160, "bullet-enemy-pink", this.enemyBullets);
      }
    }

    // clamp boss inside arena
    const bossBody = boss.body as Phaser.Physics.Arcade.Body;
    boss.x = Phaser.Math.Clamp(boss.x, 60, W - 60);
    boss.y = Phaser.Math.Clamp(boss.y, 40, 160);
    bossBody.reset(boss.x, boss.y);
  }

  // ─── wave spawning ───────────────────────────────────────────────────────────

  private processWaves(): void {
    const t = this.gameTime;
    let timeline = WAVE_TIMELINE;

    // after full loop, scale enemies
    if (this.loopPass > 0 && t > WAVE_TIMELINE[WAVE_TIMELINE.length - 1]!.at) {
      this.loopPass++;
    }

    while (this.waveIndex < timeline.length && timeline[this.waveIndex]!.at <= t) {
      const ev = timeline[this.waveIndex]!;
      if (ev.round && ev.round !== this.currentRound) {
        this.currentRound = ev.round;
      }
      this.spawnWave(ev);
      this.waveIndex++;
      this.waveNumber++;
      this.syncHUD();
    }

    // loop after last wave: restart rounds (higher difficulty via loopPass)
    if (this.waveIndex >= timeline.length && !this.bossAlive && this.enemyGroup.countActive() === 0) {
      this.gameTime = 0;
      this.waveIndex = 0;
      this.currentRound = 1;
      this.loopPass++;
      this.syncHUD();
    }
  }

  private spawnWave(ev: WaveEvent): void {
    const W = this.scale.width;
    const count = ev.count ?? 1;
    const hpMult = 1 + this.loopPass * 0.2;
    const spdMult = 1 + this.loopPass * 0.15;

    if (ev.type === "boss1" || ev.type === "boss2" || ev.type === "boss3") {
      this.spawnBoss(ev.type, hpMult);
      playSfx("go");
      setTimeout(() => playSfx("score"), 200);
      if (navigator.vibrate) navigator.vibrate([40, 40, 150]);
      return;
    }

    const configs: Record<string, { hp: number; speed: number; shootCd: number }> = {
      grunt:   { hp: 2,  speed: 80  * spdMult, shootCd: 9999 },
      chaser:  { hp: 3,  speed: 120 * spdMult, shootCd: 9999 },
      diver:   { hp: 4,  speed: 100 * spdMult, shootCd: 2500 },
      gunner:  { hp: 8,  speed: 0,              shootCd: 1200 },
      shooter: { hp: 15, speed: 0,              shootCd: 2000 },
      zigzag:  { hp: 3,  speed: 110 * spdMult, shootCd: 1800 },
      tank:    { hp: 35, speed: 40  * spdMult, shootCd: 1400 },
      swarm:   { hp: 1,  speed: 180 * spdMult, shootCd: 9999 },
    };
    const cfg = configs[ev.type];
    if (!cfg) return;

    const textureFor: Record<string, string> = {
      grunt: "enemy-grunt", chaser: "enemy-chaser", diver: "enemy-diver",
      gunner: "enemy-gunner", shooter: "enemy-shooter",
      zigzag: "enemy-zigzag", tank: "enemy-tank", swarm: "enemy-swarm",
    };
    const texKey = textureFor[ev.type] ?? "enemy-grunt";

    for (let i = 0; i < count; i++) {
      const x = ev.pattern === "v-formation"
        ? W / 2 + (i - count / 2) * (W / (count + 1))
        : 30 + Math.random() * (W - 60);
      const y = -30 - i * 15;

      const e = this.enemyGroup.get(x, y, texKey) as Phaser.Physics.Arcade.Image | null;
      if (!e) continue;
      e.setActive(true).setVisible(true).setDepth(7);
      // Enemies are 30% larger than base texture for better readability
      // (swarm stays tiny — still dangerous in numbers)
      const enemyScale = ev.type === "swarm" ? 1 : 1.3;
      e.setScale(enemyScale);
      e.clearTint();
      e.setData("kind", ev.type);
      e.setData("hp", Math.ceil(cfg.hp * hpMult));
      e.setData("maxHp", Math.ceil(cfg.hp * hpMult));
      e.setData("shootCd", cfg.shootCd + Math.random() * 500);
      e.setData("spiralAngle", Math.random() * Math.PI * 2);
      e.setData("baseX", x);
      e.setData("phase", Math.random() * Math.PI * 2);
      const body = e.body as Phaser.Physics.Arcade.Body;
      body.reset(x, y);
      body.setAllowGravity(false);
      if (ev.type === "diver") {
        const dir = i % 2 === 0 ? 1 : -1;
        body.setVelocity(dir * 60 * spdMult, cfg.speed);
      } else if (ev.type === "zigzag") {
        body.setVelocity(0, cfg.speed);
      } else {
        body.setVelocity(0, cfg.speed);
      }
    }
  }

  private spawnBoss(kind: BossKind, hpMult: number): void {
    const W = this.scale.width;
    const baseHP = kind === "boss1" ? 500 : kind === "boss2" ? 1200 : 2400;
    const hp = Math.ceil(baseHP * hpMult);

    const boss = this.enemyGroup.get(W / 2, -60, kind) as Phaser.Physics.Arcade.Image | null;
    if (!boss) return;
    boss.setActive(true).setVisible(true).setDepth(7);
    boss.setData("kind", kind);
    boss.setData("hp", hp);
    boss.setData("maxHp", hp);
    boss.setData("shootCd", 0);
    boss.setData("spiralAngle", 0);
    const body = boss.body as Phaser.Physics.Arcade.Body;
    body.reset(W / 2, -60);
    body.setAllowGravity(false);
    body.setVelocity(0, 80);

    // move to position then stop
    this.time.delayedCall(1200, () => {
      if (boss.active) {
        (boss.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        boss.y = 80;
        this.bossAlive = true;
        this.bossPhase = 0;
        this.bossPhaseTimer = 1500;
        this.bossSpiralAngle = 0;
        this.bossRef = boss;
        this.bossHP = hp;
        this.bossMaxHP = hp;
        this.registry.set("boss-hp", hp);
        this.registry.set("boss-max-hp", hp);
      }
    });
  }

  // ─── collision handlers ──────────────────────────────────────────────────────

  private onPlayerHit(bullet: Phaser.Physics.Arcade.Image): void {
    if (this.invulnTimer > 0) return;
    bullet.setActive(false).setVisible(false);
    (bullet.body as Phaser.Physics.Arcade.Body).reset(-200, -200);

    this.playerLives--;
    this.noHitStreak = 0;
    this.invulnTimer = 1500;
    playSfx("error");
    if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    this.cameras.main.shake(200, 0.008);
    this.syncHUD();

    if (this.playerLives <= 0) {
      this.gameOver();
    }
  }

  private onPlayerEnemyContact(enemy: Phaser.Physics.Arcade.Image): void {
    if (this.dead) return;
    if (this.invulnTimer > 0) return;
    if (!enemy.active) return;
    const kind = enemy.getData("kind") as EnemyKind;
    const isBoss = kind === "boss1" || kind === "boss2" || kind === "boss3";

    // player takes damage
    this.playerLives--;
    this.noHitStreak = 0;
    this.invulnTimer = 1500;
    playSfx("error");
    if (navigator.vibrate) navigator.vibrate([50, 80, 50]);
    this.cameras.main.shake(260, 0.012);
    this.syncHUD();

    // enemy: kamikaze dies, boss takes chunk damage
    if (isBoss) {
      this.hitBoss(40);
    } else {
      this.spawnExplosion(enemy.x, enemy.y);
      enemy.setActive(false).setVisible(false);
      (enemy.body as Phaser.Physics.Arcade.Body).reset(-200, -200);
    }

    if (this.playerLives <= 0) {
      this.gameOver();
    }
  }

  private onBulletHitEnemy(bullet: Phaser.Physics.Arcade.Image, enemy: Phaser.Physics.Arcade.Image): void {
    if (!bullet.active || !enemy.active) return;
    // weapon type laser handled separately
    if (bullet.texture.key === "bullet-p-laser") return;
    bullet.setActive(false).setVisible(false);
    (bullet.body as Phaser.Physics.Arcade.Body).reset(-200, -200);

    const dmg = (bullet.getData("dmg") as number | undefined) ?? 1;
    // Boss uses its own HP bar & kill path — don't route through hitEnemy
    // (would desync the bar and skip round-clear flow).
    const kind = enemy.getData("kind") as EnemyKind;
    if (kind === "boss1" || kind === "boss2" || kind === "boss3") {
      this.hitBoss(dmg);
      return;
    }
    this.hitEnemy(enemy, dmg);
  }

  private hitEnemy(enemy: Phaser.Physics.Arcade.Image, dmg: number): void {
    const hp = (enemy.getData("hp") as number) - dmg;
    enemy.setData("hp", hp);

    // hit flash tint
    enemy.setTint(0xff4444);
    this.time.delayedCall(80, () => { if (enemy.active) enemy.clearTint(); });

    const now = performance.now();

    if (hp <= 0) {
      const kind = enemy.getData("kind") as EnemyKind;
      const pts = SCORE_TABLE[kind] ?? 10;
      this.addScore(pts);
      playSfx("pop");
      if (now - this.lastVibrate > 80) {
        this.lastVibrate = now;
        if (navigator.vibrate) navigator.vibrate(6);
      }

      // explosion
      this.spawnExplosion(enemy.x, enemy.y);

      // drop pickup ~8%
      if (Math.random() < 0.08) this.dropPickup(enemy.x, enemy.y);

      enemy.setActive(false).setVisible(false);
      (enemy.body as Phaser.Physics.Arcade.Body).reset(-200, -200);
    }
  }

  private hitBoss(dmg: number): void {
    this.bossHP = Math.max(0, this.bossHP - dmg);
    this.registry.set("boss-hp", this.bossHP);

    const now = performance.now();
    if (now - this.lastBossDmgVibrate > 100) {
      this.lastBossDmgVibrate = now;
      if (navigator.vibrate) navigator.vibrate(8);
    }
    this.cameras.main.shake(60, 0.003);

    if (this.bossRef) {
      this.bossRef.setTint(0xff4444);
      this.time.delayedCall(80, () => { if (this.bossRef?.active) this.bossRef.clearTint(); });
    }

    if (this.bossHP <= 0 && this.bossRef?.active) {
      const kind = this.bossRef.getData("kind") as EnemyKind;
      this.addScore(SCORE_TABLE[kind] ?? 5000);
      playSfx("kill");
      this.cameras.main.shake(400, 0.018);
      this.spawnExplosion(this.bossRef.x, this.bossRef.y, true);
      this.bossRef.setActive(false).setVisible(false);
      this.bossAlive = false;
      this.bossRef = null;
      this.registry.set("boss-hp", 0);
      this.registry.set("boss-max-hp", 0);

      // drop rewards
      this.dropPickup(this.scale.width / 2 - 20, 200);
      this.dropPickup(this.scale.width / 2 + 20, 200);
      this.addBomb();

      // round cleared — grant weapon reward + banner
      this.onRoundCleared(kind);
    }
  }

  private onRoundCleared(bossKind: EnemyKind): void {
    const roundIdx = bossKind === "boss1" ? 0 : bossKind === "boss2" ? 1 : bossKind === "boss3" ? 2 : -1;
    if (roundIdx < 0) return;
    const round = ROUNDS[roundIdx]!;

    // grant weapon: if already owns, bump level; else swap with level 2
    if (this.weaponType === round.reward) {
      this.weaponLevel = Math.min(5, this.weaponLevel + 1) as WeaponLevel;
    } else {
      this.weaponType = round.reward;
      this.weaponLevel = 2;
    }
    this.playerLives = Math.min(5, this.playerLives + 1);
    this.playerBombs = Math.min(9, this.playerBombs + 2);
    this.syncHUD();

    // FESTA: clear bullets, confetti burst, big screen shake, fanfare
    this.clearEnemyBullets();
    this.spawnConfetti();
    this.cameras.main.flash(250, 255, 255, 160);
    this.cameras.main.shake(350, 0.012);
    playSfx("fanfare");
    if (navigator.vibrate) navigator.vibrate([60, 80, 60, 80, 200]);

    this.registry.set("round-banner", JSON.stringify({
      text: `${round.name} CLEAR`,
      sub: `+${round.rewardLabel} · +1 LIFE · +2 BOMBS`,
      color: round.color,
      ts: Date.now(),
    }));
    if (roundIdx === ROUNDS.length - 1) {
      this.time.delayedCall(2600, () => {
        this.registry.set("round-banner", JSON.stringify({
          text: "VICTORY",
          sub: "NEW LOOP · DIFFICULTY +",
          color: "#ffee44",
          ts: Date.now(),
        }));
        playSfx("fanfare");
      });
    }
  }

  private clearEnemyBullets(): void {
    this.enemyBullets.getChildren().forEach((obj) => {
      const b = obj as Phaser.Physics.Arcade.Image;
      if (!b.active) return;
      this.spawnExplosion(b.x, b.y);
      b.setActive(false).setVisible(false);
      (b.body as Phaser.Physics.Arcade.Body).reset(-200, -200);
    });
  }

  private spawnConfetti(): void {
    const W = this.scale.width;
    const colors = [0xffcc22, 0xff3366, 0x22ffaa, 0x66aaff, 0xff88ff, 0xffffff];
    const em = this.add.particles(0, 0, "thrust-particle", {
      x: { min: 0, max: W },
      y: -10,
      speedY: { min: 140, max: 380 },
      speedX: { min: -120, max: 120 },
      lifespan: { min: 1600, max: 2800 },
      scale: { start: 2.2, end: 0.6 },
      rotate: { start: 0, end: 360 },
      alpha: { start: 1, end: 0 },
      quantity: 0,
      frequency: -1,
      tint: colors,
    }).setDepth(45);
    em.explode(160);
    this.time.delayedCall(300, () => em.explode(120));
    this.time.delayedCall(600, () => em.explode(120));
    this.time.delayedCall(3200, () => em.destroy());
  }

  private onPickup(pickup: Phaser.Physics.Arcade.Image): void {
    const kind = pickup.getData("pickupKind") as string;
    playSfx("coin");
    playSfx("levelup");
    pickup.destroy();

    if (kind === "B") {
      this.addBomb();
      return;
    }

    const typeMap: Record<string, WeaponType> = { W: "wide", L: "laser", S: "spread", H: "homing" };
    const newType = typeMap[kind];
    if (newType) {
      if (this.weaponType === newType) {
        this.weaponLevel = Math.min(5, this.weaponLevel + 1) as WeaponLevel;
      } else {
        this.weaponType = newType;
        this.weaponLevel = 1;
      }
    }
    this.syncHUD();
  }

  // ─── helpers ─────────────────────────────────────────────────────────────────

  private addScore(pts: number): void {
    this.score += pts;
    this.registry.set("score", this.score);
    this.checkUpgradeTier();
  }

  private setFocusState(on: boolean): void {
    this.focusActive = on;
    if (on) {
      // Bright visible cyan ring around ship. Always alpha 1, scale pulses.
      if (!this.focusHalo) {
        this.focusHalo = this.add.circle(this.playerShip.x, this.playerShip.y, 38, 0x000000, 0)
          .setStrokeStyle(3, 0x22eeff, 1)
          .setDepth(11);
      }
      this.focusHalo.setVisible(true).setAlpha(1);
      this.tweens.killTweensOf(this.focusHalo);
      this.tweens.add({
        targets: this.focusHalo,
        scale: { from: 0.85, to: 1.2 },
        alpha: { from: 1, to: 0.55 },
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      // ship cyan tint (additive override on top of tier tint)
      this.playerShip.setTint(0x22eeff);
    } else {
      if (this.focusHalo) {
        this.tweens.killTweensOf(this.focusHalo);
        this.focusHalo.setVisible(false);
      }
      // restore tier tint
      const tints = [0xffffff, 0x88eaff, 0x66aaff, 0xff88ff, 0xffcc33];
      this.playerShip.setTint(tints[this.upgradeTier] ?? 0xffffff);
    }
    this.cameras.main.flash(140, on ? 40 : 20, on ? 220 : 30, on ? 240 : 30, false);
  }

  private checkUpgradeTier(): void {
    const next = this.upgradeTier;
    for (let i = 0; i < this.upgradeMilestones.length; i++) {
      if (this.score >= this.upgradeMilestones[i]! && i + 1 > this.upgradeTier) {
        this.upgradeTier = i + 1;
        this.applyUpgradeTier();
        return;
      }
    }
    void next;
  }

  private applyUpgradeTier(): void {
    const tier = this.upgradeTier;
    // Ship tint progression: white → cyan → blue → magenta → gold
    const tints = [0xffffff, 0x88eaff, 0x66aaff, 0xff88ff, 0xffcc33];
    this.playerShip.setTint(tints[tier] ?? 0xffffff);
    // Bomb cap raise at T2
    if (tier >= 2) this.playerBombs = Math.min(5, this.playerBombs + 1);
    // Thrust emitter richer at tier 2+
    if (tier >= 2) {
      this.thrustEmitter.setQuantity(4);
    }
    playSfx("upgrade");
    if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
    this.registry.set("round-banner", JSON.stringify({
      text: `TIER ${tier}`,
      sub: tier === 1 ? "+15% fire rate"
         : tier === 2 ? "+30% speed · +1 bomb · richer thrust"
         : tier === 3 ? "wing cannons ONLINE"
         : tier === 4 ? "MAX POWER · gold hull"
         : "upgrade",
      color: "#ffcc33",
      ts: Date.now(),
    }));
    this.syncHUD();
  }

  private addBomb(): void {
    this.playerBombs = Math.min(9, this.playerBombs + 1);
    this.addScore(200);
    this.syncHUD();
  }

  private syncHUD(): void {
    this.registry.set("score", this.score);
    this.registry.set("lives", this.playerLives);
    this.registry.set("bombs", this.playerBombs);
    this.registry.set("wave", this.waveNumber);
    this.registry.set("round", this.currentRound);
    this.registry.set("weapon", `${this.weaponType.toUpperCase()} L${this.weaponLevel}`);
  }

  private spawnExplosion(x: number, y: number, big = false): void {
    const em = this.explosionEmitters.find(e => !e.getData("busy"));
    if (!em) {
      // fallback: use first
      this.explosionEmitters[0]?.explode(big ? 20 : 12, x, y);
      return;
    }
    em.setData("busy", true);
    em.explode(big ? 20 : 12, x, y);
    this.time.delayedCall(800, () => em.setData("busy", false));
  }

  private dropPickup(x: number, y: number): void {
    const kinds = ["W", "L", "S", "H", "B"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
    const key = `pickup-${kind}`;
    const p = this.pickupGroup.create(x, y, key) as Phaser.Physics.Arcade.Image;
    p.setData("pickupKind", kind);
    p.setDepth(6);
    (p.body as Phaser.Physics.Arcade.StaticBody).reset(x, y);
  }

  private softReset(): void {
    // Clear everything in-scene. No scene lifecycle, no fresh create(),
    // no texture reload. Works reliably across Phaser 4 builds.
    const W = this.scale.width;
    const H = this.scale.height;

    // clear all active game objects in groups (preserves pool)
    this.enemyGroup.getChildren().forEach((o) => {
      const e = o as Phaser.Physics.Arcade.Image;
      e.setActive(false).setVisible(false);
      e.clearTint();
      if (e.body) (e.body as Phaser.Physics.Arcade.Body).reset(-200, -200);
    });
    this.enemyBullets.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      b.setActive(false).setVisible(false);
      if (b.body) (b.body as Phaser.Physics.Arcade.Body).reset(-200, -200);
    });
    this.playerBullets.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      b.setActive(false).setVisible(false);
      if (b.body) (b.body as Phaser.Physics.Arcade.Body).reset(-200, -200);
    });
    this.pickupGroup.clear(true, true);

    // reset player
    this.playerShip.setPosition(W / 2, H * 0.78);
    this.playerShip.setVisible(true).setAlpha(1).clearTint();
    (this.playerShip.body as Phaser.Physics.Arcade.Body).reset(W / 2, H * 0.78);
    this.targetX = W / 2;
    this.targetY = H * 0.78;

    // reset state
    this.playerLives = 3;
    this.playerBombs = 3;
    this.weaponLevel = 1;
    this.weaponType = "basic";
    this.invulnTimer = 0;
    this.score = 0;
    this.waveIndex = 0;
    this.gameTime = 0;
    this.noHitStreak = 0;
    this.waveNumber = 1;
    this.currentRound = 1;
    this.upgradeTier = 0;
    this.dead = false;
    this.loopPass = 0;
    this.fireTimer = 0;
    this.laserTimer = 0;
    this.bossAlive = false;
    this.bossPhase = 0;
    this.bossPhaseTimer = 0;
    this.bossSpiralAngle = 0;
    this.bossRef = null;
    this.bossHP = 0;
    this.bossMaxHP = 0;

    // focus off
    this.setFocusState(false);

    // resume thrust + physics
    try { this.thrustEmitter.start(); } catch { /* ok */ }
    this.physics.resume();

    // sync HUD + opening banner
    this.syncHUD();
    const r1 = ROUNDS[0]!;
    this.registry.set("round-banner", JSON.stringify({
      text: `R1 · ${r1.name}`,
      sub: "survive to boss",
      color: r1.color,
      ts: Date.now(),
    }));
  }

  private gameOver(): void {
    if (this.dead) return;
    this.dead = true;

    try { this.thrustEmitter?.stop(); } catch { /* ok */ }
    // zero velocities on active hazards so nothing keeps moving / colliding
    this.enemyBullets.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (b.active && b.body) (b.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    });
    this.enemyGroup.getChildren().forEach((o) => {
      const e = o as Phaser.Physics.Arcade.Image;
      if (e.active && e.body) (e.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    });

    playSfx("gameover");
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    this.cameras.main.shake(420, 0.02);
    this.spawnExplosion(this.playerShip.x, this.playerShip.y, true);
    this.playerShip.setVisible(false);
    void submit(GAME_ID, this.score);

    // Pause physics so no further collisions fire while overlay shows.
    this.physics.pause();

    // Show overlay immediately. Emitting an explicit event on UI scene is
    // more reliable than setting a registry key (changedata won't fire if
    // the value already matched, and it can race with scene lifecycle).
    const ui = this.scene.get("UI");
    ui.events.emit("star-void:gameover", this.score);
  }
}

// ─── UIScene ──────────────────────────────────────────────────────────────────

class UIScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private bombsText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private bombBtn!: Phaser.GameObjects.Container;
  private bombBtnHit!: Phaser.GameObjects.Arc;
  private bombBtnCount!: Phaser.GameObjects.Text;
  private bombBtnIconGfx!: Phaser.GameObjects.Graphics;
  private bombBtnPulse = 0;
  private focusBtn!: Phaser.GameObjects.Container;
  private focusBtnHit!: Phaser.GameObjects.Arc;
  private bossBar!: Phaser.GameObjects.Graphics;
  private gameoverOverlay!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Container;
  private bannerMainText!: Phaser.GameObjects.Text;
  private bannerSubText!: Phaser.GameObjects.Text;
  private bannerTimer: Phaser.Time.TimerEvent | null = null;

  constructor() { super({ key: "UI", active: false }); }

  create(): void {
    const W = this.scale.width;

    // score
    this.scoreText = this.add.text(8, 8, "0", {
      fontFamily: "monospace", fontSize: "20px", color: "#ffffff",
    }).setDepth(50);

    // round name
    this.roundText = this.add.text(W / 2, 8, "ROUND 1", {
      fontFamily: "monospace", fontSize: "13px", color: "#88ddff", fontStyle: "bold",
    }).setOrigin(0.5, 0).setDepth(50);
    // wave sub-counter
    this.waveText = this.add.text(W / 2, 24, "WAVE 1", {
      fontFamily: "monospace", fontSize: "10px", color: "#aaaaaa",
    }).setOrigin(0.5, 0).setDepth(50);

    // lives
    this.livesText = this.add.text(W - 8, 8, "♥♥♥", {
      fontFamily: "monospace", fontSize: "14px", color: "#ff3366",
    }).setOrigin(1, 0).setDepth(50);

    // bombs row
    this.bombsText = this.add.text(W - 8, 28, "💣💣💣", {
      fontFamily: "monospace", fontSize: "12px", color: "#ffcc00",
    }).setOrigin(1, 0).setDepth(50);

    // weapon badge (left)
    this.weaponText = this.add.text(8, 32, "BASIC L1", {
      fontFamily: "monospace", fontSize: "10px", color: "#88ff88",
    }).setDepth(50);

    // BOMB button bottom-right — circular, glowy, bomb icon + count badge
    const H = this.scale.height;
    const bbX = W - 46, bbY = H - 52;
    this.bombBtn = this.add.container(bbX, bbY).setDepth(55);
    // outer glow
    const bbGlow = this.add.circle(0, 0, 38, 0xff2266, 0.25);
    // main disk (radial look via multiple layered circles)
    const bbOuter = this.add.circle(0, 0, 30, 0x440011, 1);
    const bbInner = this.add.circle(0, 0, 26, 0xff3366, 1);
    const bbRim   = this.add.circle(0, 0, 26, 0x000000, 0).setStrokeStyle(2, 0xffcc44, 0.9);
    const bbShine = this.add.circle(-7, -8, 8, 0xffffff, 0.25);
    // bomb icon via Graphics (drawn in container coords)
    this.bombBtnIconGfx = this.add.graphics();
    const g = this.bombBtnIconGfx;
    // bomb body (dark circle)
    g.fillStyle(0x111111, 1);
    g.fillCircle(0, 2, 11);
    // highlight
    g.fillStyle(0x444444, 1);
    g.fillCircle(-3, -1, 3);
    // fuse
    g.lineStyle(2, 0xaa6611, 1);
    g.beginPath(); g.moveTo(5, -6); g.lineTo(10, -12); g.strokePath();
    // spark
    g.fillStyle(0xffee44, 1);
    g.fillCircle(11, -13, 2.5);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(11, -13, 1);
    // count badge
    const badgeBg = this.add.circle(20, -18, 10, 0xffcc22, 1);
    badgeBg.setStrokeStyle(1, 0x000000, 1);
    this.bombBtnCount = this.add.text(20, -18, "3", {
      fontFamily: "monospace", fontSize: "12px", color: "#111", fontStyle: "bold",
    }).setOrigin(0.5);
    this.bombBtn.add([bbGlow, bbOuter, bbInner, bbRim, bbShine, this.bombBtnIconGfx, badgeBg, this.bombBtnCount]);
    // hit area (invisible arc for cleaner hit test than the container)
    this.bombBtnHit = this.add.circle(bbX, bbY, 34, 0x000000, 0).setDepth(56).setInteractive({ useHandCursor: true });
    this.bombBtnHit.on("pointerdown", () => {
      const play = this.scene.get("Play") as PlayScene;
      play.events.emit("bomb");
      this.tweens.add({ targets: this.bombBtn, scale: { from: 0.85, to: 1 }, duration: 180, ease: "Back.easeOut" });
    });
    // idle pulse so the button visibly invites a tap
    this.tweens.add({
      targets: this.bombBtn,
      scale: { from: 0.96, to: 1.05 },
      duration: 750,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    void this.bombBtnPulse; // kept for future use

    // FOCUS button — hold to slow-move + bigger bullets + more damage
    const fbX = W - 110, fbY = H - 52;
    this.focusBtn = this.add.container(fbX, fbY).setDepth(55);
    const fbGlow  = this.add.circle(0, 0, 34, 0x22ddff, 0.22);
    const fbOuter = this.add.circle(0, 0, 28, 0x001833, 1);
    const fbInner = this.add.circle(0, 0, 24, 0x0088cc, 1);
    const fbRim   = this.add.circle(0, 0, 24, 0x000000, 0).setStrokeStyle(2, 0x88eaff, 0.9);
    // crosshair icon
    const fbIcon = this.add.graphics();
    fbIcon.lineStyle(2, 0xffffff, 1);
    fbIcon.strokeCircle(0, 0, 10);
    fbIcon.beginPath();
    fbIcon.moveTo(-14, 0); fbIcon.lineTo(-6, 0);
    fbIcon.moveTo(6, 0);   fbIcon.lineTo(14, 0);
    fbIcon.moveTo(0, -14); fbIcon.lineTo(0, -6);
    fbIcon.moveTo(0, 6);   fbIcon.lineTo(0, 14);
    fbIcon.strokePath();
    fbIcon.fillStyle(0xff3366, 1);
    fbIcon.fillCircle(0, 0, 2);
    const fbLbl = this.add.text(0, 22, "FOCUS", {
      fontFamily: "monospace", fontSize: "9px", color: "#88eaff", fontStyle: "bold",
    }).setOrigin(0.5);
    this.focusBtn.add([fbGlow, fbOuter, fbInner, fbRim, fbIcon, fbLbl]);

    this.focusBtnHit = this.add.circle(fbX, fbY, 32, 0x000000, 0).setDepth(56).setInteractive({ useHandCursor: true });
    const play = this.scene.get("Play") as PlayScene;
    // Toggle mode: tap to enable/disable. Easier than hold on mobile.
    let focusOn = false;
    const setFocus = (on: boolean) => {
      if (focusOn === on) return;
      focusOn = on;
      play.events.emit(on ? "focus-on" : "focus-off");
      this.tweens.killTweensOf(this.focusBtn);
      this.tweens.add({
        targets: this.focusBtn,
        scale: on ? 1.15 : 1,
        duration: 150,
        ease: "Back.easeOut",
      });
      fbInner.setFillStyle(on ? 0x22eeff : 0x0088cc);
      fbRim.setStrokeStyle(2, on ? 0xffffff : 0x88eaff, on ? 1 : 0.9);
      fbLbl.setText(on ? "ON" : "FOCUS");
    };
    this.focusBtnHit.on("pointerdown", () => {
      setFocus(!focusOn);
      if (navigator.vibrate) navigator.vibrate(12);
    });
    // Auto-turn-off when game over so next run starts clean
    this.events.on("star-void:gameover", () => setFocus(false));

    // boss health bar
    this.bossBar = this.add.graphics().setDepth(52);

    // round-cleared banner
    this.banner = this.add.container(W / 2, H * 0.35).setDepth(58).setVisible(false);
    const bnBg = this.add.rectangle(0, 0, Math.min(W - 40, 340), 110, 0x000000, 0.75);
    bnBg.setStrokeStyle(2, 0xffffff, 0.7);
    this.bannerMainText = this.add.text(0, -18, "", {
      fontFamily: "monospace", fontSize: "22px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5);
    this.bannerSubText = this.add.text(0, 22, "", {
      fontFamily: "monospace", fontSize: "12px", color: "#aaffcc",
    }).setOrigin(0.5);
    this.banner.add([bnBg, this.bannerMainText, this.bannerSubText]);

    // game over overlay (initially hidden)
    this.gameoverOverlay = this.add.container(W / 2, H / 2).setDepth(60).setVisible(false);
    const goBg = this.add.rectangle(0, 0, 280, 180, 0x000000, 0.9);
    goBg.setStrokeStyle(2, 0xff3366, 0.7);
    const goTitle = this.add.text(0, -60, "GAME OVER", { fontFamily: "monospace", fontSize: "22px", color: "#ff3366" }).setOrigin(0.5);
    const goScoreLbl = this.add.text(0, -20, "SCORE", { fontFamily: "monospace", fontSize: "11px", color: "#aaaaaa" }).setOrigin(0.5);
    const goScore = this.add.text(0, 5, "0", { fontFamily: "monospace", fontSize: "26px", color: "#ffffff" }).setOrigin(0.5);
    const goBtn = this.add.rectangle(0, 60, 160, 48, 0xff2266)
      .setInteractive({ useHandCursor: true });
    const goBtnLbl = this.add.text(0, 60, "PLAY AGAIN", { fontFamily: "monospace", fontSize: "13px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5);
    this.gameoverOverlay.add([goBg, goTitle, goScoreLbl, goScore, goBtn, goBtnLbl]);

    const showGameOver = (score: number) => {
      goScore.setText(String(score));
      this.gameoverOverlay.setVisible(true).setAlpha(0).setScale(0.85);
      this.tweens.add({
        targets: this.gameoverOverlay,
        alpha: 1,
        scale: 1,
        duration: 320,
        ease: "Back.easeOut",
      });
    };

    let restarting = false;
    const restart = () => {
      if (restarting) return;
      if (!this.gameoverOverlay.visible) return;
      restarting = true;
      this.gameoverOverlay.setVisible(false);
      this.registry.set("score", 0);
      this.registry.set("lives", 3);
      this.registry.set("bombs", 3);
      this.registry.set("wave", 1);
      this.registry.set("round", 1);
      this.registry.set("weapon", "BASIC L1");
      this.registry.set("boss-hp", 0);
      this.registry.set("boss-max-hp", 0);
      // In-scene soft reset: Play scene stays running (no scene lifecycle
      // restart which was flaky in Phaser 4). Play handles clearing all
      // groups + resetting player + resuming physics in response to this
      // event, which is reliable.
      const play = this.scene.get("Play");
      play.events.emit("star-void:restart");
      this.time.delayedCall(50, () => { restarting = false; });
    };
    goBtn.on("pointerdown", restart);
    // Fallback: any tap while overlay visible triggers restart (guards
    // against Phaser 4 hit-test quirks on mobile/WebGPU).
    this.input.on("pointerdown", () => {
      if (this.gameoverOverlay.visible) restart();
    });

    // Play scene → UI scene direct event (emit via UI's own event bus so
    // it survives Play scene restarts).
    this.events.on("star-void:gameover", (score: number) => {
      showGameOver(score);
    });

    // listen to registry
    this.registry.events.on("changedata", (_: unknown, key: string, value: unknown) => {
      this.onRegistryChange(key, value, goScore);
    });

    // resize
    this.scale.on("resize", (gs: Phaser.Structs.Size) => this.onResize(gs.width, gs.height));
  }

  private onRegistryChange(key: string, value: unknown, goScore: Phaser.GameObjects.Text): void {
    switch (key) {
      case "score":
        this.scoreText.setText(String(value as number));
        break;
      case "wave":
        this.waveText.setText(`WAVE ${value as number}`);
        break;
      case "round": {
        const n = value as number;
        const name = ROUNDS[n - 1]?.name ?? "FINAL";
        const color = ROUNDS[n - 1]?.color ?? "#ffcc00";
        this.roundText.setText(`R${n} · ${name}`);
        this.roundText.setColor(color);
        break;
      }
      case "weapon": {
        const w = value as string;
        this.weaponText.setText(w);
        break;
      }
      case "lives": {
        const n = value as number;
        this.livesText.setText("♥".repeat(Math.max(0, n)));
        break;
      }
      case "bombs": {
        const n = value as number;
        this.bombsText.setText("💣".repeat(Math.max(0, n)));
        this.bombBtnCount.setText(String(Math.max(0, n)));
        const disabled = n <= 0;
        this.bombBtn.setAlpha(disabled ? 0.45 : 1);
        this.bombBtnHit.input!.enabled = !disabled;
        break;
      }
      case "boss-hp":
      case "boss-max-hp":
        this.drawBossBar();
        break;
      case "round-banner": {
        try {
          const d = JSON.parse(value as string) as { text: string; sub: string; color: string };
          this.bannerMainText.setText(d.text).setColor(d.color);
          this.bannerSubText.setText(d.sub);
          this.banner.setVisible(true).setAlpha(0);
          this.tweens.add({ targets: this.banner, alpha: 1, duration: 250 });
          if (this.bannerTimer) this.bannerTimer.remove();
          this.bannerTimer = this.time.delayedCall(2600, () => {
            this.tweens.add({
              targets: this.banner,
              alpha: 0,
              duration: 400,
              onComplete: () => this.banner.setVisible(false),
            });
          });
        } catch {}
        break;
      }
      // gameover handled via direct scene event (see create())
    }
    void goScore;
  }

  private drawBossBar(): void {
    const hp    = (this.registry.get("boss-hp") as number | undefined) ?? 0;
    const maxHp = (this.registry.get("boss-max-hp") as number | undefined) ?? 0;
    const W = this.scale.width;
    this.bossBar.clear();
    if (maxHp <= 0 || hp <= 0) return;
    const barW = W - 32;
    const barH = 6;
    const barX = 16;
    const barY = 44;
    this.bossBar.fillStyle(0x550000, 0.8);
    this.bossBar.fillRect(barX, barY, barW, barH);
    const frac = hp / maxHp;
    this.bossBar.fillStyle(0xff2200, 1);
    this.bossBar.fillRect(barX, barY, barW * frac, barH);
    this.bossBar.lineStyle(1, 0xff6644, 0.6);
    this.bossBar.strokeRect(barX, barY, barW, barH);
  }

  private onResize(W: number, H: number): void {
    this.roundText.setX(W / 2);
    this.waveText.setX(W / 2);
    this.livesText.setX(W - 8);
    this.bombsText.setX(W - 8);
    this.bombBtn.setPosition(W - 46, H - 52);
    this.bombBtnHit.setPosition(W - 46, H - 52);
    this.focusBtn.setPosition(W - 110, H - 52);
    this.focusBtnHit.setPosition(W - 110, H - 52);
    this.gameoverOverlay.setPosition(W / 2, H / 2);
    this.banner.setPosition(W / 2, H * 0.35);
  }
}

// ─── mount / unmount ──────────────────────────────────────────────────────────

export function mount(container: HTMLElement): () => void {
  container.classList.add("starvoid-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // hint overlay
  const hintKey = "star-void:seenHint";
  let seenHint = false;
  try { seenHint = !!localStorage.getItem(hintKey); } catch { /* ok */ }
  if (!seenHint) {
    try { localStorage.setItem(hintKey, "1"); } catch { /* ok */ }
    const hint = document.createElement("div");
    hint.id = "sv-hint";
    hint.style.cssText = [
      "position:absolute","inset:0","z-index:100",
      "display:flex","flex-direction:column","align-items:center","justify-content:center",
      "pointer-events:none","gap:12px",
    ].join(";");
    hint.innerHTML = `
      <div style="background:rgba(0,0,0,0.7);padding:12px 20px;border-radius:8px;color:#fff;font-family:monospace;text-align:center;font-size:14px;line-height:1.6">
        <div>DRAG TO MOVE</div>
        <div style="font-size:11px;color:#aaaacc;margin-top:4px">BOMB button bottom-right: tap for nuke</div>
      </div>`;
    // need relative positioning on container
    const prevPos = container.style.position;
    if (!container.style.position || container.style.position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(hint);
    setTimeout(() => hint.remove(), 5000);
    // patch cleanup to restore position
    void prevPos;
  }

  // parent div for Phaser
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0;width:100%;height:100%;";
  container.appendChild(wrapper);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: wrapper,
    backgroundColor: "#050b1e",
    scene: [BootScene, PlayScene, UIScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: DESIGN_W,
      height: DESIGN_H,
    },
    physics: {
      default: "arcade",
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    audio: {
      disableWebAudio: true,
    },
    banner: false,
    disableContextMenu: true,
  });

  return (): void => {
    game.destroy(true, false);
    wrapper.remove();
    container.classList.remove("starvoid-root");
    container.style.touchAction = prevTouchAction;
    const hint = document.getElementById("sv-hint");
    hint?.remove();
  };
}
