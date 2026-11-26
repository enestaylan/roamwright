import * as THREE from 'three';
import { clamp, lerp, sstep } from '../math/scalar.js';

// ════════════════════════════════════════════════════════════════════════
//  A four-legged body in motion: the skeleton a hound and a horse share, and what moves it.
//  A foot is planted in the world and stays where it was put while the body passes over it; when its turn comes it is
//  lifted, carried to where it will next be needed and set down again. Each leg is then solved back from its foot to
//  its shoulder or hip, so no paw or hoof slides, on a slope, in a turn, or while the pace changes. Which foot's turn
//  it is comes from the gait: the order and timing of the four footfalls, chosen by the speed against the leg's length
//  (so a lapdog trots where a horse still walks). The body's rise and fall, its rocking and the flexing of its back
//  follow from which feet carry it.
// ════════════════════════════════════════════════════════════════════════
// Bones: 0 root, 1 hips, 2 chest, 3-4 neck, 5 head, 6 jaw, 7-8 ears (left, right), 9 lip, then four to a leg (upper, lower,
// cannon or pastern, foot) for the fore left, fore right, hind left and hind right, 26-28 the tail, 29 the crest (the tips of
// hackles or a mane).
const BONE = { root: 0, hips: 1, chest: 2, neck: 3, neck2: 4, head: 5, jaw: 6, earL: 7, earR: 8, lip: 9, tail: 26, crest: 29 },
  LEGS = [10, 14, 18, 22],
  PARENT = [-1, 0, 0, 2, 3, 4, 5, 5, 5, 5, 2, 10, 11, 12, 2, 14, 15, 16, 1, 18, 19, 20, 1, 22, 23, 24, 1, 26, 27, 2],
  GRAVITY = 9.81,
  IDLE_STEP = 0.24, // seconds a foot takes to shift while the beast stands
  IDLE_SLACK = 0.14; // how far a standing foot may be from its place, in leg lengths, before it shifts

// The angle of a limb segment in the body's upright plane: 0 hanging straight down, positive with its lower end to the rear.
const slope = (y0, z0, y1, z1) => Math.atan2(z0 - z1, y0 - y1);

// A gait at a speed: `keys` are [speed, stance travel, duty, [phase of each foot], rise, lift, flex] in order of speed (the speed
// is against the leg's length, lengths are in leg lengths); between two keys everything is blended, the phases the short way round.
function gaitAt(keys, u, out) {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] < u) i++;
  const currentKey = keys[i],
    nextKey = keys[i + 1],
    t = clamp((u - currentKey[0]) / (nextKey[0] - currentKey[0]), 0, 1);
  out.travel = lerp(currentKey[1], nextKey[1], t);
  out.duty = lerp(currentKey[2], nextKey[2], t);
  for (let k = 0; k < 4; k++) {
    let angleDelta = nextKey[3][k] - currentKey[3][k];
    angleDelta -= Math.round(angleDelta);
    out.phase[k] = currentKey[3][k] + angleDelta * t;
  }
  out.rise = lerp(currentKey[4], nextKey[4], t);
  out.lift = lerp(currentKey[5], nextKey[5], t);
  out.flex = lerp(currentKey[6], nextKey[6], t);
  return out;
}

