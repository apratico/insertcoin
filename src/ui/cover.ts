import type { GameEntry } from "../games/registry.js";

// viewBox: 160x120 (4:3). Coordinates are in that space.

function wrap(id: string, bg: string, fg: string, accent: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" width="100%" height="100%">
  <defs>
    <filter id="glow-${id}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow2-${id}" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="vignette-${id}" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
    ${extraDefs(id, bg, fg, accent)}
  </defs>
  <rect width="160" height="120" fill="${bg}"/>
  ${body}
  <rect width="160" height="120" fill="url(#vignette-${id})"/>
  <rect x="0" y="100" width="160" height="20" fill="#000" fill-opacity="0.72"/>
</svg>`;
}

function extraDefs(id: string, bg: string, _fg: string, accent: string): string {
  return `<linearGradient id="grad-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${bg}" stop-opacity="0.3"/>
    </linearGradient>`;
}

// ---------- per-game art bodies ----------

function snakeArt(id: string): string {
  // Grid lines, snake body, red apple
  const lines: string[] = [];
  // faint grid
  for (let x = 0; x <= 160; x += 16)
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="100" stroke="#00ff41" stroke-opacity="0.08" stroke-width="0.5"/>`);
  for (let y = 0; y <= 100; y += 16)
    lines.push(`<line x1="0" y1="${y}" x2="160" y2="${y}" stroke="#00ff41" stroke-opacity="0.08" stroke-width="0.5"/>`);

  // Snake segments (S-curve)
  const segs: [number, number][] = [
    [100, 52], [84, 52], [68, 52], [68, 36], [84, 36], [100, 36], [116, 36],
  ];
  const segRects = segs.map(([x, y], i) => {
    const head = i === 0;
    const color = head ? "#00ff41" : `hsl(${120 + i * 8}, 100%, ${55 - i * 3}%)`;
    return `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="3" fill="${color}" filter="url(#glow-${id})"/>`;
  }).join("\n  ");

  // Eye on head
  const headEye = `<circle cx="104" cy="49" r="2" fill="#000"/>`;

  // Apple
  const apple = `<circle cx="36" cy="68" r="7" fill="#ff3333" filter="url(#glow2-${id})"/>
  <path d="M36 61 Q38 57 41 58" stroke="#228b22" stroke-width="1.5" fill="none"/>`;

  return lines.join("\n  ") + "\n  " + segRects + "\n  " + headEye + "\n  " + apple;
}

function tetrisArt(id: string): string {
  // Several tetrominos in various positions
  const pieces = [
    // I piece horizontal
    { cells: [[16,16],[28,16],[40,16],[52,16]], color:"#00e5ff" },
    // S piece
    { cells: [[80,24],[92,24],[68,36],[80,36]], color:"#66ff00" },
    // L piece
    { cells: [[108,16],[108,28],[108,40],[120,40]], color:"#ff9500" },
    // O piece (square)
    { cells: [[20,52],[32,52],[20,64],[32,64]], color:"#ffee00" },
    // T piece
    { cells: [[60,52],[72,52],[84,52],[72,64]], color:"#aa00ff" },
    // Z piece
    { cells: [[100,52],[112,52],[112,64],[124,64]], color:"#ff2222" },
    // J piece
    { cells: [[136,16],[136,28],[136,40],[124,40]], color:"#1a44ff" },
  ];

  return pieces.map(({ cells, color }) =>
    cells.map(([x, y]) =>
      `<rect x="${x - 5}" y="${y - 5}" width="11" height="11" rx="1.5" fill="${color}" stroke="#000" stroke-width="0.5" filter="url(#glow-${id})"/>`
    ).join("\n  ")
  ).join("\n  ");
}

