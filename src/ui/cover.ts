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

function mergeArenaArt(id: string): string {
  // Subtle grid
  const gridLines: string[] = [];
  for (let x2 = 0; x2 <= 160; x2 += 20)
    gridLines.push(`<line x1="${x2}" y1="0" x2="${x2}" y2="100" stroke="#ff00aa" stroke-opacity="0.08" stroke-width="0.5"/>`);
  for (let y2 = 0; y2 <= 100; y2 += 20)
    gridLines.push(`<line x1="0" y1="${y2}" x2="160" y2="${y2}" stroke="#ff00aa" stroke-opacity="0.08" stroke-width="0.5"/>`);

  // Turret tiles in a 3x2 grid at the bottom
  const turretData: [number, string, string][] = [
    [1, "#888888", ""],
    [2, "#44aaff", ""],
    [4, "#ffcc00", ""],
    [3, "#22cc22", ""],
    [5, "#ff6600", ""],
    [6, "#ff2222", ""],
  ];
  const slotW = 28; const slotH = 18; const gapX = 6; const gapY = 5;
  const startX = 16; const startY = 62;
  const tiles = turretData.map(([lv, color], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * (slotW + gapX);
    const y = startY + row * (slotH + gapY);
    return `<rect x="${x}" y="${y}" width="${slotW}" height="${slotH}" rx="3" fill="${color}" filter="url(#glow-${id})"/>
  <text x="${x + slotW / 2}" y="${y + 12}" font-family="monospace" font-size="7" font-weight="bold" text-anchor="middle" fill="rgba(0,0,0,0.75)">LV${lv}</text>`;
  }).join("\n  ");

  // Merged big turret (LV10 / rainbow-ish) centre-right
  const bigTurret = `<rect x="116" y="60" width="34" height="32" rx="5" fill="#ffff00" filter="url(#glow2-${id})"/>
  <text x="133" y="80" font-family="monospace" font-size="9" font-weight="bold" text-anchor="middle" fill="rgba(0,0,0,0.8)">LV10</text>`;

  // Enemies descending in combat zone
  const enemies2 = [
    `<circle cx="40" cy="18" r="8" fill="#ff4444" filter="url(#glow-${id})"/>`,
    `<polygon points="80,10 87,22 73,22" fill="#ffcc00" filter="url(#glow-${id})"/>`,
    `<rect x="108" y="14" width="16" height="16" rx="2" fill="#aa44ff" filter="url(#glow-${id})"/>`,
    `<circle cx="140" cy="30" r="6" fill="#ff4444" filter="url(#glow-${id})"/>`,
  ].join("\n  ");

  // Bullet trails from turrets to enemies
  const bulletTrails = [
    `<line x1="29" y1="62" x2="40" y2="26" stroke="#ffe066" stroke-opacity="0.7" stroke-width="1.5" filter="url(#glow-${id})"/>`,
    `<line x1="63" y1="62" x2="80" y2="22" stroke="#ffe066" stroke-opacity="0.7" stroke-width="1.5" filter="url(#glow-${id})"/>`,
    `<line x1="133" y1="60" x2="116" y2="30" stroke="#ffe066" stroke-opacity="0.9" stroke-width="2" filter="url(#glow2-${id})"/>`,
  ].join("\n  ");

  // Slot borders
  const slotBorders = Array.from({ length: 6 }, (_, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * (slotW + gapX) - 1;
    const y = startY + row * (slotH + gapY) - 1;
    return `<rect x="${x}" y="${y}" width="${slotW + 2}" height="${slotH + 2}" rx="4" fill="none" stroke="#ff00aa" stroke-opacity="0.3" stroke-width="0.8"/>`;
  }).join("\n  ");

  return gridLines.join("\n  ") + "\n  " + enemies2 + "\n  " + bulletTrails + "\n  " + slotBorders + "\n  " + tiles + "\n  " + bigTurret;
}

function connect4Art(id: string): string {
  // 7×6 mini board, accent #ffcc00, red #ff3333
  const cols = 7;
  const rows = 6;
  const cellR = 8;
  const gapX = 20;
  const gapY = 14;
  const ox = 11;
  const oy = 5;

  // Board background
  const bg = `<rect x="${ox - 4}" y="${oy - 4}" width="${cols * gapX}" height="${rows * gapY + 4}" rx="5" fill="#0b2d4a"/>`;

  // Discs layout (col,row) 0-indexed, row 0 = bottom, rendered top-to-bottom
  const p1: [number, number][] = [[0,0],[1,0],[2,0],[3,0],[1,1],[2,2],[3,3]];
  const p2: [number, number][] = [[0,1],[1,2],[2,1],[4,0],[5,0],[3,1]];
  // winning diagonal ↗: col 0-3, row 0-3 → P1
  const winCoords: [number, number][] = [[0,0],[1,1],[2,2],[3,3]];

  const cells: string[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      const cx = ox + c * gapX + cellR;
      const cy = oy + (rows - 1 - r) * gapY + cellR;
      const isP1 = p1.some(([pc, pr]) => pc === c && pr === r);
      const isP2 = p2.some(([pc, pr]) => pc === c && pr === r);
      const isWin = winCoords.some(([wc, wr]) => wc === c && wr === r);
      let fill = "#0d2238";
      let gfilter = "";
      if (isP1) { fill = "#ffcc00"; gfilter = isWin ? ` filter="url(#glow2-${id})"` : ` filter="url(#glow-${id})"`; }
      if (isP2) { fill = "#ff3333"; gfilter = ` filter="url(#glow-${id})"`; }
      cells.push(`<circle cx="${cx}" cy="${cy}" r="${cellR - 1}" fill="${fill}"${gfilter}/>`);
    }
  }

  // Win line across the 4 highlighted cells
  const w0 = winCoords[0]!;
  const w3 = winCoords[winCoords.length - 1]!;
  const wx1 = ox + w0[0] * gapX + cellR;
  const wy1 = oy + (rows - 1 - w0[1]) * gapY + cellR;
  const wx2 = ox + w3[0] * gapX + cellR;
  const wy2 = oy + (rows - 1 - w3[1]) * gapY + cellR;
  const winLine = `<line x1="${wx1}" y1="${wy1}" x2="${wx2}" y2="${wy2}" stroke="#ffcc00" stroke-width="3" stroke-linecap="round" filter="url(#glow2-${id})" opacity="0.85"/>`;

  return bg + "\n  " + cells.join("\n  ") + "\n  " + winLine;
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

