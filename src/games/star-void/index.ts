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
type EnemyKind = "grunt" | "chaser" | "diver" | "gunner" | "shooter" | "boss1" | "boss2";

interface WaveEvent {
  at: number;
  type: EnemyKind;
  count?: number;
  pattern?: string;
}

// ─── wave timeline ────────────────────────────────────────────────────────────

const WAVE_TIMELINE: WaveEvent[] = [
  { at: 2,   type: "grunt",   count: 8,  pattern: "straight-line" },
  { at: 8,   type: "chaser",  count: 4 },
  { at: 15,  type: "diver",   count: 6 },
  { at: 25,  type: "gunner",  count: 2 },
  { at: 35,  type: "grunt",   count: 12, pattern: "v-formation" },
  { at: 45,  type: "chaser",  count: 5 },
  { at: 55,  type: "diver",   count: 4 },
  { at: 65,  type: "gunner",  count: 2 },
  { at: 75,  type: "shooter", count: 1 },
  { at: 80,  type: "grunt",   count: 15, pattern: "straight-line" },
  { at: 90,  type: "boss1" },
  { at: 100, type: "grunt",   count: 15 },
  { at: 110, type: "chaser",  count: 6 },
  { at: 120, type: "diver",   count: 8 },
  { at: 130, type: "gunner",  count: 3 },
  { at: 140, type: "shooter", count: 2 },
  { at: 150, type: "grunt",   count: 20, pattern: "v-formation" },
  { at: 165, type: "chaser",  count: 8 },
  { at: 175, type: "shooter", count: 3 },
  { at: 180, type: "boss2" },
];

// ─── score values ─────────────────────────────────────────────────────────────

