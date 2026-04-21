export interface GameEntry {
  id: string;
  title: string;
  tagline: string;
  palette: { bg: string; fg: string; accent: string };
  status: "ready" | "soon";
  load?: () => Promise<{ mount: (root: HTMLElement) => () => void }>;
}

export const GAMES: GameEntry[] = [
  {
    id: "snake",
    title: "Snake",
    tagline: "Eat. Grow. Survive.",
    palette: { bg: "#001a00", fg: "#00ff41", accent: "#ff3333" },
    status: "ready",
    load: () => import("./snake/index.js"),
  },
  {
    id: "2048",
    title: "2048",
    tagline: "Merge tiles to 2048.",
    palette: { bg: "#faf8ef", fg: "#776e65", accent: "#f65e3b" },
    status: "ready",
    load: () => import("./2048/index.js"),
  },
  {
    id: "minesweeper",
    title: "Minesweeper",
    tagline: "Flag the mines. Stay alive.",
    palette: { bg: "#0f172a", fg: "#e0e0ff", accent: "#4fc3f7" },
    status: "ready",
    load: () => import("./minesweeper/index.js"),
  },

  // --- Classic kept (soon) ---
  {
    id: "sudoku",
    title: "Sudoku",
    tagline: "Numbers 1–9. Pure logic.",
    palette: { bg: "#1a1a2e", fg: "#e0e0ff", accent: "#4fc3f7" },
    status: "soon",
  },
  {
    id: "memory",
    title: "Memory",
    tagline: "Flip and match the pairs.",
    palette: { bg: "#1b003b", fg: "#ffffff", accent: "#c084fc" },
    status: "soon",
  },
  {
    id: "bubble-shooter",
    title: "Bubble Shooter",
    tagline: "Aim. Shoot. Pop.",
    palette: { bg: "#001133", fg: "#ffffff", accent: "#00ccff" },
    status: "soon",
  },
  {
    id: "15puzzle",
    title: "15-Puzzle",
    tagline: "Slide tiles into order.",
    palette: { bg: "#0f172a", fg: "#e2e8f0", accent: "#38bdf8" },
    status: "soon",
  },
  {
    id: "flappy",
    title: "Tap Wing",
    tagline: "Tap to fly. Try not to cry.",
    palette: { bg: "#70c5ce", fg: "#ffffff", accent: "#ded895" },
    status: "soon",
  },

  // --- Commercial mobile-first concepts (soon) ---
  {
    id: "tap-rotate",
    title: "Tap & Rotate",
    tagline: "Tap to shoot. Hold to rotate.",
    palette: { bg: "#0b0b1f", fg: "#ffffff", accent: "#ff3d68" },
    status: "soon",
  },
  {
    id: "merge-arena",
    title: "Merge Arena",
    tagline: "Fuse weapons. Auto-fire.",
    palette: { bg: "#120826", fg: "#ffe066", accent: "#ff00aa" },
    status: "soon",
  },
  {
    id: "color-match-shooter",
    title: "Hue Blaster",
    tagline: "Shoot same color.",
    palette: { bg: "#0a0a2a", fg: "#ffffff", accent: "#22ffaa" },
    status: "soon",
  },
  {
    id: "one-bullet",
    title: "One Shot",
    tagline: "One bullet. Many rebounds.",
    palette: { bg: "#0a1210", fg: "#d9f8e4", accent: "#ffd166" },
    status: "soon",
  },
  {
    id: "chain-blast",
    title: "Chain Blast",
    tagline: "Trigger combo explosions.",
    palette: { bg: "#160814", fg: "#ffffff", accent: "#ff6600" },
    status: "soon",
  },
];

export function getGame(id: string): GameEntry | undefined {
  return GAMES.find((g) => g.id === id);
}
