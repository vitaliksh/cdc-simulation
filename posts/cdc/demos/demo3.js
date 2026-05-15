const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');

const TABLEAU_CELL_W = 26;
const INITIAL_TABLEAU = "101001";
const D_EMIT_A = 18;
const D_COLLECT_B = 18;
const TABLEAU_B_TOP = 480;
// Smaller than demo2 (1.0) so FALL_THROUGH_GAP is achievable at higher gap values
const BALL_COEFF = 0.75;

// Read shared CSS palette
const _cs = getComputedStyle(document.documentElement);
const CLR_ACCENT  = _cs.getPropertyValue('--demo-accent').trim()  || '#E07A2F';
const CLR_BTN     = _cs.getPropertyValue('--demo-btn').trim()     || '#6B5D4F';
const CLR_BORDER  = _cs.getPropertyValue('--demo-border').trim()  || '#3D3229';
const CLR_STOP    = _cs.getPropertyValue('--error').trim()         || '#d32f2f';
const CLR_OK      = _cs.getPropertyValue('--ok').trim()            || '#4D854F';
const CLR_BG      = _cs.getPropertyValue('--demo-bg').trim()        || '#d1bb90';
const BALL_1 = { c0: _cs.getPropertyValue('--ball-1-hi').trim()  || '#ffb3b3', c1: _cs.getPropertyValue('--ball-1-mid').trim() || '#e53935', c2: _cs.getPropertyValue('--ball-1-lo').trim()  || '#8e0000' };
const BALL_0 = { c0: _cs.getPropertyValue('--ball-0-hi').trim()  || '#82b1ff', c1: _cs.getPropertyValue('--ball-0-mid').trim() || '#1e88e5', c2: _cs.getPropertyValue('--ball-0-lo').trim()  || '#0d47a1' };

const state = {
  running: false,
  paused: false,
  canEdit: true,
  animSpeed: 1.0,
  gateOpen: false,
  timeouts: [],
  isSyncMode: true,
  soundEnabled: false,
  gapW: 0   // Setup+Hold window gap width in pixels
};

// --- AUDIO SYSTEM ---
const audioBelt = new Audio('conveyor_belt.wav');
audioBelt.volume = 0.2;
audioBelt.loop = true;

['ball_drop.wav', 'success.wav', 'wrong.wav', 'tableou_in.mp3'].forEach(src => {
  new Audio(src).load();
});

function playFx(src) {
  if (!state.soundEnabled) return;
  const a = new Audio(src);
  a.play().catch(e => {});
}

document.getElementById('btnSound').onclick = function() {
  state.soundEnabled = !state.soundEnabled;
  this.innerHTML = state.soundEnabled ? '🔊' : '🔇';
  this.style.background = state.soundEnabled ? CLR_ACCENT : CLR_BORDER;
  if (!state.soundEnabled && !audioBelt.paused) {
    audioBelt.pause();
  }
};
// --------------------

let balls = [];
let nextBallIndexA = 0;

let tableauACells = [];
let originalCodeBits = [];
let sourceConsumedCount = 0;
let sourceLatched = false;
let tableauBCells = [];
let frameHistory = [];

class Conveyor {
  constructor(geom, initialWa, isA) {
    this.geom = geom;
    this.Wa = initialWa;
    this.absOffset = 0;
    this.isA = isA;
  }

  getActualWa() {
    const peri = 2 * this.geom.L + 2 * Math.PI * this.geom.R;
    const n = Math.max(1, Math.round(peri / this.Wa));
    return peri / n;
  }

  getPathPoint(dist, radiusOffset = 0) {
    const { startX, startY, L, R } = this.geom;
    const peri = 2 * L + 2 * Math.PI * R;
    let pos = dist % peri;
    if (pos < 0) pos += peri;
    const Ro = R + radiusOffset;

    if (pos <= L) {
      return { x: startX + pos, y: startY - Ro, a: -Math.PI / 2 };
    }
    if (pos <= L + Math.PI * R) {
      const arc = pos - L;
      const ang = -Math.PI / 2 + (arc / R);
      return { x: startX + L + Ro * Math.cos(ang), y: startY + Ro * Math.sin(ang), a: ang };
    }
    if (pos <= 2 * L + Math.PI * R) {
      const over = pos - (L + Math.PI * R);
      return { x: startX + L - over, y: startY + Ro, a: Math.PI / 2 };
    }
    const arc = pos - (2 * L + Math.PI * R);
    const ang = Math.PI / 2 + (arc / R);
    return { x: startX + Ro * Math.cos(ang), y: startY + Ro * Math.sin(ang), a: ang };
  }

