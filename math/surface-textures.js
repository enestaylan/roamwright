import { cellEdge } from './cell-edge.js';
import { mulberry32 } from './random.js';
import { clamp, sstep } from './scalar.js';

// Tileable surface textures worked out in code: masonry, plaster, roof tiles, rock, planks, foliage, ground, road, brick and ice.
// Each maker returns fill(u, v, out): for the place (u, v) of the tile, 0 to 1 each way, it writes the texel's channels into
// `out` as numbers from 0 to 255. The makers need nothing of the page, so a worker can fill them (fillPixels below).
// noise: a seeded { tfbm, tnoise } of math/noise.js; hash2: a seeded hash of math/random.js. The same seeds give the same
// textures every time.
export function createSurfaceTextures({ noise: { tfbm, tnoise }, hash2 }) {
  // Coursed ashlar: courses of uneven height, blocks of uneven length, thin joints, and each block its own tone.
  function ashlar({ seed = 611, courses = 10 } = {}) {
    const random = mulberry32(seed),
      N = courses,
      rows = [];
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const h = 0.75 + random() * 0.6;
      rows.push({ y0: acc, h });
      acc += h;
    }
    for (const r of rows) {
      r.y0 /= acc;
      r.h /= acc;
      const n = 3 + ((random() * 3) | 0),
        cuts = [];
      let cutPosition = random();
      for (let k = 0; k < n; k++) {
        cuts.push(cutPosition % 1);
        cutPosition += (0.7 + random() * 0.6) / n;
      }
      r.cuts = cuts.sort((p, q) => p - q);
      r.tone = cuts.map(() => 0.86 + random() * 0.26);
      r.warm = cuts.map(() => random());
    }
    return (u, v, o) => {
      let r = rows[N - 1];
      for (let i = 0; i < N; i++)
        if (v < rows[i].y0 + rows[i].h) {
          r = rows[i];
          break;
        }
      const cuts = r.cuts,
        m = cuts.length;
      let k = m - 1;
      for (let i = 0; i < m; i++)
        if (u < cuts[i]) {
          k = (i + m - 1) % m;
          break;
        }
      const startCut = cuts[k],
        endCut = cuts[(k + 1) % m],
        w = (endCut - startCut + 1) % 1 || 1,
        bu = ((u - startCut + 1) % 1) / w,
        bv = (v - r.y0) / r.h;
      const dj = Math.min(Math.min(bu, 1 - bu) * w, Math.min(bv, 1 - bv) * r.h); // distance to the nearest joint, in tile units
      const joint = sstep(0.0, 0.0055, dj),
        edge = sstep(0.0, 0.028, dj),
        n = tfbm(u, v, 8, 4, 62),
        pit = sstep(0.62, 0.8, tfbm(u, v, 32, 2, 65));
      const brightness = (158 + n * 62) * r.tone[k] * (0.72 + 0.28 * joint) * (0.93 + 0.07 * edge) * (1 - 0.12 * pit),
        wm = r.warm[k];
      o[0] = brightness * (1 + 0.03 * wm);
      o[1] = brightness * 0.985;
      o[2] = brightness * (0.95 - 0.04 * wm);
    };
  }

  // Rubble masonry: rough stones of every size, unsquared and in no courses, bedded in thick mortar. Each stone has its own tone
  // and grain and rounds over to its rim; the mortar lies back between them. Two sizes of stone are mixed: a large stone is
  // split where its own number says. big, small: stones a side of the tile; joint, rim: the mortar's half-width and the
  // rim's, in tile units.
  function rubble({ big: BIG = 6, small: SMALL = 11, split: SPLIT = 0.5, joint: JOINT = 0.008, rim: RIM = 0.016 } = {}) {
    const big = [0, 0],
      small = [0, 0];
    return (u, v, o) => {
      const w = (tfbm(u, v, 5, 3, 91) - 0.5) * 0.09 + (tfbm(u, v, 13, 2, 102) - 0.5) * 0.025, // warped twice, so no stone is a polygon
        eb = cellEdge(hash2, u + w, v - w * 0.8, BIG, 92, big),
        split = hash2(big[0], big[1], 93) < SPLIT,
        es = split ? cellEdge(hash2, u - w * 0.8, v + w, SMALL, 94, small) : 1,
        e = Math.min(eb, es),
        id = split ? hash2(small[0], small[1], 95) : hash2(big[0], big[1], 96);
      const joint = JOINT * (0.6 + 1.3 * tfbm(u, v, 9, 2, 97)), // the mortar's width wanders
        inStone = sstep(joint, joint + 0.005, e),
        rim = sstep(joint, joint + RIM, e), // a rough stone rounds over to its rim
        grain = tfbm(u, v, 24, 3, 98),
        pit = sstep(0.66, 0.82, tfbm(u, v, 40, 2, 99));
      const tone = 0.8 + 0.35 * id,
        stone = (150 + 60 * grain) * tone * (0.72 + 0.28 * Math.sqrt(rim)) * (1 - 0.12 * pit),
        mortar = 84 + 26 * tfbm(u, v, 14, 3, 100) + 14 * tfbm(u, v, 60, 2, 103), // lying back, flat and sandy
        brightness = mortar + (stone - mortar) * inStone,
        warm = (hash2(big[0] + 7, big[1], 101) - 0.5) * 0.08 * inStone; // ironstone, limestone and grey field stone
      o[0] = clamp(brightness * (1 + warm), 0, 255);
      o[1] = clamp(brightness * 0.985, 0, 255);
      o[2] = clamp(brightness * (0.95 - warm), 0, 255);
    };
  }

  // Lime plaster: broad blotches and faint streaks down the wall.
  const plaster = () => (u, v, o) => {
    const n = tfbm(u, v, 5, 5, 63),
      streak = tfbm(u * 3, v * 0.4, 4, 3, 64);
    const brightness = clamp(170 + n * 60 + streak * 24 - 20 * sstep(0.9, 1.0, (v * 6) % 1), 0, 255);
    o[0] = brightness;
    o[1] = brightness * 0.99;
    o[2] = brightness * 0.97;
  };

  // Roof tiles in rows that break joint: each tile its own shade, its lower lip lit, a gap between neighbours.
  const roofTiles =
    ({ rows = 12, columns: cols = 10 } = {}) =>
    (u, v, o) => {
      const r = Math.floor(v * rows),
        tu = (u * cols + (r % 2) * 0.5) % 1,
        tv = (v * rows) % 1;
      const shade = 0.72 + 0.28 * hash2(Math.floor(u * cols + (r % 2) * 0.5) % cols, r, 65);
      const lip = 0.66 + 0.34 * sstep(0.0, 0.5, tv),
        gap = 0.75 + 0.25 * sstep(0, 0.12, tu) * sstep(1, 0.88, tu);
      const brightness = (150 + tfbm(u, v, 8, 3, 66) * 70) * shade * lip * gap;
      o[0] = brightness;
      o[1] = brightness * 0.98;
      o[2] = brightness * 0.96;
    };

  // Bare rock: mottled grey with dark cracks.
  const rock = () => (u, v, o) => {
    const n = tfbm(u, v, 4, 6, 67),
      crack = Math.abs(tfbm(u, v, 6, 4, 68) - 0.5) * 2;
    const brightness = clamp((130 + n * 110) * (0.55 + 0.45 * sstep(0.0, 0.12, crack)), 0, 255);
    o[0] = brightness;
    o[1] = brightness;
    o[2] = brightness * 0.98;
  };

  // Planks side by side: grain along each, a dark edge between them, each plank its own tone.
  const planks =
    ({ count = 8 } = {}) =>
    (u, v, o) => {
      const plank = Math.floor(u * count),
        g = tfbm(u * 0.6 + plank * 0.13, v, 4, 5, 69),
        edge = sstep(0, 0.06, (u * count) % 1);
      const brightness = (130 + g * 90) * (0.82 + 0.18 * hash2(plank, 0, 70)) * (0.6 + 0.4 * edge);
      o[0] = brightness * 1.05;
      o[1] = brightness * 0.95;
      o[2] = brightness * 0.8;
    };

  // Leaf clusters, as one grey value: bright clumps, dark gaps.
  const foliage = () => (u, v, o) => {
    const coarseNoise = tfbm(u, v, 10, 3, 71),
      mediumNoise = tnoise(u * 34, v * 34, 34, 72),
      fineNoise = tnoise(u * 90, v * 90, 90, 73);
    const n = clamp(sstep(0.34, 0.62, coarseNoise) * 0.62 + mediumNoise * 0.3 + fineNoise * 0.16, 0, 1) * 255;
    o[0] = o[1] = o[2] = n;
  };

  // The grain of open ground. alpha(u, v), 0 to 1, when given, is packed into the fourth channel: a shader short of texture
  // units can carry a second field there.
  const groundGrain =
    ({ alpha = null } = {}) =>
    (u, v, o) => {
      const n = tfbm(u, v, 6, 6, 3),
        g = tnoise(u * 160, v * 160, 160, 9);
      const brightness = clamp(168 + n * 72 + g * 30, 0, 255);
      o[0] = brightness;
      o[1] = brightness * 0.99;
      o[2] = brightness * 0.96;
      if (alpha) o[3] = 255 * alpha(u, v);
    };

  // One tile of a road's ground detail: R fine soil, G pale pebbles, B the dark lines of dried cracks.
  const roadGrit = () => (u, v, o) => {
    const crack = Math.abs(tfbm(u, v, 3, 3, 71) - 0.5);
    o[0] = 255 * tfbm(u, v, 16, 4, 61);
    o[1] = (255 * Math.max(0, tnoise(u * 48, v * 48, 48, 67) - 0.72)) / 0.28;
    o[2] = 255 * Math.max(0, 1 - crack / 0.03);
  };

  // Sun-dried brick in mud mortar: courses that break joint, each brick its own tone, flecked with straw and worn at its edges.
  function brick({ seed = 733, courses: COURSES = 13, perCourse: BRICKS = 4 } = {}) {
    const random = mulberry32(seed),
      tone = Array.from({ length: COURSES * BRICKS * 2 }, () => 0.84 + random() * 0.3),
      shift = Array.from({ length: COURSES }, () => random() * 0.18);
    return (u, v, o) => {
      const row = Math.min(COURSES - 1, Math.floor(v * COURSES)),
        bv = v * COURSES - row,
        x = u * BRICKS + (row % 2) * 0.5 + shift[row],
        col = Math.floor(x),
        bu = x - col,
        k = row * BRICKS * 2 + (((col % (BRICKS * 2)) + BRICKS * 2) % (BRICKS * 2)),
        worn = tfbm(u, v, 16, 3, 741), // edges eaten back by wind and rain
        edge = Math.min(Math.min(bu, 1 - bu) * 0.36, Math.min(bv, 1 - bv) * 0.12) / 0.12 + (worn - 0.5) * 0.5,
        joint = sstep(0.06, 0.2, edge),
        grain = tfbm(u, v, 24, 4, 742),
        straw = sstep(0.8, 0.86, tfbm(u * 3, v * 0.6, 48, 2, 743));
      const brightness = clamp((128 + grain * 70) * (0.74 + 0.26 * joint) * (joint > 0.5 ? tone[k] : 0.92) * (1 + straw * 0.12), 0, 255);
      o[0] = brightness * 1.02;
      o[1] = brightness * 0.97;
      o[2] = brightness * 0.9;
    };
  }

  // Old ice: R how near the nearest crack is, in a net of straight cracks at two sizes, the finer only in places (255 on a
  // crack, 0 at `reach` of the sheet away); G the milky cloud in it; B the grain of its frost; A a broad field for where
  // cracks show and stains run.
  const crackedIce =
    ({ reach = 0.05 } = {}) =>
    (u, v, o) => {
      const w = tfbm(u, v, 3, 3, 871) - 0.5,
        broad = cellEdge(hash2, u + w * 0.04, v - w * 0.03, 4, 872),
        fine = cellEdge(hash2, u - w * 0.03, v + w * 0.04, 9, 873) + reach * sstep(0.62, 0.48, tfbm(u, v, 3, 2, 874));
      o[0] = 255 * (1 - clamp(Math.min(broad, fine) / reach, 0, 1));
      o[1] = 255 * clamp(tfbm(u, v, 4, 4, 875) * 1.3 - 0.15, 0, 1);
      o[2] = 255 * tfbm(u, v, 24, 3, 876);
      o[3] = 255 * tfbm(u, v, 3, 3, 877);
    };

  return { ashlar, rubble, plaster, roofTiles, rock, planks, foliage, groundGrain, roadGrit, brick, crackedIce };
}

// A fill's pixels, four bytes each, row by row from the fill's highest v down to its lowest. size: texels a side; make(): returns the fill(u, v, out, w); depth: for a block, its layers one after another, each
// filled from its height w in the block. A fill that leaves the fourth channel alone gets 255 there.
export function fillPixels({ size, depth = 1, make }) {
  const fn = make(),
    layer = size * size * 4,
    data = new Uint8ClampedArray(layer * depth),
    out = [0, 0, 0, 255];
  for (let z = 0; z < depth; z++)
    for (let y = 0; y < size; y++) {
      let k = z * layer + (size - 1 - y) * size * 4;
      for (let x = 0; x < size; x++, k += 4) {
        out[3] = 255;
        fn((x + 0.5) / size, (y + 0.5) / size, out, (z + 0.5) / depth);
        data[k] = out[0];
        data[k + 1] = out[1];
        data[k + 2] = out[2];
        data[k + 3] = out[3];
      }
    }
  return data;
}
