import * as THREE from 'three';

/**
 * A budget of real point lights for many small sources (flames, lanterns, a spell's glow). A few times a second the sources that
 * matter most, the nearest and strongest in view, are each handed one of a small set of point lights made once, before any shader
 * is compiled. A light changing hands fades out and in again by intensity and is never switched off (switching a light off
 * recompiles every material). The first light may cast shadows: it goes to the source that matters most once that clearly
 * outranks the one it holds. Sources too far for a light may still be kept, nearest first, as `pools` for a cheaper stand-in.
 *
 * A source is a record the caller keeps: x, y, z (metres), r, g, b (linear colour), `power` (intensity at full), `reach`
 * (the light's distance), `pool` and `poolR` (whether it may lay a pool, and its radius), `life` and `born` (a brief flash, in
 * seconds of the caller's clock), `flicker`. The budget writes `held` (the light it holds, -1 for none: start it at -1), `score`,
 * `pick` (the round it was last chosen in), `share` (how far its light is faded in) and, for a flash, `on`.
 *
 * @param {object} options
 * @param {THREE.Object3D} options.parent Where the lights are added.
 * @param {(source: object, night: number) => number} options.strength The share of its power a source gives now (0 for none).
 * @param {(source: object, t: number) => number} options.flicker Its flicker at clock t (1 steady).
 * @param {number} [options.count=5] Real lights.
 * @param {number} [options.scan=0.2] Seconds between rounds of choosing.
 * @param {number} [options.fade=3.5] A light fades fully in or out in one over this many seconds.
 * @param {number} [options.reach=70] Metres from the eye beyond which a source holds no light.
 * @param {number} [options.poolReach=900] Metres beyond which a source lays no pool.
 * @param {number} [options.pools=64] Pools kept at most, the nearest in view.
 * @param {number} [options.outOfView=0.25] The share a source whose light falls outside the view counts for.
 * @param {number} [options.held=1.3] How much more a source that already holds a light counts, so lights do not trade back and forth.
 * @param {number} [options.near=9] Square metres added to a source's distance squared, so the one at the eye's feet does not
 *   outshine the rest.
 * @param {number} [options.shadowLead=1.6] How far another source must outrank the one the first light holds to take it over.
 */
