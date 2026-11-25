import { Vector2, Vector3 } from 'three';
import { clamp } from '../math/scalar.js';

export function createWind({ speed: BREEZE = 1, swing: SWING = 0.16, direction: QUARTER = 0, squallGain: SQUALL = 1 } = {}) {
  const wind = { x: 1, z: 0, speed: BREEZE, gust: 0.5 }; // (x, z): the way it blows, a unit vector; speed in metres a second; gust 0 to 1
  // For shaders: xy the wind's velocity in metres a second (world x, z), z its gust from 0 to 1
  // uWindDrift: how far the air has carried anything since the page opened (world x, z, in metres), for patterns that run with it
  const windU = { uWind: { value: new Vector3(BREEZE, 0, 0.5) }, uWindDrift: { value: new Vector2() } };
  let lastT = 0;

  // Each frame, from the time elapsed in seconds and how hard a squall blows (0 to 1). The gust is handed in, not read
  // from the environment, so that the materials the pool's workers load with a job's module do not bring the renderer with them.
  function updateWind(t, squall) {
    const a = QUARTER + SWING * Math.sin(t * 0.071),
      g = clamp(0.5 + 0.22 * Math.sin(t * 0.21) + 0.18 * Math.sin(t * 0.077 + 1.3) + 0.1 * Math.sin(t * 0.53 + 2.1), 0, 1);
    wind.x = Math.cos(a);
    wind.z = Math.sin(a);
    wind.gust = Math.max(g, squall);
    wind.speed = BREEZE * (0.75 + 0.5 * g) * (1 + SQUALL * squall);
    windU.uWind.value.set(wind.x * wind.speed, wind.z * wind.speed, wind.gust);
    const dt = Math.min(0.25, Math.max(0, t - lastT)); // a long pause carries nothing far
    lastT = t;
    windU.uWindDrift.value.x += wind.x * wind.speed * dt;
    windU.uWindDrift.value.y += wind.z * wind.speed * dt;
  }
  return { wind, uniforms: windU, update: updateWind };
}
