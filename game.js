"use strict";

// ---------- Track ----------
// Stadium oval: two straights + two semicircle turns, traversed counter-clockwise
// (bottom straight L->R, right-end turn, top straight R->L, left-end turn),
// matching real speedway where every corner is a left turn. Corners flare wider
// than the straights (real tracks: ~12m straight -> ~15-16m at the apex), and a
// soft dirt apron sits between the racing surface and the outer safety fence.
const TRACK = {
  cx: 550, cy: 325,
  halfStraight: 260,
  radius: 150,
  width: 100,       // straight-section width
  cornerExtra: 34,  // extra full-width bulge at corner apex
  apron: 20,        // loose-surface verge between the racing line and the fence
};
TRACK.lenStraight = TRACK.halfStraight * 2;
TRACK.lenArc = Math.PI * TRACK.radius;
TRACK.totalLength = TRACK.lenStraight * 2 + TRACK.lenArc * 2;

function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Returns {x, y, angle, curvature} for a point on the centerline at arc-length s.
function centerlineAt(s) {
  const t = TRACK;
  s = ((s % t.totalLength) + t.totalLength) % t.totalLength;
  const segA = t.lenStraight;
  const segB = segA + t.lenArc;
  const segC = segB + t.lenStraight;
  const segD = segC + t.lenArc;

  if (s < segA) {
    // bottom straight, moving +x
    const x = t.cx - t.halfStraight + s;
    const y = t.cy + t.radius;
    return { x, y, angle: 0, curvature: 0 };
  } else if (s < segB) {
    // right semicircle around (cx+halfStraight, cy): bottom-right -> east bulge -> top-right
    const a = (s - segA) / t.lenArc; // 0..1
    const theta = Math.PI / 2 - a * Math.PI;
    const ccx = t.cx + t.halfStraight, ccy = t.cy;
    const x = ccx + Math.cos(theta) * t.radius;
    const y = ccy + Math.sin(theta) * t.radius;
    return { x, y, angle: theta - Math.PI / 2, curvature: 1 / t.radius };
  } else if (s < segC) {
    // top straight, moving -x
    const x = t.cx + t.halfStraight - (s - segB);
    const y = t.cy - t.radius;
    return { x, y, angle: Math.PI, curvature: 0 };
  } else {
    // left semicircle around (cx-halfStraight, cy): top-left -> west bulge -> bottom-left
    const a = (s - segC) / t.lenArc; // 0..1
    const theta = -Math.PI / 2 - a * Math.PI;
    const ccx = t.cx - t.halfStraight, ccy = t.cy;
    const x = ccx + Math.cos(theta) * t.radius;
    const y = ccy + Math.sin(theta) * t.radius;
    return { x, y, angle: theta - Math.PI / 2, curvature: 1 / t.radius };
  }
}

// 0 on the straights, rising smoothly to 1 at each corner apex.
function arcWidenFactor(s) {
  const t = TRACK;
  const segA = t.lenStraight, segB = segA + t.lenArc, segC = segB + t.lenStraight, segD = segC + t.lenArc;
  let a = null;
  if (s >= segA && s < segB) a = (s - segA) / t.lenArc;
  else if (s >= segC && s < segD) a = (s - segC) / t.lenArc;
  if (a === null) return 0;
  return Math.sin(a * Math.PI);
}

function trackHalfWidthAt(s) {
  return (TRACK.width + TRACK.cornerExtra * arcWidenFactor(s)) / 2;
}

// Finds the arc-length s of the centerline point closest to (x,y), searching near a hint.
function projectToTrack(x, y, hintS) {
  const t = TRACK;
  let bestS = hintS, bestD = Infinity;
  const searchSpan = 220, coarseStep = 8;
  for (let ds = -searchSpan; ds <= searchSpan; ds += coarseStep) {
    const s = hintS + ds;
    const p = centerlineAt(s);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) { bestD = d; bestS = s; }
  }
  for (let ds = -coarseStep; ds <= coarseStep; ds += 1) {
    const s = bestS - coarseStep / 2 + ds;
    const p = centerlineAt(s);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) { bestD = d; bestS = s; }
  }
  return ((bestS % t.totalLength) + t.totalLength) % t.totalLength;
}