const SCORE_TABLE: Record<EnemyKind, number> = {
  grunt: 10, chaser: 15, diver: 20, gunner: 50, shooter: 100,
  boss1: 5000, boss2: 10000,
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
      // Mid layer: medium white + pale-blue stars with halo
      { key: "star-mid",  size: 512, count: 320, seed: 29,
        heroChance: 0.01,
        minR: 0.6, maxR: 1.4,
        colors: ["#ffffff", "#dce9ff", "#b8d0ff"] },
      // Near layer: bigger luminous stars with frequent spikes
      { key: "star-fast", size: 512, count: 140, seed: 11,
        heroChance: 0.08,
        minR: 1.0, maxR: 2.4,
        colors: ["#ffffff", "#cfeaff", "#e8f1ff"] },
    ];

    for (const cfg of layers) {
      const ct = this.textures.createCanvas(cfg.key, cfg.size, cfg.size);
      if (!ct) continue;
      const ctx = ct.context;
      ctx.clearRect(0, 0, cfg.size, cfg.size);
      const rng = seededRng(cfg.seed);

      for (let i = 0; i < cfg.count; i++) {
        const x = rng() * cfg.size;
        const y = rng() * cfg.size;
        const color = cfg.colors[Math.floor(rng() * cfg.colors.length)]!;
        const r = cfg.minR + rng() * (cfg.maxR - cfg.minR);

        // Halo bloom
        const haloR = r * 5;
        const grd = ctx.createRadialGradient(x, y, 0, x, y, haloR);
        grd.addColorStop(0, hexWithAlpha(color, 0.95));
        grd.addColorStop(0.35, hexWithAlpha(color, 0.35));
        grd.addColorStop(1, hexWithAlpha(color, 0));
        ctx.fillStyle = grd;
        ctx.fillRect(x - haloR, y - haloR, haloR * 2, haloR * 2);

        // Tight bright core
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // Hero diffraction spikes on the bigger stars
        if (r > 1.3 && rng() < cfg.heroChance) {
          const spikeLen = 8 + rng() * 12;
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
          // Pure-white core overlay
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
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

      // Gentle blue haze clouds
      const blues = [[30, 50, 110], [40, 70, 140], [50, 90, 170], [20, 40, 90]];
      for (let i = 0; i < 10; i++) {
        const cx = rng() * nSize;
        const cy = rng() * nSize;
        const radius = 140 + rng() * 220;
        const rgb = blues[Math.floor(rng() * blues.length)]!;
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grd.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.10 + rng() * 0.09})`);
        grd.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.03 + rng() * 0.04})`);
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, nSize, nSize);
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
  private dead = false;
  private loopPass = 0;

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

    // hint dismiss
    const hint = document.getElementById("sv-hint");
    if (hint) {
      this.input.once("pointerdown", () => hint.remove());
      setTimeout(() => hint.remove(), 5000);
    }

    // init HUD
    this.syncHUD();

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
    this.starFast.alpha = 0.85 + Math.sin(this.gameTime * 3) * 0.1;

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
    const lerpFactor = 0.25;
    this.playerShip.x = Phaser.Math.Linear(this.playerShip.x, this.targetX, lerpFactor);
    this.playerShip.y = Phaser.Math.Linear(this.playerShip.y, this.targetY, lerpFactor);

    // clamp
    this.playerShip.x = Phaser.Math.Clamp(this.playerShip.x, 28, W - 28);
    this.playerShip.y = Phaser.Math.Clamp(this.playerShip.y, 32, H - 32);

    // thrust emitter follow (behind twin engines)
    this.thrustEmitter.setPosition(this.playerShip.x, this.playerShip.y + 26);

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

    // score streak bonus
    const streakBonus = Math.floor(this.noHitStreak / 10);
    if (streakBonus > 0 && Math.floor(this.gameTime * 10) % 10 === 0) {
      this.addScore(1);
    }

    // sync HUD every 200ms approx
    if (Math.floor(this.gameTime * 5) !== Math.floor((this.gameTime - dt / 1000) * 5)) {
      this.syncHUD();
    }
  }

  // ─── firing ──────────────────────────────────────────────────────────────────

  private autoFire(): void {
    const rpmTable: Record<WeaponLevel, number> = { 1: 300, 2: 280, 3: 250, 4: 600, 5: 240 };
    const intervalMs = 60000 / rpmTable[this.weaponLevel];
    this.fireTimer = intervalMs;

    if (this.weaponType === "laser") {
      // laser handled continuously in update
      return;
    }

    const x = this.playerShip.x;
    const y = this.playerShip.y - 26;
    const bulletKey = this.weaponBulletKey();

    playSfx("shoot");

    switch (this.weaponType) {
      case "basic": {
        const b = this.spawnPlayerBullet(x, y, bulletKey);
        if (b) (b.body as Phaser.Physics.Arcade.Body).setVelocity(0, -500);
        break;
      }
      case "spread": {
        const angles = [-15, 0, 15];
        angles.forEach((deg) => {
          const b = this.spawnPlayerBullet(x, y, bulletKey);
          if (b) {
            const rad = (deg * Math.PI) / 180;
            (b.body as Phaser.Physics.Arcade.Body).setVelocity(Math.sin(rad) * 500, -Math.cos(rad) * 500);
          }
        });
        break;
      }
      case "wide": {
        const angles = [-30, -15, 0, 15, 30];
        angles.forEach((deg) => {
          const b = this.spawnPlayerBullet(x, y, bulletKey);
          if (b) {
            const rad = (deg * Math.PI) / 180;
            (b.body as Phaser.Physics.Arcade.Body).setVelocity(Math.sin(rad) * 480, -Math.cos(rad) * 480);
          }
        });
        break;
      }
      case "homing": {
        const b1 = this.spawnPlayerBullet(x - 14, y + 6, bulletKey);
        const b2 = this.spawnPlayerBullet(x + 14, y + 6, bulletKey);
        if (b1) (b1.body as Phaser.Physics.Arcade.Body).setVelocity(-20, -400);
        if (b2) (b2.body as Phaser.Physics.Arcade.Body).setVelocity(20, -400);
        break;
      }
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
    b.setData("dmg", this.weaponLevel === 4 ? 3 : 1);
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

    // damage all on-screen enemies
    this.enemyGroup.getChildren().forEach((obj) => {
      const e = obj as Phaser.Physics.Arcade.Image;
      if (!e.active) return;
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
          // straight down, set at spawn
          break;
        }
        case "chaser": {
          const body = e.body as Phaser.Physics.Arcade.Body;
          const dx = px - e.x;
          const spd = 120;
          body.setVelocityX(dx > 0 ? spd : dx < 0 ? -spd : 0);
          break;
        }
        case "diver": {
          // fire aimed bullet periodically
          if (shootCd <= 0) {
            e.setData("shootCd", 2500);
            aimed(e.x, e.y + 8, px, this.playerShip.y, 1, 0, 200, "bullet-enemy-red", this.enemyBullets);
          }
          break;
        }
        case "gunner": {
          const body = e.body as Phaser.Physics.Arcade.Body;
          body.setVelocityY(0);
          if (shootCd <= 0) {
            e.setData("shootCd", 1200);
            aimed(e.x, e.y + 8, px, this.playerShip.y, 3, 20, 190, "bullet-enemy-red", this.enemyBullets);
          }
          break;
        }
        case "shooter": {
          const body = e.body as Phaser.Physics.Arcade.Body;
          body.setVelocityY(0);
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
    const bossKey = boss.getData("kind") as "boss1" | "boss2";

    this.bossPhaseTimer -= dt;

    switch (this.bossPhase) {
      case 0: {
        // phase 1: aimed spread
        if (this.bossPhaseTimer <= 0) {
          this.bossPhaseTimer = 1400;
          aimed(boss.x, boss.y + 10, px, this.playerShip.y, 3, 18, 200, "bullet-enemy-red", this.enemyBullets);
        }
        // slow horizontal oscillation
        const body = boss.body as Phaser.Physics.Arcade.Body;
        body.setVelocityX(Math.sin(this.gameTime * 1.2) * 80);
        body.setVelocityY(0);
        // switch phase at 60% HP
        if (this.bossHP < this.bossMaxHP * 0.6) {
          this.bossPhase = 1;
          this.bossPhaseTimer = 0;
          this.bossSpiralAngle = 0;
        }
        break;
      }
      case 1: {
        // phase 2: spiral
        this.bossSpiralAngle += (2.5 * Math.PI * dt) / 1000;
        if (this.bossPhaseTimer <= 0) {
          this.bossPhaseTimer = 80;
          const b = this.enemyBullets.get(boss.x, boss.y, "bullet-enemy-pink") as Phaser.Physics.Arcade.Image | null;
          if (b) {
            b.setActive(true).setVisible(true).setDepth(3);
            const body2 = b.body as Phaser.Physics.Arcade.Body;
            body2.reset(boss.x, boss.y);
            const spd = bossKey === "boss2" ? 220 : 180;
            body2.setVelocity(Math.cos(this.bossSpiralAngle) * spd, Math.sin(this.bossSpiralAngle) * spd);
            body2.setAllowGravity(false);
          }
        }
        const body = boss.body as Phaser.Physics.Arcade.Body;
        body.setVelocityX(Math.sin(this.gameTime * 0.8) * 60);
        body.setVelocityY(Math.cos(this.gameTime * 0.6) * 30);
        // switch phase at 30% HP
        if (this.bossHP < this.bossMaxHP * 0.3) {
          this.bossPhase = 2;
          this.bossPhaseTimer = 2500;
        }
        break;
      }
      case 2: {
        // phase 3: wall curtain with gap
        if (this.bossPhaseTimer <= 0) {
          this.bossPhaseTimer = bossKey === "boss2" ? 1800 : 2500;
          const gapCenter = px;
          wall(boss.y + 20, 16, gapCenter, 80, 220, "bullet-enemy-red", this.enemyBullets, W);
          // also aimed
          aimed(boss.x, boss.y + 10, px, this.playerShip.y, 3, 25, 180, "bullet-enemy-pink", this.enemyBullets);
        }
        const body = boss.body as Phaser.Physics.Arcade.Body;
        body.setVelocityX(Math.sin(this.gameTime * 1.5) * 100);
        body.setVelocityY(0);
        break;
      }
    }

    // boss2 gets an extra radial in phase 1
    if (bossKey === "boss2" && this.bossPhase === 0) {
      if (this.bossPhaseTimer > 0 && this.bossPhaseTimer % 3000 < 50) {
        radial(boss.x, boss.y, 12, 160, "bullet-enemy-pink", this.enemyBullets);
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
      this.spawnWave(ev);
      this.waveIndex++;
      this.waveNumber++;
      this.syncHUD();
    }

    // loop after 180s
    if (this.waveIndex >= timeline.length && !this.bossAlive) {
      this.gameTime = 0;
      this.waveIndex = 0;
      this.loopPass++;
    }
  }

  private spawnWave(ev: WaveEvent): void {
    const W = this.scale.width;
    const count = ev.count ?? 1;
    const hpMult = 1 + this.loopPass * 0.2;
    const spdMult = 1 + this.loopPass * 0.15;

    if (ev.type === "boss1" || ev.type === "boss2") {
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
    };
    const cfg = configs[ev.type];
    if (!cfg) return;

    for (let i = 0; i < count; i++) {
      const x = ev.pattern === "v-formation"
        ? W / 2 + (i - count / 2) * (W / (count + 1))
        : 30 + Math.random() * (W - 60);
      const y = -30 - i * 15;

      const e = this.enemyGroup.get(x, y, ev.type === "gunner" ? "enemy-gunner"
        : ev.type === "shooter" ? "enemy-shooter"
        : ev.type === "diver" ? "enemy-diver"
        : ev.type === "chaser" ? "enemy-chaser"
        : "enemy-grunt") as Phaser.Physics.Arcade.Image | null;

      if (!e) continue;
      e.setActive(true).setVisible(true).setDepth(7);
      e.setData("kind", ev.type);
      e.setData("hp", Math.ceil(cfg.hp * hpMult));
      e.setData("maxHp", Math.ceil(cfg.hp * hpMult));
      e.setData("shootCd", cfg.shootCd + Math.random() * 500);
      e.setData("spiralAngle", Math.random() * Math.PI * 2);
      const body = e.body as Phaser.Physics.Arcade.Body;
      body.reset(x, y);
      body.setAllowGravity(false);
      if (ev.type === "diver") {
        const dir = i % 2 === 0 ? 1 : -1;
        body.setVelocity(dir * 60 * spdMult, cfg.speed);
      } else {
        body.setVelocity(0, cfg.speed);
      }
    }
  }

  private spawnBoss(kind: "boss1" | "boss2", hpMult: number): void {
    const W = this.scale.width;
    const baseHP = kind === "boss1" ? 500 : 1200;
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

  private onBulletHitEnemy(bullet: Phaser.Physics.Arcade.Image, enemy: Phaser.Physics.Arcade.Image): void {
    if (!bullet.active || !enemy.active) return;
    // weapon type laser handled separately
    if (bullet.texture.key === "bullet-p-laser") return;
    bullet.setActive(false).setVisible(false);
    (bullet.body as Phaser.Physics.Arcade.Body).reset(-200, -200);

    const dmg = (bullet.getData("dmg") as number | undefined) ?? 1;
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
    }
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

  private gameOver(): void {
    this.dead = true;
    this.thrustEmitter.stop();
    playSfx("gameover");
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    this.cameras.main.shake(500, 0.02);
    void submit(GAME_ID, this.score);
    setTimeout(() => {
      this.registry.set("gameover", true);
    }, 1200);
  }
}

// ─── UIScene ──────────────────────────────────────────────────────────────────

class UIScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private bombsText!: Phaser.GameObjects.Text;
  private bombBtn!: Phaser.GameObjects.Rectangle;
  private bombBtnLabel!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Graphics;
  private gameoverOverlay!: Phaser.GameObjects.Container;

  constructor() { super({ key: "UI", active: false }); }

  create(): void {
    const W = this.scale.width;

    // score
    this.scoreText = this.add.text(8, 8, "0", {
      fontFamily: "monospace", fontSize: "20px", color: "#ffffff",
    }).setDepth(50);

    // wave
    this.waveText = this.add.text(W / 2, 8, "WAVE 1", {
      fontFamily: "monospace", fontSize: "13px", color: "#aaddff",
    }).setOrigin(0.5, 0).setDepth(50);

    // lives
    this.livesText = this.add.text(W - 8, 8, "♥♥♥", {
      fontFamily: "monospace", fontSize: "14px", color: "#ff3366",
    }).setOrigin(1, 0).setDepth(50);

    // bombs row
    this.bombsText = this.add.text(W - 8, 28, "💣💣💣", {
      fontFamily: "monospace", fontSize: "12px", color: "#ffcc00",
    }).setOrigin(1, 0).setDepth(50);

    // BOMB button bottom-right
    const H = this.scale.height;
    this.bombBtn = this.add.rectangle(W - 40, H - 50, 60, 60, 0xff2266, 0.85)
      .setDepth(55).setInteractive({ useHandCursor: true });
    this.bombBtnLabel = this.add.text(W - 40, H - 50, "BOMB", {
      fontFamily: "monospace", fontSize: "10px", color: "#ffffff",
    }).setOrigin(0.5).setDepth(56);

    this.bombBtn.on("pointerdown", () => {
      const play = this.scene.get("Play") as PlayScene;
      play.events.emit("bomb");
    });
    this.bombBtn.on("pointerover", () => this.bombBtn.setFillStyle(0xff4488));
    this.bombBtn.on("pointerout",  () => this.bombBtn.setFillStyle(0xff2266));

    // boss health bar
    this.bossBar = this.add.graphics().setDepth(52);

    // game over overlay (initially hidden)
    this.gameoverOverlay = this.add.container(W / 2, H / 2).setDepth(60).setVisible(false);
    const goBg = this.add.rectangle(0, 0, 280, 180, 0x000000, 0.85);
    const goTitle = this.add.text(0, -60, "GAME OVER", { fontFamily: "monospace", fontSize: "22px", color: "#ff3366" }).setOrigin(0.5);
    const goScoreLbl = this.add.text(0, -20, "SCORE", { fontFamily: "monospace", fontSize: "11px", color: "#aaaaaa" }).setOrigin(0.5);
    const goScore = this.add.text(0, 5, "0", { fontFamily: "monospace", fontSize: "26px", color: "#ffffff" }).setOrigin(0.5);
    const goBtn = this.add.rectangle(0, 60, 140, 44, 0xff2266).setInteractive({ useHandCursor: true });
    const goBtnLbl = this.add.text(0, 60, "PLAY AGAIN", { fontFamily: "monospace", fontSize: "11px", color: "#ffffff" }).setOrigin(0.5);
    this.gameoverOverlay.add([goBg, goTitle, goScoreLbl, goScore, goBtnLbl, goBtn, goBtnLbl]);

    goBtn.on("pointerdown", () => {
      this.registry.set("gameover", false);
      this.registry.set("score", 0);
      this.registry.set("lives", 3);
      this.registry.set("bombs", 3);
      this.registry.set("wave", 1);
      this.registry.set("boss-hp", 0);
      this.registry.set("boss-max-hp", 0);
      this.gameoverOverlay.setVisible(false);
      this.scene.stop("Play");
      this.scene.start("Play");
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
      case "lives": {
        const n = value as number;
        this.livesText.setText("♥".repeat(Math.max(0, n)));
        break;
      }
      case "bombs": {
        const n = value as number;
        this.bombsText.setText("💣".repeat(Math.max(0, n)));
        this.bombBtnLabel.setText(`BOMB\n${n}`);
        break;
      }
      case "boss-hp":
      case "boss-max-hp":
        this.drawBossBar();
        break;
      case "gameover":
        if (value === true) {
          const sc = this.registry.get("score") as number;
          goScore.setText(String(sc));
          this.gameoverOverlay.setVisible(true);
        }
        break;
    }
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
    this.waveText.setX(W / 2);
    this.livesText.setX(W - 8);
    this.bombsText.setX(W - 8);
    this.bombBtn.setPosition(W - 40, H - 50);
    this.bombBtnLabel.setPosition(W - 40, H - 50);
    this.gameoverOverlay.setPosition(W / 2, H / 2);
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
      mode: Phaser.Scale.RESIZE,
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
