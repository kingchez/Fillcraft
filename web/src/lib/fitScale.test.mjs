import { computeFitScale } from './fitScale.js';
import assert from 'assert';

function approx(a, b, eps = 0.0001) { return Math.abs(a - b) < eps; }

// Case 1: portrait design (1080x1920) in a wide, short viewport — height-constrained
{
  const s = computeFitScale(1878, 670, 1080, 1920);
  const availW = 1878 - 64, availH = 670 - 64;
  assert(approx(s, availH / 1920), 'should be height-constrained');
  assert(1080 * s <= availW + 0.5, 'must not overflow width');
  assert(1920 * s <= availH + 0.5, 'must not overflow height');
}

// Case 2: landscape design (1920x1080) in a narrow, tall viewport — width-constrained
{
  const s = computeFitScale(600, 900, 1920, 1080);
  const availW = 600 - 64, availH = 900 - 64;
  assert(approx(s, availW / 1920), 'should be width-constrained');
  assert(1920 * s <= availW + 0.5);
  assert(1080 * s <= availH + 0.5);
}

// Case 3: tiny design that fits at 100% — must NOT upscale past 1
{
  const s = computeFitScale(1900, 1000, 400, 300);
  assert(s === 1, 'small designs must never be scaled above 100%');
}

// Case 4: pathologically small container (panel expanded on a small laptop) —
// must never divide into something insane or negative
{
  const s = computeFitScale(50, 50, 1080, 1920);
  assert(s > 0 && Number.isFinite(s), 'must stay positive and finite');
}

// Case 5: square design in a square container, small enough to hit the 100% cap
{
  const s = computeFitScale(1000, 1000, 500, 500);
  assert(s === 1, 'fits comfortably under 100%, should cap at 1');
}
// Case 5b: square design in a square container, big enough to actually need shrinking
{
  const s = computeFitScale(1000, 1000, 2000, 2000);
  const avail = 1000 - 64;
  assert(approx(s, avail / 2000));
}

// Case 6: EVERY case — the golden invariant — design*scale must never exceed
// available space in either dimension, for a wide sweep of random inputs.
for (let i = 0; i < 2000; i++) {
  const cw = 200 + Math.random() * 3000;
  const ch = 200 + Math.random() * 3000;
  const dw = 50 + Math.random() * 4000;
  const dh = 50 + Math.random() * 4000;
  const s = computeFitScale(cw, ch, dw, dh);
  const availW = Math.max(cw - 64, 100), availH = Math.max(ch - 64, 100);
  assert(dw * s <= availW + 0.01, `overflow W: cw=${cw} ch=${ch} dw=${dw} dh=${dh} s=${s}`);
  assert(dh * s <= availH + 0.01, `overflow H: cw=${cw} ch=${ch} dw=${dw} dh=${dh} s=${s}`);
  assert(s <= 1, `upscaled past 100%: s=${s}`);
  assert(s > 0, `non-positive scale: s=${s}`);
}

console.log('ALL FIT-SCALE TESTS PASSED (2005 cases)');
