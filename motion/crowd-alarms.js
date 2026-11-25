import { sstep } from '../math/scalar.js';

/**
 * Alarms that scatter a crowd, and a stage it turns to watch. Everyone within reach of a fresh alarm runs away from it, round
 * whatever stands in the way; once it has been quiet for a while they walk back to where their own routine has them. A person's
 * flight is kept on them as an offset from that routine, so the routine itself never changes.
 *
 * A person is a plain record the crowd keeps: `fx`, `fz` (the flight's offset, metres), `fy` (its heading), `ft` (the clock at
 * their last step, -1 before the first), `lean` (the side they turned to last, tried first next time) and `ph` (their own
 * phase, which staggers when each starts to run). Positions come and go in records filled in place, and no frame allocates.
 *
 * @param {object} options
 * @param {(x: number, z: number, want: number, step: number, radius: number, lean?: number) => number|undefined} options.steer
 *   A heading clear of obstacles for a step from (x, z), or undefined when hemmed in (`createSpaces().steer`).
 * @param {number} [options.run=4.2] Metres a second of a person running from an alarm.
 * @param {number} [options.walkBack=0.9] Metres a second of a person walking back to their routine.
 * @param {number} [options.life=7] Seconds an alarm lasts after it was last raised.
 * @param {number} [options.body=0.3] Metres: a runner's radius against obstacles.
 * @param {number} [options.merge=3] Metres within which a new alarm renews an old one instead of adding another.
 * @param {number} [options.reach=11] Metres an alarm carries unless it says.
 * @param {number} [options.watchWithin=18] Metres from a stage within which an idle person turns to it,
 * @param {number} [options.watchBeyond=2.5] unless they stand in the middle of it.
 */
export function createCrowdAlarms({
  steer,
  run = 4.2,
  walkBack = 0.9,
  life = 7,
  body = 0.3,
  merge = 3,
  reach = 11,
  watchWithin = 18,
  watchBeyond = 2.5,
} = {}) {
  const alarms = []; // { x, z, t, r }: where, when last raised, and how far it carries
  const stage = { on: false, x: 0, z: 0 };

  // Raises an alarm at (x, z) at clock t, or renews the one already there.
  function raise(x, z, t, r = reach) {
    const near = alarms.find(a => Math.hypot(a.x - x, a.z - z) < merge);
    if (near) {
      near.t = t;
      near.r = Math.max(near.r, r);
    } else alarms.push({ x, z, t, r });
  }
  // Drops the alarms that have been quiet for `life` seconds at clock t (or were raised after it: the clock was turned back).
  function expire(t) {
    for (let i = alarms.length - 1; i >= 0; i--) if (t - alarms[i].t > life || t < alarms[i].t) alarms.splice(i, 1);
  }
  // A stage at (x, z) that idle people near it turn to watch; called with nothing when it closes.
  function watch(x, z) {
    stage.on = x !== undefined;
    if (stage.on) {
      stage.x = x;
      stage.z = z;
    }
  }
  // Turns someone standing at `at` ({ x, z, yaw }) to the stage, if there is one near enough.
  function watchStage(at) {
    if (!stage.on) return;
    const dx = stage.x - at.x,
      dz = stage.z - at.z,
      d = Math.sqrt(dx * dx + dz * dz);
    if (d < watchWithin && d > watchBeyond) at.yaw = Math.atan2(dx, dz);
  }
  // Whether g may be in flight: an alarm is up, or g is still away from their routine.
  const alarmed = g => alarms.length > 0 || !!g.fx || !!g.fz;

  // One step of g at clock t: `at` ({ x, z, yaw, speed, travel, focus }) holds where g's routine puts them, and is moved to where
  // their flight has them. False when they stand where their routine puts them.
  function flee(g, at, t) {
    const hx = at.x,
      hz = at.z,
      dt = g.ft < 0 ? 0 : Math.min(0.1, Math.max(0, t - g.ft));
    g.ft = t;
    const x = hx + (g.fx || 0),
      z = hz + (g.fz || 0);
    let near = null,
      nd = Infinity;
    for (let i = 0; i < alarms.length; i++) {
      const a = alarms[i],
        ax = x - a.x,
        az = z - a.z,
        d = Math.sqrt(ax * ax + az * az);
      if (d < a.r && d < nd) {
        nd = d;
        near = a;
      }
    }
    let speed;
    if (near) {
      const away = nd < 0.01 ? g.ph || 1 : Math.atan2(x - near.x, z - near.z);
      const k = sstep(0, 0.6, t - near.t + 0.6 - (g.ph % 1) * 0.5); // each starts at their own moment, not all on one beat
      speed = go(g, x, z, hx, hz, away, run * k * dt, run * k);
    } else {
      const fx = g.fx || 0,
        fz = g.fz || 0,
        o = Math.sqrt(fx * fx + fz * fz);
      if (o < 0.02) {
        g.fx = g.fz = 0;
        return false;
      }
      speed = go(g, x, z, hx, hz, Math.atan2(-g.fx, -g.fz), Math.min(o, walkBack * dt), walkBack);
    }
    if (!speed && !g.fx && !g.fz) return false; // hemmed in away from their routine, they stand there rather than leap back to it
    at.x += g.fx;
    at.z += g.fz;
    at.yaw = g.fy;
    at.speed = speed;
    at.travel = t * speed + g.ph;
    at.focus = undefined;
    return true;
  }
  function go(g, x, z, hx, hz, want, step, speed) {
    const a = steer(x, z, want, step, body, g.lean);
    g.fy = a ?? want;
    if (a === undefined) return 0; // hemmed in: they stand where they are
    const turn = Math.sin(a - want);
    if (turn > 0.1) g.lean = 1;
    else if (turn < -0.1) g.lean = -1;
    g.fx = x + Math.sin(a) * step - hx;
    g.fz = z + Math.cos(a) * step - hz;
    return speed;
  }

  return { alarms, raise, expire, watch, watchStage, alarmed, flee };
}
