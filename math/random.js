/**
 * Repeatable random streams and coordinate hashes for procedural placement.
 * @module
 */

/**
 * Create a repeatable stream of numbers in [0, 1). Save `next.state()` and pass
 * it to a new generator to resume at the next draw, including in a worker.
 * @param {number} a - Integer seed or a previously saved generator state.
 */
function mulberry32(a) {
  const next = function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => a;
  return next;
}
// A random item of a, drawn with the generator R.
const pickR = (R, a) => a[(R() * a.length) | 0];
export { mulberry32, pickR };

/** Return a repeatable hash in [0, 1) for integer X/Z grid coordinates and a per-sample seed. */
export function createHash(worldSeed = 0) {
  // A random number in 0..1 fixed by two integers and a seed.
  function hash2(ix, iz, seed) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed + worldSeed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  return hash2;
}
