# InsertCoin — project knowledge

PWA arcade mobile-first. Vanilla TS + Vite + Dexie + PWA (no UI framework). Games live under `src/games/<id>/` and are lazy-loaded per chunk by Vite. Shell is in `src/main.ts` + `src/ui/menu.ts`. Cover art is SVG generated at runtime (`src/ui/cover.ts`).

Target: ship as PWA first, wrap as Android/iOS via Capacitor later.

---

## Hard rules (learned the hard way — do not re-violate)

### Game mount contract (`src/games/<id>/index.ts`)

The shell passes `container` = `.game-content` (has `flex:1; min-height:0; position:relative; overflow:hidden`). Every game must respect:

1. `container.classList.add("<game>-root")` — NEVER `container.className = "..."`. Replacing the class wipes `game-content` and collapses the flex height chain (Snake shipped broken this way 2026-04-21, canvas rendered 80×80).
2. Cleanup: `classList.remove("<game>-root")`, restore changed styles (e.g. `touchAction`). NEVER `container.className = ""`.
3. Game root: `display:flex; flex-direction:column; flex:1; min-height:0;`. Do not rely on `height:100%` alone — it does not resolve reliably when the parent is a flex item.
4. Canvas resize: `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` — never `ctx.scale(dpr, dpr)` (it compounds across ResizeObserver fires).
5. Resize guard: if `clientWidth < 8 || clientHeight < 8` return early.
6. Canvas render must fire inside the resize callback (canvas content clears when `canvas.width` is assigned). Use an `onAfterResize` hook and call the game's render function from it.
7. Touch/swipe listeners on the full game wrap, not only on the canvas/grid — otherwise swipes near HUD/D-pad are lost on mobile.
8. Modern touch defaults every game must include:
   - `navigator.vibrate(…)` on key events (input registered, scoring, merge, game over, win).
   - Fullscreen button in HUD → `container.closest(".game-host").requestFullscreen()`.
   - `container.style.touchAction = "none"` on mount, restored on cleanup.
   - First-play onboarding hint (`<game>:seenHint` key in `settings` table). Auto-dismiss on first valid input / 5s timeout / tap. `pointer-events:none` so it never blocks gameplay.
9. Leaderboard submit on gameover (and on win if it ends the run). Use `submit(gameId, score)` from `src/lib/leaderboard.ts`.

### Copyright

**Game mechanics are not copyrightable. Names, specific characters, distinctive art are.** Current rename map (id stays stable because `src/ui/cover.ts` dispatches by id):

| id | safe title used in UI |
|---|---|
| tetris | Blox |
| pacman | Chompr |
| breakout | Brick Buster |
| invaders | Sky Defender |
| frogger | Road Hop |
| asteroids | Void Rocks |
| flappy | Tap Wing |
| lights-out | Blackout |

Untouched (already generic / PD): snake, 2048, match3, minesweeper, sudoku, memory, 15puzzle, bubble-shooter.

Rule for new games: original title, cover art distinct from the original (no yellow Pac-Man profile, no classic Tetris palette pixel-for-pixel, etc.).

### Author attribution

Never add Claude / Anthropic / AI footers to commits, PRs, comments, docstrings, changelogs, READMEs. Global user preference — Alessandro's repo must read as his authorship.

---

## Commercial mobile criteria

When proposing new games, bias toward games that are:

- **Short sessions** — 1–3 minutes per run.
- **One-finger controls** — tap, swipe, long-press. No dual-stick, no keyboard reliance.
- **High replayability** — permadeath + randomness + score-chase.
- **Monetizable** — clean points for ads/IAP (interstitial between runs, cosmetics, skip-timer).
- **Viral potential** — shareable run results, daily challenges.
- **Accessibility** — learn in 5 seconds, master over hours.

What makes a title "commercial" is not the idea itself but: accessibility, fast loss→retry loop, immediate dopamine (scores, effects, combos), content scalability (new levels/skins/weapons without rewriting).

### Top 10 commercial concepts (mobile-first shortlist)

1. **Tap & Rotate Shooter** — tap to shoot, hold to rotate. Wave-based. 30–60s runs. Ultra-simple retention.
2. **Merge Weapon Arena** — auto-shooter + merge-same-weapons to upgrade. Merge mechanic is addictive.
3. **Endless Dodge & Shoot** — auto-movement, player controls aim + ability. Relaxed but engaging.
4. **Color Match Shooter** — shoot only matching-color enemies, hot-swap color. Easy to learn, hard to master.
5. **One Bullet Puzzle Shooter** — one shot per level, use ricochets. Perfect interstitial-ads cadence.
6. **Idle Shooter Arena** — auto-fire even offline, upgrade loop. Daily-return retention.
7. **Swipe Combo Shooter** — swipe-to-attack with multiplier scoring. Skill-based but simple.
8. **Tower Defense + Shooter Hybrid** — build towers and manual-fire. Genre mash.
9. **Roguelike Mini Shooter** — 2-min runs, random upgrades. Max replayability.
10. **Chain Reaction Blast** — shoot to trigger explosion chains. Immediate "wow".

Use this list as the default shortlist when Alessandro asks "what next". Prefer these over purely-creative concepts unless he explicitly asks for experiments.

---

## Original-concept shooter pool (use for differentiation, post-MVP)