function pacmanArt(id: string): string {
  // Dots row
  const dots = Array.from({ length: 8 }, (_, i) =>
    `<circle cx="${20 + i * 16}" cy="30" r="2.5" fill="#ffffff" fill-opacity="0.7"/>`
  ).join("\n  ");

  // Pac-Man
  const pm = `<path d="M48 68 L80 52 A24 24 0 1 1 80 84 Z" fill="#ffff00" filter="url(#glow-${id})"/>`;

  // Ghosts: Blinky(red), Pinky(pink), Inky(cyan), Clyde(orange)
  function ghost(cx: number, cy: number, color: string, gid: string): string {
    return `<g filter="url(#glow-${id})">
    <path d="M${cx - 9} ${cy + 10} Q${cx - 9} ${cy - 10} ${cx} ${cy - 10} Q${cx + 9} ${cy - 10} ${cx + 9} ${cy + 10}
      Q${cx + 5} ${cy + 6} ${cx + 1} ${cy + 10} Q${cx - 3} ${cy + 6} ${cx - 5} ${cy + 10} Q${cx - 7} ${cy + 6} ${cx - 9} ${cy + 10}"
      fill="${color}"/>
    <circle cx="${cx - 3}" cy="${cy - 2}" r="3" fill="white"/>
    <circle cx="${cx + 3}" cy="${cy - 2}" r="3" fill="white"/>
    <circle cx="${cx - 2}" cy="${cy - 2}" r="1.5" fill="#222" id="ge-${gid}"/>
    <circle cx="${cx + 4}" cy="${cy - 2}" r="1.5" fill="#222"/>
  </g>`;
  }

  const ghosts = [
    ghost(96, 68, "#ff0000", `${id}-b`),
    ghost(116, 68, "#ffb8ff", `${id}-p`),
    ghost(136, 68, "#00ffff", `${id}-i`),
  ].join("\n  ");

  return dots + "\n  " + pm + "\n  " + ghosts;
}

function breakoutArt(id: string): string {
  // Bricks 5 rows x 8 cols
  const brickColors = ["#ff2222", "#ff8800", "#ffee00", "#22cc22", "#2288ff"];
  const bricks = brickColors.map((color, row) =>
    Array.from({ length: 8 }, (_, col) => {
      const x = 2 + col * 20;
      const y = 4 + row * 12;
      return `<rect x="${x}" y="${y}" width="18" height="10" rx="1.5" fill="${color}" stroke="#000" stroke-width="0.5"/>`;
    }).join("\n  ")
  ).join("\n  ");

  // Ball with trail
  const trail = [
    `<circle cx="65" cy="88" r="3.5" fill="#ffffff" fill-opacity="0.2"/>`,
    `<circle cx="68" cy="82" r="4" fill="#ffffff" fill-opacity="0.4"/>`,
    `<circle cx="72" cy="76" r="5" fill="#ffffff" filter="url(#glow-${id})"/>`,
  ].join("\n  ");

  // Paddle
  const paddle = `<rect x="50" y="93" width="48" height="6" rx="3" fill="#ff6600" filter="url(#glow-${id})"/>`;

  return bricks + "\n  " + trail + "\n  " + paddle;
}

function invadersArt(id: string): string {
  // Pixel-art alien shapes (3 rows x 5 cols)
  function alien(cx: number, cy: number, type: number, color: string): string {
    if (type === 0) {
      // crab
      return `<g fill="${color}" filter="url(#glow-${id})">
    <rect x="${cx-6}" y="${cy-4}" width="12" height="8" rx="1"/>
    <rect x="${cx-9}" y="${cy-1}" width="4" height="3" rx="1"/>
    <rect x="${cx+5}" y="${cy-1}" width="4" height="3" rx="1"/>
    <rect x="${cx-3}" y="${cy-6}" width="2" height="3"/>
    <rect x="${cx+1}" y="${cy-6}" width="2" height="3"/>
    <circle cx="${cx-2}" cy="${cy}" r="1.5" fill="#000"/>
    <circle cx="${cx+2}" cy="${cy}" r="1.5" fill="#000"/>
  </g>`;
    }
    // squid
    return `<g fill="${color}" filter="url(#glow-${id})">
    <rect x="${cx-5}" y="${cy-5}" width="10" height="9" rx="2"/>
    <rect x="${cx-7}" y="${cy+1}" width="3" height="2" rx="1"/>
    <rect x="${cx+4}" y="${cy+1}" width="3" height="2" rx="1"/>
    <rect x="${cx-2}" y="${cy-7}" width="4" height="3"/>
    <circle cx="${cx-1}" cy="${cy-1}" r="1" fill="#000"/>
    <circle cx="${cx+1}" cy="${cy-1}" r="1" fill="#000"/>
  </g>`;
  }

  const rows = [
    { type: 1, color: "#ff88ff", y: 16 },
    { type: 0, color: "#88ff88", y: 30 },
    { type: 0, color: "#44ff44", y: 44 },
  ];

  const aliens = rows.map(({ type, color, y }) =>
    [22, 42, 62, 82, 102].map((x) => alien(x, y, type, color)).join("\n  ")
  ).join("\n  ");

  // Cannon
  const cannon = `<rect x="72" y="86" width="16" height="6" rx="2" fill="#33ff33" filter="url(#glow-${id})"/>
  <rect x="78" y="80" width="4" height="8" rx="1" fill="#33ff33" filter="url(#glow-${id})"/>`;

  // Laser
  const laser = `<rect x="79" y="60" width="2" height="18" fill="#ffffff" fill-opacity="0.8" filter="url(#glow-${id})"/>`;

  return aliens + "\n  " + cannon + "\n  " + laser;
}

