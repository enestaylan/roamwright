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
  const pointScratch = new THREE.Vector3(),
    tangentScratch = new THREE.Vector3(),
    normalScratch = new THREE.Vector3(),
    binormalScratch = new THREE.Vector3(),
    UP = new THREE.Vector3(0, 1, 0);
  return function update(anchors, count, positions, normals) {
    let ring = 0;
    for (let s = 0; s < count - 1; s++) {
      const from = anchors[s],
        to = anchors[s + 1],
        span = from.distanceTo(to),
        length = span * slack + extraLength,
        sag = Math.sqrt((3 * span * Math.max(0, length - span)) / 8); // a parabola of that length over that span
      for (let j = s ? 1 : 0; j <= spanSegments; j++, ring++) {
        const u = j / spanSegments;
        pointScratch.lerpVectors(from, to, u);
        pointScratch.y -= sag * 4 * u * (1 - u);
        tangentScratch.subVectors(to, from);
        tangentScratch.y -= sag * 4 * (1 - 2 * u);
        tangentScratch.normalize();
        normalScratch.crossVectors(tangentScratch, UP);
        if (normalScratch.lengthSq() < 1e-6) normalScratch.set(1, 0, 0);
        normalScratch.normalize();
        binormalScratch.crossVectors(normalScratch, tangentScratch);
        for (let k = 0; k < radialSegments; k++) {
          const ringAngle = (k / radialSegments) * Math.PI * 2,
            cosAngle = Math.cos(ringAngle),
            sinAngle = Math.sin(ringAngle),
            positionOffset = (ring * radialSegments + k) * 3,
            nx = normalScratch.x * cosAngle + binormalScratch.x * sinAngle,
            ny = normalScratch.y * cosAngle + binormalScratch.y * sinAngle,
            nz = normalScratch.z * cosAngle + binormalScratch.z * sinAngle;
          normals[positionOffset] = nx;
          normals[positionOffset + 1] = ny;
          normals[positionOffset + 2] = nz;
          positions[positionOffset] = pointScratch.x + nx * radius;
          positions[positionOffset + 1] = pointScratch.y + ny * radius;
          positions[positionOffset + 2] = pointScratch.z + nz * radius;
        }
      }
    }
  };
}