// The skeleton and the state of one beast. joints: where each bone's joint is at rest; feet: where each foot meets the ground;
// o: its kind's gaits and the habits of its legs.
function makeRig(joints, feet, options) {
  const bones = joints.map(() => new THREE.Bone());
  for (let i = 0; i < bones.length; i++) {
    const parentIndex = PARENT[i];
    if (parentIndex < 0) bones[i].position.set(joints[i][0], joints[i][1], joints[i][2]);
    else {
      bones[i].position.set(joints[i][0] - joints[parentIndex][0], joints[i][1] - joints[parentIndex][1], joints[i][2] - joints[parentIndex][2]);
      bones[parentIndex].add(bones[i]);
    }
  }
  const legs = LEGS.map((legBone, k) => {
    const girdle = joints[k > 1 ? BONE.hips : BONE.chest],
      pts = [joints[legBone], joints[legBone + 1], joints[legBone + 2], joints[legBone + 3], feet[k]],
      len = [],
      rest = [];
    for (let i = 0; i < 4; i++) {
      len.push(Math.hypot(pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]));
      rest.push(slope(pts[i][1], pts[i][2], pts[i + 1][1], pts[i + 1][2]));
    }
    return {
      bone: legBone,
      hind: k > 1,
      habit: k > 1 ? options.hind : options.fore,
      px: joints[legBone][0],
      py: joints[legBone][1] - girdle[1], // the pivot from its girdle's joint
      pz: joints[legBone][2] - girdle[2],
      fx: feet[k][0], // the foot's own place under the body
      fz: feet[k][2],
      len,
      rest,
      line: slope(joints[legBone][1], joints[legBone][2], joints[legBone + 3][1], joints[legBone + 3][2]), // the whole leg's slope at rest
      air: 0, // 1 while the foot is being carried
      s: 0, // how far through its step
      wx: 0, // where it is planted, or was lifted from, in the world
      wz: 0,
      x: feet[k][0], // where it is now, in the body's frame
      y: 0,
      z: feet[k][2],
      stance: 0.5, // how far through its time on the ground
    };
  });
  return {
    bones,
    legs,
    o: options,
    joints,
    leg: joints[LEGS[2]][1], // the hip's height: the length everything is measured against
    span: joints[LEGS[0]][2] - joints[LEGS[2]][2], // from hip to shoulder
    ph: options.phase ?? Math.random(),
    beat: 0, // the quarter of the stride its hooves last struck in
    v: 0,
    u: 0, // its speed against its leg's length
    px: null,
    pz: 0,
    wait: 0,
    rise: [0, 0], // the fore and hind girdles' rise with the stride,
    ground: [0, 0], // and the height of the ground under each
    pitch: 0,
    y: 0,
    gait: { travel: 0.5, duty: 0.6, phase: [0, 0, 0, 0], rise: 0, lift: 0.1, flex: 0 },
  };
}

const _free = { dy: 0, dz: 0, pitch: 0, hips: 0, chest: 0, legs: null };

