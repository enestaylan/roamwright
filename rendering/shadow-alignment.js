import { Vector3 } from 'three';

// The snapped center keeps its original depth and moves by whole texels across the shadow map.
export function createShadowSnap() {
  const worldUp = new Vector3(0, 1, 0);
  const right = new Vector3();
  const up = new Vector3();
  return (out, x, y, z, direction, texelWidth, texelHeight = texelWidth) => {
    right.crossVectors(worldUp, direction);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(direction, right);
    const a = Math.round((x * right.x + y * right.y + z * right.z) / texelWidth) * texelWidth;
    const u = Math.round((x * up.x + y * up.y + z * up.z) / texelHeight) * texelHeight;
    const d = x * direction.x + y * direction.y + z * direction.z;
    return out.set(0, 0, 0).addScaledVector(right, a).addScaledVector(up, u).addScaledVector(direction, d);
  };
}

export function fitOrthographicShadow(camera, extent, near, far) {
  camera.left = -extent;
  camera.right = extent;
  camera.top = extent;
  camera.bottom = -extent;
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
}
