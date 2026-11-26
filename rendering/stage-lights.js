import * as THREE from 'three';
import { clamp, lerp, sstep } from '../math/scalar.js';

/**
 * Lights for a filmed stage, moved with its camera each frame: a fill over the stage by night that becomes a key beside the lens
 * for a closer shot (and for a near shot by day, so a face with the sun behind it is read); a rim behind the players by night, low
 * and to one side, so dark clothes against dark ground keep an edge; and the warm light a fire behind the players throws back at
 * them from the lens's side. Each keeps its strength on the subject whatever the lens's distance. A jump of the lens is a cut,
 * where the lights take their new strength at once.
 *
 * @param {object} options
 * @param {THREE.SpotLight} options.fill The fill and key (a spot whose cone becomes a half-sphere when it is a fill).
 * @param {THREE.SpotLight} options.rim The rim.
 * @param {THREE.PointLight} options.bounce The fire's bounce.
 * @param {{ position: THREE.Vector3, intensity: number, on: boolean }} [options.fire] The brightest fire near the stage.
 * @param {THREE.Color} [options.moonColor] The fill's colour by night.
 * @param {THREE.Color} [options.dayColor] The key's colour by day.
 * @param {object} [options.tuning] Overrides of the constants below.
 */
export function createStageLights({
  fill,
  rim,
  bounce,
  fire = { position: new THREE.Vector3(), intensity: 0, on: false },
  moonColor = new THREE.Color(0xa9bfe6),
  dayColor = new THREE.Color(0xfff0dc),
  tuning = {},
}) {
  const T = {
    key: 0.55, // a closer shot's key light: its strength where the subject stands
    keyNear: 5, // a near shot has the key too, in full at keyNear metres from its aim, none past keyFar, by day
    keyFar: 9,
    keyDay: [0.6, 0.9], // from this daylight to this one
    nightFill: 1.25, // the fill over a night stage: its strength where the camera looks,
    nightKey: 0.9, // and how much stronger a closer shot's key is by night
    fillUp: 4.5, // the fill hangs at least this far above the stage, and higher by this share of the lens's distance
    fillRise: 0.3,
    fillRoom: 12, // a lens nearer its aim than this hangs the fill lower in step, down to this share of fillUp
    fillLowest: 0.3,
    decay: 1.2, // how the lights fall off with distance
    keyUp: 1.1, // how far above the lens the key hangs, and how far to one side, in metres
    keyAside: 1.6,
    keySide: 0.8, // the key stands this share of the way from the subject to the lens,
    keyReach: 4.8, // but never further from the subject than this many metres
    keyTop: 3.6, // held in close, it rises in step, up to this many metres over the lens
    keySpread: 1.6, // its cone takes in this many metres round the aim at the subject's distance,
    keySoft: 0.55, // its outer part, by this share of the cone's angle, fading to its edge
    keyCut: 1.5, // and it reaches this many times the subject's distance, fading before
    fillRange: 48, // the fill by night reaches this many metres,
    fillCone: Math.PI / 2, // pointing straight down with its cone opened to a half-sphere
    fillSoft: 0.05,
    rim: 6, // the rim's strength where the players stand
    rimBack: 0.35, // how far behind them, as a share of the lens's distance, between these many metres,
    rimNearest: 3,
    rimFurthest: 12,
    rimUp: 1.2, // how far above the aim, and higher by this share of the lens's distance
    rimRise: 0.12,
    rimSpread: 0.35, // the width its cone takes in at the players, as a share of the lens's distance, at least rimLeast metres
    rimLeast: 1.6,
    rimAside: 0.7, // and to one side, as a share of how far behind
    rimCut: 1.4, // it reaches this many times its distance to them, fading before
    bounce: 0.45, // the warm light thrown back by a fire behind the players: this share of the fire's own light on them,
    bounceAt: 0.45, // from this share of the way from them to the lens, at most bounceNearest metres off
    bounceNearest: 3,
    bounceUp: 0.6, // and this far above the aim
    bounceReach: 14, // a fire further than this from the players throws nothing back
    cutJump: 2.5, // metres the lens moves in one frame that make a cut
    ...tuning,
  };
  const keyAtSubject = (1 - T.keyCut ** -4) ** 2, // the share of its strength the fading leaves it at the subject
    rimAtSubject = (1 - T.rimCut ** -4) ** 2;
  const back = new THREE.Vector3(),
    key = new THREE.Vector3(),
    lastLens = new THREE.Vector3(),
    toFire = new THREE.Vector3();

  // Points a light standing where it is: at `subject` as a key, its cone taking in the subject; with none, straight down as a fill.
  function aim(light, subject) {
    if (subject) {
      const reach = light.position.distanceTo(subject);
      light.target.position.copy(subject);
      light.angle = Math.atan(T.keySpread / reach);
      light.penumbra = T.keySoft;
      light.distance = reach * T.keyCut;
    } else {
      light.target.position.copy(light.position);
      light.target.position.y -= 1;
      light.angle = T.fillCone;
      light.penumbra = T.fillSoft;
      light.distance = T.fillRange;
    }
  }
  function lightRim(p, l, reach, night, ease) {
    const behind = clamp(reach * T.rimBack, T.rimNearest, T.rimFurthest);
    back.set(l.x - p.x, 0, l.z - p.z).normalize();
    rim.position.copy(l).addScaledVector(back, behind);
    rim.position.x -= back.z * behind * T.rimAside;
    rim.position.z += back.x * behind * T.rimAside;
    rim.position.y += T.rimUp + T.rimRise * reach;
    rim.target.position.copy(l);
    const dist = rim.position.distanceTo(l);
    rim.angle = Math.atan(Math.max(T.rimLeast, reach * T.rimSpread) / dist);
    rim.distance = dist * T.rimCut;
    rim.color.copy(moonColor);
    rim.intensity += ((T.rim * night * dist ** T.decay) / rimAtSubject - rim.intensity) * ease;
  }
  function lightBounce(p, l, reach, ease) {
    toFire.subVectors(fire.position, l);
    const fireDist = Math.max(1, toFire.length()),
      behind = fire.on ? clamp(toFire.normalize().dot(back), 0, 1) * (1 - clamp(fireDist / T.bounceReach, 0, 1)) : 0;
    bounce.position.copy(l).lerp(p, Math.min(T.bounceAt, T.bounceNearest / Math.max(reach, 0.01)));
    bounce.position.y += T.bounceUp;
    const near = Math.max(0.5, bounce.position.distanceTo(l));
    bounce.distance = near * 2.5;
    bounce.intensity += (T.bounce * behind * fire.intensity * (near / fireDist) ** 2 - bounce.intensity) * ease;
  }

  /**
   * Places and sets the lights for a lens at `p` looking at `l` this frame. `closer`: a closer shot (a key in full, and eased in
   * faster); `day`: the share of daylight, 0 to 1; `dt`: seconds since the last frame. Returns whether the lens jumped (a cut).
   */
  function update(p, l, closer, day, dt) {
    const reach = p.distanceTo(l),
      room = 1 - clamp(reach / T.fillRoom, 0, 1) ** 2,
      held = Math.max(1, (T.keySide * reach) / T.keyReach), // how many times nearer the subject the key is held than its share
      keyOut = (T.keySide * reach) / held,
      keyUp = Math.min(T.keyUp * held, T.keyTop),
      keyed = closer ? 1 : sstep(T.keyFar, T.keyNear, reach) * sstep(T.keyDay[0], T.keyDay[1], day);
    // where the key stands beside the lens, and where the fill hangs over the stage: the light moves between them as the shot
    // comes in, and is aimed at the subject as soon as it is any part a key
    key.copy(l).lerp(p, T.keySide / held);
    key.y += keyUp;
    key.addScaledVector(back.set(p.z - l.z, 0, l.x - p.x).normalize(), T.keyAside);
    fill.position.copy(l).lerp(p, lerp(0.3, 0.85, room));
    fill.position.y += Math.max(T.fillUp * clamp(reach / T.fillRoom, T.fillLowest, 1), T.fillRise * reach);
    fill.position.lerp(key, keyed);
    aim(fill, keyed > 0 ? l : null);
    fill.color.lerpColors(moonColor, dayColor, day);
    const night = 1 - day,
      keyReach = (reach / held) * Math.sqrt((keyOut * keyOut + keyUp * keyUp) / (keyOut * keyOut + T.keyUp * T.keyUp)),
      strength =
        T.nightFill * night * fill.position.distanceTo(l) ** T.decay +
        (keyed * T.key * (1 + T.nightKey * night) * keyReach ** T.decay) / keyAtSubject;
    const cut = lastLens.distanceToSquared(p) > T.cutJump * T.cutJump;
    lastLens.copy(p);
    const ease = cut ? 1 : Math.min(1, dt * (closer ? 12 : 2));
    fill.intensity += (strength - fill.intensity) * ease;
    lightRim(p, l, reach, night, ease);
    lightBounce(p, l, reach, ease);
    return cut;
  }

  return { update, aim };
}