// Moves a beast's body and legs forward by deltaSeconds. The placement describes where it stands: { x, y, z, yaw, s: its size, ground: (x, z) => height, or null on a
// floor }. The optional pose describes its posture: { dy, dz, pitch, hips, chest } shift and turn the body (a crouch, a sit), and legs[k], where
// given, takes a foot off the ground to a place of its own: { y, z, a3, a4, w } in the body's frame (a leap, a beast lying down).
function stepRig(rig, placement, deltaSeconds, pose = _free) {
  const s = placement.s,
    sin = Math.sin(placement.yaw),
    cos = Math.cos(placement.yaw),
    h = rig.leg,
    gait = rig.gait,
    jumped = rig.px === null || Math.hypot(placement.x - rig.px, placement.z - rig.pz) > 3 * h * s, // put down somewhere else: the feet go with it
    fwd = jumped ? 0 : ((placement.x - rig.px) * sin + (placement.z - rig.pz) * cos) / s,
    gone = Math.abs(fwd),
    dir = fwd < 0 ? -1 : 1;
  rig.px = placement.x;
  rig.pz = placement.z;
  if (deltaSeconds > 0) rig.v += (gone / deltaSeconds - rig.v) * Math.min(1, deltaSeconds * 8);
  const u = (rig.v * s) / Math.sqrt(GRAVITY * h * s),
    moving = u > 0.035;
  rig.u = u;
  gaitAt(rig.o.gaits, u, gait);
  const travel = gait.travel * h,
    stride = travel / gait.duty,
    swing = 1 - gait.duty;
  if (moving) rig.ph = (rig.ph + gone / stride) % 1;
  rig.wait -= deltaSeconds;
  // which standing foot is furthest from its place, when the beast is at rest
  let worst = -1,
    worstBy = IDLE_SLACK * h,
    carried = 0;
  for (const leg of rig.legs) carried += leg.air;
  for (let k = 0; k < 4; k++) {
    const leg = rig.legs[k],
      held = pose.legs && pose.legs[k] ? pose.legs[k].w : 0;
    if (jumped || held > 0.5) {
      // not on the ground of its own accord: when it comes back it is under the body
      leg.air = 0;
      leg.wx = placement.x + (leg.fx * cos + leg.fz * sin) * s;
      leg.wz = placement.z + (-leg.fx * sin + leg.fz * cos) * s;
    }
    const lx = ((leg.wx - placement.x) * cos - (leg.wz - placement.z) * sin) / s, // the planted (or lifted-from) point in the body's frame
      lz = ((leg.wx - placement.x) * sin + (leg.wz - placement.z) * cos) / s,
      off = Math.hypot(lx - leg.fx, lz - leg.fz);
    if (moving) {
      const phi = (rig.ph + gait.phase[k] + 1) % 1;
      if (!leg.air && ((phi >= gait.duty && phi < gait.duty + 0.5 * swing) || off > 0.75 * h)) {
        leg.air = 1;
        leg.s = clamp((phi - gait.duty) / swing, 0, 0.5);
      } else if (leg.air) leg.s += gone / stride / swing;
    } else if (leg.air) leg.s += deltaSeconds / IDLE_STEP;
    else if (!carried && rig.wait <= 0 && off > worstBy) {
      worst = k;
      worstBy = off;
    }
    if (leg.air) {
      // carried from where it left the ground to where it will be wanted, both fixed in the world, so it leaves and lands still
      const left = Math.max(0, 1 - leg.s),
        tz = leg.fz + (moving ? dir * (travel / 2 + left * swing * stride) : 0),
        tx = placement.x + (leg.fx * cos + tz * sin) * s,
        tzw = placement.z + (-leg.fx * sin + tz * cos) * s;
      if (leg.s >= 1) {
        leg.air = 0;
        leg.wx = tx;
        leg.wz = tzw;
        leg.x = leg.fx;
        leg.z = tz;
        leg.lift = 0;
      } else {
        const e = leg.s * leg.s * (3 - 2 * leg.s),
          wx = lerp(leg.wx, tx, e),
          wz = lerp(leg.wz, tzw, e);
        leg.x = ((wx - placement.x) * cos - (wz - placement.z) * sin) / s;
        leg.z = ((wx - placement.x) * sin + (wz - placement.z) * cos) / s;
        leg.lift = (moving ? gait.lift : 0.07) * h * Math.sin(Math.PI * leg.s ** 0.8);
      }
    } else {
      leg.x = lx;
      leg.z = lz;
      leg.lift = 0;
    }
    const wx = placement.x + (leg.x * cos + leg.z * sin) * s,
      wz = placement.z + (-leg.x * sin + leg.z * cos) * s;
    leg.floor = placement.ground ? (placement.ground(wx, wz) - placement.y) / s : 0;
    leg.y = leg.floor + leg.lift;
    leg.stance = leg.air ? 1 : clamp(0.5 + (dir * (leg.fz - leg.z)) / Math.max(travel, 0.3 * h), 0, 1);
  }
  if (worst >= 0) {
    rig.legs[worst].air = 1;
    rig.legs[worst].s = 0;
    rig.wait = IDLE_STEP * 1.5;
  }
  // the body: each girdle sinks as its legs take the weight and rises between, over the ground its own feet stand on
  const lively = sstep(0.03, 0.2, u),
    ease = Math.min(1, deltaSeconds * 16);
  for (let g = 0; g < 2; g++) {
    const firstLegState = rig.legs[g * 2],
      pairedLegState = rig.legs[g * 2 + 1],
      load = (firstLegState.air ? 0 : Math.sin(Math.PI * firstLegState.stance)) + (pairedLegState.air ? 0 : Math.sin(Math.PI * pairedLegState.stance));
    rig.rise[g] += (gait.rise * h * lively * (1.27 * gait.duty - load) - rig.rise[g]) * ease;
    rig.ground[g] += ((firstLegState.floor + pairedLegState.floor) / 2 - rig.ground[g]) * Math.min(1, deltaSeconds * 7);
  }
  const yf = rig.rise[0] + rig.ground[0],
    yh = rig.rise[1] + rig.ground[1],
    pitch = -Math.atan2(yf - yh, rig.span) + pose.pitch,
    joints = rig.joints,
    bones = rig.bones,
    rootY = joints[0][1] + (yf + yh) / 2 + pose.dy - rig.o.crouch * h * sstep(0.5, 1.8, u), // lower at speed, to reach further
    rootZ = joints[0][2] + pose.dz,
    reachOf = g => (rig.legs[g * 2].z - rig.legs[g * 2].fz + rig.legs[g * 2 + 1].z - rig.legs[g * 2 + 1].fz) / (2 * h),
    chest = -gait.flex * reachOf(0) + pose.chest,
    hips = -gait.flex * reachOf(1) + pose.hips;
  rig.pitch = pitch;
  rig.y = rootY - joints[0][1];
  bones[0].position.set(0, rootY, rootZ);
  bones[0].rotation.x = pitch;
  bones[BONE.chest].rotation.x = chest;
  bones[BONE.hips].rotation.x = hips;
  for (let k = 0; k < 4; k++) {
    const leg = rig.legs[k],
      g = leg.hind ? BONE.hips : BONE.chest,
      turn = pitch + (leg.hind ? hips : chest),
      // the girdle's joint, then the leg's pivot, turned with the body
      gy = joints[g][1] - joints[0][1],
      gz = joints[g][2] - joints[0][2],
      jy = rootY + gy * Math.cos(pitch) - gz * Math.sin(pitch),
      jz = rootZ + gy * Math.sin(pitch) + gz * Math.cos(pitch),
      glide = leg.habit.glide * (leg.z - leg.fz), // a shoulder blade slides on the ribs with its leg's reach
      py = jy + leg.py * Math.cos(turn) - (leg.pz + glide) * Math.sin(turn),
      pz = jz + leg.py * Math.sin(turn) + (leg.pz + glide) * Math.cos(turn),
      held = pose.legs && pose.legs[k] ? pose.legs[k] : null;
    bones[leg.bone].position.z = leg.pz + glide;
    solveLeg(bones, leg, py, pz, turn, held, clamp(gait.lift / 0.15, 0.5, 1.5));
  }
}

