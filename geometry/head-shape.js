import { clamp, lerp, sstep } from '../math/scalar.js';
import { BACK, FRONT, MIDDLE, NOSE_OUT, NOSE_WIDE, SQUARE, WIDTH, sampled } from './head-profile.js';

// ════════════════════════════════════════════════════════════════════════
//  The shape of a head. It is a stack of level slices, each a rounded outline about a middle that moves forward toward the chin:
//  a skull that closes into a dome above and a jaw that closes into the chin below. The features of a face (brow, sockets, lids,
//  nose, cheeks, lips, chin) are pushed out of and into that form. Lengths in here are millimetres from the head's middle, which
//  is the level of the eyes; what leaves this module is in metres.
// ════════════════════════════════════════════════════════════════════════
const MM = 0.001,
  HALF = 118, // from the middle up to the crown, and down to the underside of the chin
  CROWN = 45, // above this the slices close into the dome of the skull
  JAW = -85, // below this (the angle of the jaw) they close into the chin
  SEAM = -67, // where the lips meet
  LID_TOP = 3.2, // the rows of the face's grid that are laid along the edges of the upper and the lower lid,
  LID_LOW = -6, //   and the rows above and below them where the grid lies level again
  LID_ABOVE = 17,
  LID_BELOW = -16,
  FURROWS = [40, 49, 58], // the heights of the furrows of an aged brow
  UNDER_STEPS = 3, // times a point is drawn in toward the skull to find what lies under it: its surface is no sphere
  SCAR_WIDE = 1.7, // millimetres across an old scar's seam, unless the look says
  SCAR_SHADE = 0.14, // how much a millimetre of a scar's seam darkens the skin in it (a crease holds shadow)
  WOUND_DEEP = 4.5, // millimetres a fresh wound's torn flesh lies below the skin round it,
  WOUND_SWELL = 2.2, // and how far the bruised skin at its edges swells;
  HEALED_DEEP = 2.4, // once healed (H.healed), how far the scar lies sunk where the flesh was torn, and how high its edges and
  HEALED_RIDGE = 0.9, //   the cords of scar tissue across it stand
  // Where a wound has torn the nose away, the opening into the skull's nose left in its place: a pear-shaped hollow down the
  // middle of the face (from the top of its rows to its foot, millimetres up the face), its half width at the foot, how deep it
  // sinks, and how dark it is within, fresh and healed.
  NOSE_HOLE = { top: -19, foot: -46, wide: 9.5, deep: 6, dark: 0.78, healedDeep: 3.5, healedDark: 0.6 },
  // Optional single brow eye: centre height, radius, opening, offset and brow ridge in millimetres.
  ONE_EYE = { y: 16.5, r: 17.5, wide: 16.5, high: 10.5, out: 7, ridge: 7 };

// A soft rise of that width about a point, and one about a point of the face. Far from the point it is nothing, and is not
// worked out: a head asks for these some hundred thousand times.
const FAR = 3.2;
function bump(v, at, wide) {
  const d = (v - at) / wide;
  return d > FAR || d < -FAR ? 0 : Math.exp(-d * d);
}
function blob(x, y, ax, ay, wx, wy) {
  const dx = (x - ax) / wx,
    dy = (y - ay) / wy,
    d = dx * dx + dy * dy;
  return d > FAR * FAR ? 0 : Math.exp(-d);
}
// The larger of two heights, rounded where they meet.
function smoothMax(a, b, k) {
  const h = clamp(0.5 + (a - b) / (2 * k), 0, 1);
  return lerp(b, a, h) + k * h * (1 - h);
}
// How far a point lies from the line a-b, to which side of it (positive to the outside of the face), and how far along.
function fromLine(x, y, ax, ay, bx, by, out) {
  const dx = bx - ax,
    dy = by - ay,
    len = Math.hypot(dx, dy),
    along = ((x - ax) * dx + (y - ay) * dy) / (len * len);
  out[0] = ((x - ax) * -dy + (y - ay) * dx) / len;
  out[1] = along;
}

const _slice = { x: 0, z: 0 },
  _line = [0, 0];