function froggerArt(id: string): string {
  // Lanes background
  const lanes = [
    { y: 10, color: "#1a3a1a", label: "grass" },
    { y: 22, color: "#333333", label: "road" },
    { y: 36, color: "#333333", label: "road" },
    { y: 50, color: "#003366", label: "water" },
    { y: 64, color: "#003366", label: "water" },
    { y: 78, color: "#1a3a1a", label: "grass" },
  ];

  const bg = lanes.map(({ y, color }) =>
    `<rect x="0" y="${y}" width="160" height="14" fill="${color}"/>`
  ).join("\n  ");

  // Cars
  const cars = [
    `<rect x="10" y="24" width="28" height="10" rx="3" fill="#ff2222"/>`,
    `<rect x="60" y="24" width="28" height="10" rx="3" fill="#ffee00"/>`,
    `<rect x="110" y="24" width="28" height="10" rx="3" fill="#4488ff"/>`,
    `<rect x="30" y="38" width="22" height="10" rx="3" fill="#ff8800"/>`,
    `<rect x="90" y="38" width="22" height="10" rx="3" fill="#00ccff"/>`,
  ].join("\n  ");

  // Logs
  const logs = [
    `<rect x="5" y="52" width="40" height="10" rx="5" fill="#8B4513"/>`,
    `<rect x="65" y="52" width="40" height="10" rx="5" fill="#8B4513"/>`,
    `<rect x="20" y="66" width="55" height="10" rx="5" fill="#a0522d"/>`,
    `<rect x="100" y="66" width="40" height="10" rx="5" fill="#a0522d"/>`,
  ].join("\n  ");

  // Frog (on log)
  const frog = `<ellipse cx="45" cy="57" rx="7" ry="6" fill="#44ff44" filter="url(#glow-${id})"/>
  <circle cx="42" cy="53" r="2.5" fill="#33cc33"/>
  <circle cx="48" cy="53" r="2.5" fill="#33cc33"/>
  <circle cx="42" cy="53" r="1.2" fill="#000"/>
  <circle cx="48" cy="53" r="1.2" fill="#000"/>`;

  return bg + "\n  " + cars + "\n  " + logs + "\n  " + frog;
}

function asteroidsArt(id: string): string {
  // Stars
  const stars = Array.from({ length: 28 }, (_, i) => {
    const x = ((i * 47 + 13) % 155) + 3;
    const y = ((i * 31 + 7) % 90) + 3;
    const r = i % 3 === 0 ? 1.5 : 0.8;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" fill-opacity="${0.4 + (i % 4) * 0.15}"/>`;
  }).join("\n  ");

  // Asteroids (irregular polygons)
  function asteroid(cx: number, cy: number, r: number): string {
    const pts = 8;
    const points = Array.from({ length: pts }, (_, i) => {
      const angle = (i / pts) * Math.PI * 2;
      const jitter = r * (0.7 + ((i * 17 + cx) % 30) / 100);
      return `${(cx + Math.cos(angle) * jitter).toFixed(1)},${(cy + Math.sin(angle) * jitter).toFixed(1)}`;
    }).join(" ");
    return `<polygon points="${points}" fill="none" stroke="#aaaaff" stroke-width="1.5" filter="url(#glow-${id})"/>`;
  }

  const rocks = [
    asteroid(28, 24, 14),
    asteroid(120, 18, 10),
    asteroid(100, 62, 16),
    asteroid(30, 70, 9),
    asteroid(145, 52, 8),
  ].join("\n  ");

  // Ship triangle
  const ship = `<polygon points="80,40 72,58 80,54 88,58" fill="none" stroke="#ffffff" stroke-width="1.5" filter="url(#glow-${id})"/>`;

  // Thruster flame
  const flame = `<polygon points="78,56 80,65 82,56" fill="#ff6600" fill-opacity="0.8" filter="url(#glow2-${id})"/>`;

  // Laser dot
  const laser = `<circle cx="80" cy="28" r="2" fill="#ffffff" filter="url(#glow2-${id})"/>`;

  return stars + "\n  " + rocks + "\n  " + ship + "\n  " + flame + "\n  " + laser;
}

