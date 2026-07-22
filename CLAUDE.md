# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser speedway (motorcycle oval racing) game inspired by "kreski" (a cult ~1995
Polish DOS game) and modern PGE Ekstraliga rules. Plain HTML/CSS/JS, no framework,
no build step, no package.json, no test suite.

## Running it

No build tooling exists. Serve the directory with any static file server and open
it, or just double-click `index.html` (it works over `file://` too — no fetch(),
no ES modules, nothing that needs `http://`):

```bash
python3 -m http.server 8123
```

There is no lint, test, or build command to run — none are configured in this repo.

## Architecture

Three files, no modules:

- `index.html` — DOM structure only: canvas, HUD chips, the menu/countdown/results
  overlay panels, on-screen steer buttons.
- `style.css` — styling, plus the responsive scaling: `#stage` is a fixed
  1100×650px design surface that JS scales via CSS `transform` to fit the
  viewport (see `fitStage()` in `game.js`) rather than being reflowed.
- `game.js` — everything else, in one file, roughly in this order:
  1. **Track geometry** — `TRACK` config, `centerlineAt(s)` (arc-length →
     point/angle), `trackHalfWidthAt(s)` (corners flare wider than straights),
     `projectToTrack`/`lateralOffset` (world position → track-relative
     position), `boundaryPoints` (samples the varying-width boundary as a
     polygon for rendering, since it's not a fixed-radius shape).
  2. **Physics** — `PHYS` constants and `Bike.update()`. The core mechanic:
     heading (steering) and velocity (actual travel direction) are separate and
     chase each other via a grip/blend model; their disagreement (slip angle)
     costs speed. Two-tier off-track handling: a loose apron that saps speed,
     then a fence that hard-stops the bike (recovery only cancels the velocity
     component still pressing into the fence, not the whole vector — see the
     bug note in `README.md` if touching this).
  3. **AI** — `aiSteer`/`aiControl` (steering decision) and `AI_LEVELS`
     (difficulty tiers tuning reaction threshold, lookahead, and hesitation
     jitter — see `README.md` for the full table and tuning gotchas). AI only
     steers left except for a fence-recovery override.
  4. **Game/DOM wiring** — element refs, `GATE_COLORS`/`LEGEND_NAMES`,
     `setupRace()`, `startCountdown()`, `finishRace()`, input listeners.
  5. **Loop** — `frame()` drives both game-state updates and rendering every
     animation frame; `updateHud()`. The race ends as soon as the player
     finishes (`playerBike.finished`), not when every rider does — AI still on
     track at that point are ranked by current position, not left running.
  6. **Rendering** — track/grandstand/roof/bike drawing functions, all
     `ctx`-based canvas calls.

`README.md` documents the physics model, tuning rationale, and specific numbers
in detail (turn rates, grip values, AI preset table, etc.) — read it before
tuning feel/balance rather than re-deriving values from scratch.

## Verification approach

There's no test suite. Physics/AI/scoring changes are validated by driving the
actual production `frame()` function headlessly from the browser console
(bypassing only `requestAnimationFrame` timing, not any game logic) across many
simulated races, checking for: no thrown errors, every rider finishing (no
permanent fence-stalls), and sane finish-time/difficulty orderings. When editing
`Bike.update`, `aiControl`, or `AI_LEVELS`, re-run that kind of check rather than
eyeballing a single race — several real bugs here (a fence-recovery deadlock, an
Easy difficulty that wasn't actually easier) only showed up under many simulated
races, not one manual playtest.
