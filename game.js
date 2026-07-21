"use strict";

// ---------- Track ----------
// Stadium oval: two straights + two semicircle turns, traversed counter-clockwise
// (bottom straight L->R, right-end turn, top straight R->L, left-end turn),
// matching real speedway where every corner is a left turn.
const TRACK = {
  cx: 550, cy: 325,
  halfStraight: 260,
  radius: 150,
  width: 100,
};
TRACK.innerRadius = TRACK.radius - TRACK.width / 2;
TRACK.outerRadius = TRACK.radius + TRACK.width / 2;
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

// Signed lateral offset of (x,y) from the centerline at arc-length s (+ = to the right of travel).
function lateralOffset(x, y, s) {
  const p = centerlineAt(s);
  const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
  return (x - p.x) * nx + (y - p.y) * ny;
}

const START_S = 0; // start/finish line at beginning of bottom straight

// ---------- Bike ----------
const PHYS = {
  maxSpeed: 250,          // px/s
  enginePower: 230,       // px/s^2 forward drive
  turnEnginePenalty: 0.5, // engine drive multiplier while steering (less drive, more slide)
  turnRate: 2.7,          // rad/s heading rotation while steering left
  gripStraight: 6.0,      // 1/s blend rate of velocity->heading when not steering
  gripTurning: 1.9,       // 1/s blend rate while steering (lower = more drift)
  slipLossFactor: 1.6,    // speed lost per second per radian of slip, scaled by speed
  drag: 0.35,             // linear drag coefficient
  offTrackDrag: 2.6,      // extra drag when off the racing surface
  offTrackMax: 0.55,      // speed cap multiplier when deep off track
};

class Bike {
  constructor(color, name, isPlayer) {
    this.color = color;
    this.name = name;
    this.isPlayer = isPlayer;
    const start = centerlineAt(START_S);
    this.x = start.x;
    this.y = start.y - TRACK.width * 0.28; // lane offset, set by caller
    this.heading = start.angle;
    this.vx = 0; this.vy = 0;
    this.trackS = START_S;
    this.lap = 0;
    this.finished = false;
    this.finishTime = null;
    this.raceTime = 0;
    this.trail = [];
    this.steering = false;
    this._lastS = START_S;
    this._crossOffset = 0; // cumulative distance for lap fraction display
  }

  get speed() { return Math.hypot(this.vx, this.vy); }