  draw(ctx) {
    const { startX, startY, L, R, partH } = this.geom;
    const wheelAngle = this.absOffset / R;

    drawWheel(ctx, startX, startY, R, wheelAngle);
    drawWheel(ctx, startX + L, startY, R, wheelAngle);

    // Belt tape — full loop, gaps will be masked afterwards
    ctx.beginPath();
    ctx.moveTo(startX, startY - R);
    ctx.lineTo(startX + L, startY - R);
    ctx.arc(startX + L, startY, R, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(startX, startY + R);
    ctx.arc(startX, startY, R, Math.PI / 2, Math.PI * 1.5);
    ctx.strokeStyle = CLR_BTN;
    ctx.lineWidth = 4;
    ctx.stroke();

    const actualWa = this.getActualWa();
    const peri = 2 * L + 2 * Math.PI * R;
    const minK = Math.floor((this.absOffset - peri) / actualWa);
    const maxK = Math.ceil((this.absOffset + peri) / actualWa);

    const wallW = 8;
    const floorH = 4; // bucket floor strip height
    const gapW = state.gapW;
    const halfGap = gapW / 2;
    const halfWall = wallW / 2;

    // Helper: draw one rectangular wall piece from path pos d1 to d2, extruding outward by partH
    const drawWallPiece = (d1, d2) => {
      const p1_in  = this.getPathPoint(d1, 0);
      const p2_in  = this.getPathPoint(d2, 0);
      const p2_out = this.getPathPoint(d2, partH);
      const p1_out = this.getPathPoint(d1, partH);

      ctx.beginPath();
      ctx.moveTo(p1_in.x, p1_in.y);
      ctx.lineTo(p2_in.x, p2_in.y);
      ctx.lineTo(p2_out.x, p2_out.y);
      ctx.lineTo(p1_out.x, p1_out.y);
      ctx.closePath();
      ctx.fillStyle = '#4A3D33';
      ctx.fill();
      ctx.strokeStyle = '#2D2A26';
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    for (let k = minK; k <= maxK; k++) {
      const d = this.absOffset - k * actualWa;
      if (d >= 0 && d < peri) {
        const isTopHalf = (d >= 0 && d <= L + Math.PI * R / 2) ||
                          (d >= 2 * L + 1.5 * Math.PI * R && d < peri);

        if (isTopHalf) {
          // Solid bucket floor on the straight top segment (open-top box appearance)
          if (d <= L) {
            const floorLeft  = (d - actualWa) + halfGap + halfWall;
            const floorRight = d - halfGap - halfWall;
            const xL = startX + Math.max(floorLeft, 0);
            const xR = startX + Math.min(floorRight, L);
            if (xR > xL) {
              ctx.fillStyle = '#4A3D33';
              ctx.fillRect(xL, startY - R - floorH, xR - xL, floorH);
            }
          }

          // Each bucket division is split into left half-wall and right half-wall,
          // with a gap of `gapW` between them. When gapW=0 they merge into one wall.
          drawWallPiece(d - halfGap - halfWall, d - halfGap);
          drawWallPiece(d + halfGap,            d + halfGap + halfWall);
        }
      }
    }

    // Mask the belt tape in the gap regions on the top segment only
    if (gapW > 0) {
      for (let k = minK; k <= maxK; k++) {
        const d = this.absOffset - k * actualWa;
        if (d > 0 && d < L) {
          const xL = Math.max(startX + d - halfGap, startX);
          const xR = Math.min(startX + d + halfGap, startX + L);
          if (xR > xL) {
            ctx.fillStyle = CLR_BG;
            ctx.fillRect(xL, startY - R - 2, xR - xL, 5);
          }
        }
      }
    }
  }

  update() {
    if (!state.running) return;
    this.absOffset += state.animSpeed;
  }
}

function drawWheel(ctx, cx, cy, r, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = CLR_BTN;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#8A7A6A';
  ctx.stroke();
  ctx.beginPath();
  const xLen = r * 0.6;
  ctx.moveTo(-xLen, -xLen);
  ctx.lineTo(xLen, xLen);
  ctx.moveTo(-xLen, xLen);
  ctx.lineTo(xLen, -xLen);
  ctx.stroke();
  ctx.restore();
}

function getBallPalette(bit) {
  return bit === '1' ? BALL_1 : BALL_0;
}

function draw3DBall(ctx, cx, cy, r, bit, isSplit = false, splitSide = null) {
  if (r <= 0) return;
  const p = getBallPalette(bit);

  ctx.save();

  if (isSplit) {
    ctx.beginPath();
    if (splitSide === 'left') {
      ctx.rect(cx - r - 2, cy - r - 2, r + 2, r * 2 + 4);
    } else {
      ctx.rect(cx, cy - r - 2, r + 2, r * 2 + 4);
    }
    ctx.clip();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(
    cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r
  );
  grad.addColorStop(0, p.c0);
  grad.addColorStop(0.7, p.c1);
  grad.addColorStop(1, p.c2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();

  if (isSplit) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + (splitSide === 'left' ? -r*0.2 : r*0.2), cy - r/2);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + (splitSide === 'left' ? -r*0.2 : r*0.2), cy + r/2);
    ctx.lineTo(cx, cy + r);
    ctx.strokeStyle = CLR_BORDER;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

function getPosOnConveyor(conv, d, r, offsetX) {
  const pt = conv.getPathPoint(d, r);
  return {
    x: pt.x - offsetX * Math.sin(pt.a),
    y: pt.y + offsetX * Math.cos(pt.a)
  };
}

function getBallRadiusA() { return (convA.getActualWa() * BALL_COEFF) / 2; }
function getBallRadiusB() { return (convB.getActualWa() * BALL_COEFF) / 2; }

function getTableauAGatePoint() {
  const tab = document.getElementById('tableauA');
  const tabRect = tab.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  return {
    x: (tabRect.left - canvasRect.left) + 4 + TABLEAU_CELL_W / 2,
    y: (tabRect.bottom - canvasRect.top) + 4
  };
}

function getTableauBGatePoint() {
  const tab = document.getElementById('tableauB');
  const tabRect = tab.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  return {
    x: (tabRect.right - canvasRect.left) - (4 + TABLEAU_CELL_W / 2),
    y: (tabRect.top - canvasRect.top) - 4
  };
}

function getTableauBEntryPoint() {
  const tab = document.getElementById('tableauB');
  const tabRect = tab.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  return {
    x: (tabRect.right - canvasRect.left) - (4 + TABLEAU_CELL_W / 2),
    y: (tabRect.top - canvasRect.top) + 4 + 15
  };
}

function getBVerticalDropX() {
  return convB.geom.startX + convB.geom.L + convB.geom.R + getBallRadiusB();
}

function positionTableauBWrapper() {
  const wrapper = document.getElementById('tableauBWrapper');
  const tab = document.getElementById('tableauB');
  if (!wrapper || !tab) return;
  const tabWidth = tab.offsetWidth || 0;
  const gateOffsetFromLeft = tabWidth - (4 + TABLEAU_CELL_W / 2);
  const targetGateX = getBVerticalDropX();
  wrapper.style.left = `${Math.round(targetGateX - gateOffsetFromLeft)}px`;
  wrapper.style.top = `${TABLEAU_B_TOP}px`;
}

function resetSourceLatch() {
  originalCodeBits = [];
  sourceConsumedCount = 0;
  sourceLatched = false;
}

function latchSourceFromVisibleTableau() {
  originalCodeBits = tableauACells.map(c => c.bit);
  sourceConsumedCount = 0;
  sourceLatched = true;
}

function hasMoreSourceSymbols() {
  return sourceConsumedCount < originalCodeBits.length;
}

function shiftTableauAAndConsumeBit() {
  if (tableauACells.length === 0 || !hasMoreSourceSymbols()) return null;
  const outBit = tableauACells[0].bit;
  const newCells = [];
  for (let i = 0; i < tableauACells.length - 1; i++) {
    newCells.push({ bit: tableauACells[i + 1].bit, light: tableauACells[i + 1].light });
  }
  newCells.push({ bit: null, light: false });
  tableauACells = newCells;
  sourceConsumedCount++;
  updateTableauA(false);
  return outBit;
}

function getTableauBCellCount() {
  return 18;
}

function clearTableauB() {
  const count = getTableauBCellCount();
  tableauBCells = new Array(count).fill(null).map(() => ({ bit: null, light: false }));
  tableauBBaseIndex = null;
}

let tableauBBaseIndex = null;

function pushBitIntoTableauB(bit, indexB) {
  if (tableauBCells.length === 0) clearTableauB();

  tableauBCells.shift();
  tableauBCells.push({ bit: bit, light: false });

  updateTableauB(false);
}

function setPlayButtonVisual(isRunning) {
  const btnPlay = document.getElementById('btnPlay');
  if (isRunning) {
    btnPlay.innerHTML = "PAUSE &#9646;&#9646;";
    btnPlay.style.background = CLR_STOP;
  } else if (state.paused) {
    btnPlay.innerHTML = "CONTINUE &#9654;";
    btnPlay.style.background = CLR_BTN;
  } else {
    btnPlay.innerHTML = "START &#9654;";
    btnPlay.style.background = CLR_BTN;
  }
}

function setPausedDisabled(disabled) {
  document.getElementById('slAnimSpeed').disabled = disabled;
  document.getElementById('slTimeline').disabled = !disabled;
}

function toggleStepControls(disabled) {
  document.getElementById('slStepA').disabled = disabled;
  document.getElementById('slStepB').disabled = disabled || state.isSyncMode;
  document.getElementById('slGapW').disabled = disabled;
  const toggle = document.getElementById('syncToggle');
  if (disabled) {
    toggle.classList.add('disabled-toggle');
  } else {
    toggle.classList.remove('disabled-toggle');
  }
}

function clearEndSequenceVisuals() {
  if (state.timeouts) {
    state.timeouts.forEach(clearTimeout);
  }
  state.timeouts = [];

  const clone = document.getElementById('tableauBWrapperClone');
  if (clone) clone.remove();

  const wrapperB = document.getElementById('tableauBWrapper');
  if (wrapperB) wrapperB.classList.remove('faded');

  const resTextEl = document.getElementById('resultText');
  if (resTextEl) {
    resTextEl.classList.remove('visible');
    resTextEl.remove();
  }

  const tabAWrapper = document.getElementById('tableauAWrapper');
  if (tabAWrapper) {
    tabAWrapper.style.transition = '';
    tabAWrapper.style.left = '30px';
    tabAWrapper.style.top = '30px';

    const titleA = tabAWrapper.querySelector('.tableau-title');
    if (titleA) {
      titleA.style.position = '';
      titleA.style.left = '';
      titleA.style.top = '';
      titleA.style.transition = '';
    }
    const tabAElem = tabAWrapper.querySelector('.tableau');
    if (tabAElem) tabAElem.style.marginTop = '';
  }
}

function autoStopIfDone() {
  if (!state.running || !sourceLatched || hasMoreSourceSymbols() || balls.length > 0) return;
  state.running = false;
  state.paused = false;
  setPlayButtonVisual(false);
  toggleStepControls(false);
  drawAll();

  document.getElementById('btnPlay').disabled = true;

  tableauACells = originalCodeBits.map(b => ({ bit: b, light: false }));
  updateTableauA(false);

  const wrapperB = document.getElementById('tableauBWrapper');
  const cloneWrapper = wrapperB.cloneNode(true);
  cloneWrapper.id = 'tableauBWrapperClone';
  cloneWrapper.classList.add('clone');

  const cloneTab = cloneWrapper.querySelector('#tableauB');
  if (cloneTab) cloneTab.id = 'tableauBClone';

  document.querySelector('.canvas-container').appendChild(cloneWrapper);

  cloneWrapper.style.top = `${TABLEAU_B_TOP}px`;
  void cloneWrapper.offsetWidth;

  cloneWrapper.style.top = '30px';

  const titleA = document.getElementById('tableauAWrapper').querySelector('.tableau-title');
  const cloneTitle = cloneWrapper.querySelector('.tableau-title');
  titleA.style.transition = 'all 1s ease-in-out';
  cloneTitle.style.transition = 'all 1s ease-in-out';

  state.timeouts.push(setTimeout(() => {
    wrapperB.classList.add('faded');
  }, 2000));

  state.timeouts.push(setTimeout(() => {
    cloneWrapper.style.transition = 'top 1s ease-in-out, left 1s ease-in-out';
    cloneWrapper.style.top = '80px';

    cloneTitle.style.position = 'absolute';
    if (cloneTab) cloneTab.style.marginTop = '21px';

    const cloneLeft = cloneWrapper.offsetLeft;
    cloneTitle.style.left = (100 - cloneLeft) + 'px';
    cloneTitle.style.top = (116 - 80) + 'px';
  }, 3000));

  state.timeouts.push(setTimeout(() => {
    const tabAWrapper = document.getElementById('tableauAWrapper');
    const tabAElem = tabAWrapper.querySelector('.tableau');
    const rightEdgeB = cloneWrapper.offsetLeft + cloneWrapper.offsetWidth;
    const targetLeftA = rightEdgeB - tabAWrapper.offsetWidth;

    tabAWrapper.style.transition = 'left 1s ease-in-out, top 1s ease-in-out';
    tabAWrapper.style.left = targetLeftA + 'px';

    titleA.style.position = 'absolute';
    if (tabAElem) tabAElem.style.marginTop = '21px';

    titleA.style.left = (415 - targetLeftA) + 'px';
    titleA.style.top = (66 - 30) + 'px';
  }, 4500));

  state.timeouts.push(setTimeout(() => {
    const strA = originalCodeBits.join('');
    const strB = tableauBCells.filter(c => c.bit !== null).map(c => c.bit).join('');
    const isMatch = (strA === strB);

    if (state.soundEnabled) playFx(isMatch ? 'success.wav' : 'wrong.wav');

    let resTextEl = document.getElementById('resultText');
    if (!resTextEl) {
      resTextEl = document.createElement('div');
      resTextEl.id = 'resultText';
      resTextEl.className = 'result-text';
      document.querySelector('.canvas-container').appendChild(resTextEl);
    }
    resTextEl.innerText = isMatch ? 'Code A = Code B' : 'Code A \u2260 Code B';
    resTextEl.style.color = isMatch ? CLR_OK : CLR_STOP;

    void resTextEl.offsetWidth;
    resTextEl.classList.add('visible');
  }, 5500));
}

function computeSplitTargets(fx, actualWaA, actualWaB, currentAbsOffsetB) {
  const BLX = fx - actualWaA / 2;
  const BRX = fx + actualWaA / 2;

  const k_left  = Math.floor((currentAbsOffsetB - (BLX - convB.geom.startX)) / actualWaB);
  const k_right = Math.floor((currentAbsOffsetB - (BRX - convB.geom.startX)) / actualWaB);

  const hits = [];

  for (let k = k_left - 1; k >= k_right; k--) {
    let splitSide = 'right';
    if (k === k_left - 1 && k > k_right) {
      splitSide = 'left';
    }
    hits.push({ k: k, isSplit: true, splitSide: splitSide, offsetD: 0 });
  }

  return hits;
}

function updateBalls() {
  const actualWaA = convA.getActualWa();
  const actualWaB = convB.getActualWa();
  const radiusA = getBallRadiusA();
  const radiusB = getBallRadiusB();
  const D_FALL = 20;
  const maxIndexA = Math.floor(convA.absOffset / actualWaA);

  while (nextBallIndexA <= maxIndexA) {
    if (nextBallIndexA >= 0 && sourceLatched && hasMoreSourceSymbols()) {
      const bit = shiftTableauAAndConsumeBit();
      const src = getTableauAGatePoint();
      balls.push({
        indexA: nextBallIndexA, r: radiusA, bit: bit, state: 'EMIT_A',
        emitStartOffsetA: convA.absOffset, emitFromX: src.x, emitFromY: src.y, x: src.x, y: src.y
      });
    }
    nextBallIndexA++;
  }

  // First pass: check for state transitions that depend on position
  balls.forEach(b => {
    if (b.state === 'A') {
      const d = convA.absOffset - (b.indexA * actualWaA + actualWaA / 2);
      const distFall = convA.geom.L + Math.PI * convA.geom.R / 2;
      if (d > distFall) {
        b.state = 'FALL_A';
        b.startFallOffsetB = convB.absOffset;
        b.dropStartX = convA.geom.startX + convA.geom.L + convA.geom.R + b.r;
      }
    }

    if (b.state === 'B' || b.state === 'DOOMED_B') {
      const dB = convB.absOffset - (b.indexB * actualWaB + actualWaB / 2) + (b.offsetD || 0);
      const distFallB = convB.geom.L + Math.PI * convB.geom.R / 2;
      if (dB > distFallB) {
        const pos = getPosOnConveyor(convB, dB, b.r, 0);
        const gate = getTableauBGatePoint();
        const entry = getTableauBEntryPoint();
        b.state = 'COLLECT_B';
        b.collectStartOffsetB = convB.absOffset;
        b.collectFromX = gate.x; b.collectFromY = pos.y;
        b.collectGateX = gate.x; b.collectGateY = gate.y;
        b.collectTargetX = entry.x; b.collectTargetY = entry.y;
      }
    }
  });

  const newBalls = [];
  const survivors = [];

  balls.forEach(b => {
    // Split halves stay split for their entire journey on conveyor B (no merge-back)

    if (b.state === 'EMIT_A') {
      const progress = (convA.absOffset - b.emitStartOffsetA) / D_EMIT_A;
      const dA = convA.absOffset - (b.indexA * actualWaA + actualWaA / 2);
      const targetPos = getPosOnConveyor(convA, dA, b.r, 0);
      if (progress >= 1.0) {
        if (state.soundEnabled) playFx('ball_drop.wav');
        b.state = 'A';
        b.x = targetPos.x; b.y = targetPos.y;
      } else {
        const t = Math.max(0, progress);
        b.x = b.emitFromX + (targetPos.x - b.emitFromX) * t;
        b.y = b.emitFromY + (targetPos.y - b.emitFromY) * (t * t);
      }
      survivors.push(b);

    } else if (b.state === 'A') {
      const d = convA.absOffset - (b.indexA * actualWaA + actualWaA / 2);
      const pos = getPosOnConveyor(convA, d, b.r, 0);
      b.x = pos.x; b.y = pos.y;
      survivors.push(b);

    } else if (b.state === 'FALL_A') {
      const progress = (convB.absOffset - b.startFallOffsetB) / D_FALL;
      const targetY = convB.geom.startY - convB.geom.R;

      if (progress >= 1.0) {
        b.x = b.dropStartX + (convB.absOffset - b.startFallOffsetB);

        // --- Demo3: detect if ball center lands within a gap ---
        if (state.gapW > 0) {
          const path_pos = b.x - convB.geom.startX;
          const k_nearest = Math.round((convB.absOffset - path_pos) / actualWaB);
          const x_div = convB.geom.startX + (convB.absOffset - k_nearest * actualWaB);
          if (Math.abs(b.x - x_div) < state.gapW / 2) {
            b.r = radiusB;
            if (2 * radiusB > state.gapW) {
              // Ball diameter > gap: ball rests on the two wall edges (metastable)
              b.state = 'METASTABLE';
              b.gapDivK = k_nearest;
              b.metastableStart = Date.now();
              b.metastableDelay = 500 + Math.random() * 1500;
              b.x = x_div;
              b.y = targetY - convB.geom.partH - b.r;
            } else {
              // Ball diameter <= gap: ball falls straight through (data lost)
              b.state = 'FALL_THROUGH_GAP';
              b.dropStartOffsetB = convB.absOffset;
              b.dropStartX = b.x;
              b.dropStartY = targetY - b.r;
            }
            survivors.push(b);
            return; // skip normal landing logic
          }
        }
        // --- end gap detection ---

        const hits = computeSplitTargets(b.x, actualWaA, actualWaB, convB.absOffset);

        if (hits.length > 0) {
          if (state.soundEnabled) playFx('ball_drop.wav');
          hits.forEach(hit => {
            balls
              .filter(other => (other.state === 'B' || other.state === 'DOOMED_B') && other.indexB === hit.k)
              .forEach(existing => {
                existing.state = 'DOOMED_B';
                existing.doomOffsetB = convB.absOffset;
              });
          });

          hits.forEach((hit, idx) => {
            if (idx === 0) {
              b.state = 'B'; b.indexB = hit.k; b.offsetD = hit.offsetD || 0; b.r = radiusB;
              b.isSplit = hit.isSplit; b.splitSide = hit.splitSide;
              b.timeHitB = Date.now();
            } else {
              newBalls.push({
                bit: b.bit, r: radiusB, state: 'B', indexB: hit.k, offsetD: hit.offsetD || 0,
                isSplit: hit.isSplit, splitSide: hit.splitSide, x: b.x, y: targetY - radiusB,
                timeHitB: Date.now()
              });
            }
          });
          const dB = convB.absOffset - (b.indexB * actualWaB + actualWaB / 2) + (b.offsetD || 0);
          const pos = getPosOnConveyor(convB, dB, b.r, 0);
          b.x = pos.x; b.y = pos.y;
          survivors.push(b);
        } else {
          b.state = 'FALL_MISS';
          b.dropStartOffsetB = convB.absOffset;
          b.dropStartX = b.x;
          b.dropStartY = targetY - b.r;
          survivors.push(b);
        }
      } else {
        b.x = b.dropStartX + (convB.absOffset - b.startFallOffsetB);
        b.y = convA.geom.startY + (targetY - b.r - convA.geom.startY) * (progress * progress);
        survivors.push(b);
      }

    } else if (b.state === 'METASTABLE') {
      // Ball tracks the wall it rests on, wobbling in Y
      const x_div = convB.geom.startX + (convB.absOffset - b.gapDivK * actualWaB);
      b.x = x_div;
      b.y = convB.geom.startY - convB.geom.R - convB.geom.partH - b.r
            + Math.sin(Date.now() * 0.014) * 2.5;

      // Drop as miss if wall has scrolled off the right end of the top segment
      if (x_div > convB.geom.startX + convB.geom.L + convB.geom.R) {
        b.state = 'FALL_MISS';
        b.dropStartOffsetB = convB.absOffset;
        b.dropStartX = x_div;
        b.dropStartY = b.y;
        survivors.push(b);
        return;
      }

      // After random delay, resolve into left or right bucket
      if (Date.now() - b.metastableStart >= b.metastableDelay) {
        const goLeft = Math.random() < 0.5;
        b.indexB = goLeft ? b.gapDivK : b.gapDivK - 1;
        // offsetD places the ball at the gap center within the chosen bucket
        // so there is no visual jump (smooth transition from wall to bucket)
        b.offsetD = goLeft ? actualWaB / 2 : -actualWaB / 2;
        b.bit = Math.floor(Date.now() / 250) % 2 === 0 ? b.bit : (b.bit === '1' ? '0' : '1');
        b.state = 'B';
        b.isSplit = false;
      }
      survivors.push(b);

    } else if (b.state === 'FALL_THROUGH_GAP') {
      // Ball falls straight down and disappears (data lost)
      const dropProgress = convB.absOffset - b.dropStartOffsetB;
      const tt = dropProgress / 20;
      b.x = b.dropStartX;
      b.y = b.dropStartY + 200 * tt * tt;
      if (b.y < canvas.height + 50) survivors.push(b);

    } else if (b.state === 'B' || b.state === 'DOOMED_B') {
      const dB = convB.absOffset - (b.indexB * actualWaB + actualWaB / 2) + (b.offsetD || 0);
      const pos = getPosOnConveyor(convB, dB, b.r, 0);
      b.x = pos.x; b.y = pos.y;
      if (b.state === 'DOOMED_B') {
        if (convB.absOffset >= b.doomOffsetB) {
          b.state = 'USURPED_DROP';
          b.dropStartOffsetB = convB.absOffset;
          b.dropStartX = b.x; b.dropStartY = b.y;
        }
      }
      survivors.push(b);

    } else if (b.state === 'COLLECT_B') {
      const progress = (convB.absOffset - b.collectStartOffsetB) / D_COLLECT_B;
      const t = Math.max(0, Math.min(1, progress));
      if (t < 0.55) {
        const tt = t / 0.55;
        b.x = b.collectFromX; b.y = b.collectFromY + (b.collectGateY - b.collectFromY) * tt;
        survivors.push(b);
      } else if (t < 1.0) {
        const tt = (t - 0.55) / 0.45;
        b.x = b.collectGateX + (b.collectTargetX - b.collectGateX) * tt;
        b.y = b.collectGateY + (b.collectTargetY - b.collectGateY) * tt;
        survivors.push(b);
      } else {
        if (state.soundEnabled) playFx('tableou_in.mp3');
        pushBitIntoTableauB(b.bit, b.indexB);
      }

    } else if (b.state === 'FALL_MISS' || b.state === 'USURPED_DROP') {
      const dropProgress = convB.absOffset - b.dropStartOffsetB;
      const tt = dropProgress / 20;
      b.x = b.dropStartX;
      b.y = b.dropStartY + 200 * tt * tt;
      if (b.y < canvas.height + 50) survivors.push(b);
    }
  });

  balls = survivors.concat(newBalls);
}

const convA = new Conveyor({ startX: 60, startY: 250, L: 300, R: 30, partH: 15 }, 30, true);
const convB = new Conveyor({ startX: 350, startY: 420, L: 300, R: 30, partH: 15 }, 30, false);
const CONV_B_BASE_X = convB.geom.startX;
let convBShift = 0;

function renderTableau(wrapperId, cells, isA) {
  const container = document.getElementById(wrapperId);
  if (!container) return;

  const isClone = wrapperId === 'tableauBWrapperClone';
  const tabEl = container.querySelector('.tableau');
  if (tabEl) tabEl.innerHTML = '';

  cells.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'tableau-cell' + (!state.canEdit ? ' disabled' : '');
    if (c.bit === null) {
      d.classList.add('empty');
      d.innerText = '0';
    } else {
      d.innerText = c.bit;
      d.classList.add('digit-' + c.bit + (c.light ? '-light' : ''));
    }
    if (isA && state.canEdit && !isClone) {
      d.onclick = () => {
        c.bit = c.bit === '1' ? '0' : '1';
        c.light = false;
        renderTableau(wrapperId, cells, isA);
      };
    }
    if (tabEl) tabEl.appendChild(d);
  });
}

function updateTableauA(fromUser) {
  if (fromUser && !state.canEdit) return;
  renderTableau('tableauAWrapper', tableauACells, true);
  const tab = document.getElementById('tableauA');
  if (state.running) tab.classList.add('gate-open');
  else tab.classList.remove('gate-open');
}

function updateTableauB(fromUser) {
  renderTableau('tableauBWrapper', tableauBCells, false);
  const tab = document.getElementById('tableauB');
  if (state.running) tab.classList.add('gate-open');
  else tab.classList.remove('gate-open');

  const clone = document.getElementById('tableauBWrapperClone');
  if (clone) renderTableau('tableauBWrapperClone', tableauBCells, false);
}

function drawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  convA.draw(ctx);
  convB.draw(ctx);
  drawConvBDragHint(ctx);

