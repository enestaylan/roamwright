import * as THREE from 'three';
import { TAU, sstep } from '../math/scalar.js';
import { placeBankedAt, placement } from '../geometry/placement.js';

/**
 * Flocks of birds: one instanced mesh a flock, the wings beaten in the vertex shader. A bird beats while it climbs or holds its
 * height and glides on held wings as it comes down, and banks into its turn as far as its speed round it asks.
 *
 * A bird's look gives its wing's outline and, for a bird of more than one colour, the colours of its parts (all in the bird's own
 * units, nose to +z, about 2.1 long and 3.2 across the wings at size 1):
 * - `arm`, `hand`: rows across the wing from the leading edge to the trailing one, [x, y, z of the front, x, y, z of the back],
 *   the arm out to the wrist (x = WRIST) and the hand out to the tip;
 * - `fingers`: the outer primaries' tips, notched apart [x, z where one leaves the wing, how far its tip lies out and forward];
 * - `tail`: [how far back its middle reaches, how wide its end is];
 * - `beat`: wingbeats a second; `gloss`: the plumage's roughness, if not the flock's;
 * - `colours` (linear) { body, head, arm, hand, tip }, the tip beyond x = `tips`; `under` { arm, hand }: the under face's colours;
 * - `soar`: a bird that rides the air on held wings and seldom beats them; `silent`: one that does not call.
 */
export const SHOULDER = 0.16; // how far out the wings are hinged
export const WRIST = 0.8; // and the wrists
const SPAN = 3.2; // a bird across the wings at size 1

/** A bird's geometry from its look: position, aW (0 body, 1 arm, 2 hand), and for a coloured look, color and aUnder. */
export function birdGeometry(birdStyle) {
  const positions = [],
    wingWeights = [],
    K = [],
    U = [], // the under face's colour and which way the triangle's front face looks (1 up, -1 down, 0 one colour on both faces)
    col = birdStyle.colours,
    tri = (firstPoint, secondPoint, thirdPoint, w = 0, part = 'body') => {
      positions.push(...firstPoint, ...secondPoint, ...thirdPoint);
      wingWeights.push(w, w, w);
      if (!col) return;
      const under = birdStyle.under?.[part],
        up = Math.sign((secondPoint[2] - firstPoint[2]) * (thirdPoint[0] - firstPoint[0]) - (secondPoint[0] - firstPoint[0]) * (thirdPoint[2] - firstPoint[2]));
      for (const p of [firstPoint, secondPoint, thirdPoint]) {
        const tip = part !== 'body' && part !== 'head' && Math.abs(p[0]) > birdStyle.tips;
        K.push(...(tip ? col.tip : col[part]));
        if (birdStyle.under) U.push(...(under && !tip ? under : tip ? col.tip : col[part]), under && !tip ? up : 0);
      }
    };
  // the body: rings along z [z, half width, half height, centre y], from the beak's tip to the root of the tail
  const bodyRings = [
      [1.08, 0, 0, 0.02],
      [0.86, 0.06, 0.06, 0.04],
      [0.68, 0.1, 0.1, 0.05],
      [0.4, 0.17, 0.15, 0.01],
      [0.05, 0.18, 0.15, 0],
      [-0.35, 0.12, 0.1, 0.01],
      [-0.6, 0.05, 0.04, 0.02],
    ],
    AROUND = 6,
    at = (r, j) => {
      const angle = (j / AROUND) * TAU;
      return [Math.cos(angle) * r[1], r[3] + Math.sin(angle) * r[2], r[0]];
    };
  for (let i = 0; i < bodyRings.length - 1; i++)
    for (let j = 0; j < AROUND; j++) {
      const ringStart = at(bodyRings[i], j),
        ringEnd = at(bodyRings[i], j + 1),
        nextRingStart = at(bodyRings[i + 1], j),
        nextRingEnd = at(bodyRings[i + 1], j + 1);
      const part = i < 2 ? 'head' : 'body';
      tri(ringStart, nextRingStart, nextRingEnd, 0, part);
      if (i > 0) tri(ringStart, nextRingEnd, ringEnd, 0, part);
    }
  // the tail, a fan a little wider at its end, its middle feathers longest
  const [back, wide] = birdStyle.tail;
  tri([-0.05, 0.02, -0.5], [0.05, 0.02, -0.5], [wide, 0.02, -back + 0.08]);
  tri([-0.05, 0.02, -0.5], [wide, 0.02, -back + 0.08], [0, 0.02, -back]);
  tri([-0.05, 0.02, -0.5], [0, 0.02, -back], [-wide, 0.02, -back + 0.08]);
  for (const s of [-1, 1]) {
    const X = (x, y, z) => [s * x, y, z];
    for (const [rows, w] of [
      [birdStyle.arm, 1],
      [birdStyle.hand, 2],
    ])
      for (let i = 0; i < rows.length - 1; i++) {
        const currentRow = rows[i],
          nextRow = rows[i + 1],
          la = X(currentRow[0], currentRow[1], currentRow[2]),
          ta = X(currentRow[3], currentRow[4], currentRow[5]),
          lb = X(nextRow[0], nextRow[1], nextRow[2]),
          tb = X(nextRow[3], nextRow[4], nextRow[5]);
        tri(la, ta, tb, w, w === 1 ? 'arm' : 'hand');
        tri(la, tb, lb, w, w === 1 ? 'arm' : 'hand');
      }
    for (const [x, z, dx, dz] of birdStyle.fingers) tri(X(x - 0.07, 0.01, z + 0.05), X(x + 0.05, 0.01, z + 0.04), X(x + dx, 0, z + dz), 2, 'tip');
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aW', new THREE.Float32BufferAttribute(wingWeights, 1));
  if (col) geometry.setAttribute('color', new THREE.Float32BufferAttribute(K, 3));
  if (U.length) geometry.setAttribute('aUnder', new THREE.Float32BufferAttribute(U, 4));
  geometry.computeVertexNormals();
  return geometry;
}

/** A plain bird for far or stylised flocks: a body diamond and two wings, aW marking how far out along the wing a vertex sits. */
export function plainBirdGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions = [
    0, 0, 0.9, 0.22, 0, 0, -0.22, 0, 0, 0.22, 0, 0, 0, 0, -1.0, -0.22, 0, 0, 0.2, 0, 0.35, 1.5, 0, 0.05, 0.2, 0, -0.35, -0.2, 0, -0.35,
    -1.5, 0, 0.05, -0.2, 0, 0.35,
  ];
  const wingWeights = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aW', new THREE.Float32BufferAttribute(wingWeights, 1));
  geometry.computeVertexNormals();
  return geometry;
}

