// ════════════════════════════════════════════════════════════════════════
//  A smooth curve through a line of [x, z] points: a centripetal Catmull-Rom spline, walked at even steps of its length.
//
//  Matches Three.js CatmullRomCurve3.getSpacedPoints for open centripetal curves,
//  using scalar arithmetic suitable for workers. The evaluation order and the
//  extrapolation used at the ends of two-point curves match Three.js.
// ════════════════════════════════════════════════════════════════════════
const ARC_STEPS = 200, // the pieces the curve's length is measured in
  REPEATED = 1e-4; // points closer than this (to the power the knots are spaced by) count as one

// One coordinate of the cubic between p1 and p2, with p0 before and p3 after, the knots dt0, dt1 and dt2 apart, at t in 0..1.
function cubic(x0, x1, x2, x3, dt0, dt1, dt2, t) {
  const t1 = ((x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1) * dt1,
    t2 = ((x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2) * dt1,
    c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2,
    c3 = 2 * x1 - 2 * x2 + t1 + t2,
    tt = t * t;
  return x1 + t1 * t + c2 * tt + c3 * (tt * t);
}
const knot = (startPoint, endPoint) => Math.pow((startPoint[0] - endPoint[0]) * (startPoint[0] - endPoint[0]) + (startPoint[1] - endPoint[1]) * (startPoint[1] - endPoint[1]), 0.25);
const _before = [0, 0],
  _after = [0, 0];
// The point of the curve through the control points at t in 0..1, where t runs evenly from point to point.
function curvePoint(controlPoints, t) {
  const count = controlPoints.length,
    at = (count - 1) * t;
  let i = Math.floor(at),
    weight = at - i;
  if (weight === 0 && i === count - 1) {
    i = count - 2;
    weight = 1;
  }
  // past either end the line is carried on by its last step
  const first = controlPoints[0],
    last = controlPoints[count - 1];
  _after[0] = last[0] - controlPoints[count - 2][0] + last[0];
  _after[1] = last[1] - controlPoints[count - 2][1] + last[1];
  _before[0] = first[0] - controlPoints[1][0] + first[0];
  _before[1] = first[1] - controlPoints[1][1] + first[1];
  const atEnd = i + 2 >= count,
    p0 = i > 0 ? controlPoints[i - 1] : atEnd ? _after : _before,
    p1 = controlPoints[i],
    p2 = controlPoints[i + 1],
    p3 = atEnd ? _after : controlPoints[i + 2];
  let dt0 = knot(p0, p1),
    dt1 = knot(p1, p2),
    dt2 = knot(p2, p3);
  if (dt1 < REPEATED) dt1 = 1;
  if (dt0 < REPEATED) dt0 = dt1;
  if (dt2 < REPEATED) dt2 = dt1;
  return [cubic(p0[0], p1[0], p2[0], p3[0], dt0, dt1, dt2, weight), cubic(p0[1], p1[1], p2[1], p3[1], dt0, dt1, dt2, weight)];
}
// The curve's length from its start to each of ARC_STEPS + 1 points along it.
function arcLengths(controlPoints) {
  const lengths = [0];
  let last = curvePoint(controlPoints, 0),
    sum = 0;
  for (let stepIndex = 1; stepIndex <= ARC_STEPS; stepIndex++) {
    const point = curvePoint(controlPoints, stepIndex / ARC_STEPS);
    sum += Math.sqrt((point[0] - last[0]) * (point[0] - last[0]) + (point[1] - last[1]) * (point[1] - last[1]));
    lengths.push(sum);
    last = point;
  }
  return lengths;
}
// The t at which the curve has run the share u of its length.
function shareToT(lengths, u) {
  const target = u * lengths[ARC_STEPS];
  let low = 0,
    high = ARC_STEPS;
  while (low <= high) {
    const i = Math.floor(low + (high - low) / 2),
      over = lengths[i] - target;
    if (over < 0) low = i + 1;
    else if (over > 0) high = i - 1;
    else {
      high = i;
      break;
    }
  }
  if (lengths[high] === target) return high / ARC_STEPS;
  return (high + (target - lengths[high]) / (lengths[high + 1] - lengths[high])) / ARC_STEPS;
}
// The line through the control points as a smooth curve of evenly spaced points, about `spacing` apart.
function spacedCurve(controlPoints, spacing) {
  const lengths = arcLengths(controlPoints),
    steps = Math.max(2, Math.round(lengths[ARC_STEPS] / spacing)),
    points = [];
  for (let stepIndex = 0; stepIndex <= steps; stepIndex++) points.push(curvePoint(controlPoints, shareToT(lengths, stepIndex / steps)));
  return points;
}

export { spacedCurve };
