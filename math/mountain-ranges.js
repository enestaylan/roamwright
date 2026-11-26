/**
 * Add seeded hills, ridges and escarpments to a terrain height function.
 * {@link createMountainRanges} samples relief and loose rock for the same location.
 * @module
 */
import { clamp, lerp, sstep } from './scalar.js';
import { createNoise } from './noise.js';
import { createHash } from './random.js';

const RANGE_FROM = [0.3, 0.75], // how broken an upland must be to begin to be a range, and to be one wholly
  FOOT = 1.15, //            where a flank's rock slope meets its apron, in flank widths from the crest
  APRON = 0.13, //           the share of a crest's height its apron stands for: the scree and wash banked against its foot
  REACH = 2.1, //            flank widths from the crest at which nothing of a range is left
  TAIL_REACH = 1.9, //       and the same past a crest's end, in the lengths its end falls away over
  NARROW = 0.4, //           the share of its width a range keeps where its crest has fallen away
  CREST_ROUND = 7, //        metres a crest is rounded over, so its line does not saw across the ground's cells
  PEAK_SPACING = 0.6, //     peaks along a crest, in half-widths of the range ...
  PEAK_SPAN = [60, 200], //  ... but no nearer and no farther apart than this, in metres
  PEAK_POINT = 1.4, //       how pointed a peak is and how level a saddle (1: a straight line from one to the other)
  PEAK_DROP = 0.26, //       the most a lesser peak stands under the highest, as a share of it,
  SADDLE_DROP = [0.05, 0.24], // and a saddle under the lower of its two peaks;
  PASS = [0.12, 0.2], //     the share of the saddles that are passes, and how much lower a pass lies
  HELD = 0.6, //             the share of its length beyond its width that an ellipse's crest holds its height over, where it is a range
  LOP = 0.3, //              how much narrower than its half-width a range's steeper flank may be, and the other wider
  BOW = 0.3, //              how far a flank's slope may be bowed out or hollowed
  WANDER = 0.28, //          how far a crest strays from its straight line, in half-widths
  WARP = [0.5, 3.2], //      how far a range's whole shape is pulled about, in half-widths, and over what length, in peak spacings
  SHOULDER = 0.85, //        the share of a crest's saddles that send a short spur of their own down one side
  EMBAYED = 0.32, //         how much nearer the crest a valley's floor meets the apron than a spur's toe does
  CUT = 0.6, //             the share of a flank's height the valleys between its spurs are cut down by
  RIB_CUT = 0.42, //         and the gullies in a spur's side
  KNOB = 0.3, //            how far a spur's own crest is notched between its knobs, as a share of the valleys' depth
  RIB_SPAN = [36, 80], //    metres from one such gully to the next: six cells of the ground at the least
  CRAG = 0.42, //             how far broken rock roughens a flank
  NOTCH = 0.1, //            and notches a crest between its peaks, as a share of its height
  BEDS = { thick: 21, hold: 0.34, dip: [0.05, 0.03], warp: 9 }, // the rock's hard beds: metres from one to the next, how far they step a
  // flank into cliffs and benches at the most, how they dip (metres to a metre east and south) and how far (metres) they are warped
  SPUR_LEAST = 0.1, //       the share of its height a crest must keep for a spur to leave it
  SCARP = { face: 0.5, back: 1.3, rim: 0.55, cliff: [0.28, 0.48], level: 0.35, wander: 2.4 }, // an escarpment: its face's and its dip
  // slope's widths as shares of the half-width, how far its rim stands off the middle toward its face, how far down the face its
  // cliff reaches (in flank widths) and the share of the height it drops, how much of a range's peaks and saddles its rim keeps,
  // and how much farther than a range's crest it strays, in bays and headlands
  HILL = { base: 0.3, long: [0.2, 0.5], wide: [0.35, 0.6], high: [0.4, 1], turn: 1.1 }, // a field of hills: the swell they stand
  // on as a share of its height; each hill's half-length as a share of the field's lesser radius, its half-width as a share of its
  // length, its height as a share of the field's, and how far (radians) its crest may turn off the field's strike
  SWELL_REACH = 3.2, //      how far out a swell's foot runs, as its radius squared,
  SWELL_WARP = 0.22, //      and how far that radius is pulled about
  SEG = 9; //                numbers to a spur: its ends (u, v), the metres along it at each, its flanks' width at each, its ribs' phase