function art2048(id: string): string {
  // Main 2048 tile
  const main = `<rect x="32" y="18" width="96" height="62" rx="8" fill="#f65e3b" filter="url(#glow-${id})"/>
  <text x="80" y="62" font-family="monospace" font-size="28" font-weight="bold"
    fill="#ffffff" text-anchor="middle">2048</text>`;

  // Smaller tiles behind
  const smalls = [
    { x: 6, y: 10, w: 30, h: 22, text: "1024", color: "#f67c5f", fs: 8 },
    { x: 6, y: 38, w: 30, h: 22, text: "512", color: "#edcf72", fs: 9 },
    { x: 6, y: 66, w: 30, h: 22, text: "256", color: "#edcc61", fs: 9 },
    { x: 124, y: 10, w: 30, h: 22, text: "128", color: "#f0b27a", fs: 8 },
    { x: 124, y: 38, w: 30, h: 22, text: "64", color: "#f0a05a", fs: 9 },
    { x: 124, y: 66, w: 30, h: 22, text: "32", color: "#f09070", fs: 9 },
  ].map(({ x, y, w, h, text, color, fs }) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${color}" fill-opacity="0.7"/>
  <text x="${x + w / 2}" y="${y + h / 2 + fs / 3}" font-family="monospace" font-size="${fs}" font-weight="bold" fill="#fff" text-anchor="middle">${text}</text>`
  ).join("\n  ");

  return smalls + "\n  " + main;
}

function match3Art(id: string): string {
  const gems = [
    ["#ff2222", "#ff6666"],
    ["#2244ff", "#6688ff"],
    ["#22bb22", "#66ee66"],
    ["#ff22ff", "#ff88ff"],
    ["#ffcc00", "#ffe066"],
    ["#00ccff", "#88eeff"],
    ["#ff6600", "#ffaa44"],
    ["#9933ff", "#cc88ff"],
    ["#ff2222", "#ff6666"],
  ];

  const grid = Array.from({ length: 9 }, (_, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 32 + col * 34;
    const y = 12 + row * 28;
    const [fill, hi] = gems[i] ?? ["#888", "#aaa"];
    const isMatch = i === 3 || i === 4 || i === 5;
    return `<g filter="${isMatch ? `url(#glow2-${id})` : `url(#glow-${id})`}">
    <polygon points="${x},${y - 10} ${x + 10},${y} ${x},${y + 10} ${x - 10},${y}"
      fill="${fill}" stroke="${hi}" stroke-width="1.5"/>
    <polygon points="${x - 2},${y - 6} ${x + 4},${y} ${x - 2},${y + 4}"
      fill="${hi}" fill-opacity="0.4"/>
    ${isMatch ? `<circle cx="${x}" cy="${y}" r="13" fill="${fill}" fill-opacity="0.12"/>` : ""}
  </g>`;
  }).join("\n  ");

  return grid;
}

function flappyArt(id: string): string {
  // Sky gradient suggestion via layers
  const sky = `<rect x="0" y="0" width="160" height="100" fill="url(#grad-${id})"/>`;

  // Clouds
  const clouds = [
    `<ellipse cx="30" cy="25" rx="20" ry="10" fill="#ffffff" fill-opacity="0.85"/>`,
    `<ellipse cx="24" cy="25" rx="14" ry="8" fill="#ffffff" fill-opacity="0.85"/>`,
    `<ellipse cx="120" cy="18" rx="18" ry="9" fill="#ffffff" fill-opacity="0.75"/>`,
    `<ellipse cx="114" cy="18" rx="12" ry="7" fill="#ffffff" fill-opacity="0.75"/>`,
  ].join("\n  ");

  // Pipes
  const pipes = [
    `<rect x="95" y="0" width="22" height="42" rx="3" fill="#228B22"/>
  <rect x="93" y="38" width="26" height="8" rx="3" fill="#2E8B57"/>`,
    `<rect x="95" y="60" width="22" height="40" rx="3" fill="#228B22"/>
  <rect x="93" y="58" width="26" height="8" rx="3" fill="#2E8B57"/>`,
  ].join("\n  ");

  // Bird
  const bird = `<g filter="url(#glow-${id})">
    <ellipse cx="60" cy="50" rx="12" ry="10" fill="#ded895"/>
    <ellipse cx="67" cy="47" rx="6" ry="5" fill="#f0d060"/>
    <circle cx="69" cy="46" r="3" fill="white"/>
    <circle cx="70" cy="46" r="1.5" fill="#1a1a1a"/>
    <path d="M72 50 L80 48 L72 52 Z" fill="#ff7700"/>
    <ellipse cx="56" cy="44" rx="5" ry="3" fill="#c8b840" transform="rotate(-30 56 44)"/>
  </g>`;

  return sky + "\n  " + clouds + "\n  " + pipes + "\n  " + bird;
}

function minesweeperArt(id: string): string {
  // Grid 7x6
  const cellSize = 20;
  const startX = 10;
  const startY = 4;

  const contents: Record<string, string> = {
    "1,1": "1", "2,1": "2", "3,1": "1",
    "1,2": "3", "3,2": "2",
    "0,3": "1", "2,3": "1",
    "4,1": "F", "5,2": "M",
    "0,0": ".", "1,0": ".", "2,0": ".", "3,0": ".", "4,0": ".",
    "5,0": "?", "4,2": "?", "5,1": "?",
  };

  const numColors: Record<string, string> = {
    "1": "#0000ff", "2": "#008000", "3": "#ff0000", "4": "#000080",
  };

  const cells: string[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 7; col++) {
      const x = startX + col * cellSize;
      const y = startY + row * cellSize;
      const key = `${col},${row}`;
      const val = contents[key] ?? "";
      const isRevealed = val && val !== "?" && val !== "F";
      const cellFill = isRevealed ? "#c0c0c0" : "#909090";

      cells.push(`<rect x="${x}" y="${y}" width="${cellSize - 1}" height="${cellSize - 1}" rx="1" fill="${cellFill}" stroke="#808080" stroke-width="0.5"/>`);

      if (val === "F") {
        cells.push(`<text x="${x + 10}" y="${y + 14}" font-family="monospace" font-size="11" text-anchor="middle" fill="#ff0000">⚑</text>`);
      } else if (val === "M") {
        cells.push(`<circle cx="${x + 10}" cy="${y + 10}" r="6" fill="#111" filter="url(#glow-${id})"/>
  <circle cx="${x + 8}" cy="${y + 8}" r="2" fill="#555"/>
  <line x1="${x+4}" y1="${y+10}" x2="${x+16}" y2="${y+10}" stroke="#111" stroke-width="1.5"/>
  <line x1="${x+10}" y1="${y+4}" x2="${x+10}" y2="${y+16}" stroke="#111" stroke-width="1.5"/>
  <line x1="${x+6}" y1="${y+6}" x2="${x+14}" y2="${y+14}" stroke="#111" stroke-width="1.5"/>
  <line x1="${x+14}" y1="${y+6}" x2="${x+6}" y2="${y+14}" stroke="#111" stroke-width="1.5"/>`);
      } else if (val && val !== "." && val !== "?") {
        const nc = numColors[val] ?? "#333";
        cells.push(`<text x="${x + 10}" y="${y + 14}" font-family="monospace" font-size="11" font-weight="bold" text-anchor="middle" fill="${nc}">${val}</text>`);
      }
    }
  }

  return cells.join("\n  ");
}

function sudokuArt(id: string): string {
  // 9x9 grid, partial fill
  const numbers: (string | null)[][] = [
    ["5", "3", null, null, "7", null, null, null, null],
    ["6", null, null, "1", "9", "5", null, null, null],
    [null, "9", "8", null, null, null, null, "6", null],
    ["8", null, null, null, "6", null, null, null, "3"],
    ["4", null, null, "8", null, "3", null, null, "1"],
    ["7", null, null, null, "2", null, null, null, "6"],
    [null, "6", null, null, null, null, "2", "8", null],
    [null, null, null, "4", "1", "9", null, null, "5"],
    [null, null, null, null, "8", null, null, "7", "9"],
  ];

  const cell = 10;
  const ox = 5;
  const oy = 4;

  const cells: string[] = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const x = ox + c * cell;
      const y = oy + r * cell;
      const val = numbers[r]?.[c];
      if (val) {
        cells.push(`<text x="${x + cell / 2}" y="${y + cell - 2}" font-family="monospace" font-size="7" font-weight="bold" text-anchor="middle" fill="#4fc3f7" filter="url(#glow-${id})">${val}</text>`);
      }
    }
  }

  // Grid lines
  const gridLines: string[] = [];
  for (let i = 0; i <= 9; i++) {
    const w = i % 3 === 0 ? 1.2 : 0.4;
    const col = "#4fc3f7";
    gridLines.push(`<line x1="${ox + i * cell}" y1="${oy}" x2="${ox + i * cell}" y2="${oy + 9 * cell}" stroke="${col}" stroke-width="${w}" stroke-opacity="0.6"/>`);
    gridLines.push(`<line x1="${ox}" y1="${oy + i * cell}" x2="${ox + 9 * cell}" y2="${oy + i * cell}" stroke="${col}" stroke-width="${w}" stroke-opacity="0.6"/>`);
  }

  return gridLines.join("\n  ") + "\n  " + cells.join("\n  ");
}

function memoryArt(id: string): string {
  // Card grid 4x3
  const cardW = 34;
  const cardH = 26;
  const gap = 4;
  const ox = 4;
  const oy = 6;
  const symbols = ["★", "♥", "♦", "♣", "◆", "●"];
  const symColors = ["#ffee00", "#ff3366", "#ff8800", "#44ff44", "#00aaff", "#aa44ff"];

  const cards: string[] = [];
  let si = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const x = ox + col * (cardW + gap);
      const y = oy + row * (cardH + gap);
      const reveal = (row === 1 && col === 1) || (row === 1 && col === 2);
      const symIdx = reveal ? (si % symbols.length) : -1;
      if (reveal) si++;

      if (reveal) {
        const sym = symbols[symIdx] ?? "★";
        const color = symColors[symIdx] ?? "#fff";
        cards.push(`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="4" fill="#1a0a3a" stroke="${color}" stroke-width="1.5" filter="url(#glow-${id})"/>
  <text x="${x + cardW / 2}" y="${y + cardH / 2 + 6}" font-size="14" text-anchor="middle" fill="${color}" filter="url(#glow-${id})">${sym}</text>`);
      } else {
        // card back pattern
        cards.push(`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="4" fill="#2a1060" stroke="#6644aa" stroke-width="1"/>
  <rect x="${x + 3}" y="${y + 3}" width="${cardW - 6}" height="${cardH - 6}" rx="2" fill="none" stroke="#5533aa" stroke-width="0.7"/>
  <line x1="${x + 3}" y1="${y + 3}" x2="${x + cardW - 3}" y2="${y + cardH - 3}" stroke="#5533aa" stroke-width="0.5"/>
  <line x1="${x + cardW - 3}" y1="${y + 3}" x2="${x + 3}" y2="${y + cardH - 3}" stroke="#5533aa" stroke-width="0.5"/>`);
      }
    }
  }

  return cards.join("\n  ");
}

function puzzle15Art(id: string): string {
  const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0]; // 0 = empty
  const cellSize = 33;
  const ox = 14;
  const oy = 6;

  return order.map((num, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = ox + col * cellSize;
    const y = oy + row * cellSize;
    if (num === 0) {
      return `<rect x="${x}" y="${y}" width="${cellSize - 2}" height="${cellSize - 2}" rx="4" fill="#0f172a" stroke="#253040" stroke-width="1"/>`;
    }
    return `<rect x="${x}" y="${y}" width="${cellSize - 2}" height="${cellSize - 2}" rx="4" fill="#1e3a5f" stroke="#38bdf8" stroke-width="1.5" filter="url(#glow-${id})"/>
  <text x="${x + (cellSize - 2) / 2}" y="${y + (cellSize - 2) / 2 + 6}" font-family="monospace" font-size="14" font-weight="bold" text-anchor="middle" fill="#38bdf8">${num}</text>`;
  }).join("\n  ");
}

function lightsOutArt(id: string): string {
  // 5x5 grid, some on some off
  const state = [
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [1, 0, 0, 0, 1],
  ];

  const cellSize = 22;
  const ox = 22;
  const oy = 6;

  return state.flatMap((row, r) =>
    row.map((on, c) => {
      const x = ox + c * cellSize;
      const y = oy + r * cellSize;
      if (on) {
        return `<rect x="${x}" y="${y}" width="${cellSize - 2}" height="${cellSize - 2}" rx="3" fill="#ffee00" filter="url(#glow2-${id})"/>`;
      }
      return `<rect x="${x}" y="${y}" width="${cellSize - 2}" height="${cellSize - 2}" rx="3" fill="#1a1200" stroke="#3a3000" stroke-width="1"/>`;
    })
  ).join("\n  ");
}

function bubbleShooterArt(id: string): string {
  // Bubble grid at top
  type BubbleRow = [number, number, string][];
  const rows: BubbleRow[] = [
    [[16,14,"#ff2244"],[36,14,"#00ccff"],[56,14,"#22dd00"],[76,14,"#ff8800"],[96,14,"#aa22ff"],[116,14,"#ff2244"],[136,14,"#00ccff"]],
    [[26,28,"#22dd00"],[46,28,"#ff2244"],[66,28,"#aa22ff"],[86,28,"#00ccff"],[106,28,"#ff8800"],[126,28,"#22dd00"]],
    [[16,42,"#ff8800"],[36,42,"#aa22ff"],[56,42,"#ff2244"],[76,42,"#00ccff"],[96,42,"#22dd00"],[116,42,"#ff8800"]],
    [[26,56,"#00ccff"],[46,56,"#22dd00"],[66,56,"#ff2244"],[86,56,"#aa22ff"],[106,56,"#00ccff"]],
  ];

  const bubbles = rows.flatMap((row) =>
    row.map(([cx, cy, color]) =>
      `<circle cx="${cx}" cy="${cy}" r="10" fill="${color}" filter="url(#glow-${id})"/>
  <circle cx="${cx - 3}" cy="${cy - 3}" r="3" fill="#ffffff" fill-opacity="0.35"/>`
    )
  ).join("\n  ");

  // Shooter at bottom
  const shooter = `<polygon points="80,96 72,84 88,84" fill="#00ccff" filter="url(#glow-${id})"/>
  <rect x="76" y="88" width="8" height="6" rx="2" fill="#0066aa"/>`;

  // Aimed bubble with trail
  const trail = [
    [80, 78, 7, 0.3],
    [80, 66, 8, 0.5],
  ].map(([cx, cy, r, op]) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ff2244" fill-opacity="${op}"/>`
  ).join("\n  ");

  const aimBubble = `<circle cx="80" cy="72" r="10" fill="#ff2244" filter="url(#glow-${id})"/>
  <circle cx="77" cy="69" r="3" fill="#ffffff" fill-opacity="0.35"/>`;

  return bubbles + "\n  " + trail + "\n  " + aimBubble + "\n  " + shooter;
}