  positionTableauBWrapper();
  balls.forEach(b => {
    // Metastable balls flicker between bit-0 and bit-1 colors to show uncertain state
    let displayBit = b.bit;
    if (b.state === 'METASTABLE') {
      displayBit = Math.floor(Date.now() / 250) % 2 === 0 ? b.bit : (b.bit === '1' ? '0' : '1');
    }
    draw3DBall(ctx, b.x, b.y, b.r, displayBit, b.isSplit, b.splitSide);
  });
}

function step() {
  if (state.running) {
    convA.update();
    convB.update();
    updateBalls();
    autoStopIfDone();
    captureSnapshot();
  }

  if (state.running && state.soundEnabled) {
    if (audioBelt.paused) audioBelt.play().catch(e => {});
  } else {
    if (!audioBelt.paused) audioBelt.pause();
  }

  drawAll();
  requestAnimationFrame(step);
}

const bindSl = (id, obj, key, valId, callback) => {
  const el = document.getElementById(id);
  const vEl = document.getElementById(valId);
  el.oninput = () => {
    obj[key] = parseFloat(el.value);
    vEl.innerText = obj[key];
    if (callback) callback();
    if (!state.running) drawAll();
  };
  el.oninput();
};

bindSl('slAnimSpeed', state, 'animSpeed', 'vAnimSpeed');
bindSl('slStepA', convA, 'Wa', 'vStepA', () => {
  balls = [];
  nextBallIndexA = Math.floor(convA.absOffset / convA.getActualWa());
  updateTableauA(false);
  if (state.isSyncMode) {
    const slStepA = document.getElementById('slStepA');
    const slStepB = document.getElementById('slStepB');
    slStepB.value = slStepA.value;
    convB.Wa = parseFloat(slStepA.value);
    document.getElementById('vStepB').innerText = slStepA.value;
    balls = [];
    updateTableauB(false);
  }
});
bindSl('slStepB', convB, 'Wa', 'vStepB', () => {
  balls = [];
  updateTableauB(false);
});
bindSl('slGapW', state, 'gapW', 'vGapW');

