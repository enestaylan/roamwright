// Predict planar motion in metres, reusing the returned point between updates.
export function createGroundLookahead({ seconds, maxDistance, smoothing, jumpDistance, maxGap }) {
  let lastX,
    lastZ,
    lastTime,
    vx = 0,
    vz = 0;
  const point = { x: 0, z: 0, jumped: false };
  return function predict(x, z, time) {
    const deltaSeconds = time - lastTime,
      dx = x - lastX,
      dz = z - lastZ;
    point.jumped = lastTime === undefined || Math.hypot(dx, dz) > jumpDistance;
    if (point.jumped || !(deltaSeconds > 0 && deltaSeconds < maxGap)) vx = vz = 0;
    else {
      const velocityBlend = Math.min(1, deltaSeconds * smoothing);
      vx += (dx / deltaSeconds - vx) * velocityBlend;
      vz += (dz / deltaSeconds - vz) * velocityBlend;
    }
    const speed = Math.hypot(vx, vz);
    const lead = speed ? Math.min(seconds, maxDistance / speed) : seconds;
    point.x = x + vx * lead;
    point.z = z + vz * lead;
    lastX = x;
    lastZ = z;
    lastTime = time;
    return point;
  };
}