export function createLightBudget({
  parent,
  strength,
  flicker,
  count = 5,
  scan = 0.2,
  fade = 3.5,
  reach = 70,
  poolReach = 900,
  pools: poolCount = 64,
  outOfView = 0.25,
  held: heldBonus = 1.3,
  near = 9,
  shadowLead = 1.6,
}) {
  const lights = [],
    held = [], // the source each light holds, or null
    level = new Float32Array(count), // how far up each light is faded, 0 to 1
    picked = [], // the sources chosen this round, best first
    pickedScore = new Float32Array(count),
    pools = [], // the sources that lay pools this round, nearest first
    poolD = new Float64Array(poolCount);
  let scanT = 0,
    round = 0;
  const sphere = new THREE.Sphere(),
    frustum = new THREE.Frustum(),
    vp = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const L = new THREE.PointLight(0xffffff, 0, 30, 2);
    parent.add(L);
    lights.push(L);
    held.push(null);
  }

  function considerPool(rec, d2) {
    if (d2 > poolReach * poolReach) return;
    sphere.center.set(rec.x, rec.y, rec.z);
    sphere.radius = rec.poolR;
    if (!frustum.intersectsSphere(sphere)) return;
    let j = pools.length;
    if (j === poolCount) {
      if (d2 >= poolD[poolCount - 1]) return;
      j = poolCount - 1;
    } else pools.push(rec);
    while (j > 0 && poolD[j - 1] > d2) {
      pools[j] = pools[j - 1];
      poolD[j] = poolD[j - 1];
      j--;
    }
    pools[j] = rec;
    poolD[j] = d2;
  }

  // Starts a round of choosing, seen through `camera`.
  function begin(camera) {
    round++;
    picked.length = 0;
    pools.length = 0;
    frustum.setFromProjectionMatrix(vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  }
  // Ranks one source, seen from (cx, cy, cz), against those chosen so far this round.
  function consider(rec, cx, cy, cz, night) {
    const dx = rec.x - cx,
      dy = rec.y - cy,
      dz = rec.z - cz,
      d2 = dx * dx + dy * dy + dz * dz;
    if (rec.pool) considerPool(rec, d2);
    if (d2 > reach * reach) return;
    const s = strength(rec, night);
    if (s <= 0) return;
    sphere.center.set(rec.x, rec.y, rec.z);
    sphere.radius = rec.reach * 0.6;
    let score = s / (d2 + near);
    if (!frustum.intersectsSphere(sphere)) score *= outOfView;
    if (rec.held >= 0) score *= heldBonus;
    rec.score = score;
    let j = picked.length;
    if (j === count) {
      if (score <= pickedScore[count - 1]) return;
      j = count - 1;
    } else picked.push(rec);
    while (j > 0 && pickedScore[j - 1] < score) {
      picked[j] = picked[j - 1];
      pickedScore[j] = pickedScore[j - 1];
      j--;
    }
    picked[j] = rec;
    pickedScore[j] = score;
  }
  function aim(L, rec) {
    L.position.set(rec.x, rec.y, rec.z);
    L.color.setRGB(rec.r, rec.g, rec.b);
    L.distance = rec.reach;
  }
  // The shadow-casting light goes to the source that matters most once it clearly outranks the one it holds: the two lights trade
  // sources, each keeping its level, so the light on the ground stays as it was and only the shadow moves.
  function leadShadow() {
    const best = picked[0],
      mine = held[0];
    if (!best || best === mine || !(best.held > 0)) return;
    if (mine && mine.pick === round && best.score < mine.score * shadowLead) return;
    const i = best.held;
    held[i] = mine;
    held[0] = best;
    best.held = 0;
    if (mine) mine.held = i;
    const lv = level[0];
    level[0] = level[i];
    level[i] = lv;
    aim(lights[0], best);
    if (mine) aim(lights[i], mine);
  }
  function release(i) {
    held[i].held = -1;
    held[i].share = 0;
    held[i] = null;
  }
  // Ends the round: a light whose source is no longer chosen fades out, and once out is free for a chosen source that holds none.
  function settle() {
    for (let i = 0; i < picked.length; i++) picked[i].pick = round;
    leadShadow();
    for (let i = 0; i < count; i++) if (held[i] && held[i].pick !== round && level[i] <= 0) release(i);
    for (let p = 0; p < picked.length; p++) {
      const rec = picked[p];
      if (rec.held >= 0) continue;
      const i = held.indexOf(null);
      if (i < 0) break;
      held[i] = rec;
      rec.held = i;
      aim(lights[i], rec);
    }
  }
  // Whether a round of choosing is due after dt seconds.
  function due(dt) {
    scanT -= dt;
    if (scanT > 0) return false;
    scanT = scan;
    return true;
  }
  // Chooses again in the coming frame (a flash should not wait its turn).
  function soon() {
    scanT = 0;
  }
  // Fades the lights towards this round's choosing and flickers them, at clock t; returns the index of the brightest light whose
  // source flickers fully (`flicker === 1`, a fire's), or -1.
  function fadeLights(dt, t, night) {
    const step = Math.min(1, dt * fade);
    let lead = -1;
    for (let i = 0; i < count; i++) {
      const rec = held[i],
        L = lights[i];
      if (!rec) {
        L.intensity = 0;
        continue;
      }
      if (rec.life) rec.on = Math.max(0, 1 - (t - rec.born) / rec.life) ** 2;
      // a flash comes up at once; every other light eases in
      level[i] = rec.pick === round ? (rec.life ? 1 : Math.min(1, level[i] + step)) : Math.max(0, level[i] - step);
      rec.share = level[i];
      L.intensity = level[i] * strength(rec, night) * flicker(rec, t);
      if (rec.flicker === 1 && (lead < 0 || L.intensity > lights[lead].intensity)) lead = i;
    }
    return lead;
  }

  return { lights, picked, pools, begin, consider, settle, due, soon, fadeLights };
}

/**
 * When a point light's cached shadow is redrawn: only while it is lit, at most every `every` frames, and only when something
 * within its reach moved, the light moved, the kept picture of what stands still is stale, or `anyway` frames have gone by.
 * The returned function takes the caster, the frame's number, `stirsAt(x, y, z)` (a count that changes whenever something near
 * the light moves, negative when unknown) and `stale()` (whether a kept picture under the shadow is out of date); both are asked
 * only when the shadow might be redrawn. It sets `caster.shadow.needsUpdate` and returns true when it should be.
 */
export function createShadowRedraw({ every = 2, anyway = 30 } = {}) {
  const drawn = { stirs: NaN, x: NaN, y: NaN, z: NaN, frame: -Infinity };
  return function redraw(caster, frame, stirsAt, stale) {
    if (!caster.castShadow || !(caster.intensity > 0) || frame % every) return false;
    const { x, y, z } = caster.position,
      stirs = stirsAt(x, y, z);
    if (stirs >= 0 && stirs === drawn.stirs && x === drawn.x && y === drawn.y && z === drawn.z && !stale())
      if (caster.shadow.map && frame - drawn.frame < anyway) return false;
    caster.shadow.needsUpdate = true;
    drawn.stirs = stirs;
    drawn.x = x;
    drawn.y = y;
    drawn.z = z;
    drawn.frame = frame;
    return true;
  };
}