function tapRotateArt(id: string): string {
  // Background grid pulse lines
  const gridLines: string[] = [];
  for (let x2 = 0; x2 <= 160; x2 += 20)
    gridLines.push(`<line x1="${x2}" y1="0" x2="${x2}" y2="100" stroke="#4444aa" stroke-opacity="0.15" stroke-width="0.5"/>`);
  for (let y2 = 0; y2 <= 100; y2 += 20)
    gridLines.push(`<line x1="0" y1="${y2}" x2="160" y2="${y2}" stroke="#4444aa" stroke-opacity="0.15" stroke-width="0.5"/>`);

  // Arena border
  const arena = `<rect x="28" y="8" width="104" height="84" rx="2" fill="none" stroke="#ff3d68" stroke-opacity="0.3" stroke-width="1"/>`;

  // Player (center): blue circle + barrel pointing up
  const player = `<g filter="url(#glow-${id})">
    <circle cx="80" cy="50" r="9" fill="#1a3a8a" stroke="#4488ff" stroke-width="1.5"/>
    <rect x="77" y="30" width="6" height="16" rx="2" fill="#88aaff"/>
  </g>`;

  // Targeting ring
  const ring = `<circle cx="80" cy="50" r="24" fill="none" stroke="#ff3d68" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="4 3"/>`;

  // Rotating arrow (static at 45deg to suggest rotation)
  const rotArrow = `<g transform="translate(80,50)">
    <path d="M-30 0 A30 30 0 0 1 0 -30" fill="none" stroke="#ff3d68" stroke-width="2" stroke-opacity="0.7"/>
    <polygon points="0,-26 4,-34 -4,-34" fill="#ff3d68" fill-opacity="0.9"/>
  </g>`;

  // Enemies: runner (circle, red, top-right), tank (square, purple, left), swifty (triangle, yellow, bottom-right)
  const runner = `<circle cx="130" cy="22" r="8" fill="#ff3333" filter="url(#glow-${id})"/>`;
  const tank = `<rect x="18" y="42" width="18" height="18" rx="1" fill="#9933cc" filter="url(#glow-${id})"/>`;
  const swifty = `<polygon points="130,72 138,84 122,84" fill="#ffcc00" filter="url(#glow-${id})"/>`;

  // Bullet trails
  const bullets2 = [
    `<circle cx="80" cy="20" r="3" fill="#ffffff" filter="url(#glow-${id})" fill-opacity="0.9"/>`,
    `<circle cx="80" cy="14" r="2" fill="#ffffff" fill-opacity="0.4"/>`,
    `<circle cx="110" cy="30" r="2.5" fill="#ffffff" fill-opacity="0.6"/>`,
    `<circle cx="118" cy="24" r="1.5" fill="#ffffff" fill-opacity="0.3"/>`,
  ].join("\n  ");

  return gridLines.join("\n  ") + "\n  " + arena + "\n  " + ring + "\n  " + rotArrow + "\n  " + runner + "\n  " + tank + "\n  " + swifty + "\n  " + player + "\n  " + bullets2;
}