(function() {
  const toggle = document.getElementById('syncToggle');
  const labelSync = document.getElementById('labelSync');
  const labelAsync = document.getElementById('labelAsync');

  function applySyncMode(isSync) {
    state.isSyncMode = isSync;
    if (isSync) {
      toggle.classList.remove('async-mode');
      labelSync.classList.add('active');
      labelAsync.classList.remove('active');
      const slStepA = document.getElementById('slStepA');
      const slStepB = document.getElementById('slStepB');
      slStepB.value = slStepA.value;
      convB.Wa = parseFloat(slStepA.value);
      document.getElementById('vStepB').innerText = slStepA.value;
      balls = [];
      updateTableauB(false);
    } else {
      toggle.classList.add('async-mode');
      labelSync.classList.remove('active');
      labelAsync.classList.add('active');
    }
    toggleStepControls(false);
  }

  toggle.addEventListener('click', () => {
    if (state.running) return;
    applySyncMode(!state.isSyncMode);
  });

  applySyncMode(true);
})();

document.getElementById('btnPlay').onclick = () => {
  if (!state.running) {
    setPausedDisabled(false);
    clearEndSequenceVisuals();
    document.getElementById('editHint').style.display = 'none';
    if (tableauACells.length === 0) return;
    if (!sourceLatched) latchSourceFromVisibleTableau();
    if (!hasMoreSourceSymbols() && balls.length === 0) resetSourceLatch();
    state.running = true;
    state.canEdit = false;
    toggleStepControls(true);
    nextBallIndexA = Math.floor(convA.absOffset / convA.getActualWa());
    updateTableauA(false);
    state.paused = false;
    setPlayButtonVisual(true);
  } else {
    state.running = false;
    state.paused = true;
    toggleStepControls(true);
    setPausedDisabled(true);
    setPlayButtonVisual(false);
  }
};

