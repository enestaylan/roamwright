import { sstep } from '../math/scalar.js';

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

  // Each frame: env's weather (wet, rain, damp, gust, dust, mist) moved on by dt seconds; hour is the clock, 0 to 1.
  function updateWeather(env, dt, hour, { region, weather: w, x, z, running = true, quiet = false, ambientDust = 0 }) {
    if (!w) {
      env.wet = env.rain = env.damp = env.gust = env.dustStorm = env.mist = 0;
      env.dust = ambientDust;
      return;
    }
    if (clock.land !== region) {
      // a land just come to: its first spell is a while off
      clock.land = region;
      clock.on = false;
      clock.next = w.spell ? between(w.every) * (0.5 + 0.5 * random()) : 0;
    }
    if (w.spell && running) {
      clock.next -= dt;
      if (clock.next <= 0) {
        clock.on = !clock.on;
        clock.next = between(clock.on ? w.lasts : w.every);
      }
    }
    let spell = !w.spell || quiet ? 0 : env.storm >= 0 ? env.storm : clock.on ? 1 : 0;
    if (spell && w.reach) spell *= sstep(w.reach, w.reach * SPELL_FADE, Math.hypot(x - w.x, z - w.z));
    const dusty = w.spell === 'dust',
      squall = w.spell === 'squall',
      wetGoal = dusty ? 0 : spell,
      raining = wetGoal > 0.5 && env.wet > 0.75;
    // clouds gather in under a minute (a squall's sooner) and break up more slowly; the rain waits for the cloud, and stops before it breaks
    env.wet = toward(env.wet, wetGoal, dt / (wetGoal > env.wet ? (squall ? 22 : 40) : 70));
    env.rain = toward(env.rain, raining ? 1 : 0, dt / (raining ? 14 : 8));
    env.damp = toward(env.damp, env.rain > 0.3 ? 1 : 0, dt / (env.rain > 0.3 ? 45 : 240));
    env.gust = squall ? env.wet : 0;
    // dust: the storm's, what the viewer stands in already (local airborne dust), or a scene's own
    env.dustStorm = toward(
      env.dustStorm,
      dusty ? spell : 0,
      dt / (dusty && spell > env.dustStorm ? DUST_RISES : DUST_SETTLES),
    );
    env.dust = Math.max(env.dustStorm, ambientDust);
    const clear = (1 - env.wet) * (1 - env.dust),
      apart = (hour - DAWN) / MIST_HOURS;
    env.mist = toward(env.mist, w.mist && !quiet ? Math.exp(-apart * apart) * clear : 0, dt / 6);
  }
  return updateWeather;
}