function colorMatchShooterArt(id: string): string {
  // Dark grid
  const gridLines: string[] = [];
  for (let x2 = 0; x2 <= 160; x2 += 20)
    gridLines.push(`<line x1="${x2}" y1="0" x2="${x2}" y2="100" stroke="#2222aa" stroke-opacity="0.15" stroke-width="0.5"/>`);
  for (let y2 = 0; y2 <= 100; y2 += 20)
    gridLines.push(`<line x1="0" y1="${y2}" x2="160" y2="${y2}" stroke="#2222aa" stroke-opacity="0.15" stroke-width="0.5"/>`);

  // Descending enemies: circle (red), square (cyan), triangle (yellow)
  const enemies3 = [
    `<circle cx="36" cy="24" r="12" fill="#ff3333" filter="url(#glow-${id})"/>`,
    `<rect x="70" y="14" width="24" height="24" rx="1" fill="#00eeff" filter="url(#glow-${id})"/>`,
    `<polygon points="124,10 136,30 112,30" fill="#ffe600" filter="url(#glow-${id})"/>`,
  ].join("\n  ");

  // Player cannon at bottom-center
  const player = `<g filter="url(#glow-${id})">
    <circle cx="80" cy="86" r="8" fill="#0d0d2a" stroke="#00eeff" stroke-width="2"/>
    <rect x="77" y="68" width="6" height="12" rx="2" fill="#00eeff"/>
  </g>`;

  // Cyan bullet going up toward cyan square (auto-aim feel)
  const bullet = `<rect x="78" y="50" width="4" height="10" rx="2" fill="#00eeff" filter="url(#glow-${id})"/>`;

  // Color bar buttons at the very bottom
  const barBg = `<rect x="0" y="90" width="160" height="10" fill="rgba(0,0,0,0.5)"/>`;
  const btnRed    = `<rect x="4"  y="91" width="44" height="8" rx="2" fill="#ff3333" filter="url(#glow-${id})"/>`;
  const btnCyan   = `<rect x="58" y="91" width="44" height="8" rx="2" fill="#00eeff" filter="url(#glow-${id})"/>`;
  const btnYellow = `<rect x="112" y="91" width="44" height="8" rx="2" fill="#ffe600" filter="url(#glow-${id})"/>`;

  // Cyan button active glow ring
  const activering = `<rect x="57" y="90" width="46" height="10" rx="3" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.8"/>`;

  return gridLines.join("\n  ") + "\n  " + enemies3 + "\n  " + bullet + "\n  " + player
    + "\n  " + barBg + "\n  " + btnRed + "\n  " + btnCyan + "\n  " + btnYellow + "\n  " + activering;
}

function tapRaceArt(id: string): string {
  // Split screen: bottom green (GO), top purple (P2 rotated)
  const topHalf = `<rect x="0" y="0" width="160" height="48" fill="#2a003a"/>`;
  const botHalf = `<rect x="0" y="52" width="160" height="48" fill="#0a2a0a"/>`;
  const divLine = `<rect x="0" y="48" width="160" height="4" fill="#111"/>`;

  // Timer bar in divider
  const timerBg = `<rect x="4" y="50" width="152" height="2" rx="1" fill="rgba(255,255,255,0.12)"/>`;
  const timerFg = `<rect x="4" y="50" width="80" height="2" rx="1" fill="#ff44ff" filter="url(#glow-${id})"/>`;

  // P2 (top) — tap count and label (would be rotated in game)
  const countP2 = `<text x="80" y="35" font-family="monospace" font-size="26" font-weight="bold"
    fill="#cc44cc" text-anchor="middle" filter="url(#glow-${id})">23</text>`;
  const labelP2 = `<text x="80" y="14" font-family="monospace" font-size="7" font-weight="bold"
    fill="#ff44ff" text-anchor="middle" letter-spacing="3" filter="url(#glow-${id})">TAP!</text>`;

  // P1 (bottom) — higher tap count, winning
  const countP1 = `<text x="80" y="87" font-family="monospace" font-size="26" font-weight="bold"
    fill="#44ff66" text-anchor="middle" filter="url(#glow-${id})">31</text>`;
  const labelP1 = `<text x="80" y="70" font-family="monospace" font-size="7" font-weight="bold"
    fill="#44ff66" text-anchor="middle" letter-spacing="3" filter="url(#glow-${id})">TAP!</text>`;

  // Finger ripple hints on each side
  const rippleTop = `<circle cx="80" cy="24" r="16" fill="none" stroke="#ff44ff" stroke-width="1" stroke-opacity="0.3"/>
  <circle cx="80" cy="24" r="22" fill="none" stroke="#ff44ff" stroke-width="0.5" stroke-opacity="0.15"/>`;
  const rippleBot = `<circle cx="80" cy="76" r="16" fill="none" stroke="#44ff66" stroke-width="1" stroke-opacity="0.4"/>
  <circle cx="80" cy="76" r="22" fill="none" stroke="#44ff66" stroke-width="0.5" stroke-opacity="0.2"/>`;

  return topHalf + "\n  " + botHalf + "\n  " + divLine + "\n  "
    + timerBg + "\n  " + timerFg + "\n  "
    + rippleTop + "\n  " + rippleBot + "\n  "
    + countP2 + "\n  " + labelP2 + "\n  "
    + countP1 + "\n  " + labelP1;
}

function damaArt(id: string): string {
  const lightSq = "#e8c98a";
  const darkSq  = "#6b3a1f";
  const p1Fill  = "#f5e6c8";
  const p2Fill  = "#4a2418";
  const gold    = "#f5c518";

  // 8x8 board, cell size ~11, origin 8,4
  const cellW = 18;
  const cellH = 11;
  const ox = 8;
  const oy = 4;

  const cells: string[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const x = ox + c * cellW;
      const y = oy + r * cellH;
      const dark = (r + c) % 2 === 1;
      cells.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${dark ? darkSq : lightSq}"/>`);
    }
  }

  // pieces: P2 (dark) rows 0-2, P1 (light) rows 5-7, only playable (r+c odd)
  const pieces: string[] = [];
  function piece(r: number, c: number, player: 1 | 2, king: boolean): void {
    if ((r + c) % 2 !== 1) return;
    const cx = ox + c * cellW + cellW / 2;
    const cy = oy + r * cellH + cellH / 2;
    const rr = 4.2;
    const fill   = player === 1 ? p1Fill : p2Fill;
    const stroke = player === 1 ? "#3a2010" : p1Fill;
    pieces.push(`<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${fill}" stroke="${stroke}" stroke-width="0.8"${king ? ` filter="url(#glow-${id})"` : ""}/>`);
    if (king) {
      pieces.push(`<text x="${cx}" y="${cy + 2}" font-size="5" text-anchor="middle" fill="${gold}" font-weight="bold">♛</text>`);
    }
  }

  // P2 pieces (top, dark)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 8; c++) piece(r, c, 2, false);

  // P1 pieces (bottom, light) — row 5 has a king
  for (let r = 5; r < 8; r++)
    for (let c = 0; c < 8; c++) piece(r, c, 1, r === 5 && c === 2);

  // A selected piece glow: P1 at (5,4)
  const selCx = ox + 4 * cellW + cellW / 2;
  const selCy = oy + 5 * cellH + cellH / 2;
  const selGlow = `<circle cx="${selCx}" cy="${selCy}" r="5.5" fill="none" stroke="${gold}" stroke-width="1.5" filter="url(#glow-${id})"/>`;

  // A hint dot for valid move at (4,3)
  const hintCx = ox + 3 * cellW + cellW / 2;
  const hintCy = oy + 4 * cellH + cellH / 2;
  const hintDot = `<circle cx="${hintCx}" cy="${hintCy}" r="2.5" fill="${gold}" fill-opacity="0.7"/>`;

  return cells.join("\n  ") + "\n  " + pieces.join("\n  ") + "\n  " + selGlow + "\n  " + hintDot;
}