// Signed lateral offset of (x,y) from the centerline at arc-length s (+ = outward, away from infield).
function lateralOffset(x, y, s) {
  const p = centerlineAt(s);
  const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
  return (x - p.x) * nx + (y - p.y) * ny;
}

// Points offset from the centerline by trackHalfWidthAt(s)+extra, sign +1 = outer, -1 = inner.
function boundaryPoints(sign, extra, steps) {
  steps = steps || 240;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * TRACK.totalLength;
    const p = centerlineAt(s);
    const hw = trackHalfWidthAt(s) + extra;
    const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
    pts.push({ x: p.x + sign * hw * nx, y: p.y + sign * hw * ny });
  }
  return pts;
}

const START_S = TRACK.lenStraight / 2; // regulation start gate: middle of the straight

// ---------- Bike ----------
const PHYS = {
  maxSpeed: 250,               // px/s
  enginePower: 230,            // px/s^2 forward drive
  turnRateLeft: 2.7,           // rad/s heading rotation while steering left
  turnRateRight: 1.7,          // right turns are weaker - the bike is set up for left
  turnEnginePenaltyLeft: 0.5,  // engine drive multiplier while steering left
  turnEnginePenaltyRight: 0.38,// steering right costs more drive - less efficient
  gripStraight: 6.0,           // 1/s blend rate of velocity->heading when not steering
  gripTurningLeft: 1.9,        // 1/s blend rate while steering left (lower = more drift)
  gripTurningRight: 1.3,       // steering right is slidier / less stable
  slipLossFactor: 1.6,         // speed lost per second per radian of slip, scaled by speed
  drag: 0.35,                  // linear drag coefficient
  offTrackDrag: 2.6,           // extra drag on the loose apron surface
  offTrackMax: 0.55,           // speed cap multiplier at the edge of the apron
};

class Bike {
  constructor(color, name, isPlayer) {
    this.color = color;
    this.name = name;
    this.isPlayer = isPlayer;
    const start = centerlineAt(START_S);
    this.x = start.x;
    this.y = start.y;
    this.heading = start.angle;
    this.vx = 0; this.vy = 0;
    this.trackS = START_S;
    this.lap = 0;
    this.finished = false;
    this.finishTime = null;
    this.raceTime = 0;
    this.trail = [];
    this.steerDir = 0;
    this.offTrack = false;
    this.crashed = false;
    this._lastS = START_S;
    this._crossOffset = 0; // cumulative distance for lap fraction display
  }

  get speed() { return Math.hypot(this.vx, this.vy); }