document.getElementById('btnReset').onclick = () => {
  document.getElementById('btnPlay').disabled = false;
  document.getElementById('editHint').style.display = 'inline';
  state.running = false;
  state.canEdit = true;
  state.paused = false;
  toggleStepControls(false);
  setPausedDisabled(false);
  setPlayButtonVisual(false);
  clearEndSequenceVisuals();

  convA.absOffset = 0;
  convB.absOffset = 0;
  balls = [];
  tableauACells = INITIAL_TABLEAU.split('').map(b => ({ bit: b, light: false }));
  clearTableauB();
  resetSourceLatch();
  updateTableauA(true);
  updateTableauB(true);
  drawAll();
  frameHistory = [];
  (function() {
    const sl = document.getElementById('slTimeline');
    const lbl = document.getElementById('vTimeline');
    if (sl) { sl.max = 1000; sl.value = 0; }
    if (lbl) lbl.textContent = 'Frame 0 / 0';
  })();
};

tableauACells = INITIAL_TABLEAU.split('').map(b => ({ bit: b, light: false }));
clearTableauB();
updateTableauA(true);
updateTableauB(true);
drawAll();
requestAnimationFrame(step);

// --- TIMELINE SCRUBBER ---
function captureSnapshot() {
  const sl = document.getElementById('slTimeline');
  if (sl) {
    const resumeIdx = parseInt(sl.value);
    if (resumeIdx < frameHistory.length - 1) {
      frameHistory = frameHistory.slice(0, resumeIdx + 1);
    }
  }
  frameHistory.push({
    convAOffset: convA.absOffset,
    convBOffset: convB.absOffset,
    balls: structuredClone(balls),
    nextBallIndexA: nextBallIndexA,
    tableauACells: structuredClone(tableauACells),
    originalCodeBits: originalCodeBits.slice(),
    sourceConsumedCount: sourceConsumedCount,
    sourceLatched: sourceLatched,
    tableauBCells: structuredClone(tableauBCells),
    tableauBBaseIndex: tableauBBaseIndex
  });
  const sl2 = document.getElementById('slTimeline');
  const lbl = document.getElementById('vTimeline');
  const frame = frameHistory.length - 1;
  if (sl2) {
    if (frame >= parseInt(sl2.max)) sl2.max = frame + 500;
    sl2.value = frame;
  }
  if (lbl) lbl.textContent = `Frame ${frame + 1} / ${frameHistory.length}`;
}

