// Screen coordinates grow right and down. Offer labels in priority order. Only
// successful placements occupy space, so callers can try another anchor on a miss.
export function createLabelLayout({ capacity = 64, margin = 0, blocked = () => false } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || !Number.isFinite(margin) || margin < 0) {
    throw new RangeError('Expected positive capacity and nonnegative margin');
  }
  const boxes = new Float64Array(capacity * 4);
  let used = 0, width = 0, height = 0;

  function reset(viewportWidth, viewportHeight) {
    used = 0;
    width = viewportWidth;
    height = viewportHeight;
  }
  function overlaps(left, top, right, bottom) {
    for (let i = 0; i < used; i += 4) {
      if (right > boxes[i] && left < boxes[i + 2] && bottom > boxes[i + 1] && top < boxes[i + 3]) return true;
    }
    return false;
  }
  // Returns the accepted bottom edge or NaN. Positive maxLift permits stacking.
  function place(x, foot, boxWidth, boxHeight, maxLift = 0, gap = 0) {
    const left = x - boxWidth / 2, right = x + boxWidth / 2;
    if (!(boxWidth > 0 && boxHeight > 0 && maxLift >= 0 && gap >= 0) || !Number.isFinite(x + foot + boxWidth + boxHeight) || used === boxes.length || left < margin || right > width - margin) return NaN;
    let bottom = foot;
    for (;;) {
      const top = bottom - boxHeight;
      if (top < margin || bottom > height - margin || foot - bottom > maxLift || blocked(left, top, right, bottom)) return NaN;
      let next = bottom;
      for (let i = 0; i < used; i += 4) {
        if (right > boxes[i] && left < boxes[i + 2] && bottom > boxes[i + 1] && top < boxes[i + 3]) {
          next = Math.min(next, boxes[i + 1] - gap);
        }
      }
      if (next === bottom) {
        boxes[used++] = left;
        boxes[used++] = top;
        boxes[used++] = right;
        boxes[used++] = bottom;
        return bottom;
      }
      bottom = next;
    }
  }
  return { reset, place, overlaps };
}