function reactionDuelArt(id: string): string {
  // Split screen: top half red (P2 waiting), bottom half green (GO)
  const topHalf = `<rect x="0" y="0" width="160" height="48" fill="#aa2222"/>`;
  const botHalf = `<rect x="0" y="52" width="160" height="48" fill="#22aa22"/>`;
  const divLine = `<rect x="0" y="48" width="160" height="4" fill="#111"/>`;

  // VS label in divider
  const vsText = `<text x="80" y="52.5" font-family="monospace" font-size="4" font-weight="bold"
    fill="rgba(255,255,255,0.4)" text-anchor="middle" dominant-baseline="middle"
    letter-spacing="2">VS</text>`;

  // P2 tap circle (top, rotated — show as outline/waiting)
  const circleP2 = `<circle cx="80" cy="24" r="14" fill="none" stroke="#ff8888" stroke-width="2.5"
    filter="url(#glow-${id})" stroke-dasharray="5 3"/>
  <text x="80" y="28" font-family="monospace" font-size="8" font-weight="bold"
    fill="#ff8888" text-anchor="middle">WAIT</text>`;

  // P1 tap circle (bottom, green/active)
  const circleP1 = `<circle cx="80" cy="76" r="14" fill="#22aa22" stroke="#44ff66" stroke-width="2.5"
    filter="url(#glow2-${id})"/>
  <text x="80" y="80" font-family="monospace" font-size="8" font-weight="bold"
    fill="#ffffff" text-anchor="middle">TAP!</text>`;

  // Finger/tap ripple on P1 side
  const ripple1 = `<circle cx="80" cy="76" r="20" fill="none" stroke="#44ff66" stroke-width="1"
    stroke-opacity="0.4"/>`;
  const ripple2 = `<circle cx="80" cy="76" r="26" fill="none" stroke="#44ff66" stroke-width="0.5"
    stroke-opacity="0.2"/>`;

  // Reaction time label suggestion bottom-right
  const msLabel = `<text x="148" y="94" font-family="monospace" font-size="6"
    fill="#44ff66" text-anchor="end" fill-opacity="0.8">142 ms</text>`;

  return topHalf + "\n  " + botHalf + "\n  " + divLine + "\n  " + vsText + "\n  "
    + circleP2 + "\n  " + circleP1 + "\n  " + ripple1 + "\n  " + ripple2 + "\n  " + msLabel;
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
      case "merge-arena": return mergeArenaArt(id);
      case "color-match-shooter": return colorMatchShooterArt(id);
      case "tris": return trisArt(id);
      case "dama": return damaArt(id);
      case "reaction-duel": return reactionDuelArt(id);
      case "tap-race": return tapRaceArt(id);
      case "connect4": return connect4Art(id);
      case "chain-reaction": return chainReactionArt(id);
      case "chain-blast": return chainBlastArt(id);
      case "crypt-run": return cryptRunArt(id);
      case "one-bullet": return oneBulletArt(id);
      case "brick-buster": return brickBusterArt(id);
      case "gem-cascade": return gemCascadeArt(id);
      case "color-flow": return colorFlowArt(id);
      case "block-fit": return blockFitArt(id);
      case "star-void": return starVoidArt(id);
      case "drop-stack": return dropStackArt(id);
      default: return defaultArt(id, entry.palette.accent);
    }
  })();
  return base + "\n  " + titleOverlay(title, fg);
}

