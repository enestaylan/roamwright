import { wrapRadians } from '../math/periodic.js';
import { sstep } from '../math/scalar.js';

/**
 * Where a crowd's people are, from routines laid out once: legs walked on a loop of the clock, a circle, or a way walked to and
 * fro; and those routines fitted to the colliders of their space as the walls they stand among are built. A person is a plain
 * record their crowd keeps; no frame allocates.
 *
 * Routine fields on a walker:
 * - `legs`: [{ t0, tw, x0, z0, dx, dz, dir, len, travel, start, stop, hide, yaw, role, rest }], walked over `T` seconds from
 *   phase `ph` at `walkSpeed`, each eased in where it `start`s and out where it `stop`s; a leg that `hide`s ends indoors.
 * - `speed`: moved by a keeper of its own, which sets `speed`, `travel` and `sway` (a turn off the line) each frame.
 * - `r`, `w`: a circle of radius r about (ax, az) at w radians a second.
 * - `sp`, `len`, `dx`, `dz`, `pathYaw`: a way of len metres from (ax, az) along (dx, dz), walked to and fro at sp metres a second.
 * - otherwise they stand at (ax, az) facing `yaw`, `role` naming what they do and `graze` lowering a beast's head.
 */

/**
 * Compile waypoints into a timed loop for followRoutine. Each point has x and z in
 * metres and may have a wait w in seconds, a facing yaw, a role, or a hide flag.
 * retrace returns through the intermediate points in reverse order.
 * clearAt(x, z), when supplied, must allow both endpoints and samples at most
 * half a metre apart on every leg. A blocked route returns null before drawing
 * from rng. A supplied rng draws a phase and a size in [size, size + spread).
 */
export function walkRound(points, speed, { retrace = false, clearAt, rng: random, size = 1, spread = 0 } = {}) {
  if (!points.length || !Number.isFinite(speed) || speed <= 0) throw new RangeError('Expected waypoints and a positive walking speed');
  const seq = retrace ? points.concat(points.slice(1, -1).reverse()) : points;
  const legs = [];
  let time = 0, distance = 0;
  for (let i = 0; i < seq.length; i++) {
    const startPoint = seq[i], endPoint = seq[(i + 1) % seq.length];
    if (!Number.isFinite(startPoint.x) || !Number.isFinite(startPoint.z) || !Number.isFinite(endPoint.x) || !Number.isFinite(endPoint.z)
        || !Number.isFinite(endPoint.w ?? 0) || (endPoint.w ?? 0) < 0) throw new RangeError('Invalid waypoint');
    const dx = endPoint.x - startPoint.x, dz = endPoint.z - startPoint.z;
    const len = Math.hypot(dx, dz), tw = len / speed;
    if (clearAt) {
      const steps = Math.max(1, Math.ceil(len / 0.5));
      for (let j = 0; j <= steps; j++) {
        if (!clearAt(startPoint.x + dx * (j / steps), startPoint.z + dz * (j / steps))) return null;
      }
    }
    legs.push({
      x0: startPoint.x, z0: startPoint.z, dx, dz, len, travel: distance, t0: time, tw,
      dir: Math.atan2(dx, dz), yaw: endPoint.yaw, hide: endPoint.hide, start: startPoint.w > 0, stop: endPoint.w > 0, role: endPoint.role,
    });
    time += tw + (endPoint.w || 0);
    distance += len;
  }
  const { x, z } = seq[0];
  return {
    ax: x, az: z, bx: x, bz: z, sp: 0, walkSpeed: speed, legs: time ? legs : null,
    distance, T: time, ph: random ? random() * time : 0, s: random ? size + random() * spread : size,
  };
}

/**
 * Where the walker’s routine puts them at clock t, into `at` ({ x, z, yaw, speed, travel, focus, head, rest }). False while they are
 * indoors at the end of a leg. `headAtHalt(leg, held, left)` gives a beast's head at a halt (1 down), from the seconds it has
 * been held there and those left before the next leg; without it the head is down while grazing.
 */
