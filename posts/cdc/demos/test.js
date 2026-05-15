// Run: node test.js
// Tests the pure-logic functions extracted from the demo scripts.
// No DOM or build tools required.

import assert from 'node:assert/strict';

// ── Conveyor (geometry only, no canvas) ──────────────────────────────────────

class Conveyor {
  constructor(geom, initialWa) {
    this.geom = geom;
    this.Wa = initialWa;
    this.absOffset = 0;
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
      const ang = -Math.PI / 2 + arc / R;
      return { x: startX + L + Ro * Math.cos(ang), y: startY + Ro * Math.sin(ang), a: ang };
    }
    if (pos <= 2 * L + Math.PI * R) {
      const over = pos - (L + Math.PI * R);
      return { x: startX + L - over, y: startY + Ro, a: Math.PI / 2 };
    }
    const arc = pos - (2 * L + Math.PI * R);
    const ang = Math.PI / 2 + arc / R;
    return { x: startX + Ro * Math.cos(ang), y: startY + Ro * Math.sin(ang), a: ang };
  }
}

// ── computeSplitTargets ──────────────────────────────────────────────────────

function computeSplitTargets(fx, actualWaA, actualWaB, currentAbsOffsetB, startXB) {
  const BLX = fx - actualWaA / 2;
  const BRX = fx + actualWaA / 2;

  const k_left  = Math.floor((currentAbsOffsetB - (BLX - startXB)) / actualWaB);
  const k_right = Math.floor((currentAbsOffsetB - (BRX - startXB)) / actualWaB);

  const hits = [];
  for (let k = k_left - 1; k >= k_right; k--) {
    let splitSide = 'right';
    if (k === k_left - 1 && k > k_right) splitSide = 'left';
    hits.push({ k, isSplit: true, splitSide, offsetD: 0 });
  }
  return hits;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const EPS = 1e-9;
function near(a, b, msg) {
  assert(Math.abs(a - b) < EPS, `${msg}: expected ${b}, got ${a}`);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

// ── Conveyor.getActualWa ─────────────────────────────────────────────────────

const GEOM_A = { startX: 60, startY: 250, L: 300, R: 30 };

console.log('\nConveyor.getActualWa()');

test('snaps to nearest integer multiple of perimeter', () => {
  const peri = 2 * 300 + 2 * Math.PI * 30;  // ≈ 788.495
  const c = new Conveyor(GEOM_A, 30);
  const n = Math.round(peri / 30);           // round(26.28) = 26
  near(c.getActualWa(), peri / n, 'actualWa');
});

test('Wa much larger than perimeter → n=1, actualWa=peri', () => {
  const peri = 2 * 300 + 2 * Math.PI * 30;
  const c = new Conveyor(GEOM_A, 9999);
  near(c.getActualWa(), peri, 'actualWa with huge Wa');
});

test('Wa of exactly half the perimeter → n=2', () => {
  const peri = 2 * 300 + 2 * Math.PI * 30;
  const c = new Conveyor(GEOM_A, peri / 2);
  near(c.getActualWa(), peri / 2, 'actualWa half-peri');
});

// ── Conveyor.getPathPoint ────────────────────────────────────────────────────

console.log('\nConveyor.getPathPoint()');

test('dist=0 is at top-left of top straight, angle=-π/2', () => {
  const c = new Conveyor(GEOM_A, 30);
  const p = c.getPathPoint(0);
  near(p.x, 60, 'x');
  near(p.y, 220, 'y');   // startY - R = 250 - 30
  near(p.a, -Math.PI / 2, 'angle');
});

test('dist=L is at top-right of top straight', () => {
  const c = new Conveyor(GEOM_A, 30);
  const p = c.getPathPoint(300);
  near(p.x, 360, 'x');   // startX + L
  near(p.y, 220, 'y');
  near(p.a, -Math.PI / 2, 'angle');
});

test('dist = L + π*R/2 is at the 3-o-clock position of the right wheel', () => {
  // arc = π*R/2, ang = -π/2 + π/2 = 0
  const c = new Conveyor(GEOM_A, 30);
  const p = c.getPathPoint(300 + Math.PI * 30 / 2);
  near(p.x, 390, 'x');   // startX + L + R*cos(0)
  near(p.y, 250, 'y');   // startY + R*sin(0)
  near(p.a, 0, 'angle');
});

test('dist = L + π*R lands at the bottom of the right wheel', () => {
  // arc = π*R, ang = -π/2 + π = π/2
  const c = new Conveyor(GEOM_A, 30);
  const p = c.getPathPoint(300 + Math.PI * 30);
  near(p.x, 360, 'x');   // startX + L + R*cos(π/2) = 360 + 0
  near(p.y, 280, 'y');   // startY + R*sin(π/2) = 250 + 30
  near(p.a, Math.PI / 2, 'angle');
});

test('negative dist wraps around correctly', () => {
  const c = new Conveyor(GEOM_A, 30);
  const peri = 2 * 300 + 2 * Math.PI * 30;
  const p0 = c.getPathPoint(0);
  const pNeg = c.getPathPoint(-peri);
  near(pNeg.x, p0.x, 'x wrap');
  near(pNeg.y, p0.y, 'y wrap');
});

test('radiusOffset pushes point outward along normal', () => {
  const c = new Conveyor(GEOM_A, 30);
  // At dist=0 (top straight) the normal points up (-Y), so y decreases by radiusOffset
  const p = c.getPathPoint(0, 10);
  near(p.y, 210, 'y with radiusOffset');  // startY - R - offset = 250 - 30 - 10
});

// ── computeSplitTargets ──────────────────────────────────────────────────────

console.log('\ncomputeSplitTargets()');

const START_X_B = 350;

test('ball A fits inside one B slot → no hits', () => {
  // Make actualWaB much larger than actualWaA so the ball fits entirely in one slot.
  const hits = computeSplitTargets(500, 10, 100, 1000, START_X_B);
  assert.equal(hits.length, 0, 'no hits when ball fits in one B slot');
});

test('ball A straddles exactly one B divider → one hit, splitSide=right', () => {
  // actualWaA = 50, actualWaB = 50, currentAbsOffsetB = 1000, startXB = 0, fx = 25
  // BLX = 0, BRX = 50
  // k_left  = floor((1000 - 0) / 50) = 20
  // k_right = floor((1000 - 50) / 50) = 19
  // loop k=19 down to 19 (one iteration), k===k_left-1=19 and k NOT > k_right=19 → splitSide='right'
  const hits = computeSplitTargets(25, 50, 50, 1000, 0);
  assert.equal(hits.length, 1, 'one hit');
  assert.equal(hits[0].splitSide, 'right');
  assert.equal(hits[0].k, 19);
});

test('ball A spans two B dividers → two hits, first left, second right', () => {
  // actualWaA = 120, actualWaB = 50, fx = 100, startXB = 0, currentAbsOffsetB = 1000
  // BLX = 40, BRX = 160
  // k_left  = floor((1000 - 40) / 50) = floor(19.2) = 19
  // k_right = floor((1000 - 160) / 50) = floor(16.8) = 16
  // loop k=18 down to 16: k=18,17,16
  // k=18 === k_left-1=18 && 18 > k_right=16 → left
  // k=17, k=16 → right
  const hits = computeSplitTargets(100, 120, 50, 1000, 0);
  assert.equal(hits.length, 3, 'three hits');
  assert.equal(hits[0].splitSide, 'left');
  assert.equal(hits[1].splitSide, 'right');
  assert.equal(hits[2].splitSide, 'right');
});

test('all hits have isSplit=true and offsetD=0', () => {
  const hits = computeSplitTargets(25, 50, 50, 1000, 0);
  hits.forEach(h => {
    assert.equal(h.isSplit, true);
    assert.equal(h.offsetD, 0);
  });
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