function chainBlastArt(id: string): string {
  // Floating bubbles + central explosion + ring + chain of exploded bubbles
  // Use a dark rect + radial overlay for the background (gradient defined in extraDefs via grad-id)
  const bg = `<rect width="160" height="100" fill="#160814"/>
  <rect width="160" height="100" fill="url(#grad-${id})" fill-opacity="0.25"/>`;

  // Central explosion ring
  const ring1 = `<circle cx="80" cy="50" r="28" fill="none" stroke="#ff6600" stroke-width="2.5" stroke-opacity="0.9" filter="url(#glow2-${id})"/>`;
  const ring2 = `<circle cx="80" cy="50" r="18" fill="none" stroke="#ffcc00" stroke-width="1.5" stroke-opacity="0.6" filter="url(#glow-${id})"/>`;
  const core  = `<circle cx="80" cy="50" r="8" fill="#ffcc00" filter="url(#glow2-${id})"/>`;

  // Chain of exploded bubbles radiating from center
  const chain: string[] = [
    `<circle cx="110" cy="38" r="11" fill="#ff3333" fill-opacity="0.85" filter="url(#glow-${id})"/>`,
    `<circle cx="125" cy="24" r="9"  fill="#ff3333" fill-opacity="0.5"  filter="url(#glow-${id})"/>`,
    `<circle cx="52"  cy="32" r="10" fill="#00e5ff" fill-opacity="0.85" filter="url(#glow-${id})"/>`,
    `<circle cx="38"  cy="20" r="8"  fill="#00e5ff" fill-opacity="0.5"  filter="url(#glow-${id})"/>`,
    `<circle cx="108" cy="68" r="10" fill="#ffee00" fill-opacity="0.85" filter="url(#glow-${id})"/>`,
    `<circle cx="52"  cy="72" r="11" fill="#ff44ff" fill-opacity="0.85" filter="url(#glow-${id})"/>`,
  ];

  // Gloss on live bubbles
  const gloss: string[] = [
    `<circle cx="107" cy="35" r="3" fill="#ffffff" fill-opacity="0.3"/>`,
    `<circle cx="50"  cy="29" r="2.5" fill="#ffffff" fill-opacity="0.3"/>`,
    `<circle cx="106" cy="65" r="2.5" fill="#ffffff" fill-opacity="0.3"/>`,
    `<circle cx="50"  cy="69" r="3" fill="#ffffff" fill-opacity="0.3"/>`,
  ];

  // Spark particles
  const sparks: string[] = [];
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  for (const a of angles) {
    const rad = (a * Math.PI) / 180;
    const x1 = (80 + Math.cos(rad) * 10).toFixed(1);
    const y1 = (50 + Math.sin(rad) * 10).toFixed(1);
    const x2 = (80 + Math.cos(rad) * 22).toFixed(1);
    const y2 = (50 + Math.sin(rad) * 22).toFixed(1);
    sparks.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffcc00" stroke-width="1.5" stroke-opacity="0.7" filter="url(#glow-${id})"/>`);
  }

  return bg + "\n  " + chain.join("\n  ") + "\n  " + gloss.join("\n  ") + "\n  " + sparks.join("\n  ") + "\n  " + ring1 + "\n  " + ring2 + "\n  " + core;
}

function cryptRunArt(id: string): string {
  // Night sky with stars
  const stars: string[] = [];
  for (let i = 0; i < 22; i++) {
    const sx = ((i * 53 + 11) % 154) + 4;
    const sy = ((i * 37 + 5) % 48) + 4;
    const sr = i % 4 === 0 ? 1.2 : 0.6;
    stars.push(`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="#ffffff" fill-opacity="${0.4 + (i % 3) * 0.2}"/>`);
  }

  // Moon
  const moon = `<circle cx="130" cy="14" r="9" fill="#e8d4b0" fill-opacity="0.9"/>
  <circle cx="133" cy="12" r="7" fill="#14041a"/>`;

  // Ground strip
  const ground = `<rect x="0" y="70" width="160" height="30" fill="#1e0b28"/>
  <rect x="0" y="70" width="160" height="3" fill="#2e1040"/>`;

  // Headstones
  const graves = [
    `<rect x="18" y="58" width="12" height="14" rx="6" fill="#3a2048" stroke="#6030a0" stroke-width="0.8"/>
  <rect x="21" y="68" width="6" height="5" fill="#3a2048"/>
  <line x1="24" y1="60" x2="24" y2="68" stroke="#6030a0" stroke-width="0.7"/>
  <line x1="20" y1="63" x2="28" y2="63" stroke="#6030a0" stroke-width="0.7"/>`,
    `<rect x="55" y="55" width="14" height="16" rx="7" fill="#3a2048" stroke="#6030a0" stroke-width="0.8"/>
  <rect x="58" y="67" width="8" height="6" fill="#3a2048"/>`,
    `<rect x="126" y="60" width="11" height="13" rx="5" fill="#3a2048" stroke="#6030a0" stroke-width="0.8"/>
  <rect x="129" y="70" width="5" height="4" fill="#3a2048"/>`,
  ].join("\n  ");

  // Silhouette castle towers in background
  const castle = `<rect x="88" y="28" width="10" height="42" fill="#1a0828"/>
  <rect x="85" y="22" width="4" height="8" fill="#1a0828"/>
  <rect x="91" y="22" width="4" height="8" fill="#1a0828"/>
  <rect x="97" y="22" width="4" height="8" fill="#1a0828"/>
  <rect x="104" y="32" width="8" height="38" fill="#1a0828"/>
  <rect x="102" y="26" width="3" height="8" fill="#1a0828"/>
  <rect x="107" y="26" width="3" height="8" fill="#1a0828"/>`;

  // Knight player — pixel style, jumping
  const knightX = 46;
  const knightY = 46;
  const knight = `<g filter="url(#glow-${id})">
    <rect x="${knightX - 5}" y="${knightY - 14}" width="10" height="8" rx="1" fill="#888aaa"/>
    <rect x="${knightX - 3}" y="${knightY - 10}" width="6" height="3" fill="#222" fill-opacity="0.8"/>
    <rect x="${knightX - 5}" y="${knightY - 6}" width="10" height="12" rx="1" fill="#4466aa"/>
    <rect x="${knightX - 7}" y="${knightY - 4}" width="4" height="8" rx="1" fill="#3355aa"/>
    <rect x="${knightX + 3}" y="${knightY - 4}" width="4" height="8" rx="1" fill="#3355aa"/>
    <rect x="${knightX - 4}" y="${knightY + 6}" width="3" height="8" fill="#334466"/>
    <rect x="${knightX + 1}" y="${knightY + 6}" width="3" height="8" fill="#334466"/>
    <rect x="${knightX + 4}" y="${knightY - 6}" width="14" height="2" rx="1" fill="#ccddff"/>
  </g>`;

  // Bat
  const batX = 76;
  const batY = 32;
  const bat = `<g filter="url(#glow-${id})">
    <ellipse cx="${batX}" cy="${batY}" rx="4" ry="3.5" fill="#cc3300"/>
    <path d="M${batX - 4} ${batY} Q${batX - 10} ${batY - 8} ${batX - 14} ${batY - 2} Q${batX - 10} ${batY - 1} ${batX - 4} ${batY}" fill="#aa2200"/>
    <path d="M${batX + 4} ${batY} Q${batX + 10} ${batY - 8} ${batX + 14} ${batY - 2} Q${batX + 10} ${batY - 1} ${batX + 4} ${batY}" fill="#aa2200"/>
    <circle cx="${batX - 2}" cy="${batY - 1}" r="1" fill="#ff3300"/>
    <circle cx="${batX + 2}" cy="${batY - 1}" r="1" fill="#ff3300"/>
  </g>`;

  // Zombie approaching
  const zombieX = 140;
  const zombieY = 58;
  const zombie = `<g filter="url(#glow-${id})">
    <circle cx="${zombieX}" cy="${zombieY - 10}" r="5" fill="#55aa55"/>
    <rect x="${zombieX - 4}" y="${zombieY - 5}" width="8" height="9" fill="#448844"/>
    <rect x="${zombieX - 6}" y="${zombieY - 4}" width="3" height="6" fill="#448844"/>
    <rect x="${zombieX + 3}" y="${zombieY - 3}" width="3" height="6" fill="#448844"/>
    <rect x="${zombieX - 3}" y="${zombieY + 4}" width="2" height="7" fill="#336633"/>
    <rect x="${zombieX + 1}" y="${zombieY + 4}" width="2" height="7" fill="#336633"/>
  </g>`;

  // Orange accent coins
  const coins = [
    `<circle cx="34" cy="45" r="3" fill="#ff5722" filter="url(#glow-${id})" fill-opacity="0.9"/>`,
    `<circle cx="50" cy="38" r="3" fill="#ff5722" filter="url(#glow-${id})" fill-opacity="0.7"/>`,
    `<circle cx="66" cy="42" r="3" fill="#ff5722" filter="url(#glow-${id})" fill-opacity="0.8"/>`,
  ].join("\n  ");

  return stars.join("\n  ") + "\n  " + moon + "\n  " + castle + "\n  " + ground + "\n  " + graves + "\n  " + bat + "\n  " + zombie + "\n  " + coins + "\n  " + knight;
}

function oneBulletArt(id: string): string {
  // Dark arena + zigzag bullet trail + targets
  const bg = `<rect width="160" height="100" fill="#0a1210"/>`;

  // Subtle grid
  const grid: string[] = [];
  for (let x = 0; x <= 160; x += 16)
    grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="100" stroke="#d9f8e4" stroke-opacity="0.04" stroke-width="0.5"/>`);
  for (let y = 0; y <= 100; y += 16)
    grid.push(`<line x1="0" y1="${y}" x2="160" y2="${y}" stroke="#d9f8e4" stroke-opacity="0.04" stroke-width="0.5"/>`);

  // Wall obstacle
  const wall = `<rect x="64" y="28" width="8" height="36" rx="1" fill="#1a3a5c"/>
  <rect x="64" y="28" width="8" height="3" fill="rgba(100,180,255,0.25)"/>`;

  // Zigzag bullet trail: cannon bottom-center → bounce on right wall → bounce on left wall → target
  const trail = `<polyline points="80,90 120,38 40,22 90,14"
    fill="none" stroke="#ffd166" stroke-width="1.5" stroke-dasharray="4 4"
    stroke-opacity="0.7" filter="url(#glow-${id})"/>`;

  // Bounce flash marks
  const b1 = `<circle cx="120" cy="38" r="4" fill="#ffd166" fill-opacity="0.55" filter="url(#glow-${id})"/>`;
  const b2 = `<circle cx="40"  cy="22" r="4" fill="#ffd166" fill-opacity="0.55" filter="url(#glow-${id})"/>`;

  // Targets (green circles with glow)
  const t1 = `<circle cx="90" cy="14" r="7" fill="#1a5c2a" stroke="#44ff88" stroke-width="1.5" filter="url(#glow-${id})"/>
  <circle cx="90" cy="14" r="2.2" fill="#d9f8e4"/>`;
  const t2 = `<circle cx="26" cy="50" r="7" fill="#1a5c2a" stroke="#44ff88" stroke-width="1.5" filter="url(#glow-${id})"/>
  <circle cx="26" cy="50" r="2.2" fill="#d9f8e4"/>`;
  const t3 = `<circle cx="140" cy="62" r="7" fill="#1a5c2a" stroke="#44ff88" stroke-width="1.5" filter="url(#glow-${id})"/>
  <circle cx="140" cy="62" r="2.2" fill="#d9f8e4"/>`;

  // Bullet head at start of trail
  const bulletDot = `<circle cx="80" cy="90" r="4" fill="#ffffff" filter="url(#glow2-${id})"/>`;

  // Cannon base
  const cannon = `<rect x="76" y="84" width="14" height="5" rx="2" fill="#ffd166" filter="url(#glow-${id})"/>
  <circle cx="80" cy="93" r="6" fill="#2a4a3a" stroke="#ffd166" stroke-width="1.5"/>`;

  return (
    bg + "\n  " +
    grid.join("\n  ") + "\n  " +
    wall + "\n  " +
    trail + "\n  " +
    b1 + "\n  " + b2 + "\n  " +
    t1 + "\n  " + t2 + "\n  " + t3 + "\n  " +
    bulletDot + "\n  " +
    cannon
  );
}

function brickBusterArt(id: string): string {
  // Bricks: 6 rows × 8 cols in top portion of viewBox (160×100 play area)
  const brickColors = ["#ff3333", "#ff8800", "#ffee00", "#22cc55", "#2277ff", "#aa33ff"];
  const brickW = 17;
  const brickH = 8;
  const gapX = 2;
  const gapY = 2;
  const ox = 4;
  const oy = 4;

  const bricks: string[] = [];
  for (let row = 0; row < 6; row++) {
    const color = brickColors[row] ?? "#888";
    for (let col = 0; col < 8; col++) {
      const x = ox + col * (brickW + gapX);
      const y = oy + row * (brickH + gapY);
      bricks.push(
        `<rect x="${x}" y="${y}" width="${brickW}" height="${brickH}" rx="1.5" fill="${color}" stroke="#000" stroke-width="0.4" filter="url(#glow-${id})"/>` +
        `\n  <rect x="${x + 2}" y="${y + 1}" width="${brickW - 4}" height="2" fill="rgba(255,255,255,0.28)"/>`
      );
    }
  }

  // Ball trail
  const trail = [
    `<circle cx="62" cy="84" r="3" fill="#ffffff" fill-opacity="0.18"/>`,
    `<circle cx="65" cy="79" r="4" fill="#ffffff" fill-opacity="0.35"/>`,
    `<circle cx="69" cy="73" r="5.5" fill="#ffffff" fill-opacity="0.55" filter="url(#glow-${id})"/>`,
  ].join("\n  ");

  // Ball
  const ball = `<circle cx="73" cy="67" r="7" fill="#ffffff" filter="url(#glow2-${id})"/>`;

  // Paddle (orange gradient approximated with two rects + border)
  const paddleX = 44;
  const paddleY = 91;
  const paddleW = 72;
  const paddleH = 7;
  const paddle = `<rect x="${paddleX}" y="${paddleY}" width="${paddleW}" height="${paddleH}" rx="3" fill="#ff6600" filter="url(#glow-${id})"/>
  <rect x="${paddleX + 2}" y="${paddleY + 1}" width="${paddleW - 4}" height="2" fill="rgba(255,200,100,0.45)"/>
  <rect x="${paddleX}" y="${paddleY}" width="${paddleW}" height="${paddleH}" rx="3" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="0.8"/>`;

  return bricks.join("\n  ") + "\n  " + trail + "\n  " + ball + "\n  " + paddle;
}

function gemCascadeArt(id: string): string {
  // 5x5 mini gem grid with 3 highlighted gems in a row
  const gemColors = ["#ff3344", "#00eeff", "#ffee00", "#44ff66", "#aa44ff", "#ff8822"];
  const shapes = ["rhombus", "circle", "triangle", "pentagon", "star", "hexagon"];
  const cellSize = 16;
  const gap = 2;
  const ox = 20;
  const oy = 8;

  // fixed layout for cover: 5x5 grid with row 2 cols 1-3 highlighted (match-3)
  const layout: number[][] = [
    [0, 1, 2, 3, 4],
    [5, 3, 0, 1, 2],
    [1, 4, 4, 4, 3], // row 2: indices 1-3 are color 4 (purple star) — match 3
    [2, 0, 3, 5, 1],
    [4, 2, 1, 0, 5],
  ];

  const cells: string[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const x = ox + c * (cellSize + gap);
      const y = oy + r * (cellSize + gap);
      const colorIdx = layout[r]![c]!;
      const color = gemColors[colorIdx]!;
      const highlighted = r === 2 && c >= 1 && c <= 3;

      // gem background cell
      cells.push(
        `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="3" fill="${color}22" stroke="${color}" stroke-width="${highlighted ? 1.5 : 0.5}" stroke-opacity="${highlighted ? 1 : 0.4}" ${highlighted ? `filter="url(#glow-${id})"` : ""}/>`,
      );

      // shape inside
      const shape = shapes[colorIdx % shapes.length]!;
      const cx = x + cellSize / 2;
      const cy = y + cellSize / 2;
      const sr = (cellSize / 2) - 2.5;

      if (shape === "circle") {
        cells.push(`<circle cx="${cx}" cy="${cy}" r="${sr}" fill="${color}" fill-opacity="${highlighted ? 0.95 : 0.7}" ${highlighted ? `filter="url(#glow-${id})"` : ""}/>`);
      } else if (shape === "rhombus") {
        cells.push(`<polygon points="${cx},${cy - sr} ${cx + sr},${cy} ${cx},${cy + sr} ${cx - sr},${cy}" fill="${color}" fill-opacity="${highlighted ? 0.95 : 0.7}" ${highlighted ? `filter="url(#glow-${id})"` : ""}/>`);
      } else if (shape === "triangle") {
        cells.push(`<polygon points="${cx},${cy - sr} ${cx + sr},${cy + sr} ${cx - sr},${cy + sr}" fill="${color}" fill-opacity="${highlighted ? 0.95 : 0.7}" ${highlighted ? `filter="url(#glow-${id})"` : ""}/>`);
      } else if (shape === "star") {
        const pts: string[] = [];
        for (let i = 0; i < 10; i++) {
          const a = (i * 36 - 90) * Math.PI / 180;
          const rr = i % 2 === 0 ? sr : sr * 0.44;
          pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
        }
        cells.push(`<polygon points="${pts.join(" ")}" fill="${color}" fill-opacity="${highlighted ? 0.95 : 0.7}" ${highlighted ? `filter="url(#glow-${id})"` : ""}/>`);
      } else {
        // pentagon / hexagon / default — small filled circle
        cells.push(`<circle cx="${cx}" cy="${cy}" r="${sr}" fill="${color}" fill-opacity="${highlighted ? 0.95 : 0.7}" ${highlighted ? `filter="url(#glow-${id})"` : ""}/>`);
      }
    }
  }

  // glow ring around the 3 highlighted gems row
  const ringY = oy + 2 * (cellSize + gap);
  const ringX1 = ox + 1 * (cellSize + gap) - 2;
  const ringX2 = ox + 3 * (cellSize + gap) + cellSize + 2;
  const glow3 = `<rect x="${ringX1}" y="${ringY - 2}" width="${ringX2 - ringX1}" height="${cellSize + 4}" rx="5" fill="none" stroke="#ff44ff" stroke-width="2" stroke-opacity="0.7" filter="url(#glow2-${id})"/>`;

  // Small cascade score label
  const scoreLabel = `<text x="${ox + 2.5 * (cellSize + gap)}" y="${oy + 5 * (cellSize + gap) + 6}" font-family="'Press Start 2P',ui-monospace,monospace" font-size="6" font-weight="bold" text-anchor="middle" fill="#ff44ff" filter="url(#glow-${id})">+60 MATCH!</text>`;

  return cells.join("\n  ") + "\n  " + glow3 + "\n  " + scoreLabel;
}

function colorFlowArt(id: string): string {
  // 5 test tubes arranged in a row, each partially filled with colored layers
  // Tube dimensions: width ~16, height ~68, bottom-rounded
  // Colors: red, cyan, yellow, green, purple — last tube is single complete (green)
  const tubeData: { cx: number; layers: { color: string; h: number; y: number }[]; complete: boolean }[] = [
    {
      cx: 22,
      complete: false,
      layers: [
        { color: "#ff3344", h: 14, y: 50 },
        { color: "#00eeff", h: 14, y: 36 },
        { color: "#ffee00", h: 10, y: 26 },
        { color: "#aa44ff", h: 10, y: 16 },
      ],
    },
    {
      cx: 48,
      complete: false,
      layers: [
        { color: "#ffee00", h: 14, y: 50 },
        { color: "#ff3344", h: 14, y: 36 },
        { color: "#aa44ff", h: 16, y: 20 },
      ],
    },
    {
      cx: 74,
      complete: false,
      layers: [
        { color: "#aa44ff", h: 18, y: 46 },
        { color: "#00eeff", h: 18, y: 28 },
      ],
    },
    {
      cx: 100,
      complete: false,
      layers: [
        { color: "#ff3344", h: 16, y: 48 },
        { color: "#ffee00", h: 14, y: 34 },
        { color: "#00eeff", h: 14, y: 20 },
      ],
    },
    {
      cx: 134,
      complete: true,
      layers: [
        { color: "#44ff66", h: 64, y: 0 },
      ],
    },
  ];

  const tubeW = 18;
  const tubeH = 68;
  const tubeTop = 10;

  const tubes = tubeData.map(({ cx, layers, complete }) => {
    const x = cx - tubeW / 2;
    const y = tubeTop;
    // Tube outline: open top, rounded bottom
    const outline = `<rect x="${x}" y="${y}" width="${tubeW}" height="${tubeH}"
      rx="${tubeW / 2}" fill="rgba(10,26,42,0.7)"
      stroke="${complete ? "#22ffaa" : "rgba(200,220,240,0.4)"}" stroke-width="1.5"
      ${complete ? `filter="url(#glow-${id})"` : ""}/>`;

    // Clip path via rect (approximate: draw layers as rects capped by tube bounds)
    const layerSvg = layers.map(({ color, h, y: ly }) => {
      const absY = y + ly;
      // Clamp bottom to tube rounded area
      const actualH = Math.min(h, tubeH - ly - 1);
      const br = (actualH > tubeH - ly - 8) ? tubeW / 2 : 0;
      return `<rect x="${x + 1.5}" y="${absY}" width="${tubeW - 3}" height="${actualH}"
        rx="${br}" fill="${color}" fill-opacity="0.92"/>`;
    }).join("\n  ");

    return outline + "\n  " + layerSvg;
  }).join("\n  ");

  // Pour arc from tube 3 to tube 2 (cyan pouring)
  const pourLine = `<path d="M100 14 Q117 4 134 14" fill="none" stroke="#44ff66" stroke-width="2.5"
    stroke-linecap="round" fill-opacity="0" opacity="0.8" filter="url(#glow-${id})"/>`;

  // Drop dots on arc
  const drops = [
    `<circle cx="113" cy="6" r="2.5" fill="#44ff66" fill-opacity="0.9" filter="url(#glow-${id})"/>`,
    `<circle cx="121" cy="5" r="2" fill="#44ff66" fill-opacity="0.6"/>`,
  ].join("\n  ");

  return tubes + "\n  " + pourLine + "\n  " + drops;
}

function blockFitArt(id: string): string {
  // 8x8 grid (partial) + 3 tray shapes below + clearing row highlight
  const cellW = 13;
  const cellH = 13;
  const gap = 1;
  const ox = 6;
  const oy = 4;
  const step = cellW + gap;

  // color palette for placed blocks
  const colors = [
    "#ff3344", "#ff8822", "#ffee00", "#44ff66",
    "#22ddff", "#2266ff", "#aa44ff", "#ff44aa",
  ];

  // fixed grid layout: 0=empty, 1-8=color index
  const layout: number[][] = [
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 2, 0, 1, 1, 0, 3, 3],
    [0, 2, 0, 0, 0, 0, 3, 3],
    [4, 4, 4, 4, 4, 4, 4, 4], // full row — will be highlighted
    [5, 0, 0, 6, 6, 0, 0, 7],
    [5, 0, 0, 6, 6, 0, 0, 7],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ];

  const clearRow = 3;

  const cells: string[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const x = ox + c * step;
      const y = oy + r * step;
      const v = layout[r]![c]!;
      const isClearing = r === clearRow;
      if (v === 0) {
        cells.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="2" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.07)" stroke-width="0.5"/>`);
      } else {
        const color = colors[(v - 1) % colors.length]!;
        const gf = isClearing ? `filter="url(#glow2-${id})"` : `filter="url(#glow-${id})"`;
        cells.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="2" fill="${color}" ${gf}/>`);
        if (isClearing) {
          cells.push(`<rect x="${x + 1}" y="${y + 1}" width="${cellW - 2}" height="3" rx="1" fill="rgba(255,255,255,0.35)"/>`);
        }
      }
    }
  }

  // clearing row flash ring
  const clearY = oy + clearRow * step - 1;
  const clearRing = `<rect x="${ox - 2}" y="${clearY}" width="${8 * step}" height="${cellH + 2}" rx="3" fill="none" stroke="#ffee00" stroke-width="1.5" stroke-opacity="0.85" filter="url(#glow2-${id})"/>`;

  // tray area: 3 mini shapes below the grid
  const trayY = oy + 8 * step + 5;

  // shape 1: 2x2 square (cyan)
  function trayShape(shapes: [number, number][], color: string, ox2: number, oy2: number, cs: number): string {
    return shapes.map(([r, c]) =>
      `<rect x="${ox2 + c * (cs + 1)}" y="${oy2 + r * (cs + 1)}" width="${cs}" height="${cs}" rx="2" fill="${color}" filter="url(#glow-${id})"/>`
    ).join("\n  ");
  }

  const shape1 = trayShape([[0,0],[0,1],[1,0],[1,1]], "#22ddff", 16, trayY, 9);
  const shape2 = trayShape([[0,0],[1,0],[2,0]], "#ff8822", 56, trayY, 9);
  const shape3 = trayShape([[0,0],[0,1],[0,2],[1,0]], "#44ff66", 88, trayY, 9);

  // slot backgrounds
  const slots = [
    `<rect x="10" y="${trayY - 3}" width="32" height="28" rx="4" fill="rgba(34,221,255,0.06)" stroke="rgba(34,221,255,0.2)" stroke-width="0.8"/>`,
    `<rect x="48" y="${trayY - 3}" width="22" height="34" rx="4" fill="rgba(255,136,34,0.06)" stroke="rgba(255,136,34,0.2)" stroke-width="0.8"/>`,
    `<rect x="82" y="${trayY - 3}" width="36" height="28" rx="4" fill="rgba(68,255,102,0.06)" stroke="rgba(68,255,102,0.2)" stroke-width="0.8"/>`,
  ].join("\n  ");

  return cells.join("\n  ") + "\n  " + clearRing + "\n  " + slots + "\n  " + shape1 + "\n  " + shape2 + "\n  " + shape3;
}

function chainReactionArt(id: string): string {
  // 6×9 grid, partial cells with orbs, one exploding cell with directional arrows
  const COLS = 6;
  const ROWS = 7; // show top 7 rows in viewBox 160×100
  const cellW = 22;
  const cellH = 12;
  const gapX = 2;
  const gapY = 2;
  const ox = 8;
  const oy = 2;

  const p1Color = "#22ddff";
  const p2Color = "#ff3344";
  const explodeIdx = 2 + 3 * COLS; // col 2, row 3 — inner cell

  // Fixed orb layout: [owner 0=empty,1=P1,2=P2, count]
  type CellDef = [number, number]; // [owner, orbs]
  const layout: CellDef[] = Array<CellDef>(COLS * ROWS).fill([0, 0]);
  // Scatter a few P1 and P2 orbs
  layout[1]  = [1, 2];
  layout[4]  = [2, 1];
  layout[7]  = [1, 3];
  layout[9]  = [2, 2];
  layout[13] = [1, 1];
  layout[16] = [2, 3];
  layout[20] = [1, 2];
  layout[22] = [2, 1];
  layout[25] = [1, 3];
  layout[27] = [2, 2];
  layout[29] = [1, 1];
  layout[explodeIdx] = [1, 4]; // this cell is at capacity — exploding

  const cells: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const x = ox + c * (cellW + gapX);
      const y = oy + r * (cellH + gapY);
      const [owner, orbs] = layout[idx] ?? [0, 0];
      const isExploding = idx === explodeIdx;
      const color = owner === 1 ? p1Color : p2Color;

      const fill = isExploding
        ? "rgba(255,255,255,0.85)"
        : owner === 0
          ? "rgba(255,255,255,0.03)"
          : `${color}22`;

      const stroke = owner === 0
        ? "rgba(255,255,255,0.12)"
        : isExploding
          ? "#ffffff"
          : color;

      const strokeW = isExploding ? "1.5" : "0.8";
      const gf = isExploding ? ` filter="url(#glow2-${id})"` : owner !== 0 ? ` filter="url(#glow-${id})"` : "";

      cells.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"${gf}/>`);

      // Draw orb dots in cell (tiny circles)
      if (owner !== 0 && !isExploding && orbs > 0) {
        const dotR = 1.8;
        const cx = x + cellW / 2;
        const cy = y + cellH / 2;
        const dotPositions: [number, number][] =
          orbs === 1 ? [[cx, cy]] :
          orbs === 2 ? [[cx - 4, cy], [cx + 4, cy]] :
          [[cx, cy - 3], [cx - 4, cy + 2.5], [cx + 4, cy + 2.5]];
        for (const [dx, dy] of dotPositions) {
          cells.push(`<circle cx="${dx}" cy="${dy}" r="${dotR}" fill="${color}" fill-opacity="0.9"/>`);
        }
      }
    }
  }

  // Exploding cell: draw 4 directional spark arrows from cell center outward
  const ex = ox + 2 * (cellW + gapX) + cellW / 2;
  const ey = oy + 3 * (cellH + gapY) + cellH / 2;
  const arrowLen = 10;
  const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const arrows = dirs.map(([dx, dy]) => {
    const x1 = (ex + dx * 2).toFixed(1);
    const y1 = (ey + dy * 2).toFixed(1);
    const x2 = (ex + dx * (arrowLen + 2)).toFixed(1);
    const y2 = (ey + dy * (arrowLen + 2)).toFixed(1);
    // arrowhead tip
    const tipX = (ex + dx * (arrowLen + 5)).toFixed(1);
    const tipY = (ey + dy * (arrowLen + 5)).toFixed(1);
    // perpendicular for arrowhead base
    const px = dy * 2;
    const py = dx * 2;
    const ah1x = (ex + dx * (arrowLen + 2) + px).toFixed(1);
    const ah1y = (ey + dy * (arrowLen + 2) + py).toFixed(1);
    const ah2x = (ex + dx * (arrowLen + 2) - px).toFixed(1);
    const ah2y = (ey + dy * (arrowLen + 2) - py).toFixed(1);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.9" filter="url(#glow2-${id})"/>
  <polygon points="${tipX},${tipY} ${ah1x},${ah1y} ${ah2x},${ah2y}" fill="#ffffff" fill-opacity="0.9" filter="url(#glow2-${id})"/>`;
  }).join("\n  ");

  // Particles (small dots radiating)
  const particleAngles = [20, 65, 115, 160, 200, 245, 295, 340];
  const particles = particleAngles.map((a, i) => {
    const rad = (a * Math.PI) / 180;
    const dist = 8 + (i % 3) * 3;
    const px2 = (ex + Math.cos(rad) * dist).toFixed(1);
    const py2 = (ey + Math.sin(rad) * dist).toFixed(1);
    return `<circle cx="${px2}" cy="${py2}" r="${1 + (i % 2) * 0.6}" fill="#ff44aa" fill-opacity="0.8" filter="url(#glow-${id})"/>`;
  }).join("\n  ");

  return cells.join("\n  ") + "\n  " + arrows + "\n  " + particles;
}

function starVoidArt(id: string): string {
  // starfield dots
  const stars = [
    [14,8],[38,4],[62,12],[95,6],[120,3],[145,9],[22,22],[55,18],[80,28],[110,14],[140,20],
    [8,35],[44,32],[75,40],[105,36],[138,30],[18,52],[50,48],[88,55],[125,44],[155,50],
    [30,68],[68,64],[100,72],[142,60],[12,80],[58,76],[92,85],[130,78],[150,70],
  ].map(([x, y], i) => {
    const r = i % 5 === 0 ? 1.5 : 1;
    const op = 0.4 + (i % 3) * 0.2;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" fill-opacity="${op}"/>`;
  }).join("\n  ");

  // nebula blobs
  const nebulae = [
    `<ellipse cx="35" cy="35" rx="28" ry="18" fill="#4400aa" fill-opacity="0.18"/>`,
    `<ellipse cx="125" cy="55" rx="22" ry="14" fill="#220066" fill-opacity="0.22"/>`,
  ].join("\n  ");

  // 3 enemies top area
  // grunt (triangle, red)
  const g1 = `<g filter="url(#glow-${id})">
    <polygon points="28,10 35,24 21,24" fill="#ff2200"/>
    <polygon points="28,12 34,22 22,22" fill="#ff6600"/>
    <rect x="25" y="17" width="6" height="3" fill="#ffff00"/>
  </g>`;
  // chaser (diamond, purple)
  const g2 = `<g filter="url(#glow-${id})">
    <polygon points="80,8 90,17 80,26 70,17" fill="#aa00ff"/>
    <circle cx="80" cy="17" r="4" fill="#dd66ff"/>
  </g>`;
  // gunner (box, green)
  const g3 = `<g filter="url(#glow-${id})">
    <rect x="118" y="8" width="22" height="18" rx="1" fill="#226600"/>
    <rect x="120" y="10" width="18" height="14" rx="1" fill="#44aa00"/>
    <rect x="115" y="12" width="4" height="8" fill="#226600"/>
    <rect x="140" y="12" width="4" height="8" fill="#226600"/>
    <rect x="129" y="5" width="4" height="4" fill="#88ff00"/>
  </g>`;

  // bullet curtain — 20+ small bullets scattered mid-field
  const bulletCols = ["#ff2200","#ff88aa","#ff4400","#ff2200","#ffaa00","#ff88aa"];
  const bulletRows = [
    [15, 28, 42, 55, 68, 82, 95, 108, 122, 136, 148],
    [20, 38, 52, 65, 78, 90, 104, 118, 132, 145],
  ];
  const bullets = bulletRows.flatMap((xs, row) =>
    xs.map((x, i) => {
      const y = 36 + row * 14 + (i % 3) * 3;
      const col = bulletCols[(i + row * 3) % bulletCols.length]!;
      return `<circle cx="${x}" cy="${y}" r="2.5" fill="${col}" filter="url(#glow-${id})" fill-opacity="0.9"/>`;
    })
  ).join("\n  ");

  // player ship — bottom center
  const ship = `<g filter="url(#glow2-${id})">
    <polygon points="80,88 92,100 80,96 68,100" fill="#0055aa"/>
    <polygon points="80,89 90,99 80,95 70,99" fill="#00ccff"/>
    <circle cx="80" cy="92" r="4" fill="#ffffff"/>
    <rect x="62" y="100" width="6" height="4" fill="#0055aa"/>
    <rect x="92" y="100" width="6" height="4" fill="#0055aa"/>
    <rect x="77" y="100" width="6" height="3" fill="#ffcc00" filter="url(#glow-${id})"/>
  </g>`;

  // engine trail
  const trail = [
    `<ellipse cx="80" cy="103" rx="3" ry="5" fill="#ffaa00" fill-opacity="0.7" filter="url(#glow-${id})"/>`,
    `<ellipse cx="80" cy="107" rx="2" ry="4" fill="#ff6600" fill-opacity="0.5"/>`,
  ].join("\n  ");

  // player bullets (shooting up)
  const pBullets = [
    `<rect x="78" y="72" width="4" height="10" rx="1" fill="#88ffff" filter="url(#glow-${id})"/>`,
    `<rect x="78" y="60" width="4" height="8" rx="1" fill="#88ffff" fill-opacity="0.5"/>`,
  ].join("\n  ");

  return nebulae + "\n  " + stars + "\n  " + g1 + "\n  " + g2 + "\n  " + g3 + "\n  " + bullets + "\n  " + trail + "\n  " + ship + "\n  " + pBullets;
}

