const clamp = (value, minimum, maximum) => (value < minimum ? minimum : value > maximum ? maximum : value);
const lerp = (start, end, fraction) => start + (end - start) * fraction;
/** Ease from 0 at start to 1 at end. Reverse the endpoints for a falling transition. */
const sstep = (start, end, x) => {
  const t = clamp((x - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;
// 1 inside the rectangle f (centre x, z, half sizes hx, hz), falling to 0 over a margin m outside it.
const rectMask = (x, z, f, m) => sstep(f.hx + m, f.hx, Math.abs(x - f.x)) * sstep(f.hz + m, f.hz, Math.abs(z - f.z));

export { clamp, lerp, rectMask, sstep, TAU };