// The beat in the vertex shader: the arm about the shoulder, the hand about the wrist a little behind it, drawn in and swept back
// on the upstroke; the body rises and falls against the wings; a gliding bird holds its wings in a shallow V.
const BEAT = /* glsl */ `
        float beat = aFlap.y, ph = uTime * uBeat + aFlap.x, up = max(cos(ph), 0.0) * beat;
        if (aW > 0.5) {
          float side = sign(transformed.x), ax = abs(transformed.x);
          float a1 = beat * (0.12 + 0.75 * sin(ph)) + (1.0 - beat) * 0.1;
          float a2 = a1 + beat * 0.5 * sin(ph - 0.9) - (1.0 - beat) * 0.06;
          float r1 = min(ax, ${WRIST.toFixed(2)}) - ${SHOULDER.toFixed(2)}, r2 = max(ax - ${WRIST.toFixed(2)}, 0.0) * (1.0 - 0.35 * up);
          vec2 xy = vec2(${SHOULDER.toFixed(2)}, 0.0) + vec2(cos(a1), sin(a1)) * r1 + vec2(cos(a2), sin(a2)) * r2;
          transformed.x = side * xy.x;
          transformed.y += xy.y;
          transformed.z -= 0.3 * up * r2;
        }
        transformed.y -= beat * 0.06 * sin(ph);`;
// A wing's under face in its own colour: vUnder carries that colour and whether the triangle's front face is its upper one (1),
// its lower one (-1), or it is one colour on both faces (0).
const UNDER_HEAD = /* glsl */ ` attribute vec4 aUnder; varying vec4 vUnder;`,
  UNDER = /* glsl */ `
        if (vUnder.w != 0.0 && gl_FrontFacing != (vUnder.w > 0.0)) diffuseColor.rgb = diffuse * vUnder.rgb;`;

/** A plumage's colour (hex, sRGB) lifted to the linear luminance `least` if darker, its hue kept: black feathers still shine. */
export function plumage(hex, least = 0.035) {
  const color = new THREE.Color(hex),
    lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return lum < least ? color.multiplyScalar(least / Math.max(lum, 1e-4)) : color;
}

