export type GameMode = "solo" | "local2p" | "remote2p";
export type GameCategory = "solo" | "company";

export interface GameEntry {
  id: string;
  title: string;
  tagline: string;
  palette: { bg: string; fg: string; accent: string };
  category: GameCategory;
  modes: GameMode[];
  status: "ready" | "soon";
  load?: () => Promise<{ mount: (root: HTMLElement) => () => void }>;
}

export const GAMES: GameEntry[] = [
  // =========================================================
  // SOLITARI
  // =========================================================
  {
    id: "snake",
    title: "Snake",
    tagline: "Eat. Grow. Survive.",
    palette: { bg: "#001a00", fg: "#00ff41", accent: "#ff3333" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./snake/index.js"),
  },
  {
    id: "2048",
    title: "2048",
    tagline: "Merge tiles to 2048.",
    palette: { bg: "#faf8ef", fg: "#776e65", accent: "#f65e3b" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./2048/index.js"),
  },
  {
    id: "minesweeper",
    title: "Minesweeper",
    tagline: "Flag the mines. Stay alive.",
    palette: { bg: "#0f172a", fg: "#e0e0ff", accent: "#4fc3f7" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./minesweeper/index.js"),
  },

  // --- Classic kept (soon) ---
  {
    id: "sudoku",
    title: "Sudoku",
    tagline: "Numbers 1–9. Pure logic.",
    palette: { bg: "#1a1a2e", fg: "#e0e0ff", accent: "#4fc3f7" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./sudoku/index.js"),
  },
  {
    id: "memory",
    title: "Memory",
    tagline: "Flip and match the pairs.",
    palette: { bg: "#1b003b", fg: "#ffffff", accent: "#c084fc" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./memory/index.js"),
  },
  {
    id: "bubble-shooter",
    title: "Bubble Shooter",
    tagline: "Aim. Shoot. Pop.",
    palette: { bg: "#001133", fg: "#ffffff", accent: "#00ccff" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./bubble-shooter/index.js"),
  },
  {
    id: "15puzzle",
    title: "15-Puzzle",
    tagline: "Slide tiles into order.",
    palette: { bg: "#0f172a", fg: "#e2e8f0", accent: "#38bdf8" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./15puzzle/index.js"),
  },
  {
    id: "flappy",
    title: "Tap Wing",
    tagline: "Tap to fly. Try not to cry.",
    palette: { bg: "#70c5ce", fg: "#ffffff", accent: "#ded895" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./flappy/index.js"),
  },

  // --- Commercial solo shooter concepts (soon except tap-rotate) ---
  {
    id: "tap-rotate",
    title: "Tap & Rotate",
    tagline: "Tap to shoot. Hold to rotate.",
    palette: { bg: "#0b0b1f", fg: "#ffffff", accent: "#ff3d68" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./tap-rotate/index.js"),
  },
  {
    id: "color-match-shooter",
    title: "Hue Blaster",
    tagline: "Shoot same color.",
    palette: { bg: "#0a0a2a", fg: "#ffffff", accent: "#22ffaa" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./color-match-shooter/index.js"),
  },
  {
    id: "one-bullet",
    title: "One Shot",
    tagline: "One bullet. Many rebounds.",
    palette: { bg: "#0a1210", fg: "#d9f8e4", accent: "#ffd166" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./one-bullet/index.js"),
  },
  {
    id: "chain-blast",
    title: "Chain Blast",
    tagline: "Trigger combo explosions.",
    palette: { bg: "#160814", fg: "#ffffff", accent: "#ff6600" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./chain-blast/index.js"),
  },
  {
    id: "crypt-run",
    title: "Crypt Run",
    tagline: "Corri, salta, massacra.",
    palette: { bg: "#14041a", fg: "#ffffff", accent: "#ff5722" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./crypt-run/index.js"),
  },
  {
    id: "brick-buster",
    title: "Brick Buster",
    tagline: "Break all the bricks.",
    palette: { bg: "#0a0a1a", fg: "#ffffff", accent: "#ff6600" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./brick-buster/index.js"),
  },
  {
    id: "gem-cascade",
    title: "Gem Cascade",
    tagline: "Swap. Match. Cascade.",
    palette: { bg: "#1a0030", fg: "#ffffff", accent: "#ff44ff" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./gem-cascade/index.js"),
  },
  {
    id: "surv-swarm",
    title: "Surv Swarm",
    tagline: "Sopravvivi all'orda.",
    palette: { bg: "#0a0018", fg: "#ffffff", accent: "#ff2266" },
    category: "solo",
    modes: ["solo"],
    status: "ready",
    load: () => import("./surv-swarm/index.js"),
  },

  // =========================================================
  // COMPAGNIA (2 players, local or remote)
  // =========================================================
  {
    id: "tris",
    title: "Tris",
    tagline: "Tre in riga.",
    palette: { bg: "#0b1530", fg: "#ffffff", accent: "#f6c24c" },
    category: "company",
    modes: ["local2p", "remote2p"],
    status: "ready",
    load: () => import("./tris/index.js"),
  },
  {
    id: "dama",
    title: "Dama",
    tagline: "Classico italiano.",
    palette: { bg: "#1a0f08", fg: "#ffffff", accent: "#c08040" },
    category: "company",
    modes: ["local2p", "remote2p"],
    status: "ready",
    load: () => import("./dama/index.js"),
  },
  {
    id: "connect4",
    title: "4 in Fila",
    tagline: "Quattro di fila vince.",
    palette: { bg: "#0a1a2a", fg: "#ffffff", accent: "#ffcc00" },
    category: "company",
    modes: ["local2p", "remote2p"],
    status: "ready",
    load: () => import("./connect4/index.js"),
  },
  {
    id: "reaction-duel",
    title: "Reaction",
    tagline: "Primo al verde vince.",
    palette: { bg: "#0a0f0a", fg: "#ffffff", accent: "#44ff66" },
    category: "company",
    modes: ["local2p"],
    status: "ready",
    load: () => import("./reaction-duel/index.js"),
  },
  {
    id: "tap-race",
    title: "Tap Race",
    tagline: "Più veloce in 10s.",
    palette: { bg: "#1a001a", fg: "#ffffff", accent: "#ff44ff" },
    category: "company",
    modes: ["local2p", "remote2p"],
    status: "ready",
    load: () => import("./tap-race/index.js"),
  },
];

export function getGame(id: string): GameEntry | undefined {
  return GAMES.find((g) => g.id === id);
}