function restoreFromIdx(idx) {
  if (idx < 0 || idx >= frameHistory.length) return;
  const snap = frameHistory[idx];
  convA.absOffset = snap.convAOffset;
  convB.absOffset = snap.convBOffset;
  balls = structuredClone(snap.balls);
  // Reset time-relative fields so restored balls behave correctly
  balls.forEach(b => {
    if (b.isSplit && b.timeHitB) b.timeHitB = Date.now();
    if (b.state === 'METASTABLE') b.metastableStart = Date.now();
  });
  nextBallIndexA = snap.nextBallIndexA;
  tableauACells = structuredClone(snap.tableauACells);
  originalCodeBits = snap.originalCodeBits.slice();
  sourceConsumedCount = snap.sourceConsumedCount;
  sourceLatched = snap.sourceLatched;
  tableauBCells = structuredClone(snap.tableauBCells);
  tableauBBaseIndex = snap.tableauBBaseIndex;
  updateTableauA(false);
  updateTableauB(false);
  drawAll();
}

document.getElementById('slTimeline').addEventListener('input', function() {
  if (state.running) {
    state.running = false;
    state.paused = true;
    setPlayButtonVisual(false);
    toggleStepControls(false);
  }
  document.getElementById('btnPlay').disabled = false;
  const idx = Math.min(parseInt(this.value), frameHistory.length - 1);
  this.value = idx;
  restoreFromIdx(idx);
  const total = frameHistory.length;
  const lbl = document.getElementById('vTimeline');
  if (lbl) lbl.textContent = `Frame ${idx + 1} / ${total}`;
});

