import { TAU } from '../math/scalar.js';

export const moonShine = lit => lit * Math.sqrt(lit);

// Write both normalized directions to caller-owned vectors and return the illuminated lunar fraction.
export function createSunMoonCycle({
  month = 29.5,
  sunRise = 1,
  sunOffset = 0,
  sunTilt = 0,
  moonEast = 1,
  moonRise = 1,
  moonOffset = 0,
  moonTilt = 0,
} = {}) {
  return (hour, days, moonTurn, sun, moon) => {
    const sunAngle = (hour - 0.25) * TAU;
    sun.set(Math.cos(sunAngle), Math.sin(sunAngle) * sunRise, sunOffset + sunTilt * Math.sin(sunAngle)).normalize();
    const elongation = (((days + hour) / month) % 1) * TAU;
    const moonAngle = sunAngle - elongation;
    moon
      .set(Math.cos(moonAngle) * moonEast, Math.sin(moonAngle) * moonRise, moonOffset + moonTilt * Math.sin(moonAngle))
      .normalize();
    if (moonTurn) {
      const c = Math.cos(moonTurn),
        s = Math.sin(moonTurn);
      const { x, z } = moon;
      moon.x = x * c + z * s;
      moon.z = z * c - x * s;
    }
    return (1 - Math.cos(elongation)) / 2;
  };
}

// A continuous haze layer trails the terrain as the eye moves; a cut or a region change resets it immediately.
export function createHazeFollower({ fixedHeight = 0, seconds = 1.2, cutDistance = 60 } = {}) {
  let base = fixedHeight,
    lastX,
    lastZ,
    lastRegion;
  return (dt, x, z, ground, region) => {
    if (region == null) base = fixedHeight;
    else if (region !== lastRegion || Math.hypot(x - lastX, z - lastZ) > cutDistance) base = ground;
    else base += (ground - base) * (1 - Math.exp(-dt / seconds));
    lastRegion = region;
    lastX = x;
    lastZ = z;
    return base;
  };
}
