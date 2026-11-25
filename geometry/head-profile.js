// ════════════════════════════════════════════════════════════════════════
//  The profiles of a bare head (head-shape.js), by height in millimetres from the head's middle, which is the level of the
//  eyes: its slices' width, reach to the front and the back, middle and squareness, and the nose along the face's middle.
//  Each is a smooth curve through measured points, sampled into a table it is read back from.
// ════════════════════════════════════════════════════════════════════════
// A smooth curve through [at, value] points that never overshoots them.
function curve(points) {
  const n = points.length,
    xs = points.map(p => p[0]),
    ys = points.map(p => p[1]),
    slope = [],
    tangent = [];
  for (let i = 0; i < n - 1; i++) slope.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  for (let i = 0; i < n; i++) {
    const a = slope[i - 1],
      b = slope[i];
    tangent.push(i === 0 ? b : i === n - 1 ? a : a * b <= 0 ? 0 : (2 * a * b) / (a + b));
  }
  const exact = x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i],
      t = (x - xs[i]) / h,
      t2 = t * t,
      t3 = t2 * t;
    return (
      ys[i] * (2 * t3 - 3 * t2 + 1) + tangent[i] * h * (t3 - 2 * t2 + t) + ys[i + 1] * (3 * t2 - 2 * t3) + tangent[i + 1] * h * (t3 - t2)
    );
  };
  return sampled(exact, xs[0], xs[n - 1]);
}
// A function of a length in millimetres, sampled four times a millimetre and read back along the straight line between two
// samples: a head asks for its outline many thousand times.
function sampled(fn, from, to) {
  const PER = 4,
    count = Math.ceil((to - from) * PER),
    table = new Float32Array(count + 2);
  for (let k = 0; k < count + 2; k++) table[k] = fn(Math.min(to, from + k / PER));
  return x => {
    if (x <= from) return table[0];
    if (x >= to) return table[count];
    const f = (x - from) * PER,
      k = f | 0;
    return table[k] + (table[k + 1] - table[k]) * (f - k);
  };
}

// The slices, by height: half the width, how far the front and the back reach from the middle, where the middle is, and how
// square the outline is (2 is an ellipse).
const WIDTH = curve([
    [-118, 52],
    [-100, 53],
    [-85, 56],
    [-67, 63],
    [-45, 68],
    [-22, 72.5],
    [0, 74.5],
    [22, 76],
    [45, 76.5],
  ]),
  FRONT = curve([
    [-118, 50],
    [-112, 56],
    [-100, 70],
    [-85, 87],
    [-67, 89],
    [-45, 91.5],
    [-22, 92],
    [0, 93.5],
    [22, 104],
    [45, 102],
  ]),
  BACK = curve([
    [-118, 38],
    [-100, 34],
    [-85, 39],
    [-67, 58],
    [-45, 76],
    [-22, 88],
    [0, 92],
    [22, 91.5],
    [45, 90],
  ]),
  MIDDLE = curve([
    [-118, 62],
    [-112, 55],
    [-105, 44],
    [-95, 22],
    [-85, 4],
    [-67, 6],
    [-45, 4],
    [-22, 0],
    [0, -4],
    [22, -8],
    [45, -10],
  ]),
  SQUARE = curve([
    [-105, 2.1],
    [-85, 2.3],
    [-67, 2.25],
    [-45, 2.15],
    [-22, 2.15],
    [0, 2.15],
    [22, 2.2],
    [45, 2.15],
  ]);
// The nose along the middle of the face: how far its ridge stands out of the face at each height, and half its width there.
const NOSE_OUT = curve([
    [-52, 0],
    [-50, 1.5],
    [-47.5, 5.5],
    [-45, 12.5],
    [-42, 19.5],
    [-38.5, 24.6],
    [-35, 25.6],
    [-31, 23.6],
    [-24, 19.4],
    [-12, 13],
    [0, 6.6],
    [6, 2.4],
    [12, 0.6],
    [17, 0],
  ]),
  NOSE_WIDE = curve([
    [-52, 6],
    [-48, 7],
    [-45, 9],
    [-40, 12],
    [-35, 12.5],
    [-24, 12],
    [-12, 10.5],
    [0, 9.5],
    [17, 10],
  ]);

export { BACK, FRONT, MIDDLE, NOSE_OUT, NOSE_WIDE, SQUARE, WIDTH, sampled };