/**
 * A flock of `count` birds.
 *
 * @param {object} options
 * @param {number} options.count
 * @param {number} options.color Its plumage (hex), for a bird of one colour.
 * @param {number} options.size Its birds' size (1: 3.2 across the wings).
 * @param {object} [options.look] The bird's look (above); none for a plain flock (plainBirdGeometry), which flaps without banking.
 * @param {{ value: number }} options.time The clock uniform, in seconds.
 * @param {THREE.Camera} options.lens The camera birds keep clear of.
 * @param {() => number} options.random Seeded random numbers for the birds' places.
 * @param {number} [options.roughness=0.7] Its plumage's roughness unless the look says.
 * @param {number} [options.least=0.035] The least linear luminance of its plumage.
 * @param {number} [options.lensClear=5] Wingspans a bird keeps from the lens: nearer, one bird would fill the picture.
 * @param {object} [options.calls] Now and then one bird calls: { sound(x, y, z, loudness), heard: metres within which it is heard
 *   (80), gap: [least, most] seconds between calls (4, 12) }.
 * @param {string} [options.key] Told apart from other flock materials (`customProgramCacheKey`).
 */
export function createFlock({
  count: n,
  color,
  size,
  look,
  time,
  lens,
  random,
  roughness = 0.7,
  least = 0.035,
  lensClear = 5,
  calls,
  key = look ? 'bird' : 'plain',
}) {
  const bird = !!look,
    geometry = bird ? birdGeometry(look) : plainBirdGeometry(),
    flap = bird ? new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2) : null;
  if (flap) geometry.setAttribute('aFlap', flap.setUsage(THREE.DynamicDrawUsage));
  const coloured = bird && !!look.colours,
    under = bird && !!look.under,
    material = new THREE.MeshStandardMaterial({
      color: coloured ? 0xffffff : bird ? plumage(color, least) : color,
      vertexColors: coloured,
      roughness: (bird && look.gloss) || roughness,
      side: THREE.DoubleSide,
      flatShading: true,
    });
  material.onBeforeCompile = sh => {
    sh.uniforms.uTime = time;
    if (bird) sh.uniforms.uBeat = { value: look.beat * TAU };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aW; uniform float uTime;' +
          (bird ? ' attribute vec2 aFlap; uniform float uBeat;' : '') +
          (under ? UNDER_HEAD : ''),
      )
      .replace(
        '#include <begin_vertex>',
        bird
          ? '#include <begin_vertex>' + BEAT + (under ? '\n        vUnder = aUnder;' : '')
          : `/* glsl */
#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
        #else
          float ph = 0.0;
        #endif
        transformed.y += aW * sin(uTime * 5.5 + ph) * 0.75;`,
      );
    if (under)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vUnder;')
        .replace('#include <color_fragment>', '#include <color_fragment>' + UNDER);
  };
  material.customProgramCacheKey = () => 'flock:' + key + (coloured ? ':coloured' : '') + (under ? ':under' : '');
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  mesh.frustumCulled = false;
  const birds = [];
  for (let i = 0; i < n; i++)
    birds.push({
      r: 0.55 + random() * 0.9,
      h: random() * 2 - 1,
      sp: (0.05 + random() * 0.08) * (random() < 0.5 ? 1 : -1),
      ph: random() * TAU,
      a: 0, // where it is round its circle, radians
      wob: random() * TAU,
      beat: 1, // how hard it beats now, eased towards what its climb or fall asks
    });
  return flockFlight({ mesh, birds, flap, size, lens, bird, soar: bird && look.soar, silent: !bird || look.silent, calls, lensClear });
}

const GRAVITY = 9.8, // metres a second a second
  MAX_BANK = 0.7, // radians
  BEAT_EASE = 1.5, // how quickly a bird goes from beating to gliding and back, a share a second
  BOB = 9, // metres a bird rises and falls above and below its own height in the flock, at most
  BOB_SHARE = 3, // and at most this many times the flock's height, so that a flock gathered low stays off the ground
  BOB_RATE = 0.3, // radians a second of that rise and fall
  SOAR_BEAT = 0.12; // how hard a soaring bird beats at most

