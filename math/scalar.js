const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// Smoothstep: 0 at a, 1 at b, eased between (b may be less than a, to fall instead of rise).
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;
// 1 inside the rectangle f (centre x, z, half sizes hx, hz), falling to 0 over a margin m outside it.
const rectMask = (x, z, f, m) => sstep(f.hx + m, f.hx, Math.abs(x - f.x)) * sstep(f.hz + m, f.hz, Math.abs(z - f.z));

export { clamp, lerp, rectMask, sstep, TAU };
