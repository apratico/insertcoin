# Contributing to InsertCoin

Thanks for your interest. This file is the single source of truth for how to add to or change the project. Read it once before opening a PR — most reviews bounce on the same handful of contract violations.

## TL;DR

1. Fork → branch → commit → PR. Small PRs preferred.
2. Run `npm run typecheck` and `npm run build` locally before pushing.
3. Test on a real phone (or Chrome DevTools mobile mode at 375×667) — this project is mobile-first.
4. No copyrighted names, sprites, or sounds. Mechanics are fine; "Pac-Man" is not.
5. If in doubt, open a draft PR or an issue first to discuss.

## Local setup

```bash
git clone https://github.com/<you>/insertcoin.git
cd insertcoin
npm install
npm run dev
```

Open http://localhost:5173. The hash router lets you jump straight to a game: `http://localhost:5173/#/play/<id>`.

For the optional Supabase leaderboard, copy `.env.example` to `.env.local` and fill in the URL + anon key from your own Supabase project. Local play works without this.

## Project layout

See [README.md → Project layout](./README.md#project-layout). The two files you'll touch most are `src/games/registry.ts` (catalog entry) and `src/ui/cover.ts` (SVG cover art).

## Game mount contract

This is the non-negotiable part. Every game module exports `mount(container) → cleanup`, and **every** rule below has been violated at least once and shipped a broken game. Do not re-violate.

```ts
export function mount(container: HTMLElement): () => void {
  // 1. Add your scoped class — DO NOT replace container.className.
  container.classList.add("mygame-root");

  // 2. Disable browser touch behaviors. Restore on cleanup.
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // 3. Build your DOM, attach listeners, start the loop...

  return function cleanup(): void {
    // Tear everything down. Restore styles.
    container.innerHTML = "";
    container.classList.remove("mygame-root");
    container.style.touchAction = prevTouchAction;
  };
}
```

### Rules

1. **Never** `container.className = "..."`. The shell sets `.game-content` and uses it for the flex layout chain. Replacing the class collapses height to 0. Use `classList.add` / `classList.remove`.
2. **Game root CSS** — `display:flex; flex-direction:column; flex:1; min-height:0;`. Don't rely on `height: 100%` alone; the parent is a flex item.
3. **HiDPI canvas** — use `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`. Never `ctx.scale(dpr, dpr)` (it compounds across `ResizeObserver` fires).
4. **Resize guard** — bail early if `clientWidth < 8 || clientHeight < 8`.
5. **Render after resize** — `canvas.width = …` clears the canvas, so re-render inside the resize callback (or via an `onAfterResize` hook).
6. **Touch listeners on the wrap**, not just the canvas. Otherwise swipes near the HUD are lost on mobile.
7. **Modern touch defaults**:
   - `navigator.vibrate(...)` on key events (input registered, scoring, game over).
   - Fullscreen button → `container.closest(".game-host")?.requestFullscreen()`.
   - `container.style.touchAction = "none"` on mount, restored on cleanup.
   - First-play onboarding hint stored in the `settings` Dexie table under key `<id>:seenHint`. Auto-dismiss on first valid input, after 5s, or on tap. Use `pointer-events: none` so it never blocks gameplay.
8. **Leaderboard** — call `submit(gameId, score)` from `src/lib/leaderboard.ts` on game over (and on win if it ends the run).
9. **Viewport sizing** — `html`, `body`, `#app` are all 100% height with `body { overflow: hidden }`. Do **not** add `min-height` on any ancestor of `.game-content`. Fixed-height HUDs that exceed the viewport on small phones break the layout — shrink them, don't let them overflow. Test at 375×667.

## Adding a new game (step by step)

1. **Pick an `id`** — kebab-case, unique, stable. The registry id is the dispatch key for cover art and chunking, so don't change it later.
2. **Pick a title** — original or copyright-safe. See [Copyright](#copyright). Two-word punchy is best.
3. **Create `src/games/<id>/index.ts`**. Export `mount(container) → cleanup`. Use an existing game as a model — `src/games/flappy/index.ts` (~850 lines) is the most readable starting point for canvas games; `src/games/2048/index.ts` for grid games.
4. **Register the game** in `src/games/registry.ts`:

   ```ts
   {
     id: "your-id",
     title: "Your Title",
     tagline: "Three-word hook.",
     palette: { bg: "#…", fg: "#…", accent: "#…" },
     category: "solo",        // or "company" for 2-player
     modes: ["solo"],         // ["solo"], ["local2p"], ["remote2p"]
     status: "ready",         // or "soon" if WIP
     orientation: "portrait", // or "landscape" / "any"
     load: () => import("./your-id/index.js"),
   }
   ```

5. **Add cover art** in `src/ui/cover.ts`. Add a `case "your-id": return yourIdArt(id);` to the dispatch and write the function. SVG, viewBox `0 0 160 100`. Keep it distinct — no clones of the original game's iconic look (no yellow Pac-Man profile, no NES Tetris palette, etc.).
6. **Test** — `npm run typecheck && npm run build`, then dev mode on a real phone or DevTools mobile.
7. **Commit + PR**. One game per PR is ideal.

## Copyright

Game **mechanics** are not copyrightable; titles, characters, and distinctive art are. The current rename map for clones in this repo:

| id | safe title shown in UI |
| --- | --- |
| `tetris` | Blox |
| `pacman` | Chompr |
| `breakout` | Brick Buster |
| `invaders` | Sky Defender |
| `frogger` | Road Hop |
| `asteroids` | Void Rocks |
| `flappy` | Tap Wing |
| `lights-out` | Blackout |

Untouched (already generic / public-domain): `snake`, `2048`, `match3`, `minesweeper`, `sudoku`, `memory`, `15puzzle`, `bubble-shooter`.

For new games: pick an original title and make the cover art visually distinct from the source. When in doubt, ask in your PR.

## Code style

- TypeScript strict. No `any` unless genuinely necessary, with a comment.
- No new dependencies without discussion. The catalog is bigger than its `dist/` because every dep adds bundle weight.
- One file per game, ~500–1500 lines is normal. Bigger is fine if it's still self-contained.
- Comments only when the *why* is non-obvious. Don't paraphrase what the code does.

## Commit messages

Follow Conventional Commits.

```
<type>(<scope>): <subject>

[optional body]
```

Examples:

```
feat(neon-dash): synthwave auto-runner — tap jump, swipe slide, double jump
fix(brick-buster): capsules now actually fall
chore: bump vite to 5.4.21
```

Types used in this repo: `feat`, `fix`, `chore`, `tune`, `polish`, `docs`, `security`, `refactor`.

## Pull requests

A good PR has:

- A short description of *what* and *why*.
- Screenshots or a short clip if it changes UI.
- Confirmation you tested on mobile (DevTools mobile mode is fine if you don't have a phone handy).
- A green `npm run build`.

I aim to review within a week. If you don't hear back, ping the PR.

## Issues

Two flavours:

- **Bug** — what happened, what you expected, browser + device, steps to reproduce. Use the bug template.
- **New game proposal** — title, mechanic, control scheme, why it fits the catalog. Use the new-game template. Don't start coding before discussing — saves both of us the time of a closed PR.

## Code of conduct

Be kind. Don't be a jerk. The maintainer reserves the right to close anything that wastes everyone's time.

## Questions

Open a [Discussion](https://github.com/apratico/insertcoin/discussions) or email **alessandro.pratico@decisyon.com**.