/**
 * @typedef {object} EllipticalUpland
 * @property {number} x - Centre X in metres.
 * @property {number} z - Centre Z in metres.
 * @property {number} rx - X radius in metres, or half-length along the supplied axis.
 * @property {number} rz - Z radius in metres, or half-width across the supplied axis.
 * @property {number} h - Height scale in metres.
 * @property {number} rough - Relief roughness from 0 for a smooth swell to 1 for a broken ridge.
 * @property {number} [axis] - Long-axis bearing in radians from +X toward +Z.
 * @property {number} [face] - Bearing toward the steep side of an escarpment, in radians.
 * @property {number} [hills] - Number of hills to scatter inside the ellipse.
 */

/**
 * @typedef {object} Ridge
 * @property {[number, number, number][]} crest - At least two distinct consecutive points, each [x, z, height multiplier].
 * @property {number} wide - Flank half-width in metres.
 * @property {number} h - Height in metres before applying each crest point’s multiplier.
 * @property {number} rough - Relief roughness from 0 to 1.
 * @property {number} [face] - Bearing toward the steep side of an escarpment, in radians from +X toward +Z.
 */

// The long axis of an upland given as an ellipse ({ x, z, rx, rz }), as [bearing, half-length, half-width]: the longer of its
// radii, or along `axis` (a bearing: 0 east, clockwise seen from above), with rx then its half-length and rz its half-width.
const ellipseAxis = landform => (landform.axis !== undefined ? [landform.axis, landform.rx, landform.rz] : landform.rx >= landform.rz ? [0, landform.rx, landform.rz] : [Math.PI / 2, landform.rz, landform.rx]);
/**
 * Get the crest line and flank half-width for drawing a map. An explicit ridge
 * keeps its original point array, including the third height component. An
 * ellipse yields two X/Z endpoints along its long axis.
 * @param {EllipticalUpland | Ridge} landform - Landform supplied to the range layout.
 */
export function crestOf(landform) {
  if (landform.crest) return { line: landform.crest, wide: landform.wide };
  const [bearing, halfLength, halfWidth] = ellipseAxis(landform),
    reach = 0.8 * halfLength;
  return { line: [-reach, reach].map(u => [landform.x + u * Math.cos(bearing), landform.z + u * Math.sin(bearing)]), wide: halfWidth };
}

/**
 * Build a reusable field of mountain relief. Call `layout` with ellipses or ridgelines,
 * then add `heightAt(x, z)` to the base terrain elevation in metres. Each call also
 * overwrites `surface.scree`, the loose-rock amount for that sample.
 * Calling `layout` again replaces the previous landforms. Keep their order stable
 * when reproducing a landscape because each landform’s seed depends on its index.
 * @param {number} [seed] - World seed for the ridges, spurs and surface detail.
 * @example
 * ```js
 * import { createMountainRanges } from 'roamwright/math/mountain-ranges.js';
 *
 * const mountains = createMountainRanges(42);
 * mountains.layout([{ crest: [[0, 0, 0.6], [120, 40, 1]], wide: 50, h: 90, rough: 0.8 }]);
 * const elevation = 12 + mountains.heightAt(80, 25);
 * const looseRock = mountains.surface.scree;
 * ```
 */