function trisArt(id: string): string {
  // 3x3 grid lines
  const gridLines = [
    `<line x1="16" y1="12" x2="144" y2="12" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>`,
    `<line x1="16" y1="46" x2="144" y2="46" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>`,
    `<line x1="16" y1="80" x2="144" y2="80" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>`,
    `<line x1="16" y1="14" x2="16" y2="82" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>`,
    `<line x1="59" y1="14" x2="59" y2="82" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>`,
    `<line x1="101" y1="14" x2="101" y2="82" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>`,
    `<line x1="144" y1="14" x2="144" y2="82" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>`,
  ].join("\n  ");

  // X at (0,0): cyan
  const xCy = "#00e5ff";
  const x1 = `<g filter="url(#glow-${id})">
    <line x1="25" y1="21" x2="50" y2="38" stroke="${xCy}" stroke-width="4" stroke-linecap="round"/>
    <line x1="50" y1="21" x2="25" y2="38" stroke="${xCy}" stroke-width="4" stroke-linecap="round"/>
  </g>`;

  // O at (1,1): magenta
  const oCl = "#ff40c8";
  const o1 = `<circle cx="80" cy="63" r="12" fill="none" stroke="${oCl}" stroke-width="4" filter="url(#glow-${id})"/>`;

  // X at (2,2): cyan (smaller glow = further from viewer)
  const x2 = `<g filter="url(#glow-${id})">
    <line x1="110" y1="55" x2="135" y2="72" stroke="${xCy}" stroke-width="4" stroke-linecap="round"/>
    <line x1="135" y1="55" x2="110" y2="72" stroke="${xCy}" stroke-width="4" stroke-linecap="round"/>
  </g>`;

  // O at (0,2): magenta
  const o2 = `<circle cx="37" cy="63" r="12" fill="none" stroke="${oCl}" stroke-width="4" filter="url(#glow-${id})"/>`;

  // Diagonal win line (top-right to bottom-left: 2,0 → 1,1 → 0,2) — gold
  const winLine = `<line x1="122" y1="29" x2="37" y2="63" stroke="#f6c24c" stroke-width="3.5" stroke-linecap="round" filter="url(#glow2-${id})" opacity="0.85"/>`;

  return gridLines + "\n  " + x1 + "\n  " + o1 + "\n  " + x2 + "\n  " + o2 + "\n  " + winLine;
}