// Keyboard controls: Space = play/pause, Arrow keys = single step
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    const btn = document.getElementById('btnPlay');
    if (!btn.disabled) btn.click();
  } else if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && !state.running) {
    e.preventDefault();
    if (state.canEdit || document.getElementById('btnPlay').disabled) return;
    state.running = true;
    convA.update();
    convB.update();
    updateBalls();
    autoStopIfDone();
    if (state.running) state.running = false;
    drawAll();
  }
});

// --- CONVEYOR B DRAG ---
function drawConvBDragHint(ctx) {
  if (state.running || state.paused) return;
  const { startX, startY, L, R } = convB.geom;
  const cy = startY;
  const blink = Math.floor(Date.now() / 500) % 2 === 0;
  const alpha = blink ? 0.95 : 0.3;
  const iw = 30, ih = 20, ir = 4;

  ctx.save();

  function drawShiftIcon(cx, isLeft) {
    const ix = cx - iw / 2, iy = cy - ih / 2;
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = '#3A0000';
    ctx.beginPath();
    ctx.moveTo(ix + ir, iy);
    ctx.arcTo(ix + iw, iy, ix + iw, iy + ih, ir);
    ctx.arcTo(ix + iw, iy + ih, ix, iy + ih, ir);
    ctx.arcTo(ix, iy + ih, ix, iy, ir);
    ctx.arcTo(ix, iy, ix + iw, iy, ir);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#FF3B3B';
    ctx.fillStyle = '#FF3B3B';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    const stemLen = 9, headH = 6, headW = 5;
    if (isLeft) {
      ctx.beginPath();
      ctx.moveTo(cx + stemLen / 2, cy);
      ctx.lineTo(cx - stemLen / 2 + headH, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - stemLen / 2, cy);
      ctx.lineTo(cx - stemLen / 2 + headH, cy - headW);
      ctx.lineTo(cx - stemLen / 2 + headH, cy + headW);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - stemLen / 2, cy);
      ctx.lineTo(cx + stemLen / 2 - headH, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + stemLen / 2, cy);
      ctx.lineTo(cx + stemLen / 2 - headH, cy - headW);
      ctx.lineTo(cx + stemLen / 2 - headH, cy + headW);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawShiftIcon(startX + L * 0.25 + 20, true);
  drawShiftIcon(startX + L * 0.75 - 20, false);

  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#FF3B3B';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SHIFT', startX + L / 2, cy);

  ctx.restore();
}

const _dragB = { active: false, startMouseX: 0, shiftAtStart: 0 };

function _applyConvBShift(raw) {
  convBShift = Math.max(-80, Math.min(80, raw));
  const _tab = document.getElementById('tableauB');
  const _wrp = document.getElementById('tableauBWrapper');
  if (_tab && _wrp && _wrp.offsetWidth > 0) {
    const goff = (_tab.offsetWidth || 0) - (4 + TABLEAU_CELL_W / 2);
    const contW = (canvas.parentElement && canvas.parentElement.offsetWidth) || canvas.width;
    const dropX = CONV_B_BASE_X + convBShift + convB.geom.L + convB.geom.R + getBallRadiusB();
    const wLeft = dropX - goff;
    const wRight = wLeft + _wrp.offsetWidth;
    if (wRight > contW) convBShift -= Math.ceil(wRight - contW);
    if (wLeft < 0) convBShift -= Math.floor(wLeft);
  }
  convB.geom.startX = CONV_B_BASE_X + convBShift;
}

function _convBHitTest(mx, my) {
  const { startX, startY, L, R } = convB.geom;
  return mx >= startX - R && mx <= startX + L + R && my >= startY - R && my <= startY + R;
}

canvas.addEventListener('mousedown', (e) => {
  if (state.running || state.paused) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  if (!_convBHitTest(mx, my)) return;
  _dragB.active = true;
  _dragB.startMouseX = mx;
  _dragB.shiftAtStart = convBShift;
  e.preventDefault();
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  if (_dragB.active) {
    _applyConvBShift(_dragB.shiftAtStart + (mx - _dragB.startMouseX));
    canvas.style.cursor = 'grabbing';
  } else {
    canvas.style.cursor = (!state.running && !state.paused && _convBHitTest(mx, my)) ? 'grab' : 'default';
  }
});

canvas.addEventListener('mouseup', () => { _dragB.active = false; });
canvas.addEventListener('mouseleave', () => { _dragB.active = false; });

canvas.addEventListener('touchstart', (e) => {
  if (state.running || state.paused) return;
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  const mx = (t.clientX - rect.left) * (canvas.width / rect.width);
  const my = (t.clientY - rect.top) * (canvas.height / rect.height);
  if (!_convBHitTest(mx, my)) return;
  _dragB.active = true;
  _dragB.startMouseX = mx;
  _dragB.shiftAtStart = convBShift;
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!_dragB.active) return;
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  const mx = (t.clientX - rect.left) * (canvas.width / rect.width);
  _applyConvBShift(_dragB.shiftAtStart + (mx - _dragB.startMouseX));
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', () => { _dragB.active = false; });

document.getElementById('btnReset').addEventListener('click', () => {
  convBShift = 0;
  convB.geom.startX = CONV_B_BASE_X;
});
