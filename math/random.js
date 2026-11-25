// A small seeded random generator: the same seed gives the same world every time. Its `state()` is where the stream stands:
// mulberry32(state) goes on from there, as a stream handed to a worker of the pool does.
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
