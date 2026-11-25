import * as THREE from 'three';

/**
 * `createSaggingTube({spanSegments,radialSegments,radius,slack,extraLength})` returns an allocation-free update for a
 * tube hanging between world-space anchors. Pass a Vector3 array, its active count and caller-owned position and
 * normal arrays. Allocate three floats per vertex for `((maxAnchors−1) × spanSegments + 1) × radialSegments` vertices.
 * Slack multiplies each span’s length, then extraLength adds metres. The caller owns indices, materials and drawing.
 */
export function createSaggingTube({ spanSegments, radialSegments, radius, slack = 1, extraLength = 0 }) {
  if (!Number.isInteger(spanSegments) || spanSegments < 1 || !Number.isInteger(radialSegments) || radialSegments < 3) {
    throw new RangeError('Expected at least one span segment and three radial segments');
  }
  if (![radius, slack, extraLength].every(Number.isFinite) || radius <= 0 || slack < 1 || extraLength < 0) {
    throw new RangeError('Expected a positive radius, slack of at least one and nonnegative extra length');
  }
  const _p = new THREE.Vector3(),
    _t = new THREE.Vector3(),
    _n = new THREE.Vector3(),
    _b = new THREE.Vector3(),
    UP = new THREE.Vector3(0, 1, 0);
  return function update(anchors, count, pos, nor) {
    let ring = 0;
    for (let s = 0; s < count - 1; s++) {
      const from = anchors[s],
        to = anchors[s + 1],
        span = from.distanceTo(to),
        length = span * slack + extraLength,
        sag = Math.sqrt((3 * span * Math.max(0, length - span)) / 8); // a parabola of that length over that span
      for (let j = s ? 1 : 0; j <= spanSegments; j++, ring++) {
        const u = j / spanSegments;
        _p.lerpVectors(from, to, u);
        _p.y -= sag * 4 * u * (1 - u);
        _t.subVectors(to, from);
        _t.y -= sag * 4 * (1 - 2 * u);
        _t.normalize();
        _n.crossVectors(_t, UP);
        if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
        _n.normalize();
        _b.crossVectors(_n, _t);
        for (let k = 0; k < radialSegments; k++) {
          const a = (k / radialSegments) * Math.PI * 2,
            c = Math.cos(a),
            d = Math.sin(a),
            o = (ring * radialSegments + k) * 3,
            nx = _n.x * c + _b.x * d,
            ny = _n.y * c + _b.y * d,
            nz = _n.z * c + _b.z * d;
          nor[o] = nx;
          nor[o + 1] = ny;
          nor[o + 2] = nz;
          pos[o] = _p.x + nx * radius;
          pos[o + 1] = _p.y + ny * radius;
          pos[o + 2] = _p.z + nz * radius;
        }
      }
    }
  };
}