50 original arcade/puzzle/shooter concepts — do not clone existing IPs. Pick from here when commercial list is exhausted or a twist is wanted.

### Top tier (strongest ideas)

1. Orbit Blaster — shoot from a circular orbit around a planet, gravity-aware aiming.
2. Color Chain Shooter — hit enemies only following a color sequence.
3. Mirror Arena — bullets bounce off movable mirrors (puzzle + aim).
4. Time Freeze Shooter — time flows only when you move.
5. Grid Defender — defend a grid by combining towers and manual shots.
6. Magnet Gun — attract/repel enemies via polarity.
7. Split Shot Labyrinth — projectiles split to solve puzzles.
8. Shadow Sync — your clone repeats actions on delay.
9. Chain Reaction Arena — plan chain explosions.
10. Portal Shooter — shoot through portals for indirect hits.

### Mid tier (11–20)

11. Laser Redirect · 12. Shape Breaker · 13. Rhythm Shooter · 14. Fog of War Blaster · 15. Energy Link · 16. Gravity Swap Arena · 17. Bullet Sculptor · 18. Chain Hook Shooter · 19. Element Merge Shooter · 20. Rotating Maze Combat

### Puzzle-mechanic tier (21–30)

21. Clone Puzzle Shooter · 22. Heat Management Blaster · 23. Invisible Enemy Arena · 24. Trajectory Puzzle Shooter · 25. Multi-Layer Arena · 26. Echo Shot · 27. Light & Shadow Shooter · 28. Switch Trigger Arena · 29. Chain Dash Shooter · 30. Bounce Combo Arena

### Action tier (31–40)

31. Procedural Bullet Hell Lite · 32. Tile Break Shooter · 33. Wave Sync Shooter · 34. Target Priority Arena · 35. Dynamic Cover Shooter · 36. Color Inversion Blaster · 37. Angle Master Shooter · 38. Minimalist One Bullet Game · 39. Speed Scaling Arena · 40. Combo Multiplier Shooter

### Score/meta tier (41–50)

41. Risk Reward Shooter · 42. Arena Collapse · 43. Line Clear Shooter · 44. Weak Spot Puzzle Shooter · 45. Chain Teleport Shooter · 46. Bullet Economy Game · 47. Reflective Shield Arena · 48. Enemy Fusion System · 49. One Hit Hardcore Arena · 50. Endless Scaling Survival Shooter

### Anti-plagiarism rules (applied automatically)

- Do not copy identical levels, recognizable characters, iconic UI, or iconic sounds.
- Change aesthetic (pixel / neon / 3D / minimal).
- Combine mechanics (puzzle + shooter + roguelike).
- Lean on one strong central twist + procedural content.

---

## Gamification direction

Alessandro's strategic goal: **people must be pushed to beat others' records**, otherwise the game doesn't work. Local-only leaderboards are not enough.

### What's required

- **Global leaderboards** (not just local Dexie) — per game, per difficulty, with daily/weekly/all-time tabs.
- **Remote backend** — options: Supabase (Postgres + auth), Firebase, Cloudflare D1/KV, or minimal custom Hono/Worker. Default proposal: Supabase (row-level security, free tier, realtime for "new top score" pings).
- **Nickname handle, global** — persistent per device (already local in `auth.ts`), extended to remote with a device UUID. Handle collisions handled server-side.
- **Anti-cheat baseline** — server validates score against gameplay seed + input trace for competitive slots. For arcade games this is hard; fall back to statistical outlier detection + periodic manual review for the top 10.
- **Daily challenge** — one seed per day, same for all players → head-to-head leaderboard reset daily. Massive retention driver.
- **"You are #N" feedback** — after a run, show position + delta to next higher score.
- **Share-to-beat link** — URL with encoded score + player. Opening it starts that player's "ghost" challenge.
- **Meta progression** — coins earned per run, cosmetics shop, no pay-to-win (only vanity).
- **Achievements / trophies** — cross-game streak system ("played 5 days in a row", "top 10 in 3 games").
- **Tournament mode** — timed 3-day window, entry fee in coins, prize pool in coins.
- **Push notifications** (PWA → later native) — "Your record has been beaten" alert.

### Minimum viable increment for competition

Build in this order:
1. Global leaderboard table + API endpoint + submission from game (auth via device UUID + signed score).
2. Leaderboard screen in shell (`#/scores/:id`) showing top 10 all-time + daily.
3. Post-run screen: "Your rank: #N / total. Score to beat: X".
4. Daily challenge seed (one seed/day per game supporting it; start with 2048 and Snake).
5. Share link (`/challenge/<gameId>/<encodedScore>`).

Everything else (cosmetics, tournaments, achievements) comes after #1–5 prove people come back.

---

## Current status (as of 2026-04-21)

**Ready**: snake · 2048 · minesweeper.
**Soon (classics)**: sudoku · memory · bubble-shooter · 15puzzle · flappy (Tap Wing).
**Soon (commercial)**: tap-rotate · merge-arena · color-match-shooter (Hue Blaster) · one-bullet (One Shot) · chain-blast.
Catalog size: 13 games (3 ready + 10 soon). Option B mix chosen 2026-04-21.
**Shell features**: hash router, guest auth with 3-letter nick, local Dexie leaderboard, menu with SVG covers, nick editor, toast.
**Missing**: global leaderboard, PWA icons (192/512), audio layer, scores page, daily challenge infrastructure.