const _qa = new THREE.Quaternion(),
  _qb = new THREE.Quaternion(),
  X_AXIS = new THREE.Vector3(1, 0, 0),
  Z_AXIS = new THREE.Vector3(0, 0, 1);

// One leg, from the foot up: the foot's own tilt puts its upper joint, the cannon's slope the joint above, and the two long bones
// close the gap to the pivot, the elbow bending back and the stifle forward. The leg works in a plane through its pivot, tipped
// sideways to pass through the foot. eager: how high the gait carries its feet.
function solveLeg(bones, leg, py, pz, turn, held, eager) {
  const habit = leg.habit,
    [l1, l2, l3, l4] = leg.len,
    st = leg.stance,
    off = leg.air ? 0 : sstep(0.72, 1, st), // the heel coming off the ground at the end of its time there
    fold = leg.air ? Math.sin(Math.PI * leg.s) * eager : 0, // a leg folds more the higher the gait carries it
    carry = leg.air ? (1 - leg.s) * (1 - leg.s) : 0,
    load = leg.air ? 0 : Math.sin(Math.PI * st),
    hold = held ? held.w : 0,
    fz = hold ? lerp(leg.z, held.z, hold) : leg.z,
    footY = hold ? lerp(leg.y, held.y, hold) : leg.y,
    side = leg.x - leg.px,
    tip = Math.atan2(side, Math.max(0.05, py - footY)), // the plane's lean to the side
    fy = py - Math.hypot(py - footY, side) * Math.sign(py - footY || 1); // the foot's depth below the pivot, in that plane
  let a4 = leg.rest[3] + habit.heel4 * (off + carry) + habit.fold4 * fold - habit.sink * load;
  if (hold) a4 = lerp(a4, leg.rest[3] + held.a4, hold);
  const ty = fy + l4 * Math.cos(a4),
    tz = fz + l4 * Math.sin(a4);
  if (leg.hind && habit.paired && !hold) return pairedLeg(bones, leg, py, pz, ty, tz, a4, turn, tip, fold, off + carry);
  let a3 = leg.rest[2] + habit.follow * (slope(py, pz, ty, tz) - leg.line) + habit.heel3 * (off + carry) + habit.fold3 * fold;
  if (hold) a3 = lerp(a3, leg.rest[2] + held.a3, hold);
  const wy = ty + l3 * Math.cos(a3),
    wz = tz + l3 * Math.sin(a3),
    d = clamp(Math.hypot(wy - py, wz - pz), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4),
    bend = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)),
    a1 = slope(py, pz, wy, wz) + (leg.hind ? -bend : bend),
    a2 = slope(py - l1 * Math.cos(a1), pz - l1 * Math.sin(a1), wy, wz);
  setLeg(bones, leg, turn, tip, a1, a2, a3, a4);
}