export function followRoutine(walker, t, at, headAtHalt) {
  at.x = walker.ax;
  at.z = walker.az;
  at.yaw = walker.yaw || 0;
  at.travel = 0;
  at.speed = 0;
  at.focus = walker.role;
  at.head = walker.graze ? 1 : 0;
  at.rest = 0;
  if (walker.legs) {
    const tt = (t + walker.ph) % walker.T;
    let l = walker.legs[0],
      next = null;
    for (let i = 0; i < walker.legs.length; i++) {
      const q = walker.legs[i];
      if (q.t0 <= tt) l = q;
      else {
        next = q;
        break;
      }
    }
    const local = tt - l.t0,
      ease = Math.min(0.23, l.tw * 0.5);
    let u = Math.min(1, local / Math.max(l.tw, 1e-3));
    if (u === 1 && l.hide) return false;
    if (u < 1) {
      let speed = walker.walkSpeed;
      if (ease > 0 && l.start && local < ease) {
        const f = local / ease;
        u *= f * (2 - f);
        speed *= f * (4 - 3 * f);
      } else if (ease > 0 && l.stop && l.tw - local < ease) {
        const f = (l.tw - local) / ease;
        u = 1 - (1 - u) * f * (2 - f);
        speed *= f * (4 - 3 * f);
      }
      at.speed = speed;
    } else {
      if (l.role) at.focus = l.role;
      if (headAtHalt) at.head = headAtHalt(l, local - l.tw, (next ? next.t0 : walker.T) - tt);
      at.rest = l.rest | 0;
    }
    at.x = l.x0 + l.dx * u;
    at.z = l.z0 + l.dz * u;
    at.yaw = l.yaw !== undefined && u === 1 ? l.yaw : l.dir;
    at.travel = l.travel + l.len * u;
  } else if (walker.speed) {
    at.speed = walker.speed;
    at.travel = walker.travel;
    at.yaw += walker.sway || 0;
  } else if (walker.r) {
    const phaseAngle = t * walker.w + walker.ph,
      speed = Math.abs(walker.w) * walker.r;
    at.x = walker.ax + Math.cos(phaseAngle) * walker.r;
    at.z = walker.az + Math.sin(phaseAngle) * walker.r;
    at.yaw = -phaseAngle + (walker.w > 0 ? 0 : Math.PI);
    at.speed = speed;
    at.travel = t * speed + walker.ph;
  } else if (walker.sp > 0 && walker.len > 0.5) {
    const travel = t * walker.sp + walker.ph,
      f = (travel / walker.len) % 2,
      u = f < 1 ? f : 2 - f;
    at.travel = travel;
    at.x += walker.dx * u;
    at.z += walker.dz * u;
    at.yaw = walker.pathYaw + (f < 1 ? 0 : Math.PI);
    at.speed = walker.sp * sstep(0, 0.23, Math.min(u, 1 - u) * walker.len);
  }
  return true;
}

/**
 * Fits routines to the walls round them. A builder lays a walker's way, or a stander's spot, from its plan of streets; the houses
 * and stalls there may be built later. A stander inside a collider is set outside it, and a walker's way ends a little short of
 * the first wall on it (or runs the other way from its start, where that is longer).
 *
 * @param {object} spaces What `createSpaces` returns: `collideIn`, `hit`, `onDeck` and `worldSpace` are read.
 * @param {object} [options]
 * @param {number} [options.body=0.35] Metres: a walker's half width.
 * @param {number} [options.step=0.5] Metres between the spots tested along a way.
 * @param {number} [options.short=0.9] Metres short of a wall a walker turns back.
 * @param {number} [options.least=0.5] Metres: a way shorter than this is no walk, and they stand.
 * @returns {(walker: object, space: object) => void} Fits a walker, whose builder gave it (ox, oz) and, for a walker, the way's far end
 *   (bx, bz), to the colliders of `space` as they stand now: sets ax, az, dx, dz, len, pathYaw or yaw, and `fit` (the
 *   space's collider count it was fitted to). People on decks or roofs, on a keeper's leash (`steady`), on legs or circles keep
 *   what their builder gave them.
 */
export function createWalkFit({ collideIn, hit, onDeck, worldSpace }, { body = 0.35, step = 0.5, short = 0.9, least = 0.5 } = {}) {
  const end = { x: 0, z: 0, len: 0 };
  // How far a body may go from (x, z) along (ux, uz) up to len metres before a collider stops it, less `short`; into end.
  function clearRun(grid, x, z, ux, uz, len) {
    let free = len;
    for (let t = step; t < len + step; t += step) {
      const distanceAlong = Math.min(t, len);
      if (collideIn(grid, x + ux * distanceAlong, z + uz * distanceAlong, body)) {
        free = Math.max(0, distanceAlong - step - short);
        break;
      }
    }
    end.len = free;
    end.x = ux * free;
    end.z = uz * free;
  }
  return function fitWalk(walker, sp) {
    walker.fit = sp.colliders;
    if (!sp.grid || walker.steady || walker.legs || walker.r || (walker.ground !== undefined && !walker.onGround)) return;
    let x = walker.ox,
      z = walker.oz;
    if (sp === worldSpace && onDeck(x, z)) return;
    if (collideIn(sp.grid, x, z, body)) {
      x = hit.x;
      z = hit.z;
    }
    walker.ax = x;
    walker.az = z;
    if (walker.onGround) walker.ground = sp.ground(x, z);
    if (!(walker.sp > 0)) return;
    const dx = walker.bx - x,
      dz = walker.bz - z,
      len = Math.hypot(dx, dz);
    if (len < least) return;
    const ux = dx / len,
      uz = dz / len;
    clearRun(sp.grid, x, z, ux, uz, len);
    let run = end.len,
      sx = end.x,
      sz = end.z;
    if (run < len * 0.5) {
      clearRun(sp.grid, x, z, -ux, -uz, len);
      if (end.len > run) {
        run = end.len;
        sx = end.x;
        sz = end.z;
      }
    }
    walker.dx = sx;
    walker.dz = sz;
    walker.len = run;
    if (run >= least) walker.pathYaw = Math.atan2(sx, sz);
    else walker.yaw = Math.atan2(dx, dz); // no room to walk: they stand, facing the way they would have gone
  };
}

// Kept for applications importing the crowd selector from its original module.
export { detailLevel } from '../rendering/detail-range.js';

/** Turns a heading `dir` towards `want` at `rate` a second over `gap` seconds, at once after a gap of more than `snap` seconds. */
export function easeHeading(dir, want, gap, rate, snap = 0.2) {
  if (gap > snap || gap < 0) return want;
  const turn = want - dir;
  return dir + wrapRadians(turn) * Math.min(1, gap * rate);
}