export function createMountainRanges(seed = 0) {
  const { fbm, ridged, vnoise } = createNoise(seed);
  const hash2 = createHash(seed);
  // What rangesAt found out about the place it worked out last, for the colours: how far it is scree and wash, the apron at a
  // range's foot and the floors of its valleys.
  const range = { scree: 0 };
  let uplands = [], // the uplands laid out: { limbs, x0, x1, z0, z1 }
    crag = -1, // the noise every swell is broken by at the place rangesAt is working out, once one has asked for it,
    pull = 0; // and what pulls its radius about

  // The swell of an ellipse ({ x, z, rx, rz, h, rough }) at (x, z), in metres: a rise that falls away smoothly all round, broken
  // by noise the more it is rough.
  function swellAt(landform, x, z) {
    const r0 = ((x - landform.x) / landform.rx) ** 2 + ((z - landform.z) / landform.rz) ** 2;
    if (r0 >= SWELL_REACH + SWELL_WARP / 2) return 0;
    if (crag < 0) {
      // the noise is worked out only where a swell is near
      crag = ridged(x * 0.0034, z * 0.0034, 5, 331);
      pull = SWELL_WARP * (fbm(x * 0.0021, z * 0.0021, 2, 337) - 0.5);
    }
    const r = r0 + pull;
    return r < SWELL_REACH ? landform.h * Math.exp(-1.5 * Math.max(r, 0)) * lerp(1, 0.35 + 1.25 * crag, landform.rough) : 0;
  }

  // The height of a limb's crest at u, as a share of its own: 1 along its length, falling away past each end.
  function crestShare(limbData, u) {
    const over = u < 0 ? -u / limbData.tail0 : u > limbData.len ? (u - limbData.len) / limbData.tail1 : 0;
    return (over > 0 ? Math.exp(-1.5 * over ** limbData.fall) : 1) * lerp(limbData.k0, limbData.k1, clamp(u / (limbData.len || 1), 0, 1));
  }
  // How far a limb's crest stands off its straight line at u: it wanders, and an escarpment's rim stands toward its face.
  function crestOffset(limbData, u) {
    const stray = 2 * (vnoise(u / limbData.wave + 7.3, 0, limbData.seed) - limbData.strayAt);
    return limbData.rim + limbData.wander * stray * (limbData.line ? sstep(0, limbData.step, u) * sstep(limbData.len, limbData.len - limbData.step, u) : 1); // the stretches of a line meet end to end
  }
  // How far a range leans to one side at u, -1..1: no range's two flanks are alike, and which is the steeper changes along it.
  const leanAt = (limbData, u, seed) => 2 * vnoise(u / (4 * limbData.step) + 3.1, 0, limbData.seed + seed) - 1;
  // The width of a limb's flank on `side` of its crest at u, where the crest stands at fraction crestFraction of its height: a range narrows as
  // its crest falls, so its flanks keep their slope, and the flank it leans toward is the narrower and steeper.
  const flankWidth = (limbData, crestFraction, side, u) =>
    limbData.b * (NARROW + (1 - NARROW) * crestFraction) * (limbData.face ? (limbData.face === side ? SCARP.face : SCARP.back) : 1 - side * LOP * limbData.rough * leanAt(limbData, u, 9));
  // How far a range's shape is pulled off its place at (x, z), along x (`turn` 0) or z (1), as a share of the most: at two scales.
  const warpAt = (limbData, x, z, turn) => 2 * fbm(x * limbData.warpOver + 31.7 * turn, z * limbData.warpOver + 11.3 * turn, 2, limbData.seed + 3 + turn) - 1;
  // How far a crest is notched at u, as a share of the most.
  const notchAt = (limbData, u) => 2 * fbm(u / (0.7 * limbData.step), 0, 3, limbData.seed + 6) - 1;

  // The peaks and saddles of a limb's crest, as [u, share of the height] in turn from a peak to a peak: a peak stands where the
  // data puts the upland (the middle of an ellipse, the points of a line), the rest a spacing apart.
  function crestKnots(limbData, spacing) {
    const first = limbData.line ? 0 : limbData.len / 2,
      step = limbData.line ? limbData.len / Math.max(1, Math.round(limbData.len / spacing)) : spacing,
      last = limbData.line ? Math.round(limbData.len / step) : 0, // the peak at a line's far point
      from = -Math.ceil((first + 1.3 * limbData.tail0) / step),
      to = Math.ceil((limbData.len + 1.3 * limbData.tail1 - first) / step),
      level = limbData.rough * (limbData.face ? SCARP.level : 1),
      knots = [];
    let before = 0;
    for (let k = from; k <= to; k++) {
      const given = k === 0 || (limbData.line && k === last),
        u = first + (k + (given ? 0 : 0.6 * (hash2(k, 1, limbData.seed) - 0.5))) * step,
        peak = given ? 1 : 1 - level * PEAK_DROP * Math.sqrt(hash2(k, 2, limbData.seed)); // a few stand near the highest, most well under it
      if (k > from) {
        const drop = lerp(SADDLE_DROP[0], SADDLE_DROP[1], hash2(k, 4, limbData.seed)) + (hash2(k, 5, limbData.seed) < PASS[0] ? PASS[1] : 0);
        knots.push(lerp(knots[knots.length - 2], u, 0.35 + 0.3 * hash2(k, 3, limbData.seed)), Math.min(before, peak) - level * drop);
      }
      knots.push(u, peak);
      before = peak;
    }
    limbData.step = step;
    return Float64Array.from(knots);
  }
  // How high a limb's crest stands at u between its peaks and saddles, as a share: pointed at a peak, level across a saddle.
  function knotShare(limbData, u) {
    const knots = limbData.knots,
      n = knots.length / 2;
    if (u <= knots[0]) return knots[1];
    if (u >= knots[2 * n - 2]) return knots[2 * n - 1];
    let i = clamp(Math.floor(((u - knots[0]) / limbData.step) * 2), 0, n - 2);
    while (knots[2 * i] > u) i--;
    while (knots[2 * i + 2] < u) i++;
    const t = (u - knots[2 * i]) / (knots[2 * i + 2] - knots[2 * i]),
      startHeight = knots[2 * i + 1],
      endHeight = knots[2 * i + 3];
    return startHeight >= endHeight ? endHeight + (startHeight - endHeight) * (1 - t) ** PEAK_POINT : startHeight + (endHeight - startHeight) * t ** PEAK_POINT;
  }
  // The spurs that run down one side of a limb: one from each peak, with a branch or two that leave it lower down, and a short
  // one from the shoulder of most saddles. A spur is a straight line: the range's warp bends it.
  function limbSpurs(limbData, side) {
    const out = [],
      spur = (u0, v0, angle, long, tau, wide0, wide1, seed) =>
        out.push(
          u0,
          v0,
          u0 + long * Math.sin(angle),
          v0 + side * long * Math.cos(angle),
          tau,
          tau + long,
          wide0,
          wide1,
          hash2(seed, 9, limbData.seed),
        );
    for (let k = 0; k < limbData.knots.length; k += 2) {
      const u = limbData.knots[k],
        crestFraction = crestShare(limbData, u),
        id = k + (side > 0 ? 1 : 0),
        r = n => hash2(id, n, limbData.seed + 1),
        peak = k % 4 === 0;
      if (crestFraction < SPUR_LEAST || (!peak && r(0) > SHOULDER)) continue;
      const buttress = limbData.face === side, // an escarpment's face is buttressed, not spurred
        long = flankWidth(limbData, crestFraction, side, u) * FOOT * (buttress ? 0.75 : peak ? 0.45 + 0.7 * r(1) : 0.3 + 0.35 * r(1)),
        splay = u < 0 ? -sstep(0, 1, -u / limbData.tail0) : u > limbData.len ? sstep(0, 1, (u - limbData.len) / limbData.tail1) : 0, // round a crest's end they fan out
        lean = (r(2) - 0.5) * 1.1 + 0.9 * splay,
        v = crestOffset(limbData, u),
        girth = limbData.step * (0.8 + 0.4 * r(7));
      spur(u, v, lean, long, 0, 0.42 * girth, 0.64 * girth, id);
      if (buttress || !peak) continue;
      for (let branchIndex = 0; branchIndex < 2; branchIndex++) {
        const at = (branchIndex ? 0.6 : 0.38) + 0.14 * r(3 + branchIndex),
          turn = lean + (branchIndex ? -1 : 1) * (r(5) < 0.5 ? -1 : 1) * (0.6 + 0.4 * r(6 + branchIndex));
        spur(
          u + at * long * Math.sin(lean),
          v + side * at * long * Math.cos(lean),
          turn,
          (1 - at) * long * 0.85,
          at * long,
          0.3 * girth,
          0.42 * girth,
          id + 1000 * (branchIndex + 1),
        );
      }
    }
    // where a crest ends, a long spur runs out and away on either side of its fall, so that the end of a range is no cone
    for (const [u, away, free] of [
      [0, -1, limbData.free0],
      [limbData.len, 1, limbData.free1],
    ]) {
      if (!free) continue;
      const id = 5000 + (away > 0 ? 2 : 0) + (side > 0 ? 1 : 0),
        long = flankWidth(limbData, crestShare(limbData, u), side, u) * FOOT * (0.7 + 0.6 * hash2(id, 1, limbData.seed + 1)),
        girth = limbData.step * (1 + 0.4 * hash2(id, 2, limbData.seed + 1));
      spur(u, crestOffset(limbData, u), away * (0.6 + 0.7 * hash2(id, 3, limbData.seed + 1)), long, 0, 0.42 * girth, 0.64 * girth, id);
    }
    return binned(limbData, out);
  }
  // The spurs of `list` sorted into bins along a limb's crest, a peak spacing long each: every bin holds the spurs that reach into
  // its stretch, so a place asks only the few that could lie near it.
  function binned(limbData, list) {
    const bins = Array.from({ length: Math.ceil((limbData.to - limbData.from) / limbData.step) }, () => []);
    for (let i = 0; i < list.length; i += SEG) {
      const reach = Math.max(list[i + 6], list[i + 7]),
        first = Math.floor((Math.min(list[i], list[i + 2]) - reach - limbData.from) / limbData.step),
        last = Math.floor((Math.max(list[i], list[i + 2]) + reach - limbData.from) / limbData.step);
      for (let binIndex = Math.max(first, 0); binIndex <= Math.min(last, bins.length - 1); binIndex++) bins[binIndex].push(...list.slice(i, i + SEG));
    }
    return bins.map(bin => Float64Array.from(bin));
  }
  // A limb: a straight stretch of crest from (x, z) along the unit vector (ax, az), `len` metres long and falling away past its
  // ends over tail0 and tail1; k0, k1: its height at each end, as shares of h; b: its half-width; face: the side of an
  // escarpment's steep face (the sign of v), 0 for a range; line: whether it is a stretch of a line the data gave; free0, free1:
  // whether the crest ends at that end of the limb, or another limb carries it on; swell: the ellipse it is the range of, whose
  // swell it is where it is not broken enough to be one (none: a swell about its own crest).
  function limb(spec, seed) {
    const sharp = sstep(RANGE_FROM[0], RANGE_FROM[1], spec.rough),
      limbData = {
        ...spec,
        seed,
        sharp,
        fall: lerp(2, 3, sharp),
        rim: spec.face * SCARP.rim * spec.b,
        wander: WANDER * spec.b * spec.rough * (spec.face ? SCARP.wander : 1),
        strayAt: 0.5,
      };
    limbData.knots = crestKnots(limbData, clamp(PEAK_SPACING * limbData.b, PEAK_SPAN[0], PEAK_SPAN[1]));
    limbData.wave = 3 * limbData.step;
    limbData.warp = WARP[0] * limbData.b * limbData.rough * sharp;
    limbData.warpOver = 1 / (WARP[1] * limbData.step);
    limbData.rib = clamp(0.3 * limbData.step, RIB_SPAN[0], RIB_SPAN[1]);
    // the stretch of its frame outside which the range raises nothing, however it is pulled about (by twice its warp at the most)
    limbData.from = -TAIL_REACH * limbData.tail0 - 2 * limbData.warp;
    limbData.to = limbData.len + TAIL_REACH * limbData.tail1 + 2 * limbData.warp;
    limbData.far = REACH * limbData.b * Math.max(1 + LOP, SCARP.back) + Math.abs(limbData.rim) + 2 * limbData.wander + 2 * limbData.warp;
    // a summit stands where the data puts it, the middle of an ellipse or the points of a line: there the crest has not strayed
    // (crestOffset), nor been pulled about or notched, which `pin` holds for each end of the limb [warp along x, along z, notch]
    const mid = limbData.len / 2,
      pinAt = u => [warpAt(limbData, limbData.x + u * limbData.ax, limbData.z + u * limbData.az, 0), warpAt(limbData, limbData.x + u * limbData.ax, limbData.z + u * limbData.az, 1), notchAt(limbData, u)];
    limbData.pin = limbData.line ? [pinAt(0), pinAt(limbData.len)] : [pinAt(mid), pinAt(mid)];
    if (!limbData.line) limbData.strayAt = vnoise(mid / limbData.wave + 7.3, 0, seed);
    limbData.spurs = { 1: limbSpurs(limbData, 1), [-1]: limbSpurs(limbData, -1) };
    return limbData;
  }

  const spurAt = { best: 0, next: 0, tau: 0, phase: 0, side: 0 }; // what spurNear found: the nearest spur's share and the next one's, how far along the nearest, its phase and which side of it
  // How far (u, v) lies on the spurs of `list`: 1 on a spur's line, 0 a flank's width off it.
  function spurNear(list, u, v) {
    let best = 0,
      next = 0;
    for (let i = 0; i < list.length; i += SEG) {
      const au = list[i],
        av = list[i + 1],
        eu = list[i + 2] - au,
        ev = list[i + 3] - av,
        t = clamp(((u - au) * eu + (v - av) * ev) / (eu * eu + ev * ev), 0, 1),
        du = u - au - t * eu,
        dv = v - av - t * ev,
        share = 1 - Math.hypot(du, dv) / lerp(list[i + 6], list[i + 7], t);
      if (share > best) {
        next = best;
        best = share;
        spurAt.tau = lerp(list[i + 4], list[i + 5], t);
        spurAt.phase = list[i + 8];
        spurAt.side = eu * dv - ev * du > 0 ? 0.37 : 0; // the gullies of its two sides do not meet across it
      } else if (share > next) next = share;
    }
    spurAt.best = best;
    spurAt.next = next;
  }
  // A flank's rock slope at s flank widths from the crest, as a share of the crest's height: a slope down to its foot, bowed out
  // into a shoulder (`bow` under 1) or hollowed under a steep head (over 1); an escarpment's face a cliff over a bank of talus,
  // its back a dip slope.
  function flankBody(s, scarp, bow) {
    if (scarp > 0) {
      const [reach, drop] = SCARP.cliff;
      return s < reach ? 1 - drop * sstep(0.02, reach, s) : (1 - drop) * Math.max(0, 1 - (s - reach) / (FOOT - reach)) ** 1.25;
    }
    return Math.max(0, 1 - s / FOOT) ** (scarp < 0 ? 0.9 : bow);
  }
  // A flank of rock h metres high at (x, z), stepped by its beds `hold` of the way: a cliff where a hard bed crops out, a bench
  // on the softer rock over it. The beds dip, so the steps do not follow the flank's own level lines; they are thick and thin by
  // turns, and a bed that stands as a cliff on one spur is lost under scree on the next.
  function bedded(h, x, z, hold) {
    const level = (h + BEDS.dip[0] * x + BEDS.dip[1] * z + BEDS.warp * vnoise(x * 0.004, z * 0.004, 347)) / BEDS.thick,
      uneven = level + 0.3 * Math.sin(level * 2.4),
      f = uneven - Math.floor(uneven),
      shown = sstep(0.3, 0.7, vnoise(x * 0.006, z * 0.006, 349) + 0.25 * Math.sin(level * 1.7));
    return h + hold * shown * sstep(0, BEDS.thick, h) * BEDS.thick * (sstep(0.3, 0.8, f) - f);
  }
  // Metres a limb's range raises the ground at (x, z), and the swell about its crest where it has no ellipse's (`smooth`: how
  // far it is that swell).
  function rangeHeight(limbData, x, z, smooth) {
    const px = x - limbData.x,
      pz = z - limbData.z,
      along = px * limbData.ax + pz * limbData.az;
    if (along < limbData.from || along > limbData.to || Math.abs(pz * limbData.ax - px * limbData.az) > limbData.far) return 0; // before any noise is worked out
    // a range's shape is pulled about, so that no crest, spur or foot is a ruled line; not at its summits (limbData.pin)
    const [from, to] = limbData.pin,
      held = clamp(along / (limbData.len || 1), 0, 1),
      dx = px + limbData.warp * (warpAt(limbData, x, z, 0) - lerp(from[0], to[0], held)),
      dz = pz + limbData.warp * (warpAt(limbData, x, z, 1) - lerp(from[1], to[1], held)),
      u = dx * limbData.ax + dz * limbData.az;
    if (u < -TAIL_REACH * limbData.tail0 || u > limbData.len + TAIL_REACH * limbData.tail1) return 0;
    const off = dz * limbData.ax - dx * limbData.az - crestOffset(limbData, u),
      side = off < 0 ? -1 : 1,
      flankDistance = side * off,
      crestFraction = crestShare(limbData, u),
      crest = limbData.h * crestFraction * knotShare(limbData, u) * (1 + limbData.sharp * limbData.rough * NOTCH * (notchAt(limbData, u) - lerp(from[2], to[2], held))),
      swell = smooth > 0 ? crest * Math.exp(-1.5 * (flankDistance / limbData.b) ** 2) : 0,
      wide = flankWidth(limbData, crestFraction, side, u),
      s = flankDistance / wide;
    if (smooth >= 1 || s >= REACH) return swell * smooth;
    spurNear(limbData.spurs[side][clamp(Math.floor((u - limbData.from) / limbData.step), 0, limbData.spurs[side].length - 1)], u, off);
    const spurStrength = spurAt.best,
      scarp = limbData.face ? (limbData.face === side ? 1 : -1) : 0,
      own = sstep(0, 0.25, spurStrength - spurAt.next), // how far the place is one spur's alone: what is its own (its knobs, its gullies) fades out toward the next spur
      knobs = 1 - KNOB * own * vnoise(spurAt.tau / limbData.step + 40 * spurAt.phase, 0, limbData.seed + 8),
      floor = 1 - ((spurStrength * spurStrength) / (spurStrength + 0.15)) * 1.15 * knobs, // how far the place is a valley's floor: a spur's crest is a sharp line, the floor rounded
      round = CREST_ROUND / wide,
      bow = 1 + side * BOW * limbData.rough * leanAt(limbData, u, 10),
      body = flankBody((Math.sqrt(s * s + round * round) - round) / (1 - EMBAYED * floor * sstep(0.1, 0.5, s)), scarp, bow),
      deep = limbData.rough * CUT * sstep(0.02, 0.3, s) * (scarp < 0 ? 0.5 : 1),
      sides = limbData.rough * RIB_CUT * own * (1 - spurStrength) * sstep(0.1, 0.35, s),
      gully = spurAt.tau / limbData.rib + spurAt.phase + spurAt.side,
      cut = (1 - deep * floor) * (1 - sides * Math.abs(2 * (gully - Math.floor(gully)) - 1)), // what the valleys and gullies leave of the flank
      broken = body > 0 ? 1 + limbData.rough * CRAG * sstep(0, 0.12, s) * (ridged(x * 0.009, z * 0.009, 4, 331) - 0.45) : 1,
      stone = bedded(crest * (1 - APRON) * body * cut * broken, x, z, BEDS.hold * limbData.rough),
      // the apron is banked highest where a valley comes out onto it, in a fan
      apron = crest * APRON * Math.exp(-1.2 * s * s) * (1 + 0.5 * limbData.rough * (floor - 0.5) * sstep(0.6, 1, s)),
      lies = sstep(2, 1.3, s) * Math.max(sstep(0.75, 1.05, s), 0.7 * floor * floor * sstep(0.3, 0.8, s)),
      loose = limbData.sharp * sstep(8, 30, limbData.h * crestFraction) * lies;
    if (loose > range.scree) range.scree = loose;
    return lerp(stone + apron, swell, smooth);
  }
  // Metres a limb raises the ground at (x, z): its range, and where it is not broken enough to be one wholly, its swell.
  function limbHeight(limbData, x, z) {
    if (!limbData.swell) return rangeHeight(limbData, x, z, 1 - limbData.sharp);
    return (limbData.sharp < 1 ? (1 - limbData.sharp) * swellAt(limbData.swell, x, z) : 0) + (limbData.sharp > 0 ? limbData.sharp * rangeHeight(limbData, x, z, 0) : 0);
  }
  // The higher of two limbs of one upland, rounded where they meet.
  function joined(firstHeight, secondHeight) {
    const most = Math.max(firstHeight, secondHeight),
      k = 0.25 * most,
      near = k > 0 ? Math.max(k - Math.abs(firstHeight - secondHeight), 0) / k : 0;
    return most + (near * near * k) / 4;
  }
  /**
   * @param {number} x - World X in metres.
   * @param {number} z - World Z in metres.
   * @returns {number} Added elevation in metres. An empty layout contributes zero.
   */
  function rangesAt(x, z) {
    let h = 0;
    range.scree = 0;
    crag = -1;
    for (let i = 0; i < uplands.length; i++) {
      const upland = uplands[i];
      if (x < upland.x0 || x > upland.x1 || z < upland.z0 || z > upland.z1) continue;
      let top = 0;
      for (let j = 0; j < upland.limbs.length; j++) top = joined(top, limbHeight(upland.limbs[j], x, z));
      h += top;
    }
    return h;
  }

  // An upland's limbs with the box that holds all they raise.
  function boxed(limbs) {
    const box = { limbs, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity },
      hold = (x, z) => {
        box.x0 = Math.min(box.x0, x);
        box.x1 = Math.max(box.x1, x);
        box.z0 = Math.min(box.z0, z);
        box.z1 = Math.max(box.z1, z);
      };
    for (const limbData of limbs) {
      for (const u of [limbData.from, limbData.to]) for (const v of [-limbData.far, limbData.far]) hold(limbData.x + u * limbData.ax - v * limbData.az, limbData.z + u * limbData.az + v * limbData.ax);
      if (limbData.swell) {
        const reach = Math.sqrt(SWELL_REACH + SWELL_WARP / 2);
        hold(limbData.swell.x - reach * limbData.swell.rx, limbData.swell.z - reach * limbData.swell.rz);
        hold(limbData.swell.x + reach * limbData.swell.rx, limbData.swell.z + reach * limbData.swell.rz);
      }
    }
    return box;
  }
  // The side of a limb (the sign of v) that the bearing `face` looks toward; 0 where the upland is no escarpment.
  const faceSide = (face, ax, az) => (face === undefined ? 0 : Math.cos(face) * -az + Math.sin(face) * ax < 0 ? -1 : 1);
  // An upland given as an ellipse ({ x, z, rx, rz, h, rough }): one limb along its long axis. The more broken it is, the longer
  // its crest holds its height before it falls away.
  function ellipseLimb(landform, seed) {
    const [bearing, halfLength, halfWidth] = ellipseAxis(landform),
      held = HELD * sstep(RANGE_FROM[0], RANGE_FROM[1], landform.rough) * Math.max(halfLength - 0.5 * halfWidth, 0.2 * halfLength), // the half-length its crest holds its height over: little of a round one's
      tail = halfLength - 0.95 * held,
      ax = Math.cos(bearing),
      az = Math.sin(bearing),
      crest = {
        x: landform.x - held * ax,
        z: landform.z - held * az,
        ax,
        az,
        len: 2 * held,
        tail0: tail,
        tail1: tail,
        k0: 1,
        k1: 1,
        free0: true,
        free1: true,
      };
    return limb(
      { ...crest, b: halfWidth, h: landform.h, rough: landform.rough, face: faceSide(landform.face, ax, az), line: false, swell: landform.axis === undefined ? landform : null },
      seed,
    );
  }
  // An upland given as a line ({ crest: [[x, z, share of h], ...], wide, h, rough }): a limb to each stretch, each running on a
  // little past the point where the next begins.
  function lineLimbs(landform, seed) {
    const limbs = [],
      tail = end => landform.wide * (end ? 0.65 : 0.7);
    for (let i = 0; i + 1 < landform.crest.length; i++) {
      const [x, z, k0] = landform.crest[i],
        [x1, z1, k1] = landform.crest[i + 1],
        len = Math.hypot(x1 - x, z1 - z),
        ax = (x1 - x) / len,
        az = (z1 - z) / len,
        first = i === 0,
        last = i + 2 === landform.crest.length,
        crest = { x, z, ax, az, len, tail0: tail(first), tail1: tail(last), k0, k1, free0: first, free1: last };
      limbs.push(
        limb({ ...crest, b: landform.wide, h: landform.h, rough: landform.rough, face: faceSide(landform.face, ax, az), line: true, swell: null }, seed + i * 3),
      );
    }
    return limbs;
  }
  // A field of hills ({ x, z, rx, rz, h, rough, hills: how many }): small ranges scattered over its ellipse, their crests near one
  // strike (`axis`, or the ellipse's long axis), on a low swell.
  function hillField(landform, seed) {
    const [strike, , lesser] = ellipseAxis(landform),
      r = (i, n) => hash2(i, n, seed + 2),
      out = [boxed([ellipseLimb({ ...landform, h: landform.h * HILL.base, rough: 0, axis: undefined }, seed)])];
    for (let i = 0; i < landform.hills; i++) {
      const far = 0.85 * Math.sqrt((i + 0.5) / landform.hills),
        round = i * 2.39996 + r(i, 1), // the golden angle from one to the next, so they fill the ellipse evenly
        long = lesser * lerp(HILL.long[0], HILL.long[1], r(i, 2)),
        hill = {
          x: landform.x + landform.rx * far * Math.cos(round),
          z: landform.z + landform.rz * far * Math.sin(round),
          rx: long,
          rz: long * lerp(HILL.wide[0], HILL.wide[1], r(i, 3)),
          h: landform.h * lerp(HILL.high[0], HILL.high[1], r(i, 4)) * (1 - 0.4 * far * far),
          rough: landform.rough,
          axis: strike + (r(i, 5) - 0.5) * HILL.turn,
        };
      out.push(boxed([ellipseLimb(hill, seed + 10 + i * 3)]));
    }
    return out;
  }
  /** @param {(EllipticalUpland | Ridge)[]} list - Landforms in stable seed order. */
  function layOutRanges(list) {
    uplands = list.flatMap((landform, i) => {
      const seed = 400 + i * 41;
      return landform.hills ? hillField(landform, seed) : [boxed(landform.crest ? lineLimbs(landform, seed) : [ellipseLimb(landform, seed)])];
    });
  }
  return { layout: layOutRanges, heightAt: rangesAt, surface: range };
}
