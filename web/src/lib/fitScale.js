// The ONLY place that decides how big a design's canvas should render at.
// Every past canvas-sizing bug (corners clipped, backgrounds not filling,
// content cut off) was some form of this calculation living in two places
// that could drift apart. There is exactly one now, and it's covered by
// fitScale.test.mjs (2,000+ randomized cases plus hand-picked edge cases:
// height-constrained, width-constrained, already-fits-at-100%, a
// pathologically tiny container). Run with: node src/lib/fitScale.test.mjs
export function computeFitScale(containerW, containerH, designW, designH, padding = 64) {
  const availW = Math.max(containerW - padding, 100);
  const availH = Math.max(containerH - padding, 100);
  return Math.min(availW / designW, availH / designH, 1);
}
