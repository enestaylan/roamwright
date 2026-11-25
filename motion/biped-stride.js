import { TAU, clamp, lerp, sstep } from '../math/scalar.js';

/** Create one stride solver for a rig, ground sampler and motion profile. */
export function createBipedStride({ rig, foot, pace, ground }) {
  const reach = rig.thigh + rig.shin - 0.0005;
  const _leg = [0, 0],
    _ankle = [0, 0];
  // What the legs do this frame, filled by stride(): thigh and knee angles, how far the figure's origin rides above the ground,
  // the measure of the stride the arms and trunk swing to, the hips' own turn (to the right is less) and list (the left side
  // down is more), each sole's pitch against the trunk the legs are solved in (toes down is more), how far its toes bend up to
  // stay on the ground, and the roll both soles take on ground that falls away to one side.
  const step = {
    thighL: 0,
    kneeL: 0,
    thighR: 0,
    kneeR: 0,
    rise: 0,
    swing: 0,
    arms: 0,
    go: 0,
    run: 0,
    bearing: 0,
    lean: 0,
    turn: 0,
    list: 0,
    soleL: 0,
    soleR: 0,
    toesL: 0,
    toesR: 0,
    roll: 0,
  };

  // Two-bone leg from hip to ankle in the fore-and-aft plane: for an ankle at (forward, up) from the hip, the thigh's and the
  // knee's rotation, written into _leg.
  function solveLeg(forward, up) {
    const D = clamp(Math.sqrt(forward * forward + up * up), 0.3, rig.thigh + rig.shin - 1e-4),
      bend = Math.acos(clamp((D * D - rig.thigh * rig.thigh - rig.shin * rig.shin) / (2 * rig.thigh * rig.shin), -1, 1));
    _leg[0] = -(Math.atan2(forward, -up) + Math.atan2(rig.shin * Math.sin(bend), rig.thigh + rig.shin * Math.cos(bend)));
    _leg[1] = bend;
  }
  // The pitch of a foot's sole (toes down is more) at share u of its stride: it lands on its heel with the toes up by `strike`,
  // lies flat while the body passes over it, rolls up onto its toes until the heel has risen by `push`, and in the air comes
  // round from toes down to toes up. A step backwards (`back`) does it the other way round.
  function soleAt(u, duty, back, strike, push) {
    const planted = u < duty;
    let s = planted ? u / duty : (u - duty) / (1 - duty);
    if (back) s = 1 - s;
    return planted ? push * sstep(foot.riseAt, 1, s) - strike * sstep(foot.flatAt, 0, s) : lerp(push, -strike, sstep(0.08, 0.8, s));
  }
  // Where a foot's ankle is from the point of its sole under the ankle when it lies flat, written into _ankle (forward, up), for a
  // sole pitched by `pitch` (about the ball of the foot with the heel up, about the heel with the toes up) on ground that itself
  // pitches by `slope` (both radians, toes down is more).
  function ankleAt(pitch, slope) {
    const c = Math.cos(pitch),
      s = Math.sin(pitch),
      forward = pitch >= 0 ? rig.ballOffset - rig.ballOffset * c + rig.ankleHeight * s : -rig.heelOffset + rig.heelOffset * c + rig.ankleHeight * s,
      up = pitch >= 0 ? rig.ballOffset * s + rig.ankleHeight * c : -rig.heelOffset * s + rig.ankleHeight * c;
    if (slope) {
      const cs = Math.cos(slope),
        ss = Math.sin(slope);
      _ankle[0] = forward * cs + up * ss;
      _ankle[1] = up * cs - forward * ss;
    } else {
      _ankle[0] = forward;
      _ankle[1] = up;
    }
  }
  // One foot (0 the left, 1 the right) at share u of its stride, kept in a.feet as how far forward of the middle it is and how
  // high. Striding, a foot on the ground stays where it was set down, so it is carried back as the body goes forward, and a foot
  // in the air swings from where it left the ground to where it will land; `drift` makes it leave and meet the ground moving as
  // the ground does. Standing, a foot that is not where the pose wants it steps there (`mayStep`: one foot at a time).
  function footAt(a, i, u, duty, landing, drift, lift, gone, striding, stance, mayStep, dt) {
    const F = a.feet;
    let air = 0;
    if (striding) {
      const back = gone < 0;
      if (u < duty) {
        F[i] -= gone;
        F[i + 2] = F[i];
      } else {
        const s = back ? 1 - (u - duty) / (1 - duty) : (u - duty) / (1 - duty),
          s2 = s * s,
          s3 = s2 * s;
        F[i] = F[i + 2] + (landing - F[i + 2]) * (3 * s2 - 2 * s3) + drift * (2 * s3 - 3 * s2 + s);
        air = lift * Math.sin(Math.PI * Math.pow(s, 0.8));
      }
    } else {
      const off = stance - F[i];
      if (mayStep) F[i] += clamp(off, -foot.settleSpeed * dt, foot.settleSpeed * dt);
      air = mayStep ? Math.min(foot.settleLift, Math.abs(off) * 0.45) : 0;
      F[i + 2] = F[i];
    }
    F[i + 4] += (air - F[i + 4]) * Math.min(1, dt * 22);
  }
  const fraction = x => ((x % 1) + 1) % 1;
  const GROUND_KEPT = 0.04, // metres a foot's spot may move before the ground under it is looked up again
    GROUND_FRESH = 30; // and lookups it is kept for at most, so that a floor raised under someone standing still is found
  // The ground at (x, z) under foot k (0 left, 1 right; 2 and 3 under their toes) of actor a, looked up again only once the foot
  // has moved (or now and then): a planted or standing foot keeps its height, and no number is made for the garbage each frame
  // (a.footGround: x, z, y and the lookups since, a spot).
  function groundUnder(a, k, x, z) {
    const g = a.footGround || (a.footGround = new Float64Array(16).fill(NaN)),
      i = k * 4;
    if (!(Math.abs(x - g[i]) <= GROUND_KEPT && Math.abs(z - g[i + 1]) <= GROUND_KEPT && g[i + 3] < GROUND_FRESH)) {
      g[i] = x;
      g[i + 1] = z;
      g[i + 2] = ground(x, z);
      g[i + 3] = 0;
    }
    g[i + 3]++;
    return g[i + 2];
  }
  // A step's length on a stair: one tread, as far as actor a is on one (kept with the feet: how far on a stair, its tread in
  // metres, and the seconds since an edge of it was seen); `len` otherwise, the walk's own, which a stair's is never longer than.
  function treadStep(a, len, h) {
    const F = a.feet;
    return F && F[13] > 0.01 ? lerp(len, Math.min(len, F[14] / h), F[13]) : len;
  }
  // Notes a step's edge of `riser` metres seen under a foot: on a climb or a descent it is a stair's, whose tread is the riser
  // over the slope walked.
  function stairSeen(a, riser) {
    const steep = Math.abs(a.slope),
      F = a.feet;
    if (steep < foot.stairSlope) return;
    F[14] += (clamp(riser / steep, foot.treadRange[0], foot.treadRange[1]) - F[14]) * 0.25;
    F[15] = foot.stairMemory;
  }
  // The legs of someone on their feet this frame, written into `step`. lean: the trunk's lean forward; sink: how far the pose
  // lowers the hips; hipZ: how far it shifts them forward; stanceL, stanceR: where the pose plants each foot, forward of the
  // middle; free: standing on open ground (the ground under each foot is then looked up, and a.y set between them); list: how
  // far the hips list as their owner stands with the weight on one leg (the left side down is more).
  function stride(a, dt, h, lean, sink, hipZ, stanceL, stanceR, free, list, strideScale = 1, liftScale = 1, hipScale = 1) {
    const v = a.fwd / h,
      speed = Math.abs(v),
      go = sstep(0.06, 0.5, speed), // how much of a stride the legs take
      run = sstep(pace.runFrom, pace.runFull, speed),
      shuffle = Math.max(go, 0.45 * Math.max(sstep(0.15, 0.7, a.side / h), sstep(0.6, 2.4, Math.abs(a.spin)))), // feet also lift to turn and to step aside
      striding = shuffle > 0.02,
      len = treadStep(
        a,
        Math.min(pace.maxStep, pace.baseStep + pace.stepGain * speed) * strideScale * (1 - 0.35 * Math.min(1, Math.abs(a.slope) * 2.2)),
        h,
      ),
      duty = lerp(pace.walkDuty, pace.runDuty, run),
      sweep = 2 * len * duty * go,
      lift = (lerp(pace.walkLift, pace.runLift, run) * liftScale + Math.max(0, a.slope) * len * 0.45) * shuffle,
      tip = run * go * pace.runLean + go * clamp(a.slope * 0.2, -0.06, 0.12); // a runner leans into the run, a climber into the hill
    // each foot: where it is forward of the middle, where it left the ground, how high it is, its sole's pitch in the stride
    // and the pitch of the ground it stands on; then the roll of both, and the ground each foot goes by (metres)
    // then how far they are on a stair, its tread, and the seconds a stair is still underfoot
    if (!a.feet) a.feet = [stanceL, stanceR, stanceL, stanceR, 0, 0, 0, 0, 0, 0, 0, NaN, NaN, 0, 0.3, 0];
    if (striding && !a.striding) a.phase = TAU * (duty - 0.5 + 0.02 + (a.seed > 0.5 ? 0.5 : 0)); // setting off: one foot has just taken the weight, the other leaves the ground
    a.striding = striding;
    a.phase += striding
      ? (Math.PI * dt * (v + (1 - go) * (a.side / h) * 1.4)) / len + (1 - go) * Math.abs(a.spin) * dt * 1.6
      : dt * pace.idleRate;
    lean += tip;
    const uL = fraction(a.phase / TAU),
      uR = fraction(uL + 0.5),
      sinL = Math.sin(lean),
      cosL = Math.cos(lean),
      hipAt = rig.hipHeight * sinL + hipZ, // the hips forward of the point between the feet; a stride is taken under them
      landing = hipAt * go + (v < 0 ? -sweep : sweep) / 2,
      drift = ((v < 0 ? sweep : -sweep) * (1 - duty)) / duty,
      gone = (a.fwd * dt) / h,
      F = a.feet,
      leftFirst = Math.abs(stanceL - F[0]) >= Math.abs(stanceR - F[1]); // of two feet out of place, the one further out steps first
    footAt(a, 0, uL, duty, landing, drift, lift, gone, striding, stanceL, leftFirst || Math.abs(stanceR - F[1]) < 0.03, dt);
    footAt(a, 1, uR, duty, landing, drift, lift, gone, striding, stanceR, !leftFirst || Math.abs(stanceL - F[0]) < 0.03, dt);
    // the hips turn with the leg that leads and drop on the side of the one in the air, which carries each leg's joint forward
    // or back and up or down: the legs are solved from where their joints then are, so the feet stay where they are planted
    const turn = Math.cos(TAU * uL) * go * lerp(pace.hipTurn[0], pace.hipTurn[1], run) * hipScale,
      listed = list - Math.cos(TAU * (uL - duty / 2)) * go * pace.hipDrop * hipScale,
      jointZ = a.lx * Math.sin(turn), // the left leg's joint forward of the hips' middle, and the right one's behind it
      jointY = a.lx * Math.sin(listed), // the right leg's joint above the hips' middle, and the left one's below it
      zL = F[0],
      zR = F[1],
      airL = F[4],
      airR = F[5],
      soleEase = Math.min(1, dt * foot.response),
      roll = go * (v < 0 ? foot.reverseRoll : 1),
      strike = roll * lerp(foot.heelStrike[0], foot.heelStrike[1], run),
      push = roll * lerp(foot.pushOff[0], foot.pushOff[1], run);
    // each sole rolls from heel to toe through its stride
    F[6] += ((striding ? soleAt(uL, duty, v < 0, strike, push) : 0) - F[6]) * soleEase;
    F[7] += ((striding ? soleAt(uR, duty, v < 0, strike, push) : 0) - F[7]) * soleEase;
    let groundL = 0,
      groundR = 0,
      over = 0,
      slopeL = 0,
      slopeR = 0,
      across = 0;
    if (free) {
      const cy = Math.cos(a.yaw),
        sy = Math.sin(a.yaw),
        wide = a.lx * h,
        ahead = foot.sampleAhead * h,
        xL = a.x - cy * wide + sy * zL * h,
        xR = a.x + cy * wide + sy * zR * h,
        atL = a.z + sy * wide + cy * zL * h,
        atR = a.z - sy * wide + cy * zR * h,
        gL = groundUnder(a, 0, xL, atL),
        gR = groundUnder(a, 1, xR, atR);
      // the ground each foot goes by follows what is under it: at once under a foot that stands, over a moment under one in the
      // air, so that a step's edge crossed in mid-stride (a stair, a kerb) carries the foot and the hips up to it instead of
      // jerking them there, and the foot is lifted higher to clear it
      if (!(Math.abs(gL - F[11]) < foot.snapHeight)) F[11] = gL;
      if (!(Math.abs(gR - F[12]) < foot.snapHeight)) F[12] = gR;
      F[11] += (gL - F[11]) * Math.min(1, dt * foot.groundResponse[airL < 0.004 ? 0 : 1]);
      F[12] += (gR - F[12]) * Math.min(1, dt * foot.groundResponse[airR < 0.004 ? 0 : 1]);
      a.y = (F[11] + F[12]) / 2;
      groundL = clamp((F[11] - a.y) / h, -0.3, 0.3);
      groundR = -groundL;
      over = lift > 0.01 ? Math.min(foot.stepClearance[1], (Math.abs(gL - gR) / h) * foot.stepClearance[0]) / lift : 0;
      // a planted sole lies along the ground under it: the slope from the ankle's line to the toes, unless that is a step's
      // edge; a foot in the air keeps the slope it left
      slopeL = F[8];
      slopeR = F[9];
      if (airL < 0.01) {
        const grade = (groundUnder(a, 2, xL + sy * ahead, atL + cy * ahead) - gL) / ahead;
        slopeL = Math.abs(grade) < foot.edgeSlope ? -Math.atan(grade) : 0;
        if (!slopeL && grade) stairSeen(a, Math.abs(grade) * ahead);
      }
      if (airR < 0.01) {
        const grade = (groundUnder(a, 3, xR + sy * ahead, atR + cy * ahead) - gR) / ahead;
        slopeR = Math.abs(grade) < foot.edgeSlope ? -Math.atan(grade) : 0;
        if (!slopeR && grade) stairSeen(a, Math.abs(grade) * ahead);
      }
      across = Math.abs(gR - gL) < foot.edgeSlope * 2 * wide ? Math.atan((gR - gL) / (2 * wide)) : 0;
    }
    F[15] = Math.max(0, F[15] - dt);
    F[13] += ((F[15] > 0 && striding ? 1 : 0) - F[13]) * Math.min(1, dt * foot.stairResponse);
    F[8] += (clamp(slopeL, -foot.maxSlopeAngle, foot.maxSlopeAngle) - F[8]) * soleEase;
    F[9] += (clamp(slopeR, -foot.maxSlopeAngle, foot.maxSlopeAngle) - F[9]) * soleEase;
    F[10] += (clamp(across, -foot.maxSlopeAngle, foot.maxSlopeAngle) - F[10]) * soleEase;
    // where each ankle then is: forward of the middle, and above the ground
    ankleAt(F[6], F[8]);
    const ankleZL = zL + _ankle[0],
      ankleYL = groundL + airL * (1 + over) + _ankle[1];
    ankleAt(F[7], F[9]);
    const ankleZR = zR + _ankle[0],
      ankleYR = groundR + airR * (1 + over) + _ankle[1];
    // the hips ride as high as the pose asks and the planted legs allow
    let hip = rig.hipHeight * cosL + sink + run * go * (pace.runDip - pace.runBob * Math.cos(2 * TAU * (uL - duty / 2)));
    if (airL < 0.004) hip = Math.min(hip, ankleYL + jointY + Math.sqrt(Math.max(0.05, reach * reach - (ankleZL - hipAt - jointZ) ** 2)));
    if (airR < 0.004) hip = Math.min(hip, ankleYR - jointY + Math.sqrt(Math.max(0.05, reach * reach - (ankleZR - hipAt + jointZ) ** 2)));
    a.hip = Number.isNaN(a.hip) ? hip : a.hip + (hip - a.hip) * Math.min(1, dt * pace.hipResponse);
    // each leg from the hip to its ankle, in the leaning trunk's own frame
    let z = ankleZL - hipAt - jointZ,
      y = ankleYL - a.hip + jointY;
    solveLeg(z * cosL - y * sinL, y * cosL + z * sinL);
    step.thighL = _leg[0];
    step.kneeL = _leg[1];
    z = ankleZR - hipAt + jointZ;
    y = ankleYR - a.hip - jointY;
    solveLeg(z * cosL - y * sinL, y * cosL + z * sinL);
    step.thighR = _leg[0];
    step.kneeR = _leg[1];
    step.soleL = F[6] + F[8] - lean; // against the leaning trunk the legs are solved in
    step.soleR = F[7] + F[9] - lean;
    step.toesL = -Math.max(0, F[6]) * sstep(foot.toeReleaseHeight, 0, airL); // the toes stay on the ground while the heel rises
    step.toesR = -Math.max(0, F[7]) * sstep(foot.toeReleaseHeight, 0, airR);
    step.roll = F[10];
    step.rise = a.hip - rig.hipHeight * cosL;
    step.swing = Math.cos(TAU * uL) * go; // 1 as the left foot lands ahead, -1 as the right does
    step.arms = Math.cos(TAU * (uL - pace.armLag)) * go; // the arms' swing against it: 1 with the left arm furthest back
    step.bearing = Math.cos(TAU * (uL - duty / 2)) * go * (1 - run); // 1 with the weight over the left foot, -1 over the right
    step.go = go;
    step.run = run * go;
    step.lean = tip;
    step.turn = turn;
    step.list = listed;
    return step;
  }
  return stride;
}