  update(dt, steerDir, elapsed) {
    this.steerDir = steerDir; // -1 left, 0 none, +1 right
    if (steerDir < 0) this.heading -= PHYS.turnRateLeft * dt;
    else if (steerDir > 0) this.heading += PHYS.turnRateRight * dt;

    const drivePenalty = steerDir < 0 ? PHYS.turnEnginePenaltyLeft
      : steerDir > 0 ? PHYS.turnEnginePenaltyRight
      : 1;
    this.vx += Math.cos(this.heading) * PHYS.enginePower * drivePenalty * dt;
    this.vy += Math.sin(this.heading) * PHYS.enginePower * drivePenalty * dt;

    let speed = this.speed;
    if (speed > 0.001) {
      const velAngle = Math.atan2(this.vy, this.vx);
      const diff = normAngle(this.heading - velAngle);
      const grip = steerDir < 0 ? PHYS.gripTurningLeft
        : steerDir > 0 ? PHYS.gripTurningRight
        : PHYS.gripStraight;
      const blend = Math.min(1, grip * dt);
      const newVelAngle = velAngle + diff * blend;

      const slip = Math.abs(diff);
      const speedLoss = slip * PHYS.slipLossFactor * speed * dt;
      speed = Math.max(0, speed - speedLoss);

      this.vx = Math.cos(newVelAngle) * speed;
      this.vy = Math.sin(newVelAngle) * speed;
    }

    // drag
    speed = this.speed;
    if (speed > 0) {
      const dragDecel = PHYS.drag * speed * dt;
      const ns = Math.max(0, speed - dragDecel);
      const scale = ns / speed;
      this.vx *= scale; this.vy *= scale;
    }

    // off-track / fence handling: a loose apron slows you down, the fence beyond it stops you dead
    this.trackS = projectToTrack(this.x, this.y, this.trackS);
    const p = centerlineAt(this.trackS);
    const halfW = trackHalfWidthAt(this.trackS);
    const offset = lateralOffset(this.x, this.y, this.trackS);
    const overshoot = Math.max(0, Math.abs(offset) - halfW);
    this.offTrack = overshoot > 0;
    const wasCrashed = this.crashed;
    this.crashed = false;

    if (overshoot > 0) {
      if (overshoot >= TRACK.apron) {
        this.crashed = true;
        const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
        const outwardSign = Math.sign(offset);
        if (!wasCrashed) {
          // first impact: hard stop
          this.vx = 0; this.vy = 0;
        } else {
          // already pinned: only cancel the component still pressing into the fence,
          // so steering back onto the track can actually build escape velocity
          const vNormal = this.vx * nx + this.vy * ny;
          if (vNormal * outwardSign > 0) {
            this.vx -= vNormal * nx;
            this.vy -= vNormal * ny;
          }
        }
        const clampOffset = outwardSign * (halfW + TRACK.apron);
        this.x = p.x + nx * clampOffset;
        this.y = p.y + ny * clampOffset;
      } else {
        const frac = overshoot / TRACK.apron;
        const spd = this.speed;
        const cap = PHYS.maxSpeed * (1 - frac * (1 - PHYS.offTrackMax));
        const extraDrag = PHYS.offTrackDrag * frac * dt;
        let ns = Math.max(0, spd - spd * extraDrag);
        if (ns > cap) ns = cap;
        if (spd > 0) {
          const scale = ns / spd;
          this.vx *= scale; this.vy *= scale;
        }
      }
    }

    // clamp to max speed
    speed = this.speed;
    if (speed > PHYS.maxSpeed) {
      const scale = PHYS.maxSpeed / speed;
      this.vx *= scale; this.vy *= scale;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // lap counting: track forward progress in arc-length, detect crossing start line
    const newS = projectToTrack(this.x, this.y, this.trackS);
    let dS = newS - this._lastS;
    if (dS < -TRACK.totalLength / 2) dS += TRACK.totalLength; // wrapped forward past 0
    if (dS > TRACK.totalLength / 2) dS -= TRACK.totalLength;  // wrapped backward
    this._crossOffset += dS;
    this._lastS = newS;
    this.trackS = newS;

    if (!this.finished) {
      this.raceTime = elapsed;
      const lapsDone = Math.floor(this._crossOffset / TRACK.totalLength);
      if (lapsDone > this.lap) this.lap = lapsDone;
    }

    // trail
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 42) this.trail.shift();
  }

  get progress() { return this._crossOffset; }
}

// ---------- AI ----------
// AI only ever steers left (matching a real rider's preferred, efficient direction on this oval).
function aiSteer(bike, lookAheadBase) {
  const look = lookAheadBase + bike.speed * 0.38;
  const targetS = bike.trackS + look;
  const target = centerlineAt(targetS);
  const tx = target.x + Math.sin(target.angle) * (bike.aiLine || 0);
  const ty = target.y - Math.cos(target.angle) * (bike.aiLine || 0);

  const toTargetAngle = Math.atan2(ty - bike.y, tx - bike.x);
  const diff = normAngle(toTargetAngle - bike.heading);
  return diff < -bike.aiThreshold;
}