  update(dt, steering, elapsed) {
    this.steering = steering;
    if (steering) this.heading -= PHYS.turnRate * dt;

    const speedBefore = this.speed;
    const drivePenalty = steering ? PHYS.turnEnginePenalty : 1;
    this.vx += Math.cos(this.heading) * PHYS.enginePower * drivePenalty * dt;
    this.vy += Math.sin(this.heading) * PHYS.enginePower * drivePenalty * dt;

    let speed = this.speed;
    if (speed > 0.001) {
      const velAngle = Math.atan2(this.vy, this.vx);
      const diff = normAngle(this.heading - velAngle);
      const grip = steering ? PHYS.gripTurning : PHYS.gripStraight;
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

    // off-track handling
    this.trackS = projectToTrack(this.x, this.y, this.trackS);
    const offset = lateralOffset(this.x, this.y, this.trackS);
    const halfW = TRACK.width / 2;
    const overshoot = Math.max(0, Math.abs(offset) - halfW);
    this.offTrack = overshoot > 0;
    if (overshoot > 0) {
      const t = Math.min(1, overshoot / (halfW * 0.8));
      speed = this.speed;
      const cap = PHYS.maxSpeed * (1 - t * (1 - PHYS.offTrackMax));
      const extraDrag = PHYS.offTrackDrag * t * dt;
      let ns = Math.max(0, speed - speed * extraDrag);
      if (ns > cap) ns = cap;
      if (speed > 0) {
        const scale = ns / speed;
        this.vx *= scale; this.vy *= scale;
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
function aiSteer(bike, lookAheadBase) {
  const look = lookAheadBase + bike.speed * 0.38;
  const targetS = bike.trackS + look;
  const target = centerlineAt(targetS + (bike.aiLineOffset || 0) * 0);
  const tx = target.x + Math.sin(target.angle) * (bike.aiLine || 0);
  const ty = target.y - Math.cos(target.angle) * (bike.aiLine || 0);

  const toTargetAngle = Math.atan2(ty - bike.y, tx - bike.x);
  const diff = normAngle(toTargetAngle - bike.heading);
  return diff < -bike.aiThreshold;
}

// ---------- Game ----------
const canvas = document.getElementById("track");
const ctx = canvas.getContext("2d");

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
const steerBtn = document.getElementById("steerBtn");

const TOTAL_LAPS = 4;
const RECORD_KEY = "speedway_best_lap";

let state = "menu"; // menu | countdown | racing | finished
let bikes = [];
let playerBike = null;
let raceElapsed = 0;
let countdownT = 0;
let inputLeft = false;
let bestLapThisRace = Infinity;

const COLORS = [
  { color: "#ffd23f", name: "YOU" },
  { color: "#ff5d3b", name: "RIDER 2" },
  { color: "#6fd3ff", name: "RIDER 3" },
  { color: "#8effa1", name: "RIDER 4" },
];

function setupRace() {
  bikes = COLORS.map((c, i) => {
    const b = new Bike(c.color, c.name, i === 0);
    return b;
  });
  // stagger starting positions across the track width and slightly back from the line
  bikes.forEach((b, i) => {
    const laneOffset = -TRACK.width * 0.34 + i * (TRACK.width * 0.22);
    const backOffset = i * 22;
    const s = START_S - backOffset;
    const p = centerlineAt(s);
    const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
    b.x = p.x + nx * laneOffset;
    b.y = p.y + ny * laneOffset;
    b.heading = p.angle;
    b.trackS = s;
    b._lastS = s;
    if (!b.isPlayer) {
      b.aiLine = laneOffset * 0.5;
      b.aiThreshold = 0.05 + Math.random() * 0.07;
      b.aiLook = 55 + Math.random() * 25 - i * 4;
      b.aiSkillJitter = 0.85 + Math.random() * 0.3;
    }
  });
  playerBike = bikes[0];
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
  order.forEach((b) => {
    const li = document.createElement("li");
    const t = b.finished ? formatTime(b.finishTime) : "DNF";
    li.textContent = `${b.name} — ${t}`;
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
  if (e.code === "Space") { inputLeft = true; e.preventDefault(); }
  if (e.code === "Escape") { returnToMenu(); }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") { inputLeft = false; }
});
function bindHold(el, on, off) {
  el.addEventListener("mousedown", (e) => { on(); e.preventDefault(); });
  el.addEventListener("touchstart", (e) => { on(); e.preventDefault(); }, { passive: false });
  window.addEventListener("mouseup", off);
  window.addEventListener("touchend", off);
}
bindHold(steerBtn,
  () => { inputLeft = true; steerBtn.classList.add("pressed"); },
  () => { inputLeft = false; steerBtn.classList.remove("pressed"); }
);

startBtn.addEventListener("click", startCountdown);
restartBtn.addEventListener("click", startCountdown);

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
    let prevPlayerLap = playerBike.lap;
    for (const b of bikes) {
      if (b.finished) continue;
      const prevLap = b.lap;
      const steering = b.isPlayer ? inputLeft : aiSteer(b, b.aiLook || 60) && Math.random() < (b.aiSkillJitter || 1);
      b.update(dt, steering, raceElapsed);
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
  hudSpeed.textContent = `${Math.round(playerBike.speed * 1.3)} km/h`;
}

// ---------- Render ----------
function drawTrack() {
  const t = TRACK;
  ctx.fillStyle = "#6b8e4e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // outer dirt surface
  drawStadium(t.outerRadius, "#b98a5a");
  // inner infield (grass)
  drawStadium(t.innerRadius, "#5a8046");

  // boundary lines
  strokeStadium(t.outerRadius, "#e9dcc4", 3);
  strokeStadium(t.innerRadius, "#e9dcc4", 3);

  // start/finish line
  const p = centerlineAt(START_S);
  const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
  const halfW = t.width / 2;
  drawChecker(p.x - nx * halfW, p.y - ny * halfW, p.x + nx * halfW, p.y + ny * halfW);
}

function drawStadium(r, color) {
  const t = TRACK;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(t.cx - t.halfStraight, t.cy - r);
  ctx.lineTo(t.cx + t.halfStraight, t.cy - r);
  ctx.arc(t.cx + t.halfStraight, t.cy, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(t.cx - t.halfStraight, t.cy + r);
  ctx.arc(t.cx - t.halfStraight, t.cy, r, Math.PI / 2, Math.PI * 1.5, false);
  ctx.closePath();
  ctx.fill();
}

function strokeStadium(r, color, width) {
  const t = TRACK;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(t.cx - t.halfStraight, t.cy - r);
  ctx.lineTo(t.cx + t.halfStraight, t.cy - r);
  ctx.arc(t.cx + t.halfStraight, t.cy, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(t.cx - t.halfStraight, t.cy + r);
  ctx.arc(t.cx - t.halfStraight, t.cy, r, Math.PI / 2, Math.PI * 1.5, false);
  ctx.closePath();
  ctx.stroke();
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
