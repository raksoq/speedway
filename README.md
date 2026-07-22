# Speedway

A browser speedway racer inspired by "kreski" (the cult ~1995 Polish DOS game where
riders were drawn as simple colored lines) and modern PGE Ekstraliga rules. Steer
left and right around a regulation oval; there's no throttle or brake.

Run it with any static file server, e.g. `python3 -m http.server 8123`, then open
`http://localhost:8123` (or just double-click `index.html` — it's plain HTML/CSS/JS,
no build step, no server-only features).

## Controls

- **Arrow Left / A** or **Arrow Right / D** (or the on-screen buttons): steer.
- The bike always drives forward. There's no throttle, gear, or brake — real
  speedway bikes don't have them either.

## Physics

The core idea: the bike's **heading** (which way it's pointed) and its **velocity**
(the direction it's actually traveling) are two separate things that chase each
other. Steering rotates the heading; grip (traction) is what pulls the velocity
back into line with it, but that pull isn't instant. Whenever heading and velocity
disagree, that's your **slip angle**, and it costs speed. This one mechanic
produces power-slides, oversteer, and a real speed-vs-line tradeoff without needing
a full tire model.

Per-frame update (`Bike.update` in `game.js`):

1. **Steer.** Holding left/right rotates `heading` at `turnRateLeft` (2.7 rad/s) or
   `turnRateRight` (1.7 rad/s). Left is faster to turn *and* cheaper to hold — see
   "Left vs. right" below.
2. **Engine.** Thrust of `enginePower` (230 px/s²) is applied along the *heading*,
   scaled by `turnEnginePenaltyLeft`/`Right` (0.5 / 0.38) while steering, or 1.0
   (full drive) when going straight. The bike never brakes; this is the only place
   speed is gained.
3. **Grip.** The velocity direction is blended toward the heading at
   `gripStraight` (6.0 /s) normally, or `gripTurningLeft`/`Right` (1.9 / 1.3 /s)
   while steering — a much slower catch-up, which is what makes a held turn feel
   like a slide rather than a snap. The **slip angle** (`heading - velocityAngle`)
   feeds a speed penalty: `loss = slip × slipLossFactor(1.6) × speed × dt`. This
   loss compounds the longer a turn is held, because slip keeps building the whole
   time you're steering.
4. **Drag & max speed.** Linear drag (`0.35`) plus a hard clamp at `maxSpeed`
   (250 px/s, calibrated to **125 km/h** — real speedway's individual top-speed
   record, held by Maciej Janowski, is 126.1 km/h on the straight; average race
   speed is 70-90 km/h because of constant cornering).
5. **Off-track (two-tier).** Beyond the racing surface is a loose **apron**
   (`TRACK.apron`, 20px) that scales speed down toward `offTrackMax` (55%) the
   deeper you're into it. Beyond the apron is the **fence**: on first contact,
   velocity is zeroed outright (a hard stop). On every frame after that, only the
   velocity component still pressing *into* the fence gets cancelled — so steering
   back toward the track actually builds escape speed, instead of being re-pinned
   every frame (an earlier, naively-simpler version of this code had exactly that
   bug: it zeroed the whole velocity vector every frame regardless of direction,
   so a crashed bike could never leave the fence again).

### Left vs. right

Real speedway bikes are physically set up for left turns only (frame geometry,
footrest position, engine offset) — riders can still steer right, but it's
inefficient and unstable. The game models that asymmetry directly: left is fast to
turn, costs only half your drive, and keeps decent grip. Right turns slower, costs
more drive (62% penalty vs. 50%), and slides more (grip 1.3 vs. 1.9). Right is
there for correction — peeling off the inside fence, mostly — not for cornering.

### How to actually go fast

Because slip damage compounds the longer you hold a turn, and releasing
immediately restores full drive and fast grip recovery, **tapping** the steer
input in short bursts through a corner beats **holding** it for the same total
turn. Measured in-engine: turning the same 60° via a continuous hold left the bike
at speed 191; tapping it in 3-frames-on/2-frames-off bursts left it at 219 — about
15% faster — at the cost of the turn taking longer in wall-clock time/distance.
The AI's "hard" difficulty exploits exactly this: a longer, smoother anticipatory
lookahead combined with rarely hesitating beats a twitchy, closer-reacting AI that
oversteers and eats the engine penalty too often (see AI section below).

## Track

A stadium oval (two straights + two semicircle turns), all corners turned left,
traversed counter-clockwise. Corners flare wider than the straights — real tracks
run roughly 12m straight width vs. 15-16m at the corner apex — via
`trackHalfWidthAt(s)`, which widens smoothly (`sin` taper) through each arc and
matches the straight width exactly at the transition points. Rendering samples
this varying-width boundary as a polygon (`boundaryPoints`) rather than drawing
fixed-radius arcs, since the width itself changes continuously around the lap.

The start/finish line sits at the **middle of the straight** (regulation
position — not the corner exit, where an earlier version of this game had it).
All 4 riders line up on that one line, side by side in individually marked gates
(white lines at right angles to the start line, extending back behind it), colored
in FIM/PGE Ekstraliga order: red, blue, white, yellow. Which gate the player
lands in is randomized each race.

## Computer riders

Five difficulty presets (`AI_LEVELS`) tune three knobs per AI rider:

- **threshold** — how much angular error it tolerates before deciding to steer.
  Higher = later, sloppier reactions.
- **lookahead** — how far ahead on the track it aims. Counterintuitively, a
  *shorter* lookahead alone doesn't make an AI faster: it reacts to a closer,
  twitchier target and ends up oversteering (spending more time in the
  engine-penalized turning state), which is slower. A longer, smoother
  anticipatory lookahead combined with rarely hesitating is what actually wins.
- **jitter** — the chance it acts on a steering decision each frame. Lower means
  more hesitation and missed corrections.

| | threshold | lookahead | jitter | ~avg finish (4 laps, headless sim) |
|---|---|---|---|---|
| Easy | 0.24-0.36 | 45-60 | 0.35-0.50 | ~48s |
| Medium | 0.05-0.12 | 55-80 | 0.85-1.15 | ~34.5s |
| Hard | 0.04-0.09 | 70-90 | 1.1-1.2 | ~33.5s |
| Expert | 0.025-0.055 | 90-105 | 1.2-1.25 | ~32.75s |
| Champion | 0.015-0.035 | 110-120 | 1.25-1.3 | ~32.1s |

Diminishing returns from Hard upward are expected — the AI is approaching the
same `maxSpeed` ceiling the player has, so there's a physical floor to lap times
regardless of skill.

AI also gets one difficulty-independent override: if it's pushed deep onto the
inward (infield) apron, it steers *right* to peel off, since its normal left-only
steering would otherwise just drive it further into that fence — a real dead-lock
that showed up in testing before the override was added.

### Legends mode

An optional menu toggle races real multi-time world champions instead of generic
names: Ivan Mauger, Hans Nielsen, and Greg Hancock fill the 3 AI gates. The
player gets an editable name field, defaulting to Tomasz Gollob.

## Scoring

3-2-1-0 per heat, PGE Ekstraliga style.

## Verification approach

There's no test suite; the physics/AI/scoring logic was validated by driving the
actual production `frame()` loop headlessly from the browser console (bypassing
only the animation-frame timing, not the game logic) across dozens of simulated
races per change, checking for: no thrown errors, every rider finishing (no
permanent fence-stalls), and sane finish-time orderings across difficulty levels.
