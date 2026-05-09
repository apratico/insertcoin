# InsertCoin 🕹️

A mobile-first arcade & puzzle PWA. Vanilla TypeScript, Canvas 2D, Vite, Dexie. Each game is its own lazy-loaded chunk under `src/games/<id>/`. No UI framework, no game engine bloat — every game is a small, self-contained TypeScript module.

> **27+ playable games and counting.** Built as a portfolio / experiment in shipping small, polished arcade titles for the modern web. Open to contributors who want to add games, polish existing ones, or build a remote leaderboard backend.

| | |
| --- | --- |
| **Stack** | TypeScript · Vite · Canvas 2D · Dexie (IndexedDB) · Vite PWA · Supabase (optional) |
| **Target** | Mobile web (PWA), wraps to Android/iOS via Capacitor later |
| **Status** | Active |
| **License** | [MIT](./LICENSE) |

## Games

Includes faithful clones with safe titles (mechanics aren't copyrightable, but names/art aren't ours to take):

`Snake` · `2048` · `Minesweeper` · `Sudoku` · `Memory` · `Bubble Shooter` · `15-Puzzle` · `Tap Wing` (Flappy) · `Tap & Rotate` · `Hue Blaster` · `One Shot` · `Chain Blast` · `Crypt Run` · `Brick Buster` (Arkanoid) · `Gem Cascade` · `Color Flow` · `Block Fit` · `Star Void` · `Drop Stack` (Suika) · `Peg Drop` (Plinko) · `Neon Dash` (Synthwave runner) · `Tris` · `Dama` · `4 in Fila` · `Reaction` · `Tap Race` · `Chain Reaction`

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. Hash routing — `/#/play/<game-id>` jumps straight to a game.

```bash
npm run build      # typecheck + bundle to dist/
npm run preview    # serve the production build locally
npm run typecheck  # tsc only, no bundle
```

### Optional: Supabase backend

Local-only mode works out of the box (Dexie). For the cloud leaderboard:

1. Copy `.env.example` to `.env.local`.
2. Create a Supabase project, enable RLS on every table.
3. Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

The anon key is intentionally client-side per Supabase design and is protected by RLS. **Never** put a `service_role` key anywhere in the repo. See [`SECURITY.md`](./SECURITY.md).

## Project layout

```
src/
  main.ts              # app shell + boot
  ui/
    menu.ts            # game grid
    cover.ts           # SVG cover art (one function per game)
    scores.ts          # leaderboard view
  lib/
    storage.ts         # Dexie schema
    leaderboard.ts     # local + remote score submit/top
    rank.ts            # rank computation
    auth.ts            # device-id + nickname
    audio.ts           # WebAudio SFX layer
    router.ts          # hash router
    supabase.ts        # optional remote client
  games/
    <id>/index.ts      # one game per folder, lazy-loaded
    registry.ts        # game catalogue
public/                 # PWA icons, sitemap, manifest
```

## Adding a new game

The fast path: copy `src/games/_template/index.ts` to `src/games/<your-id>/index.ts` and fill in the gaps. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full contract.

In one paragraph:
1. Each game lives in `src/games/<id>/index.ts` and exports a single `mount(container)` function that returns a cleanup function.
2. The shell passes a `container` element. **Do not replace its className** — only `classList.add("<id>-root")`.
3. Use `flex: 1; min-height: 0;` on your root, `setTransform(dpr,...)` (not `scale`) for HiDPI, and listen for swipes on the **wrap**, not the canvas.
4. Add an entry to `src/games/registry.ts` and a cover function in `src/ui/cover.ts`.
5. On game over, call `submit(gameId, score)` from `src/lib/leaderboard.ts`.

## Contributing

Contributions are very welcome — especially:

- **New games** (copyright-safe titles, original art)
- **Polishing existing games** (juice, balance, mobile UX)
- **Backend / leaderboard work** (global scores, daily challenges)
- **PWA polish** (icons, audio, accessibility)

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR. The TL;DR: respect the [game mount contract](./CONTRIBUTING.md#game-mount-contract), don't ship copyrighted names or sprites, and test on a real phone before declaring it done.

## Roadmap

- [ ] Global leaderboard + daily challenge
- [ ] Cosmetic shop (no pay-to-win)
- [ ] Achievement system across games
- [ ] Capacitor wrap for Android/iOS
- [ ] In-game audio toggle persisted across sessions

## License

[MIT](./LICENSE) © Alessandro Praticò