/**
 * Frames a shot made for a wide screen on a narrower one: the camera draws back along its line of sight until about the same width
 * of the stage is in view, as far as it can go before `blocked(x, y, z)`; what width that leaves out, a wider lens takes in.
 * The returned function moves `shot.p` (from its aim `shot.l`), eases `shot.drawn` (start it at -1) and returns the lens in degrees.
 */
export function createNarrowFraming({
  blocked,
  stageAspect = 1.5,
  keepWidth = 0.85,
  keepLens = 0.55,
  maxDrawBack = 2.2,
  drawStep = 0.5,
  widestLens = 94,
} = {}) {
  const back = new THREE.Vector3();
  return function frameNarrow(shot, longLens, dt, baseFov, wideFov, aspect) {
    const lens = baseFov - longLens * keepLens,
      framed = Math.tan(((wideFov - longLens) * Math.PI) / 360) * stageAspect,
      seen = Math.tan((lens * Math.PI) / 360) * aspect,
      need = (keepWidth * framed) / seen, // how many times wider the view must be
      reach = back.subVectors(shot.p, shot.l).length();
    if (need <= 1 || reach < 1e-3) return lens;
    back.divideScalar(reach);
    const want = reach * (Math.min(maxDrawBack, need) - 1);
    let free = 0;
    while (free < want) {
      const s = Math.min(want, free + drawStep);
      if (blocked(shot.p.x + back.x * s, shot.p.y + back.y * s, shot.p.z + back.z * s)) break;
      free = s;
    }
    shot.drawn = shot.drawn < 0 ? free : shot.drawn + (free - shot.drawn) * Math.min(1, dt * 4);
    shot.p.addScaledVector(back, shot.drawn);
    const left = need / (1 + shot.drawn / reach);
    return left <= 1 ? lens : Math.min(widestLens, (Math.atan(Math.tan((lens * Math.PI) / 360) * left) * 360) / Math.PI);
  };
}

/**
 * Samples a camera's keys at time t: keys are [seconds, x, y, z, lookX, lookY, lookZ, cut, lens], a key flagged as a cut held
 * until its time and then jumped to. Writes { src, dst, u } into `out` (u smoothstepped between src and dst).
 */
export function cameraKeyAt(keys, t, out) {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= t) i++;
  const currentKey = keys[i],
    nextKey = keys[i + 1],
    cutNext = !!nextKey[7];
  let u = cutNext ? 0 : clamp((t - currentKey[0]) / (nextKey[0] - currentKey[0]), 0, 1);
  u = u * u * (3 - 2 * u);
  out.src = cutNext && t >= nextKey[0] ? nextKey : currentKey;
  out.dst = cutNext ? out.src : nextKey;
  out.u = u;
  return out;
}