// A horse's hind leg (habit.paired): its stifle and hock are tied by tendons (the reciprocal apparatus), so they bend and
// straighten together and the cannon stays about parallel to the thigh. The thigh and cannon then turn about the hip as one
// pair, and the gaskin closes the gap from the stifle down and back to the hock: the hock never rides forward under the belly.
// The thigh swings no further forward than habit.thigh past its rest, so the stifle stays under the hip.
// (ty, tz): the fetlock, which the hoof's tilt a4 put; in the air the cannon folds a little more under the thigh (fold3), and it
// opens with the heel as the hoof leaves the ground (heel3), the hock straightening to push off.
function pairedLeg(bones, leg, py, pz, ty, tz, a4, turn, tip, fold, heel) {
  const [l1, l2, l3] = leg.len,
    pair = leg.rest[2] - leg.rest[0] + leg.habit.fold3 * fold + leg.habit.heel3 * heel, // the cannon's angle from the thigh
    ry = l1 + l3 * Math.cos(pair), // the pair as one arm from the hip, as if the thigh hung straight down
    rz = l3 * Math.sin(pair),
    r = Math.hypot(ry, rz),
    d = Math.max(eased(Math.hypot(py - ty, pz - tz), r + l2), Math.abs(r - l2) + 1e-4),
    open = Math.acos(clamp((r * r + d * d - l2 * l2) / (2 * r * d), -1, 1)),
    a1 = Math.max(slope(py, pz, ty, tz) - Math.atan2(rz, ry) - open, leg.rest[0] - leg.habit.thigh),
    sy = py - l1 * Math.cos(a1), // the stifle
    sz = pz - l1 * Math.sin(a1),
    // the gaskin and cannon close the gap from the stifle, the hock behind: as the pair would, unless the thigh was held back,
    // and then the hock folds the more
    reach = Math.max(eased(Math.hypot(sy - ty, sz - tz), l2 + l3), Math.abs(l2 - l3) + 1e-4),
    a2 = slope(sy, sz, ty, tz) + Math.acos(clamp((l2 * l2 + reach * reach - l3 * l3) / (2 * l2 * reach), -1, 1)),
    a3 = slope(sy - l2 * Math.cos(a2), sz - l2 * Math.sin(a2), ty, tz);
  setLeg(bones, leg, turn, tip, a1, a2, a3, a4);
}

// A reach d eased as it nears the most a chain can stretch: near straight, a little more reach turns its joints a long way, and
// a leg pushing off or landing would snap; past EASE of the most it comes in ever slower, and never quite gets there.
const EASE = 0.92;
function eased(d, most) {
  const over = d / most - EASE;
  return over <= 0 ? d : most * (EASE + (1 - EASE) * (1 - Math.exp(-over / (1 - EASE))));
}

// Turns a leg's bones to the slopes found for them.
function setLeg(bones, leg, turn, tip, a1, a2, a3, a4) {
  const firstBoneIndex = leg.bone,
    d1 = a1 - leg.rest[0],
    d2 = a2 - leg.rest[1],
    d3 = a3 - leg.rest[2];
  // the upper bone: out of its girdle's turn, into the leaning plane, then its own swing
  bones[firstBoneIndex].quaternion.setFromAxisAngle(X_AXIS, -turn).multiply(_qa.setFromAxisAngle(Z_AXIS, tip)).multiply(_qb.setFromAxisAngle(X_AXIS, d1));
  bones[firstBoneIndex + 1].rotation.x = d2 - d1;
  bones[firstBoneIndex + 2].rotation.x = d3 - d2;
  bones[firstBoneIndex + 3].rotation.x = a4 - leg.rest[3] - d3;
}

export { BONE, LEGS, makeRig, stepRig };