// Full AI steering decision: mostly left-only like a real rider, but if pushed deep onto the
// inward (infield) apron, left steering would only drive it further into that fence - so it
// briefly steers right to peel back off, the one case where the weak side is the correct one.
function aiControl(bike) {
  const halfW = trackHalfWidthAt(bike.trackS);
  const offset = lateralOffset(bike.x, bike.y, bike.trackS);
  if (offset < -(halfW + TRACK.apron * 0.5)) return 1;
  const wantLeft = aiSteer(bike, bike.aiLook || 60) && Math.random() < (bike.aiSkillJitter || 1);
  return wantLeft ? -1 : 0;
}

// ---------- Game ----------
const canvas = document.getElementById("track");
const ctx = canvas.getContext("2d");

// Scale the whole stage to fit the viewport (never upscale past native size) so every
// control stays on-screen and clickable regardless of window size.
const stage = document.getElementById("stage");
function fitStage() {
  const margin = 24;
  const scale = Math.min(
    (window.innerWidth - margin * 2) / 1100,
    (window.innerHeight - margin * 2) / 650,
    1
  );
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
window.addEventListener("resize", fitStage);
fitStage();

const hudPos = document.getElementById("hudPos");
const hudLap = document.getElementById("hudLap");
const hudSpeed = document.getElementById("hudSpeed");

const menuScreen = document.getElementById("menuScreen");
const countdownScreen = document.getElementById("countdownScreen");
const countdownNum = document.getElementById("countdownNum");
const resultsScreen = document.getElementById("resultsScreen");
const resultsList = document.getElementById("resultsList");
const recordLine = document.getElementById("recordLine");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const resetBtn = document.getElementById("resetBtn");
const steerLeftBtn = document.getElementById("steerLeftBtn");
const steerRightBtn = document.getElementById("steerRightBtn");
const diffBtns = document.querySelectorAll(".diffBtn");

const TOTAL_LAPS = 4;
const RECORD_KEY = "speedway_best_lap";
const HEAT_POINTS = [3, 2, 1, 0]; // PGE Ekstraliga-style scoring: 3-2-1-0 per heat

// Computer rider difficulty presets. Threshold is how much angular error the AI tolerates
// before it steers (higher = later, sloppier reactions); jitter is the chance it actually
// acts on that decision each frame (lower = more hesitation/missed corrections). A shorter
// lookahead alone doesn't make an AI faster - it reacts to a closer, twitchier target and
// ends up over-steering (holding the engine-penalized turn input too much), which is slower;
// a longer, smoother lookahead combined with rarely hesitating is what actually wins races.
const AI_LEVELS = {
  easy: { thresholdBase: 0.14, thresholdVar: 0.10, lookBase: 75, lookVar: 25, jitterBase: 0.55, jitterVar: 0.20 },
  medium: { thresholdBase: 0.05, thresholdVar: 0.07, lookBase: 55, lookVar: 25, jitterBase: 0.85, jitterVar: 0.30 },
  hard: { thresholdBase: 0.04, thresholdVar: 0.05, lookBase: 70, lookVar: 20, jitterBase: 1.1, jitterVar: 0.1 },
};
let aiDifficulty = "medium";

let state = "menu"; // menu | countdown | racing | finished
let bikes = [];
let playerBike = null;
let raceElapsed = 0;
let countdownT = 0;
let inputLeft = false;
let inputRight = false;
let bestLapThisRace = Infinity;

// Real FIM/PGE Ekstraliga gate colours, in order: red (gate 1), blue (gate 2),
// white (gate 3), yellow (gate 4).
const GATE_COLORS = ["#e74c3c", "#3d7fe0", "#eeeeee", "#ffd23f"];

function setupRace() {
  const playerGate = Math.floor(Math.random() * GATE_COLORS.length);
  bikes = GATE_COLORS.map((color, i) =>
    new Bike(color, i === playerGate ? "YOU" : `RIDER ${i + 1}`, i === playerGate)
  );
  const lvl = AI_LEVELS[aiDifficulty] || AI_LEVELS.medium;
  // Regulation start: all 4 riders on one line, side by side in their own marked gate.
  const p = centerlineAt(START_S);
  const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
  const halfW = trackHalfWidthAt(START_S);
  bikes.forEach((b, i) => {
    const laneOffset = -halfW + halfW * 2 * ((i + 0.5) / bikes.length);
    b.x = p.x + nx * laneOffset;
    b.y = p.y + ny * laneOffset;
    b.heading = p.angle;
    b.trackS = START_S;
    b._lastS = START_S;
    if (!b.isPlayer) {
      b.aiLine = laneOffset * 0.5;
      b.aiThreshold = lvl.thresholdBase + Math.random() * lvl.thresholdVar;
      b.aiLook = lvl.lookBase + Math.random() * lvl.lookVar - i * 4;
      b.aiSkillJitter = lvl.jitterBase + Math.random() * lvl.jitterVar;
    }
  });
  playerBike = bikes.find((b) => b.isPlayer);
  raceElapsed = 0;
  bestLapThisRace = Infinity;
}

function startCountdown() {
  setupRace();
  state = "countdown";
  countdownT = 3.0;
  menuScreen.classList.add("hidden");
  resultsScreen.classList.add("hidden");
  countdownScreen.classList.remove("hidden");
  countdownNum.textContent = "3";
}

function finishRace() {
  state = "finished";
  const order = [...bikes].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
  resultsList.innerHTML = "";
  order.forEach((b, i) => {
    const li = document.createElement("li");
    const t = b.finished ? formatTime(b.finishTime) : "DNF";
    const pts = b.finished ? HEAT_POINTS[i] : 0;
    li.textContent = `${i + 1}. ${b.name} — ${pts} pkt (${t})`;
    if (b.isPlayer) li.classList.add("you");
    resultsList.appendChild(li);
  });

  const prevRecord = parseFloat(localStorage.getItem(RECORD_KEY) || "0");
  let recordText = "";
  if (isFinite(bestLapThisRace)) {
    if (!prevRecord || bestLapThisRace < prevRecord) {
      localStorage.setItem(RECORD_KEY, String(bestLapThisRace));
      recordText = `New track record! Best lap: ${formatTime(bestLapThisRace)}`;
    } else {
      recordText = `Best lap this race: ${formatTime(bestLapThisRace)} — Track record: ${formatTime(prevRecord)}`;
    }
  } else if (prevRecord) {
    recordText = `Track record: ${formatTime(prevRecord)}`;
  }
  recordLine.textContent = recordText;

  countdownScreen.classList.add("hidden");
  resultsScreen.classList.remove("hidden");
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

// ---------- Input ----------
window.addEventListener("keydown", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA" || e.code === "Space") { inputLeft = true; e.preventDefault(); }
  if (e.code === "ArrowRight" || e.code === "KeyD") { inputRight = true; e.preventDefault(); }
  if (e.code === "Escape") { returnToMenu(); }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA" || e.code === "Space") { inputLeft = false; }
  if (e.code === "ArrowRight" || e.code === "KeyD") { inputRight = false; }
});
function bindHold(el, on, off) {
  el.addEventListener("mousedown", (e) => { on(); e.preventDefault(); });
  el.addEventListener("touchstart", (e) => { on(); e.preventDefault(); }, { passive: false });
  window.addEventListener("mouseup", off);
  window.addEventListener("touchend", off);
}
bindHold(steerLeftBtn,
  () => { inputLeft = true; steerLeftBtn.classList.add("pressed"); },
  () => { inputLeft = false; steerLeftBtn.classList.remove("pressed"); }
);
bindHold(steerRightBtn,
  () => { inputRight = true; steerRightBtn.classList.add("pressed"); },
  () => { inputRight = false; steerRightBtn.classList.remove("pressed"); }
);

startBtn.addEventListener("click", startCountdown);
restartBtn.addEventListener("click", startCountdown);
resetBtn.addEventListener("click", returnToMenu);
diffBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    aiDifficulty = btn.dataset.level;
    diffBtns.forEach((b) => b.classList.toggle("active", b === btn));
  });
});

