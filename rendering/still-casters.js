// A point-light shadow has six faces. Cache static casters once, then draw
// dynamic geometry over that depth on subsequent passes. STILL_LAYER selects
// the static casters. The revision and membership sum invalidate the cache
// when a caster moves, changes geometry, appears or disappears.
const STILL_LAYER = 2,
  STILL_BIT = 1 << STILL_LAYER;
const still = { kept: false, sum: 0, round: 0 }; // round: which drawing of the kept picture this is

// Marks a caster that stands still
const markStill = object => object.layers.enable(STILL_LAYER);
const isStill = object => (object.layers.mask & STILL_BIT) !== 0;
// Where a mesh stands, how it is turned (about any axis) and its size, as one number
const placeOf = e => e[12] * 1.37 + e[13] * 2.11 + e[14] * 0.59 + e[0] * 5.3 + e[1] * 3.3 + e[2] * 4.1 + e[5] * 1.9 + e[6] * 2.7;

// Record a caster during cache generation. On subsequent draws, skip it only
// when its cached revision still matches the caller-supplied transform or batch revision.
function keptAway(object, as) {
  if (!still.kept) {
    object.keptIn = still.round;
    object.keptAs = as;
    still.sum += object.id;
    return false;
  }
  if (object.keptIn !== still.round || object.keptAs !== as) {
    still.sum = NaN; // not in the picture as it stands: drawn now, and the picture drawn again
    return false;
  }
  still.sum += object.id;
  return true;
}

export { isStill, keptAway, markStill, placeOf, still, STILL_LAYER };
