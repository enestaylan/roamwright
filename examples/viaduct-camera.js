import { MathUtils } from 'three';

// Keep the eye and its entire near plane inside the landscape and above its surface.
export function createCameraGuard(ground, trees) {
  const { widthSegments: columns, heightSegments: rows } = ground.parameters;
  const positions = ground.attributes.position;
  const x0 = positions.getX(0), z0 = positions.getZ(0);
  const x1 = positions.getX(columns), z1 = positions.getZ(rows * (columns + 1));
  const cellWidth = (x1 - x0) / columns, cellDepth = (z1 - z0) / rows;

  return camera => {
    const halfHeight = camera.near * Math.tan(MathUtils.degToRad(camera.fov / 2));
    const margin = Math.hypot(camera.near, halfHeight, halfHeight * camera.aspect);
    const eye = camera.position;
    eye.x = MathUtils.clamp(eye.x, x0 + margin, x1 - margin);
    eye.z = MathUtils.clamp(eye.z, z0 + margin, z1 - margin);

    // Every point on a rendered triangle is at or below its highest corner.
    const left = Math.max(0, Math.floor((eye.x - margin - x0) / cellWidth));
    const right = Math.min(columns, Math.ceil((eye.x + margin - x0) / cellWidth));
    const back = Math.max(0, Math.floor((eye.z - margin - z0) / cellDepth));
    const front = Math.min(rows, Math.ceil((eye.z + margin - z0) / cellDepth));
    let floor = 0; // Water level.
    for (let row = back; row <= front; row++) {
      for (let col = left; col <= right; col++) {
        floor = Math.max(floor, positions.getY(row * (columns + 1) + col));
      }
    }

    let minimum = floor + margin + 1;
    for (const { x, z, top, radius } of trees) {
      const buffer = radius + margin;
      const dx = eye.x - x, dz = eye.z - z;
      if (Math.abs(dx) > buffer + 2 || Math.abs(dz) > buffer + 2) continue;
      const lift = 1 - MathUtils.smoothstep(Math.hypot(dx, dz), buffer, buffer + 2);
      minimum = Math.max(minimum, MathUtils.lerp(floor + margin + 1, top + margin + 0.35, lift));
    }
    eye.y = Math.max(eye.y, minimum);
  };
}