function returnToMenu() {
  state = "menu";
  menuScreen.classList.remove("hidden");
  countdownScreen.classList.add("hidden");
  resultsScreen.classList.add("hidden");
}

// ---------- Loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - lastT) / 1000);
  lastT = now;

  if (state === "countdown") {
    countdownT -= dt;
    if (countdownT > 0) {
      countdownNum.textContent = countdownT > 1 ? Math.ceil(countdownT).toString() : "GO!";
    } else {
      state = "racing";
      countdownScreen.classList.add("hidden");
    }
  } else if (state === "racing") {
    raceElapsed += dt;
    for (const b of bikes) {
      if (b.finished) continue;
      const prevLap = b.lap;
      const steerDir = b.isPlayer
        ? (inputLeft ? -1 : inputRight ? 1 : 0)
        : aiControl(b);
      b.update(dt, steerDir, raceElapsed);
      if (b.lap > prevLap && prevLap >= 0) {
        const lapTime = b._lapStartT !== undefined ? raceElapsed - b._lapStartT : null;
        if (lapTime && b.isPlayer) bestLapThisRace = Math.min(bestLapThisRace, lapTime);
        b._lapStartT = raceElapsed;
      }
      if (b._lapStartT === undefined) b._lapStartT = 0;
      if (b.lap >= TOTAL_LAPS && !b.finished) {
        b.finished = true;
        b.finishTime = raceElapsed;
      }
    }
    updateHud();
    if (bikes.every((b) => b.finished)) finishRace();
  }

  render();
  requestAnimationFrame(frame);
}

