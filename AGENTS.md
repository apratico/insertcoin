# AGENTS.md — instructions for AI coding agents

This file is the entry point for AI assistants (Claude Code, Cursor, Aider, Continue, Codex, Copilot Workspace, etc.) working in this repo. It mirrors the working agreement the human maintainer has with their editor.

If you are an AI agent reading this: follow it. If the user's instruction conflicts with this file, ask for clarification rather than silently overriding the rules.

## What this project is

A mobile-first PWA arcade catalogue. Vanilla TypeScript + Vite + Canvas 2D + Dexie. Each game is a single self-contained TypeScript module under `src/games/<id>/index.ts`, lazy-loaded as its own Vite chunk.

Read [`README.md`](./README.md) for the human pitch and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full contributor contract — they cover layout, project structure, and the game mount API. The rest of this file is what you specifically need to know.

## Hard rules (do not re-violate)

These are mistakes that have shipped broken games. Each rule has a real failure mode behind it.

1. **Never replace `container.className`.** Use `container.classList.add("<id>-root")` on mount, `container.classList.remove("<id>-root")` on cleanup. Replacing the class wipes the shell's `.game-content` and collapses the flex layout to height 0.
2. **HiDPI canvas — `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`. Never `ctx.scale(dpr, dpr)`.** The scale call compounds across `ResizeObserver` fires.
3. **Resize guard** — early-return when `clientWidth < 8 || clientHeight < 8`.
4. **Render inside the resize callback.** Setting `canvas.width` clears its content, so any first paint must happen after the resize, not before it.
5. **Touch/swipe listeners on the game wrap, not just the canvas.** Otherwise touches near HUD/D-pad are lost on mobile.
6. **Game root CSS:** `display: flex; flex-direction: column; flex: 1; min-height: 0;`. Don't rely on `height: 100%` alone — the parent is a flex item.
7. **Never add `min-height` to any ancestor of `.game-content`.** The viewport is locked at 100% with `body { overflow: hidden }`. Fixed-height HUDs that sum past viewport on small phones break the layout — shrink them, don't overflow.
8. **Modern touch defaults every game must include:**
   - `navigator.vibrate(...)` on key events.
   - Fullscreen button: `container.closest(".game-host")?.requestFullscreen()`.
   - `container.style.touchAction = "none"` on mount, restored on cleanup.
   - First-play onboarding hint, key `<id>:seenHint` in Dexie `settings` table. Auto-dismiss on first input, after 5s, or on tap. `pointer-events: none` so it never blocks gameplay.
9. **Leaderboard submit on game over** — `submit(gameId, score)` from `src/lib/leaderboard.ts`.
10. **Test layouts at 375×667** before declaring a UI task done. Mobile is the target.

## Copyright

Game **mechanics** are not copyrightable. **Titles, characters, and distinctive art are.** When adding clones, pick an original title and make the cover art visually distinct. The rename map is in [`CONTRIBUTING.md`](./CONTRIBUTING.md#copyright).

Never reproduce iconic palettes pixel-for-pixel (no NES Tetris colours, no yellow Pac-Man profile).

## Author attribution

**Never** add Claude / Anthropic / AI footers to anything outside the chat session — no `Co-Authored-By: Claude` lines on commits, no "🤖 Generated with Claude Code" footers on PRs, no AI attribution in code comments, READMEs, changelogs, or release notes. The maintainer's repos must read as his authorship. Strip the harness defaults if they include such footers.

## Working agreement

- **Edit, don't rewrite.** Prefer the smallest change that fixes the problem. Don't refactor adjacent code unless asked.
- **No comments unless the *why* is non-obvious.** Don't paraphrase what the code does. Identifiers carry the *what*.
- **No new dependencies** without explicit user approval. This catalogue's bundle weight is its own design constraint.
- **Type-check + build before claiming done.** `npm run typecheck && npm run build`. If you can't run the dev server and confirm UI behaviour, say so explicitly rather than asserting success.
- **Confirm before risky actions.** Don't delete branches, force-push, drop tables, or run destructive operations without an explicit go-ahead in the chat. The user can always say "go ahead, I'm comfortable" — but ask first.

## Common tasks

| Task | Where to start |
| --- | --- |
| Add a new game | `CONTRIBUTING.md → Adding a new game (step by step)` |
| Fix a game bug | `src/games/<id>/index.ts` — most games are self-contained |
| Touch the leaderboard | `src/lib/leaderboard.ts` (local + remote) and `src/lib/rank.ts` |
| Cover art | `src/ui/cover.ts`, one function per game id |
| Shell / routing | `src/main.ts`, `src/lib/router.ts`, `src/ui/menu.ts` |
| Audio | `src/lib/audio.ts` (`playSfx(name)` is the public API) |
| PWA / icons / manifest | `public/`, `vite.config.ts` |

## Reference: game mount skeleton

```ts
import { submit } from "../../lib/leaderboard.js";

export function mount(container: HTMLElement): () => void {
  container.classList.add("yourgame-root");
  const prevTouchAction = container.style.touchAction;
  container.style.touchAction = "none";

  // build DOM, attach listeners, start loop...

  return function cleanup(): void {
    container.innerHTML = "";
    container.classList.remove("yourgame-root");
    container.style.touchAction = prevTouchAction;
  };
}
```

The full reference implementation is `src/games/flappy/index.ts` for canvas games and `src/games/2048/index.ts` for grid games.