function flockFlight({ mesh, birds, flap, size, lens, bird, soar, silent, calls, lensClear }) {
  const n = birds.length,
    place = placement(),
    clear = lensClear * SPAN * size, // metres
    heard = calls?.heard ?? 80,
    gap = calls?.gap ?? [4, 12];
  let last = null,
    nextCall = 0;
  place.s = size;
  // A bird nearer the lens than `clear` metres is pushed out along the line from it to that distance.
  function keepFromLens(p) {
    const at = lens.position,
      dx = p.x - at.x,
      dy = p.y - at.y,
      dz = p.z - at.z,
      distance = Math.hypot(dx, dy, dz);
    if (distance >= clear) return;
    const k = clear / Math.max(distance, 1e-3);
    p.x = at.x + dx * k;
    p.y = at.y + dy * k;
    p.z = at.z + dz * k;
  }
  // now and then one bird of a flock being drawn calls from where it flies, if the listener is near enough to hear it
  function call(t, loud) {
    if (!calls || silent || t < nextCall) return;
    nextCall = t + gap[0] + Math.random() * (gap[1] - gap[0]);
    const e = mesh.instanceMatrix.array,
      matrixOffset = Math.floor(Math.random() * n) * 16,
      x = e[matrixOffset + 12],
      y = e[matrixOffset + 13],
      z = e[matrixOffset + 14];
    if (Math.hypot(x - lens.position.x, y - lens.position.y, z - lens.position.z) > heard) return;
    calls.sound(x, y, z, loud);
  }
  return {
    mesh,
    birds,
    distantGeometry: mesh.geometry,
    // the most metres a bird flies above or below the flock's middle when update is given this height
    reach: height => height + Math.min(BOB, BOB_SHARE * height),
    // Each bird rounds the centre on a circle of its own, rising and falling slowly; t is the flock's clock in seconds. airspeed, in
    // metres a second, flies every bird at about that pace however wide the flock wheels; without it each bird keeps a turn of its
    // own, so that a wider circle is flown faster.
    update(cx, cy, cz, radius, height, t, airspeed = 0) {
      const first = last === null,
        deltaSeconds = first ? 0 : Math.min(0.1, Math.max(0, t - last)),
        bob = Math.min(BOB, BOB_SHARE * height);
      last = t;
      for (let i = 0; i < n; i++) {
        const flockMember = birds[i],
          r = radius * flockMember.r,
          dir = flockMember.sp > 0 ? 1 : -1,
          pace = 0.8 + (Math.abs(flockMember.sp) - 0.05) * 5, // 0.8 to 1.2: some birds fly a little faster than others
          turn = airspeed > 0 ? (dir * airspeed * pace) / Math.max(r, 1) : flockMember.sp * 6; // radians a second round the circle
        flockMember.a = first ? flockMember.ph + t * turn : flockMember.a + turn * deltaSeconds;
        const orbitAngle = flockMember.a,
          yaw = -orbitAngle + (dir > 0 ? 0 : Math.PI);
        place.x = cx + Math.cos(orbitAngle) * r;
        place.z = cz + Math.sin(orbitAngle) * r;
        place.y = cy + flockMember.h * height + Math.sin(t * BOB_RATE + flockMember.wob) * bob;
        place.ry = yaw;
        if (!bird) {
          place.rx = 0;
          place.rz = dir * 0.28; // banked slightly into the turn
          placeBankedAt(mesh.instanceMatrix.array, i * 16, place);
          continue;
        }
        const speed = Math.abs(turn) * r,
          climb = bob * BOB_RATE * Math.cos(t * BOB_RATE + flockMember.wob), // metres a second up
          bank = Math.min(MAX_BANK, Math.atan((speed * Math.abs(turn)) / GRAVITY)) * dir,
          pitch = Math.atan2(climb, Math.max(speed, 1));
        flockMember.beat += (sstep(-0.6, 0.2, climb) * (soar ? SOAR_BEAT : 1) - flockMember.beat) * Math.min(1, deltaSeconds * BEAT_EASE);
        keepFromLens(place);
        place.rx = -pitch;
        place.rz = bank;
        placeBankedAt(mesh.instanceMatrix.array, i * 16, place);
        flap.array[i * 2] = flockMember.ph * 3;
        flap.array[i * 2 + 1] = flockMember.beat;
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (flap) flap.needsUpdate = true;
      if (!first) call(t, Math.min(1.4, 0.6 + size * 0.5));
    },
  };
}