function updateHud() {
  const ranked = [...bikes].sort((a, b) => b.progress - a.progress);
  const pos = ranked.indexOf(playerBike) + 1;
  hudPos.textContent = `P${pos}`;
  const lapShown = Math.min(playerBike.lap + 1, TOTAL_LAPS);
  hudLap.textContent = `Lap ${lapShown} / ${TOTAL_LAPS}`;
  // real speedway bikes top out around 125-130 km/h on the straight (Maciej Janowski's
  // individual record is 126.1 km/h), so PHYS.maxSpeed maps to ~125 km/h here
  hudSpeed.textContent = `${Math.round(playerBike.speed * 0.5)} km/h`;
}

// ---------- Render ----------
function fillPolygon(pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
}

function strokePolygon(pts, color, width, dash) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGrandstand() {
  const steps = 120;
  const gap = 14, standDepth = 46;
  const innerPts = boundaryPoints(1, TRACK.apron + gap, steps);
  const outerPts = boundaryPoints(1, TRACK.apron + gap + standDepth, steps);
  const palette = ["#e2a83f", "#eab54c", "#d99433", "#f0c169", "#c96b3f", "#eab54c", "#e2a83f", "#f4d9a0"];
  const blockSize = 4;
  for (let i = 0; i < steps; i++) {
    const a = innerPts[i], b = innerPts[i + 1], c = outerPts[i + 1], d = outerPts[i];
    ctx.fillStyle = palette[Math.floor(i / blockSize) % palette.length];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }
  // shade cast by the roof canopy over the back rows of seating
  ctx.save();
  ctx.globalAlpha = 0.18;
  fillPolygon(outerPts, "#1a1a1a");
  fillPolygon(boundaryPoints(1, TRACK.apron + gap + standDepth * 0.4, steps), "#3f5c34"); // punch the shade back out over the front rows
  ctx.restore();
  strokePolygon(outerPts, "rgba(255,255,255,0.28)", 4);
}