// The surface of a head of shape H, as a function of a direction from its middle: fn(dir, outPoint, channels). Channels: lips,
// shade, warmth (cheeks, nose), where a beard grows on cheeks and jaw, brow, where a moustache grows, the chin's tuft, a scar. A fine head has open lids and a mouth that can open (its grid lays rows
// along their edges); a plain one, for the far mesh and for coarse sculpts, has them closed and painted.
function headFn(features = {}, fine = false) {
  const H = { jaw: 0.5, lips: 1, cheek: 1, mouthW: 1, brow: 1, socket: 1, hollow: 0, chin: 1, nose: 1, bridge: 0, ...features };
  const age = H.age || 0,
    fat = H.fat || 0,
    dead = H.dead || 0,
    jawWide = (H.jaw - 0.5) * 0.17,
    chinWide = ((H.chinW ?? 1) - 1) * 0.5,
    slope = H.slope ?? 1,
    lips = H.lips,
    noseLong = H.noseL ?? 1,
    noseWide = H.noseW ?? 1;
  const width = sampled(
      y =>
        WIDTH(y) *
        (1 +
          jawWide * bump(y, -84, 26) +
          chinWide * sstep(-88, -108, y) +
          (H.cheek - 1) * 0.05 * bump(y, -18, 16) +
          fat * 0.1 * bump(y, -62, 36)),
      -HALF,
      HALF,
    ),
    front = sampled(y => FRONT(y) * (1 - slope * 0.04 * sstep(26, 80, y)), -HALF, HALF),
    back = sampled(y => BACK(y) + fat * 26 * bump(y, -104, 13), -HALF, HALF);
  // how far the slices have closed toward the crown or the chin (the ends, where it falls steeply, are worked out each time)
  const closingAt = y => {
      if (y > CROWN) return Math.pow(1 - Math.pow(Math.min(1, (y - CROWN) / (HALF - CROWN)), 2.2), 1 / 2.2);
      if (y < JAW) return Math.pow(1 - Math.pow(Math.min(1, (JAW - y) / (HALF + JAW)), 1.6), 1 / 1.6);
      return 1;
    },
    closingSampled = sampled(closingAt, -HALF, HALF),
    closing = y => (y > HALF - 6 || y < 6 - HALF ? closingAt(y) : closingSampled(y));
  // the outline of the bare skull and jaw at a height, at an angle round from the front
  // (a grid asks for one height many times running, so the slice last asked for is kept)
  const kept = { y: NaN, square: 2, wide: 0, fore: 0, aft: 0, mid: 0 };
  const slice = (y, angle, o) => {
    if (y !== kept.y) {
      const k = closing(y);
      kept.y = y;
      kept.square = SQUARE(y);
      kept.wide = width(y) * k;
      kept.fore = front(y) * k;
      kept.aft = back(y) * k;
      kept.mid = MIDDLE(y);
    }
    const n = kept.square,
      s = Math.sin(angle),
      c = Math.cos(angle),
      q = Math.pow(Math.pow(Math.abs(s), n) + Math.pow(Math.abs(c), n), -1 / n);
    o.x = kept.wide * s * q;
    o.z = kept.mid + (c > 0 ? kept.fore : kept.aft) * c * q;
  };

  // the eyes: where each ball sits, and the edges of its lids from the inner corner (0) to the outer (1)
  const eyeX = 31.5 * (H.eyeGap ?? 1),
    eyeY = -1,
    ballR = 12.2,
    lidR = ballR + 1.3,
    innerX = eyeX - 14.5,
    outerX = eyeX + 14,
    one = !!H.oneEye, // the two eyes healed over, and one in the middle of the brow
    opening = one ? 0 : (H.eye ?? 1),
    tilt = H.tilt ?? 0;
  slice(eyeY, Math.asin(eyeX / width(eyeY)) * 0.93, _slice);
  const eyeZ = _slice.z - 14.4 - (H.deep ?? 0);
  slice(ONE_EYE.y, 0, _slice);
  const oneZ = _slice.z + ONE_EYE.out - ONE_EYE.r, // where the middle of the one eye's ball is
    oneLid = ONE_EYE.r + 1.3;
  const corner = t => eyeY - 1.9 + (1.5 + 1.6 * tilt) * t,
    upperLid = t => corner(t) + 5.4 * opening * Math.pow(4 * Math.pow(t, 0.85) * (1 - Math.pow(t, 0.85)), 0.72),
    lowerLid = t => corner(t) - 3.9 * opening * Math.pow(4 * Math.pow(t, 1.15) * (1 - Math.pow(t, 1.15)), 0.8);
  // a row of the grid is bent so that the two lid rows run along the lids' edges; away from the eye it lies level
  const lidEdges = (ax, o) => {
    const t = (ax - innerX) / (outerX - innerX);
    if (t > 0 && t < 1) {
      o[0] = upperLid(t);
      o[1] = lowerLid(t);
    } else {
      const c = corner(clamp(t, 0, 1)),
        e = sstep(0, 7, t < 0 ? innerX - ax : ax - outerX);
      o[0] = c + (LID_TOP - c) * e;
      o[1] = c + (LID_LOW - c) * e;
    }
    return t;
  };
  const bendRow = (row, up, low) =>
    row >= LID_TOP
      ? up + ((row - LID_TOP) * (LID_ABOVE - up)) / (LID_ABOVE - LID_TOP)
      : row >= LID_LOW
        ? low + ((row - LID_LOW) * (up - low)) / (LID_TOP - LID_LOW)
        : low - ((LID_LOW - row) * (low - LID_BELOW)) / (LID_LOW - LID_BELOW);

  // An old scar at a point of the face (millimetres; x to the person's left), as how far the skin is sunk there and how pale it
  // is: H.scar is the seam's two ends, its width (millimetres) and how far its middle bows down from the straight, like a smile.
  // A wider one is deeper and paler.
  const _scar = [0, 0],
    scarAt = (x, y) => {
      const [ax0, ay0, bx, by, wide = SCAR_WIDE, bow = 0] = H.scar,
        k = Math.sqrt(wide / SCAR_WIDE);
      fromLine(x, y, ax0, ay0, bx, by, _line);
      const t = _line[1],
        d = _line[0] + bow * 4 * t * (1 - t), // the seam's own line, bowed
        ends = sstep(-0.04, 0.05, t) * sstep(1.04, 0.95, t);
      _scar[0] = k * ends * (0.75 * bump(d, 0, 0.45 * wide) - 0.22 * bump(Math.abs(d), 0.95 * wide, 0.4 * wide));
      _scar[1] = k * ends * bump(d, 0, wide);
      return _scar;
    };
  // A fresh wound (H.wound: as a scar, its two ends, width and bow): a broad band of torn flesh, sunk and ragged, the skin
  // swollen along its edges; as how deep it lies at a point and how much of it there is (0 to 1). Healed, the band has closed
  // into a scar: shallower, the swelling gone, its edges and cords of scar tissue across it standing proud.
  const _wound = [0, 0],
    woundAt = (x, y) => {
      const [ax0, ay0, bx, by, wide, bow = 0] = H.wound;
      fromLine(x, y, ax0, ay0, bx, by, _line);
      const t = _line[1],
        ragged = 0.22 * wide * (Math.sin(t * 23 + x * 0.31) * 0.6 + Math.sin(t * 41 - y * 0.27) * 0.4),
        d = Math.abs(_line[0] + bow * 4 * t * (1 - t)) - ragged,
        ends = sstep(-0.06, 0.08, t) * sstep(1.06, 0.92, t),
        torn = ends * sstep(wide, wide * 0.7, d);
      _wound[0] = H.healed
        ? torn * HEALED_DEEP * (0.75 + 0.25 * Math.sin(x * 0.9) * Math.sin(y * 1.1)) -
          HEALED_RIDGE * (ends * bump(d, wide * 0.85, wide * 0.18) + torn * Math.max(0, Math.sin(t * 29 + x * 0.2)) ** 3)
        : torn * WOUND_DEEP * (0.8 + 0.2 * Math.sin(x * 0.9) * Math.sin(y * 1.1)) - ends * WOUND_SWELL * bump(d, wide * 1.15, wide * 0.4);
      _wound[1] = torn;
      return _wound;
    };
  // an eye the wound crosses is burst and swollen shut
  const woundShut = H.wound ? [woundAt(-eyeX, eyeY)[1], woundAt(eyeX, eyeY)[1]] : null;
  // a wound across the middle of the nose takes all of it below the bone, tip and wings, not only the band it crosses
  const noseLost = H.wound ? Math.max(woundAt(0, -12)[1], woundAt(0, -22)[1], woundAt(0, -32)[1]) : 0;
  const mouthX = 24.5 * H.mouthW,
    browLine = ax => 19 + 5 * Math.sin(Math.PI * clamp(ax / 56, 0, 1)) - 2.5 * sstep(40, 60, ax),
    foldDeep = (0.55 + 1.5 * age + fat) * (H.fold ?? 1),
    alaX = 11.8 * noseWide;
  // the soft forms of the face without the nose, lids and lips: brow ridge, sockets, cheekbones, the muzzle of the mouth, chin
  const soft = (ax, y) => {
    const line = browLine(ax),
      ridge = (1 + 2.8 * bump(ax, 17, 14)) * H.brow * sstep(64, 42, ax) * (y > line ? bump(y, line, 8) : bump(y, line, 4.2)),
      socket = H.socket * (4 * blob(ax, y, 30, 5, 17, 11) + 2.6 * blob(ax, y, 17.5, 1, 7, 9));
    return (
      ridge -
      socket +
      2.6 * H.cheek * blob(ax, y, 46, -16, 14, 11) -
      (0.5 + 1.2 * age) * blob(ax, y, 26, -15, 9, 5) -
      (3 * H.hollow + 2 * age) * blob(ax, y, 43, -55, 13, 16) +
      3.4 * blob(ax, y, 0, -63, 26, 19) +
      3 * fat * blob(ax, y, 38, -52, 18, 22) +
      2.2 * (age + fat) * blob(ax, y, 36, -91, 10, 9) -
      3 * blob(ax, y, 0, -83.5, 17, 4.6) +
      3.6 * H.chin * blob(ax, y, 0, -100, 15 * (H.chinW ?? 1), 10)
    );
  };

  const point = (row, angle, o, ch) => {
    slice(row, angle, _slice);
    const side = _slice.x < 0 ? -1 : 1,
      cosA = Math.cos(angle),
      face = sstep(0.1, 0.5, cosA),
      eyeRows = face > 0 && row < LID_ABOVE && row > LID_BELOW && !one; // (one eye's grid lies level)
    let y = row,
      lidT = -1,
      lidUp = 0,
      lidLow = 0;
    if (eyeRows && fine) {
      lidT = lidEdges(Math.abs(_slice.x), _line);
      lidUp = _line[0];
      lidLow = _line[1];
      y = lerp(row, bendRow(row, lidUp, lidLow), face);
      slice(y, angle, _slice);
    }
    const ax = Math.abs(_slice.x);
    let out = 0, // how far the face stands forward of the bare skull here
      lip = 0,
      shade = 1,
      warm = 0,
      beard = 0, // where a beard grows: on the cheeks and jaw, on the upper lip, and on the chin
      moustache = 0,
      tuft = 0,
      brow = 0,
      scar = 0,
      raw = 0;
    if (face > 0) {
      out = soft(ax, y);
      shade -=
        0.15 * clamp((H.socket * blob(ax, y, 30, 5, 17, 11)) / 1.2, 0, 1) +
        0.1 * bump(y, browLine(ax) - 8, 4.5) * sstep(50, 36, ax) * sstep(6, 14, ax);
      if (age > 0) {
        // the lines of age: furrows across the brow (an aged head's grid has rows for them), the frown between the brows,
        // and the creases that fan from the outer corner of each eye
        const furrow =
            (bump(y, FURROWS[0], 0.75) + bump(y, FURROWS[1], 0.75) + 0.8 * bump(y, FURROWS[2], 0.75)) *
            sstep(48, 30, ax) *
            (0.7 + 0.3 * Math.sin(ax * 0.21 + y)),
          frown = bump(ax, 4.6, 1.5) * sstep(13, 17, y) * sstep(31, 25, y),
          fan =
            sstep(outerX + 1, outerX + 4, ax) *
            sstep(outerX + 15, outerX + 9, ax) *
            bump(y, eyeY, 7) *
            (0.5 + 0.5 * Math.sin((y - eyeY) * 1.5 + (ax - outerX) * 0.5));
        out -= age * (0.5 * furrow + 0.7 * frown + 0.3 * fan);
        shade -= age * (0.17 * furrow + 0.16 * frown + 0.12 * fan);
      }
      if (H.scar) {
        // an old wound the skin has closed over: a pale band with a sunken seam down its middle, puckered a little either side
        const [deep, pale] = scarAt(side * ax, y);
        scar = pale;
        out -= deep;
        shade -= SCAR_SHADE * Math.max(0, deep);
      }
      if (H.wound) {
        const [deep, torn] = woundAt(side * ax, y);
        raw = torn;
        out -= deep;
        shade -= (H.healed ? 0.12 : 0.3) * torn * (0.6 + 0.4 * Math.sin(ax * 0.7 + y * 0.9)); // the torn flesh holds shadow in its pits
      }
      // the lids over the ball of the eye, with the fold above the upper one and, with age, the bag under the lower
      const ex = ax - eyeX,
        ey = y - eyeY,
        over = lidR * lidR - ex * ex - ey * ey;
      if (over > 0 && !one) out = smoothMax(out, eyeZ + Math.sqrt(over) - _slice.z, 1.3);
      if (one) {
        // the one eye: a ridge jutting over it and sloping away to the temples, the lids wrapped round the ball, and within
        // their opening the skin falls back behind the ball
        const dy = y - ONE_EYE.y,
          ridgeY = ONE_EYE.y + ONE_EYE.high + 5.5 - 0.006 * ax * ax,
          ball = oneLid * oneLid - ax * ax - dy * dy,
          r = Math.hypot(ax / ONE_EYE.wide, dy / ONE_EYE.high);
        out += ONE_EYE.ridge * bump(y, ridgeY, y > ridgeY ? 7 : 3.6) * sstep(56, 36, ax);
        if (ball > 0) out = smoothMax(out, oneZ + Math.sqrt(ball) - _slice.z, 1.6);
        shade -= 0.22 * bump(r, 1, 0.14) + 0.12 * bump(y, ridgeY - 5, 3) * sstep(30, 10, ax);
        if (r < 1) {
          const within = (1 - r) * ONE_EYE.high; // millimetres inside the lids' edge
          out -= fine ? 1.4 * sstep(0, 0.4, within) + 10 * sstep(0.4, 2.2, within) : 0;
          shade = fine ? lerp(shade, 0.3, sstep(0, 0.6, within)) : shade * (1 - 0.8 * sstep(0, 1.2, within));
        }
      } else if (ax > innerX - 4 && ax < outerX + 6) {
        const t = clamp((ax - innerX) / (outerX - innerX), 0, 1),
          foldY = upperLid(t) + 3.4 - 1.2 * age,
          span = Math.pow(4 * t * (1 - t), 0.5);
        out +=
          -0.75 * bump(y, foldY, 1.25) * span +
          1.2 * age * bump(y, foldY + 3.4, 2.8) * span +
          1.1 * age * blob(ax, y, eyeX, lowerLid(0.5) - 5.5, 10, 2.6);
        shade -= 0.2 * bump(y, foldY, 1.1) * span + 0.1 * age * blob(ax, y, eyeX - 3, lowerLid(0.5) - 8.5, 10, 2);
      }
      if (one) {
        // the sockets healed over: no line where the lids met
      } else if (lidT > 0 && lidT < 1 && row <= LID_TOP && row >= LID_LOW && !(woundShut && woundShut[(side + 1) / 2] > 0.5)) {
        // between the lids: the edge of each lid has a thickness, then the surface drops behind the ball of the eye
        const within = Math.min(LID_TOP - row, row - LID_LOW),
          gap = sstep(0.2, 2, lidUp - lidLow) * sstep(0.02, 0.16, lidT);
        out -= gap * (1.5 * sstep(0, 0.35, within) + 9 * sstep(0.35, 1.6, within));
        shade = row > (LID_TOP + LID_LOW) / 2 ? 0.34 : lerp(0.8, 0.62, sstep(0, 0.35, within));
        warm = 1;
      } else if (!fine && !dead) {
        // a plain head's eyes are painted: the dark of lashes and iris between the lids
        const t = (ax - innerX) / (outerX - innerX);
        if (t > 0 && t < 1) shade *= 1 - 0.72 * sstep(0, 1.6, Math.min(upperLid(t) - y, y - lowerLid(t)) + 1.2);
      }
      // the nose: a ridge down the middle of the face to a rounded tip, wings beside it and the nostrils beneath
      const noseY = 12 + (y - 12) / noseLong;
      if (noseY < 17 && noseY > -52) {
        const reach = NOSE_OUT(noseY) * (1 + (H.nose - 1) * sstep(8, -6, noseY)) + 2.2 * H.bridge * bump(noseY, -8, 11),
          t = ax / (NOSE_WIDE(noseY) * (1 + (noseWide - 1) * sstep(-5, -35, noseY))),
          tip = bump(noseY, -36, 7);
        const torn = 1 - Math.max(0.85 * raw, noseLost * sstep(-6, -16, noseY)); // what a wound has torn away of the nose
        if (t < 1) out += reach * lerp(1 - sstep(0.22, 1, t), Math.pow(1 - t * t, 0.75), 0.75 * tip) * torn;
        const wr = ((ax - alaX) / (6.4 * noseWide)) ** 2 + ((noseY + 41.5) / 6.4) ** 2;
        if (wr < 1) out = smoothMax(out, soft(ax, y) + 7.2 * H.nose * Math.pow(1 - wr, 0.7) * torn, 1.2);
        const nostril = ((ax - 6.6 * noseWide) / (4.2 * noseWide)) ** 2 + ((noseY + 45.4) / 2.2) ** 2;
        if (nostril < 1.6) {
          out -= (fine ? 2.6 : 0.6) * sstep(1.6, 0.4, nostril);
          shade *= 1 - (fine ? 0.86 : 0.3) * sstep(1.5, 0.5, nostril);
        }
        shade -= 0.2 * bump(ax, 0, 12) * bump(noseY, -49.6, 2.2) + 0.08 * bump(ax, alaX + 6 * noseWide, 1.6) * bump(noseY, -40, 5);
        if (noseLost > 0) {
          // the nose gone: the opening it covered, narrow under the bone and widening to its foot, sunk and dark within
          const { top, foot, wide } = NOSE_HOLE,
            half = wide * (0.35 + 0.65 * sstep(top, foot + 6, noseY)) * noseWide,
            hole = noseLost * sstep(top + 2, top - 4, noseY) * sstep(foot - 2, foot + 3, noseY) * sstep(1, 0.55, ax / half);
          out -= hole * (H.healed ? NOSE_HOLE.healedDeep : NOSE_HOLE.deep);
          shade *= 1 - hole * (H.healed ? NOSE_HOLE.healedDark : NOSE_HOLE.dark);
          raw = Math.max(raw, hole); // coloured as the wound round it is, raw or scarred
        }
        warm += 0.5 * tip * bump(ax, 0, 13);
      }
      // the crease from the wing of the nose past the corner of the mouth, with the cheek standing proud of it
      fromLine(ax, y, 19.5 * noseWide, -40, mouthX + 6.5, -73, _line);
      const along = sstep(-0.12, 0.1, _line[1]) * sstep(1.25, 0.9, _line[1]);
      out += foldDeep * along * (0.7 * bump(_line[0], 6, 6) - bump(_line[0], 0, 2.3));
      shade -= 0.17 * Math.min(1, foldDeep) * along * bump(_line[0], 0, 2);
      // the lips: the groove under the nose, the upper lip with its bow, the seam, the fuller lower lip
      const t = ax / mouthX;
      if (t < 1.4 && y < -46 && y > -80) {
        const taper = Math.sqrt(Math.max(0, 1 - t * t)),
          upper = t < 1 ? 6.8 * lips * Math.pow(1 - Math.pow(t, 2.2), 0.8) * (1 - 0.16 * bump(ax, 0, 3.2)) : 0,
          lower = t < 1 ? 9.2 * lips * Math.pow(1 - t * t, 0.75) : 0,
          v = y > SEAM ? (upper > 0.01 ? (y - SEAM) / upper : 9) : lower > 0.01 ? (SEAM - y) / lower : 9;
        if (v < 1) {
          lip = sstep(1, 0.86, v) * sstep(0, 0.9, taper);
          out += (y > SEAM ? 2 : 3) * lips * Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.85 + 0.15)), 0.7) * taper;
        }
        out += 0.5 * lips * bump(v, 1, 0.14) * taper * (y > SEAM ? 1 : 0.5);
        const groove = sstep(-47.5, -50.5, y) * sstep(SEAM + upper - 0.4, SEAM + upper + 2.2, y);
        out += groove * (0.6 * bump(ax, 5.2, 1.9) - 1.3 * bump(ax, 0, 3.5));
        out -= 1.6 * blob(ax, y, mouthX + 2.5, SEAM, 4.5, 5);
        shade -= 0.1 * blob(ax, y, mouthX + 1, SEAM, 3, 2.5) + 0.1 * bump(ax, 0, 14) * bump(y, SEAM - lower - 3.5, 2.6);
        const off = Math.abs(row - SEAM);
        if (fine && t < 1) {
          // a pocket behind the seam: the lips part from it when the jaw drops
          if (off < 0.05) {
            out -= 11 * taper;
            shade = 0.06;
          } else if (off < 0.5) {
            out -= 1.3 * (1 - t ** 4);
            shade *= 0.5;
          }
        } else if (t < 1.03) {
          out -= 1.5 * bump(y, SEAM, 1.1) * sstep(1.03, 0.9, t);
          shade *= 1 - 0.55 * bump(y, SEAM, 0.9) * sstep(1.03, 0.9, t);
        }
      }
      warm += 0.6 * blob(ax, y, 40, -30, 17, 16);
      const cheekLine = -12 - 1.25 * (66 - ax); // a beard's upper edge, from before the ear down to the corner of the mouth
      beard = sstep(cheekLine + 3, cheekLine - 5, y) * sstep(78, 70, ax) * (1 - lip);
      // a moustache's upper edge follows the nostrils and falls toward the corners of the mouth; the beard under the lower lip
      // leaves the hollow below it bare and rises to meet the moustache at the corners
      const mTop = -50 - 0.014 * ax * ax,
        tTop = -80 + 10 * (ax / (mouthX + 6)) ** 2;
      moustache = sstep(mTop + 1.5, mTop - 1.5, y) * sstep(SEAM - 1, SEAM + 1, y) * sstep(mouthX + 9, mouthX + 3, ax) * (1 - lip);
      tuft = sstep(tTop + 2, tTop - 3, y) * sstep(mouthX + 6, mouthX - 6, ax) * (1 - lip);
      brow = one ? 0 : bump(y, browLine(ax) - 1.5, 2.7) * sstep(7.5, 11, ax) * sstep(53, 46, ax) * (1 - Math.min(1, scar + raw)); // no hair grows on a scar
      out *= face;
    }
    if (dead && face > 0) {
      // a dried face: pits for the eyes, an open cavity for the nose, the teeth bared
      const pit = blob(ax, y, eyeX, eyeY + 1, 12.5, 10.5),
        cavity = blob(ax, y, 0, -36, 7.5, 10) * sstep(-50, -44, y),
        teeth = sstep(mouthX + 2, mouthX - 2, ax) * sstep(SEAM - 7.5, SEAM - 6, y) * sstep(SEAM + 7, SEAM + 5.5, y);
      out -= (7 * sstep(0.35, 0.8, pit) + 5 * sstep(0.4, 0.75, cavity)) * face;
      shade = (1 - 0.9 * sstep(0.35, 0.85, pit)) * (1 - 0.88 * sstep(0.4, 0.75, cavity)) * (0.94 + 0.06 * Math.sin(ax * 0.9 + y * 0.7));
      shade *=
        teeth > 0.5
          ? (0.55 + 0.45 * Math.abs(Math.sin(ax * 0.85))) * (1 - 0.6 * bump(y, SEAM, 0.8))
          : 1 - 0.25 * blob(ax, y, 0, SEAM, 36, 11);
      lip = teeth;
      warm = beard = moustache = tuft = brow = scar = raw = 0;
    }
    // the sides of the head: the hollow of the temple, the arch of the cheekbone, the muscle of the jaw
    const turn = Math.abs(angle),
      flank =
        1 +
        (-2.8 * (1 + 0.8 * age) * bump(y, 22, 17) * bump(turn, 1.05, 0.33) +
          1.6 * H.cheek * bump(y, -14, 8) * bump(turn, 1.2, 0.35) +
          (0.6 + 1.2 * H.jaw) * bump(y, -62, 18) * bump(turn, 1.25, 0.3)) /
          75;
    if (y < -84) {
      shade -= 0.2 * sstep(0.25, -0.35, cosA) * sstep(-84, -98, y); // under the jaw
      if (!dead) beard = Math.max(beard, sstep(-84, -93, y));
    }
    const mid = MIDDLE(y);
    o.x = side * ax * flank * MM;
    o.y = y * MM;
    o.z = (mid + (_slice.z - mid) * flank + out) * MM;
    if (ch) {
      ch[0] = lip;
      ch[1] = Math.max(0.04, shade);
      ch[2] = Math.min(1, warm);
      ch[3] = beard;
      ch[4] = brow;
      ch[5] = moustache;
      ch[6] = tuft;
      ch[7] = scar || raw; // a head has an old scar or a fresh wound: the look says which (head.js colours it)
    }
  };

  const fn = (d, o, ch) => point(d.y * HALF, Math.atan2(d.x, d.z), o, ch);
  fn.point = point; // by a row of the grid (millimetres up from the middle) and an angle round from the front
  // the bare skull at a direction, for what sits over it (hair, hoods, helmets)
  fn.skull = (d, o) => {
    const y = d.y * HALF;
    slice(y, Math.atan2(d.x, d.z), _slice);
    o.set(_slice.x * MM, y * MM, _slice.z * MM);
  };
  // how far out from the bare skull a point lies (metres from the head's middle): 1 on its surface, less within
  fn.reach = (px, py, pz) => {
    const up = py / MM,
      y = clamp(up, -HALF, HALF),
      n = SQUARE(y),
      deep = pz / MM - MIDDLE(y),
      across = Math.pow(Math.pow(Math.abs(px / MM) / width(y), n) + Math.pow(Math.abs(deep) / (deep > 0 ? front(y) : back(y)), n), 1 / n);
    if (up > CROWN) return Math.pow(Math.pow(across, 2.2) + Math.pow((up - CROWN) / (HALF - CROWN), 2.2), 1 / 2.2);
    if (up < JAW) return Math.pow(Math.pow(across, 1.6) + Math.pow((JAW - up) / (HALF + JAW), 1.6), 1 / 1.6);
    return across;
  };
  // the direction at which the bare skull lies under a point (metres from the head's middle), on the line from the middle
  // through it: what fn.skull turns into a point again. Hair that lies over the skull finds its place by it.
  fn.under = (px, py, pz, d) => {
    for (let i = 0; i < UNDER_STEPS; i++) {
      const k = fn.reach(px, py, pz);
      px /= k;
      py /= k;
      pz /= k;
    }
    const y = clamp(py / MM, -HALF, HALF),
      deep = pz / MM - MIDDLE(y),
      angle = Math.atan2(px / MM / width(y), deep / (deep > 0 ? front(y) : back(y))),
      round = Math.sqrt(Math.max(0, 1 - (y / HALF) * (y / HALF)));
    return d.set(Math.sin(angle) * round, y / HALF, Math.cos(angle) * round);
  };
  const upAt = t => Math.asin(clamp((upperLid(t) - eyeY) / lidR, -0.95, 0.95)),
    lowAt = t => Math.asin(clamp((lowerLid(t) - eyeY) / lidR, -0.95, 0.95));
  fn.eye = {
    x: eyeX * MM,
    y: eyeY * MM,
    z: eyeZ * MM,
    r: ballR * MM,
    inner: innerX * MM,
    outer: outerX * MM,
    close: upAt(0.45) - lowAt(0.45) + 0.06, // the angle the upper lid turns through to shut
    shut: t =>
      t > 0 && t < 1 ? clamp((upAt(t) - lowAt(t) + 0.06 * Math.sqrt(Math.sin(Math.PI * t))) / (upAt(0.45) - lowAt(0.45) + 0.06), 0, 1) : 0, // the share of it at each point along the lid
    upper: t => upperLid(t) * MM,
  };
  fn.mouth = { x: mouthX * MM, y: SEAM * MM };
  fn.one = one ? { y: ONE_EYE.y * MM, z: oneZ * MM, r: ONE_EYE.r * MM, wide: ONE_EYE.wide * MM } : null; // the one eye's ball, if so
  fn.browLine = x => browLine(x / MM) * MM;
  fn.scar = (x, y) => (H.scar ? scarAt(x / MM, y / MM)[1] : 0); // how much of a scar there is at a point (metres)
  return fn;
}

export { FURROWS, LID_ABOVE, LID_BELOW, LID_LOW, LID_TOP, SEAM, headFn };
