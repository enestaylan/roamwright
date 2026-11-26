/**
 * Advance regional rain, dampness, dust and dawn mist for a world clock.
 * @module
 */

import { sstep } from '../math/scalar.js';

/**
 * Create an independent weather clock. The returned function advances the region’s
 * spell timer and writes atmospheric intensities into a caller-owned state object.
 * Keep that object between frames so cloud cover can build before rain and the
 * ground can dry after it stops. Changing the region identity restarts its timer.
 * @param {object} [options] - Weather timing and random source.
 * @param {() => number} [options.random] - Random stream in [0, 1). Supply a seeded generator for repeatable spell timing.
 * @param {number} [options.dawn] - Time of peak morning mist as a fraction of the day.
 * @param {number} [options.mistWidth] - Width of the dawn mist curve in fractions of a day.
 * @param {number} [options.fullReach] - Fraction of a local spell’s radius inside which it has full strength.
 * @param {number} [options.dustRise] - Seconds for storm dust to rise from zero to full strength.
 * @param {number} [options.dustSettle] - Seconds for storm dust to settle from full strength to zero.
 * @example
 * ```js
 * import { mulberry32 } from 'roamwright';
 * import { createWeather } from 'roamwright/motion/weather.js';
 * import { createWind } from 'roamwright/motion/wind.js';
 *
 * const updateWeather = createWeather({ random: mulberry32(42) });
 * const wind = createWind({ speed: 3 });
 * const state = { wet: 0, rain: 0, damp: 0, gust: 0, dust: 0, dustStorm: 0, mist: 0, storm: -1 };
 * const coast = { spell: 'squall', every: [30, 60], lasts: [15, 25], mist: true };
 * function frame(elapsedSeconds, deltaSeconds, dayFraction) {
 *   updateWeather(state, deltaSeconds, dayFraction, { region: 'coast', weather: coast, x: 0, z: 0 });
 *   wind.update(elapsedSeconds, state.gust);
 * }
 * frame(1, 1, 0.25);
 * ```
 */
export function createWeather({
  random = Math.random,
  dawn: DAWN = 0.25,
  mistWidth: MIST_HOURS = 0.032,
  fullReach: SPELL_FADE = 0.55,
  dustRise: DUST_RISES = 18,
  dustSettle: DUST_SETTLES = 30,
} = {}) {
  const clock = { land: null, on: false, next: 0 };
  const between = ([least, most]) => least + random() * (most - least);
  // v moved toward goal by at most step.
  const toward = (v, goal, step) => (v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step));

  /**
   * @param {{wet: number, rain: number, damp: number, gust: number, dust: number, dustStorm: number, mist: number, storm?: number}} weatherState -
   *   Mutable intensities. Use storm = -1 for the region’s automatic cycle, or 0–1 to override the spell strength.
   * @param {number} deltaSeconds - Seconds since the previous update.
   * @param {number} hour - Fraction of one day, from 0 to 1.
   * @param {object} location - Observer and region for this frame.
   * @param {unknown} location.region - Stable identity for the current region.
   * @param {{spell?: string, every?: [number, number], lasts?: [number, number], mist?: boolean, reach?: number, x?: number, z?: number} | null} location.weather -
   *   Set spell to rain, squall or dust and supply minimum/maximum seconds in every and lasts.
   *   For a local spell, set its centre (x, z) and reach in world units. Null clears the weather.
   * @param {number} location.x - Observer’s world X.
   * @param {number} location.z - Observer’s world Z.
   * @param {boolean} [location.running] - Advance the spell timer while true.
   * @param {boolean} [location.quiet] - Suppress spells and dawn mist while true.
   * @param {number} [location.ambientDust] - Local background dust intensity.
   */
  function updateWeather(weatherState, deltaSeconds, hour, { region, weather: regionWeather, x, z, running = true, quiet = false, ambientDust = 0 }) {
    if (!regionWeather) {
      weatherState.wet = weatherState.rain = weatherState.damp = weatherState.gust = weatherState.dustStorm = weatherState.mist = 0;
      weatherState.dust = ambientDust;
      return;
    }
    if (clock.land !== region) {
      // a land just come to: its first spell is a while off
      clock.land = region;
      clock.on = false;
      clock.next = regionWeather.spell ? between(regionWeather.every) * (0.5 + 0.5 * random()) : 0;
    }
    if (regionWeather.spell && running) {
      clock.next -= deltaSeconds;
      if (clock.next <= 0) {
        clock.on = !clock.on;
        clock.next = between(clock.on ? regionWeather.lasts : regionWeather.every);
      }
    }
    let spell = !regionWeather.spell || quiet ? 0 : weatherState.storm >= 0 ? weatherState.storm : clock.on ? 1 : 0;
    if (spell && regionWeather.reach) spell *= sstep(regionWeather.reach, regionWeather.reach * SPELL_FADE, Math.hypot(x - regionWeather.x, z - regionWeather.z));
    const dusty = regionWeather.spell === 'dust',
      squall = regionWeather.spell === 'squall',
      wetGoal = dusty ? 0 : spell,
      raining = wetGoal > 0.5 && weatherState.wet > 0.75;
    // clouds gather in under a minute (a squall's sooner) and break up more slowly; the rain waits for the cloud, and stops before it breaks
    weatherState.wet = toward(weatherState.wet, wetGoal, deltaSeconds / (wetGoal > weatherState.wet ? (squall ? 22 : 40) : 70));
    weatherState.rain = toward(weatherState.rain, raining ? 1 : 0, deltaSeconds / (raining ? 14 : 8));
    weatherState.damp = toward(weatherState.damp, weatherState.rain > 0.3 ? 1 : 0, deltaSeconds / (weatherState.rain > 0.3 ? 45 : 240));
    weatherState.gust = squall ? weatherState.wet : 0;
    // dust: the storm's, what the viewer stands in already (local airborne dust), or a scene's own
    weatherState.dustStorm = toward(
      weatherState.dustStorm,
      dusty ? spell : 0,
      deltaSeconds / (dusty && spell > weatherState.dustStorm ? DUST_RISES : DUST_SETTLES),
    );
    weatherState.dust = Math.max(weatherState.dustStorm, ambientDust);
    const clear = (1 - weatherState.wet) * (1 - weatherState.dust),
      apart = (hour - DAWN) / MIST_HOURS;
    weatherState.mist = toward(weatherState.mist, regionWeather.mist && !quiet ? Math.exp(-apart * apart) * clear : 0, deltaSeconds / 6);
  }
  return updateWeather;
}
