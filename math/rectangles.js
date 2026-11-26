/** Distance in world units from a point to a yawed rectangle, zero inside.
 * Supply the centre, half width and depth, yaw in radians, and the query point. */
export function distanceToRectangle(cx, cz, hw, hd, rot, px, pz) {
  const dx = px - cx,
    dz = pz - cz,
    c = Math.cos(rot),
    s = Math.sin(rot);
  return Math.hypot(Math.max(Math.abs(dx * c - dz * s) - hw, 0), Math.max(Math.abs(dx * s + dz * c) - hd, 0));
}

/** Four x-z perimeter corners, using full dimensions and a yaw in radians. */
export function rectangleCorners(cx, cz, w, d, rot) {
  const c = Math.cos(rot),
    s = Math.sin(rot),
    o = [];
  for (const [u, v] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ])
    o.push([cx + (u * w * c + v * d * s) / 2, cz + (-u * w * s + v * d * c) / 2]);
  return o;
}

// Strict overlap of two nondegenerate rectangles given four perimeter corners each. Touching edges have no area in common.
export function rectanglesOverlap(A, B) {
  for (const [P1, P2] of [
    [A, B],
    [B, A],
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
