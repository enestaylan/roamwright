/**
 * Share the same horizontal wind between simulation code and shader effects.
 * @module
 */

import { Vector2, Vector3 } from 'three';
import { clamp } from '../math/scalar.js';

/**
 * Create a wind field with a slowly varying heading and gust strength. The
 * returned wind state and uniforms keep their identity across updates. Bind the
 * uniforms to materials once, then call `update(elapsedSeconds, squall)` per frame.
 * @param {object} [options] - Prevailing wind and its variation.
 * @param {number} [options.speed] - Base speed in metres per second.
 * @param {number} [options.direction] - Heading in radians from +X toward +Z.
 * @param {number} [options.swing] - Maximum angular deviation from the heading in radians.
 * @param {number} [options.squallGain] - Fractional speed increase at full squall strength.
 * @returns `wind` holds a unit direction (x, z), speed and gust. In the shader,
 *   `uWind.xy` is X/Z velocity, `uWind.z` is gust, and `uWindDrift` is accumulated displacement in metres.
 */
export function createWind({ speed: BREEZE = 1, swing: SWING = 0.16, direction: QUARTER = 0, squallGain: SQUALL = 1 } = {}) {
  const wind = { x: 1, z: 0, speed: BREEZE, gust: 0.5 }; // (x, z): the way it blows, a unit vector; speed in metres a second; gust 0 to 1
  // For shaders: xy the wind's velocity in metres a second (world x, z), z its gust from 0 to 1
  // uWindDrift: how far the air has carried anything since the page opened (world x, z, in metres), for patterns that run with it
  const windU = { uWind: { value: new Vector3(BREEZE, 0, 0.5) }, uWindDrift: { value: new Vector2() } };
  let lastT = 0;

  /**
   * @param {number} elapsedSeconds - Total elapsed simulation time in seconds. Drift advances by at most 0.25 seconds per update.
   * @param {number} squall - Squall strength from 0 to 1. Pass zero for fair weather.
   */
  function updateWind(elapsedSeconds, squall) {
    const heading = QUARTER + SWING * Math.sin(elapsedSeconds * 0.071),
      gustStrength = clamp(0.5 + 0.22 * Math.sin(elapsedSeconds * 0.21) + 0.18 * Math.sin(elapsedSeconds * 0.077 + 1.3) + 0.1 * Math.sin(elapsedSeconds * 0.53 + 2.1), 0, 1);
    wind.x = Math.cos(heading);
    wind.z = Math.sin(heading);
    wind.gust = Math.max(gustStrength, squall);
    wind.speed = BREEZE * (0.75 + 0.5 * gustStrength) * (1 + SQUALL * squall);
    windU.uWind.value.set(wind.x * wind.speed, wind.z * wind.speed, wind.gust);
    const deltaSeconds = Math.min(0.25, Math.max(0, elapsedSeconds - lastT)); // a long pause carries nothing far
    lastT = elapsedSeconds;
    windU.uWindDrift.value.x += wind.x * wind.speed * deltaSeconds;
    windU.uWindDrift.value.y += wind.z * wind.speed * deltaSeconds;
  }
  return { wind, uniforms: windU, update: updateWind };
}