// Wrocław's Stadion Olimpijski is known for its white tensile-fabric "petal" roof
// canopy over the seating bowl - approximated here as a scalloped white ring.
function drawRoofCanopy() {
  const steps = 200;
  const standOuterExtra = TRACK.apron + 14 + 46;
  const scallopCount = 44;
  const scallopDepth = 18;
  const innerPts = boundaryPoints(1, standOuterExtra, steps);
  const outerPts = [];
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * TRACK.totalLength;
    const p = centerlineAt(s);
    const wave = (Math.sin((i / steps) * Math.PI * 2 * scallopCount) + 1) / 2; // 0..1
    const hw = trackHalfWidthAt(s) + standOuterExtra + 8 + wave * scallopDepth;
    const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
    outerPts.push({ x: p.x + nx * hw, y: p.y + ny * hw });
  }

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "#f4f6f8";
  ctx.beginPath();
  ctx.moveTo(innerPts[0].x, innerPts[0].y);
  for (let i = 1; i < innerPts.length; i++) ctx.lineTo(innerPts[i].x, innerPts[i].y);
  for (let i = outerPts.length - 1; i >= 0; i--) ctx.lineTo(outerPts[i].x, outerPts[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // radial fold lines suggesting fabric panels between support pillars
  ctx.strokeStyle = "rgba(150,165,180,0.55)";
  ctx.lineWidth = 1;
  for (let i = 0; i < outerPts.length; i += 2) {
    ctx.beginPath();
    ctx.moveTo(innerPts[i].x, innerPts[i].y);
    ctx.lineTo(outerPts[i].x, outerPts[i].y);
    ctx.stroke();
  }
  strokePolygon(innerPts, "rgba(120,135,150,0.5)", 1.5);
}

function drawAdBoards() {
  const boardDepth = 5;
  const innerEdge = boundaryPoints(1, TRACK.apron - boardDepth);
  const outerEdge = boundaryPoints(1, TRACK.apron);
  const colors = ["#1f5fa8", "#1f5fa8", "#1f5fa8", "#e8e8e8"];
  const block = 6;
  for (let i = 0; i < innerEdge.length - 1; i++) {
    const a = innerEdge[i], b = innerEdge[i + 1], c = outerEdge[i + 1], d = outerEdge[i];
    ctx.fillStyle = colors[Math.floor(i / block) % colors.length];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawInfieldTower() {
  const x = TRACK.cx + TRACK.radius * 0.85;
  const y = TRACK.cy - TRACK.radius * 0.25;
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(x - 3, y - 42, 6, 42);
  ctx.fillRect(x - 16, y - 8, 32, 3);
  ctx.fillStyle = "#565656";
  ctx.fillRect(x - 15, y - 60, 30, 20);
  ctx.fillStyle = "#8ec9e0";
  ctx.fillRect(x - 12, y - 57, 24, 12);
}

function drawInfieldStripes(innerPts) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(innerPts[0].x, innerPts[0].y);
  for (let i = 1; i < innerPts.length; i++) ctx.lineTo(innerPts[i].x, innerPts[i].y);
  ctx.closePath();
  ctx.clip();
  const stripeW = 24;
  ctx.fillStyle = "rgba(0,0,0,0.07)";
  const left = TRACK.cx - TRACK.halfStraight - TRACK.radius;
  const right = TRACK.cx + TRACK.halfStraight + TRACK.radius;
  for (let x = left; x < right; x += stripeW * 2) {
    ctx.fillRect(x, TRACK.cy - TRACK.radius - 10, stripeW, TRACK.radius * 2 + 20);
  }
  ctx.restore();
}

function drawFloodlightPylon(x, y) {
  ctx.strokeStyle = "#2a2a2a";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 34); ctx.stroke();
  ctx.fillStyle = "#d8d8d8";
  ctx.fillRect(x - 10, y - 44, 20, 10);
  ctx.fillStyle = "rgba(255, 250, 200, 0.55)";
  ctx.beginPath(); ctx.arc(x, y - 39, 16, 0, Math.PI * 2); ctx.fill();
}

function drawFloodlights() {
  const dx = TRACK.halfStraight + TRACK.radius * 0.55;
  const dy = TRACK.radius * 1.55;
  const positions = [
    { x: TRACK.cx - dx, y: TRACK.cy - dy },
    { x: TRACK.cx + dx, y: TRACK.cy - dy },
    { x: TRACK.cx - dx, y: TRACK.cy + dy },
    { x: TRACK.cx + dx, y: TRACK.cy + dy },
  ];
  for (const p of positions) drawFloodlightPylon(p.x, p.y);
}

function drawTrack() {
  ctx.fillStyle = "#3f5c34";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrandstand();
  drawRoofCanopy();

  const outerPts = boundaryPoints(1, 0);
  const innerPts = boundaryPoints(-1, 0);
  const fenceOuterPts = boundaryPoints(1, TRACK.apron);
  const fenceInnerPts = boundaryPoints(-1, TRACK.apron);

  fillPolygon(fenceOuterPts, "#a5754a"); // loose apron
  fillPolygon(outerPts, "#8b5a3c");      // racing groove (shale)
  fillPolygon(innerPts, "#4f7a3d");      // infield grass
  drawInfieldStripes(innerPts);
  drawAdBoards();

  strokePolygon(outerPts, "#e9dcc4", 3);
  strokePolygon(innerPts, "#e9dcc4", 3);
  strokePolygon(fenceOuterPts, "#d1495b", 2.5, [7, 6]);
  strokePolygon(fenceInnerPts, "#d1495b", 2.5, [7, 6]);

  drawInfieldTower();

  drawFloodlights();

  // start/finish line, regulation position: middle of the straight
  const p = centerlineAt(START_S);
  const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
  const halfW = trackHalfWidthAt(START_S);
  drawChecker(p.x - nx * halfW, p.y - ny * halfW, p.x + nx * halfW, p.y + ny * halfW);
  drawStartGrid(p, nx, ny, halfW);
}

// Regulation starting grid: 4 gates marked by lines at right angles to the start line,
// extending back behind it - all riders line up on the same line, side by side.
function drawStartGrid(p, nx, ny, halfW) {
  const tx = Math.cos(p.angle), ty = Math.sin(p.angle);
  const lanes = 4;
  const gateDepth = 26;
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 2;
  for (let i = 1; i < lanes; i++) {
    const off = -halfW + (halfW * 2 * i) / lanes;
    const bx = p.x + nx * off, by = p.y + ny * off;
    const ex = bx - tx * gateDepth, ey = by - ty * gateDepth;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
}

function drawChecker(x1, y1, x2, y2) {
  const n = 8;
  const dx = (x2 - x1) / n, dy = (y2 - y1) / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#111" : "#eee";
    const px = x1 + dx * i, py = y1 + dy * i;
    ctx.fillRect(px - 3, py - 3, dx + 6, dy + 6);
  }
}

function drawBike(b) {
  // trail (dust)
  for (let i = 0; i < b.trail.length; i++) {
    const p = b.trail[i];
    const alpha = (i / b.trail.length) * 0.35;
    ctx.fillStyle = b.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (b.crashed) {
    ctx.fillStyle = "rgba(255,80,60,0.5)";
    ctx.beginPath(); ctx.arc(b.x, b.y, 14, 0, Math.PI * 2); ctx.fill();
  }

  const velAngle = b.speed > 5 ? Math.atan2(b.vy, b.vx) : b.heading;
  const drawAngle = velAngle + normAngle(b.heading - velAngle) * 0.35; // slight lean toward heading

  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(drawAngle);

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(1, 2, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // bike body
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(-8, 5);
  ctx.lineTo(-8, -5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(-9, -2, 4, 4);
  ctx.fillRect(6, -2, 4, 4);

  ctx.restore();

  if (b.isPlayer) {
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.moveTo(b.x, b.y - 18);
    ctx.lineTo(b.x - 5, b.y - 26);
    ctx.lineTo(b.x + 5, b.y - 26);
    ctx.closePath();
    ctx.fill();
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawTrack();
  for (const b of bikes) drawBike(b);
}

requestAnimationFrame(frame);
