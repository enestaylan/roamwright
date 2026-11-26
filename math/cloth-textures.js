import { clamp } from './scalar.js';
import { createNoise } from './noise.js';
import { createHash, mulberry32 } from './random.js';

const FOLD_SLOPES = [110, 30];
// The long folds: how many, and each one's half-width, how far it wanders, how tall it is, and how much of the tile's height
// it lasts, all as [least, most] (widths and wanders in tiles: shares of the way round the body); and the shade at a fold's
// foot: how far out from the fold it reaches (of its half-width) and how much of it lies on the fold's own flanks.
const PIPES = { n: 46, half: [0.009, 0.024], wander: [0.005, 0.016], tall: [0.45, 1], lasts: [0.07, 0.2], foot: 2.3, flank: 0.5 },
  CRUMPLE = { per: 6, octaves: 2, seed: 83, full: 1.6 }, // the crumple's noise: cells a tile, and how far from its middle value it is at its full height
  STEP = 1 / 512; // how far apart a field is read to find its slope (tiles)
const around = offset => offset - Math.round(offset), // the nearest way round a tile
  byte = slope => clamp(127.5 + 127.5 * slope, 0, 255);
// The long folds' fill: a pixel's bytes from its place in the tile.
function garmentFolds(foldSeed) {
  const rand = mulberry32(foldSeed),
    between = ([minimum, maximum]) => minimum + (maximum - minimum) * rand(),
    pipes = [];
  for (let k = 0; k < PIPES.n; k++)
    pipes.push({
      u: (k + 0.15 + 0.7 * rand()) / PIPES.n,
      v: rand(),
      half: between(PIPES.half),
      wander: between(PIPES.wander),
      turns: 2 + Math.floor(rand() * 4),
      phase: rand() * Math.PI * 2,
      tall: between(PIPES.tall),
      lasts: between(PIPES.lasts),
    });
  // the folds' height at a place, or (shaded) how much of its light their feet and flanks take there
  const field = (u, v, shaded) => {
    let sum = 0;
    for (const p of pipes) {
      const along = Math.abs(around(v - p.v)) / p.lasts;
      if (along >= 1) continue;
      const t = Math.abs(around(u - p.u - p.wander * Math.sin(Math.PI * 2 * p.turns * v + p.phase)) / p.half),
        full = p.tall * (1 - along * along);
      if (!shaded) sum += t < 1 ? full * (1 - t * t) * (1 - t * t) : 0;
      else if (t < 1) sum += full * PIPES.flank * t * t;
      else if (t < PIPES.foot) sum += full * (PIPES.flank + (1 - PIPES.flank) * (1 - (t - 1) / (PIPES.foot - 1)) ** 2);
    }
    return Math.min(1, sum);
  };
  return (u, v, o) => {
    o[0] = byte((field(u + STEP, v) - field(u - STEP, v)) / (2 * STEP) / FOLD_SLOPES[0]);
    o[1] = 255 * (1 - field(u, v, true));
    o[2] = 0;
  };
}
// The crumple's fill.
function garmentCrumple(tfbm) {
  const crumple = (u, v) => Math.min(1, CRUMPLE.full * Math.abs(2 * tfbm(u, v, CRUMPLE.per, CRUMPLE.octaves, CRUMPLE.seed) - 1));
  return (u, v, o) => {
    o[0] = byte((crumple(u + STEP, v) - crumple(u - STEP, v)) / (2 * STEP) / FOLD_SLOPES[1]);
    o[1] = byte((crumple(u, v + STEP) - crumple(u, v - STEP)) / (2 * STEP) / FOLD_SLOPES[1]);
    o[2] = 255 * crumple(u, v);
  };
}

const cloth = (threads, hash2, tfbm) => (u, v, o) => {
  const i = Math.floor(u * threads),
    j = Math.floor(v * threads),
    over = (i + j) % 2, // which thread lies on top at this crossing
    along = over ? (v * threads) % 1 : (u * threads) % 1,
    thread = Math.sin(Math.PI * along), // round across the thread on top, darker where it dips under
    tone = over ? hash2(i, 0, 69) : hash2(j, 1, 69), // one thread spun a little thicker or paler than the next
    wear = tfbm(u, v, 4, 4, 70);
  const brightness = clamp(158 + wear * 56 + (thread - 0.64) * 20 + (tone - 0.5) * 12, 0, 255);
  o[0] = brightness;
  o[1] = brightness * 0.99;
  o[2] = brightness * 0.975;
};

function createClothTextures({ seed = 0, foldSeed = seed, threads = 64 } = {}) {
  const { tfbm } = createNoise(seed);
  const hash2 = createHash(seed);
  return {
    weave: () => cloth(threads, hash2, tfbm),
    folds: () => garmentFolds(foldSeed),
    crumple: () => garmentCrumple(tfbm),
  };
}
export { FOLD_SLOPES, createClothTextures };