// ---------- title overlay (common) ----------

function titleOverlay(title: string, fg: string): string {
  return `<text x="8" y="114" font-family="'Press Start 2P', ui-monospace, monospace"
    font-size="9" font-weight="bold" fill="${fg}" fill-opacity="0.95"
    letter-spacing="0.5">${title.toUpperCase()}</text>`;
}

// ---------- dispatch ----------

function artBody(entry: GameEntry): string {
  const { id, palette: { fg }, title } = entry;
  const base = (() => {
    switch (id) {
      case "snake": return snakeArt(id);
      case "tetris": return tetrisArt(id);
      case "pacman": return pacmanArt(id);
      case "breakout": return breakoutArt(id);
      case "invaders": return invadersArt(id);
      case "frogger": return froggerArt(id);
      case "asteroids": return asteroidsArt(id);
      case "2048": return art2048(id);
      case "match3": return match3Art(id);
      case "flappy": return flappyArt(id);
      case "minesweeper": return minesweeperArt(id);
      case "sudoku": return sudokuArt(id);
      case "memory": return memoryArt(id);
      case "15puzzle": return puzzle15Art(id);
      case "lights-out": return lightsOutArt(id);
      case "bubble-shooter": return bubbleShooterArt(id);
      case "tap-rotate": return tapRotateArt(id);
      case "tris": return trisArt(id);
      default: return defaultArt(id, entry.palette.accent);
    }
  })();
  return base + "\n  " + titleOverlay(title, fg);
}

function defaultArt(id: string, accent: string): string {
  return `<rect x="20" y="20" width="120" height="60" rx="8" fill="${accent}" fill-opacity="0.3" filter="url(#glow-${id})"/>`;
}

// ---------- public API ----------

export function renderCover(entry: GameEntry): string {
  const { id, palette: { bg, fg, accent } } = entry;
  return wrap(id, bg, fg, accent, artBody(entry));
}

export function mountCover(container: HTMLElement, entry: GameEntry): void {
  container.innerHTML = renderCover(entry);
}
