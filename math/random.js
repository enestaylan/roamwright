/**
 * Repeatable random streams and coordinate hashes for procedural placement.
 * @module
 */

/**
 * Create a repeatable stream of numbers in [0, 1). Save `next.state()` and pass
 * it to a new generator to resume at the next draw, including in a worker.
 * @param {number} state - Integer seed or a previously saved generator state.
 */
function mulberry32(state) {
  const next = function () {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixedState = Math.imul(state ^ (state >>> 15), 1 | state);
    mixedState = (mixedState + Math.imul(mixedState ^ (mixedState >>> 7), 61 | mixedState)) ^ mixedState;
    return ((mixedState ^ (mixedState >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => state;
  return next;
}
/** Pick one item using the supplied random generator. */
const pickR = (random, items) => items[(random() * items.length) | 0];
export { mulberry32, pickR };

/** Return a repeatable hash in [0, 1) for integer X/Z grid coordinates and a per-sample seed. */
export function createHash(worldSeed = 0) {
  // A random number in 0..1 fixed by two integers and a seed.
  function hash2(ix, iz, seed) {
    let hash = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed + worldSeed, 1442695041)) | 0;
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }
  return hash2;
}
