/** Distance in world units from a point to a yawed rectangle, zero inside.
 * Supply the centre, half width and depth, yaw in radians, and the query point. */
export function distanceToRectangle(centerX, centerZ, halfWidth, halfDepth, rotation, pointX, pointZ) {
  const dx = pointX - centerX,
    dz = pointZ - centerZ,
    cosRotation = Math.cos(rotation),
    sinRotation = Math.sin(rotation);
  return Math.hypot(Math.max(Math.abs(dx * cosRotation - dz * sinRotation) - halfWidth, 0), Math.max(Math.abs(dx * sinRotation + dz * cosRotation) - halfDepth, 0));
}

/** Four x-z perimeter corners, using full dimensions and a yaw in radians. */
export function rectangleCorners(centerX, centerZ, width, depth, rotation) {
  const cosRotation = Math.cos(rotation),
    sinRotation = Math.sin(rotation),
    o = [];
  for (const [u, v] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ])
    o.push([centerX + (u * width * cosRotation + v * depth * sinRotation) / 2, centerZ + (-u * width * sinRotation + v * depth * cosRotation) / 2]);
  return o;
}

// Strict overlap of two nondegenerate rectangles given four perimeter corners each. Touching edges have no area in common.
export function rectanglesOverlap(firstCorners, secondCorners) {
  for (const [P1, P2] of [
    [firstCorners, secondCorners],
    [secondCorners, firstCorners],
  ])
    for (let i = 0; i < 2; i++) {
      const ax = P1[i + 1][0] - P1[i][0],
        az = P1[i + 1][1] - P1[i][1];
      let a0 = Infinity,
        a1 = -Infinity,
        b0 = Infinity,
        b1 = -Infinity;
      for (const p of P1) {
        const t = p[0] * ax + p[1] * az;
        a0 = Math.min(a0, t);
        a1 = Math.max(a1, t);
      }
      for (const p of P2) {
        const t = p[0] * ax + p[1] * az;
        b0 = Math.min(b0, t);
        b1 = Math.max(b1, t);
      }
      if (a1 <= b0 || b1 <= a0) return false;
    }
  return true;
}