function defaultArt(id: string, accent: string): string {
  return `<rect x="20" y="20" width="120" height="60" rx="8" fill="${accent}" fill-opacity="0.3" filter="url(#glow-${id})"/>`;
}

function dropStackArt(id: string): string {
  // Jar outline + stack of colored orbs + one dropping from top
  const bg = `<rect width="160" height="100" fill="#0a1026"/>`;
  const jar = `
    <rect x="42" y="20" width="76" height="72" fill="rgba(120,160,255,0.05)" stroke="#1a2340" stroke-width="2"/>
    <line x1="42" y1="20" x2="118" y2="20" stroke="#ff3344" stroke-dasharray="3,3" stroke-width="1"/>
  `;
  // orbs stacked inside jar
  const orb = (cx: number, cy: number, r: number, color: string, shade: string, accent: string) => `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="${shade}" stroke-width="0.8"/>
    <ellipse cx="${cx - r * 0.35}" cy="${cy - r * 0.4}" rx="${r * 0.28}" ry="${r * 0.16}" fill="rgba(255,255,255,0.5)" transform="rotate(-30 ${cx - r * 0.35} ${cy - r * 0.4})"/>
    <circle cx="${cx}" cy="${cy + r * 0.35}" r="${r * 0.12}" fill="${accent}"/>
  `;
  const stack = [
    orb(58, 84, 6,  "#ff5177", "#a8123b", "#ffccdc"),
    orb(70, 84, 7,  "#a266ff", "#5a20b8", "#e0c8ff"),
    orb(86, 82, 9,  "#6ddc5a", "#2a7a1a", "#d7ffce"),
    orb(104, 83, 8, "#ff9f3a", "#b35c00", "#ffdaa8"),
    orb(114, 86, 5, "#ff5177", "#a8123b", "#ffccdc"),
    orb(70, 66, 11, "#ff4444", "#8b1010", "#ffc4c4"),
    orb(95, 65, 13, "#e7e23a", "#a89918", "#fff7a6"),
    orb(82, 42, 17, "#ffb59a", "#c96a43", "#fff0e6"),
  ].join("\n  ");
  // dropping orb above jar
  const dropping = orb(80, 12, 6, "#6ddc5a", "#2a7a1a", "#d7ffce");
  // trajectory dashed line
  const traj = `<line x1="80" y1="18" x2="80" y2="30" stroke="#ffffff" stroke-opacity="0.4" stroke-dasharray="2,2"/>`;
  // merge spark
  const spark = `
    <g filter="url(#glow-${id})">
      <circle cx="82" cy="42" r="20" fill="none" stroke="#ffee55" stroke-width="0.8" stroke-opacity="0.7"/>
    </g>
  `;
  return bg + "\n  " + jar + "\n  " + spark + "\n  " + stack + "\n  " + traj + "\n  " + dropping;
}

// ---------- public API ----------

export function renderCover(entry: GameEntry): string {
  const { id, palette: { bg, fg, accent } } = entry;
  return wrap(id, bg, fg, accent, artBody(entry));
}

export function mountCover(container: HTMLElement, entry: GameEntry): void {
  container.innerHTML = renderCover(entry);
}
