// Predict planar motion in metres, reusing the returned point between updates.
export function createGroundLookahead({ seconds, maxDistance, smoothing, jumpDistance, maxGap }) {
  let lastX,
    lastZ,
    lastTime,
    vx = 0,
    vz = 0;
  const point = { x: 0, z: 0, jumped: false };
  return function predict(x, z, time) {
    const dt = time - lastTime,
      dx = x - lastX,
      dz = z - lastZ;
    point.jumped = lastTime === undefined || Math.hypot(dx, dz) > jumpDistance;
    if (point.jumped || !(dt > 0 && dt < maxGap)) vx = vz = 0;
    else {
      const k = Math.min(1, dt * smoothing);
      vx += (dx / dt - vx) * k;
      vz += (dz / dt - vz) * k;
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
