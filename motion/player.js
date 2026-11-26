/**
 * First-person walking and flight over terrain, water and raised surfaces.
 * @module
 */

import { clamp } from '../math/scalar.js';

/**
 * A first-person controller for a createSpaces registry. Distances are metres,
 * speeds are metres per second, angles are radians, and update takes seconds.
 * Set input.right, forward and up to signed axes, and run, jump and fly to booleans.
 * After updating, call `applyCamera(camera)` to copy the eye position and view
 * angles to a Three.js camera with YXZ rotation order.
 * @param spatial - Registry returned by `createSpaces`.
 * @param options - Movement, collision and camera settings, with optional initial player state in `start`.
 */
export function createPlayer(spatial, options = {}) {
  const {
    eye = 1.7,
    radius = 0.35,
    gravity = 9.81,
    jumpSpeed = 4,
    pitchLimit = Math.PI / 2,
    walk = 2,
    run = 4,
    fly = 10,
    flyFast = 20,
    flySet = fly,
    flySetFast = flyFast,
    flightMargin = 0,
    flightCeiling = Infinity,
    flightHeadroom = 50,
    flightBoost = 2,
    flyEase = 6,
    walkEase = 10,
    arrivalHeight = 0,
    liftSpeed = 4,
    liftRange = 1,
    obstacleScan = 2,
    overheadStep = 0.4,
    wadingDepth = 0.5,
    stepHeight = 0.3,
    stepProbe = 0.6,
    stepSlope = 1,
    maxStep = 0.5,
    slopeProbe = 0.8,
    maxSlope = 1,
    flightFloorProbe = 0.1,
    dropHeight = 0.4,
    groundEase = 15,
    bobStart = 0.3,
    bobRate = 1,
    bobAmplitude = 0,
    restingPitch = 0,
    start = {},
  } = options;
  const player = { x: 0, y: eye, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: restingPitch, grounded: true, bob: 0, moved: 0, ...start };
  const input = { right: 0, forward: 0, up: 0, run: false, jump: false, fly: false };
  const { collide, hit, overhead } = spatial;

  function canStand(space, nx, nz, dirx, dirz) {
    const feet = player.y - eye,
      ceiling = feet + obstacleScan;
    const rock = overhead.ground(nx, nz, ceiling),
      g = Math.max(space.ground(nx, nz), rock);
    if ((g === rock && g - feet > overheadStep) || overhead.wall(player.x, player.z, nx, nz, feet)) return false;
    if (space.water && g < space.waterLevel - wadingDepth) return false;
    if (g - feet > stepHeight) {
      const x2 = nx + dirx * stepProbe,
        z2 = nz + dirz * stepProbe;
      const g2 = Math.max(space.ground(x2, z2), overhead.ground(x2, z2, ceiling));
      return (g2 - feet) / stepProbe <= stepSlope && g - feet <= maxStep;
    }
    const x2 = nx + dirx * slopeProbe,
      z2 = nz + dirz * slopeProbe;
    const g2 = Math.max(space.ground(x2, z2), overhead.ground(x2, z2, ceiling));
    return (g2 - g) / slopeProbe <= maxSlope;
  }

  function keepWithin(space) {
    if (space.round) {
      const rx = player.x - space.cx,
        rz = player.z - space.cz,
        r = Math.hypot(rx, rz);
      if (r > space.bound) {
        player.x = space.cx + (rx / r) * space.bound;
        player.z = space.cz + (rz / r) * space.bound;
      }
    } else {
      const bx = space.bx ?? space.bound,
        bz = space.bz ?? space.bound;
      player.x = clamp(player.x, space.cx - bx, space.cx + bx);
      player.z = clamp(player.z, space.cz - bz, space.cz + bz);
    }
  }

  function flyStep(space, dt, mx, mz, sinYaw, cosYaw) {
    const flight = space.flight;
    let speed = input.run ? flySetFast : flySet;
    if (space.flyable) speed = input.run ? flyFast : fly;
    else if (flight?.speed !== undefined) speed = input.run ? flight.speed * flightBoost : flight.speed;

    const cosPitch = Math.cos(player.pitch),
      sinPitch = Math.sin(player.pitch);
    const wantX = (-sinYaw * cosPitch * mz + cosYaw * mx) * speed,
      wantZ = (-cosYaw * cosPitch * mz - sinYaw * mx) * speed,
      wantY = (sinPitch * mz + input.up) * speed;
    const ease = 1 - Math.exp(-dt * flyEase);
    player.vx += (wantX - player.vx) * ease;
    player.vy += (wantY - player.vy) * ease;
    player.vz += (wantZ - player.vz) * ease;
    const previousFeet = player.y - eye;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.z += player.vz * dt;
    const cx = flight?.cx ?? space.cx,
      cz = flight?.cz ?? space.cz;
    const bx = flight?.bx ?? (space.bx ?? space.bound) + flightMargin,
      bz = flight?.bz ?? (space.bz ?? space.bound) + flightMargin;
    player.x = clamp(player.x, cx - bx, cx + bx);
    player.z = clamp(player.z, cz - bz, cz + bz);
    const outside = overhead.keepOut(player.x, player.y, player.z);
    if (outside) {
      player.x = outside[0];
      player.z = outside[1];
    }
    const under = flight?.ground ? flight.ground(player.x, player.z) : space.ground(player.x, player.z);
    const floor =
      Math.max(under, space.water ? space.waterLevel : -Infinity, overhead.ground(player.x, player.z, previousFeet + flightFloorProbe)) +
      eye;
    if (player.y < floor) {
      player.y = floor;
      player.vy = 0;
    }
    let ceiling = space.flyable
      ? Math.max(flightCeiling, floor + flightHeadroom)
      : Math.max(floor, flight?.ceiling ?? floor + flightHeadroom);
    if (space.flightRoom !== undefined) {
      ceiling = Math.max(floor, floor - eye + space.ceiling(player.x, player.z) - space.flightRoom);
      if (collide(player.x, player.z, radius)) {
        player.x = hit.x;
        player.z = hit.z;
      }
    }
    if (player.y > ceiling) player.y = ceiling;
    player.grounded = false;
  }

  function walkStep(space, dt, mx, mz, sinYaw, cosYaw) {
    const speed = input.run ? run : walk;
    const wantX = (-sinYaw * mz + cosYaw * mx) * speed,
      wantZ = (-cosYaw * mz - sinYaw * mx) * speed;
    const ease = 1 - Math.exp(-dt * walkEase);
    player.vx += (wantX - player.vx) * ease;
    player.vz += (wantZ - player.vz) * ease;
    const stepx = player.vx * dt,
      stepz = player.vz * dt,
      stepLength = Math.hypot(stepx, stepz);
    if (stepLength > 1e-5) {
      let nx = player.x + stepx,
        nz = player.z + stepz;
      if (collide(nx, nz, radius)) {
        nx = hit.x;
        nz = hit.z;
      }
      if (canStand(space, nx, nz, stepx / stepLength, stepz / stepLength)) {
        player.x = nx;
        player.z = nz;
      } else if (Math.abs(stepx) > 1e-5 && canStand(space, nx, player.z, Math.sign(stepx), 0)) {
        player.x = nx;
        player.vz *= 0.5;
      } else if (Math.abs(stepz) > 1e-5 && canStand(space, player.x, nz, 0, Math.sign(stepz))) {
        player.z = nz;
        player.vx *= 0.5;
      } else {
        player.vx = player.vz = 0;
      }
    }
    // A flight envelope can extend past the walking surface. On landing,
    // restore its bounds even if the player has no horizontal velocity.
    if (stepLength > 1e-5 || space.flight) keepWithin(space);
    const eyes = Math.max(space.ground(player.x, player.z), overhead.ground(player.x, player.z, player.y - eye + overheadStep)) + eye;
    if (player.grounded) {
      if (input.jump) {
        player.vy = jumpSpeed;
        player.grounded = false;
      } else if (player.y - eyes > dropHeight) {
        player.grounded = false;
        player.vy = 0;
      } else player.y += (eyes - player.y) * Math.min(1, dt * groundEase);
    }
    if (!player.grounded) {
      player.vy -= gravity * dt;
      player.y += player.vy * dt;
      if (player.y <= eyes) {
        player.y = eyes;
        player.vy = 0;
        player.grounded = true;
      }
    }
    const pace = Math.hypot(player.vx, player.vz);
    player.moved += pace * dt;
    if (player.grounded && pace > bobStart) player.bob += dt * pace * bobRate;
  }

  function update(dt) {
    let mx = input.right,
      mz = input.forward;
    const magnitude = Math.hypot(mx, mz);
    if (magnitude > 1) {
      mx /= magnitude;
      mz /= magnitude;
    }
    const sinYaw = Math.sin(player.yaw),
      cosYaw = Math.cos(player.yaw);
    if (input.fly) flyStep(spatial.space, dt, mx, mz, sinYaw, cosYaw);
    else walkStep(spatial.space, dt, mx, mz, sinYaw, cosYaw);
    player.pitch = clamp(player.pitch, -pitchLimit, pitchLimit);
  }

  function place(x, z, yaw) {
    const space = spatial.space;
    player.x = x;
    player.z = z;
    player.vx = player.vy = player.vz = 0;
    const ground = space.ground(x, z),
      floor = input.fly && space.water ? Math.max(ground, space.waterLevel) : ground;
    player.y = floor + eye + (input.fly ? arrivalHeight : 0);
    player.grounded = !input.fly;
    if (yaw !== undefined) {
      player.yaw = yaw;
      player.pitch = restingPitch;
    }
  }
  function applyCamera(camera) {
    const pace = Math.hypot(player.vx, player.vz);
    const bob = !input.fly && player.grounded ? Math.sin(player.bob) * bobAmplitude * Math.min(1, pace / walk) : 0;
    camera.position.set(player.x, player.y + bob, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }
  function look(dx, dy, sensitivity) {
    player.yaw -= dx * sensitivity;
    player.pitch = clamp(player.pitch - dy * sensitivity, -pitchLimit, pitchLimit);
  }
  function liftOff() {
    const space = spatial.space,
      feet = player.y - eye;
    const floor = Math.max(
      space.ground(player.x, player.z),
      space.water ? space.waterLevel : -Infinity,
      overhead.ground(player.x, player.z, feet + overheadStep),
    );
    if (feet < floor + liftRange) player.vy = liftSpeed;
  }
  return { player, input, update, place, applyCamera, look, liftOff };
}
