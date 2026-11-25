import { sstep } from '../math/scalar.js';

/**
 * Where a crowd's people are, from routines laid out once: legs walked on a loop of the clock, a circle, or a way walked to and
 * fro; and those routines fitted to the colliders of their space as the walls they stand among are built. A person is a plain
 * record their crowd keeps; no frame allocates.
 *
 * Routine fields on a person `g`:
 * - `legs`: [{ t0, tw, x0, z0, dx, dz, dir, len, travel, start, stop, hide, yaw, role, rest }], walked over `T` seconds from
 *   phase `ph` at `walkSpeed`, each eased in where it `start`s and out where it `stop`s; a leg that `hide`s ends indoors.
 * - `speed`: moved by a keeper of its own, which sets `speed`, `travel` and `sway` (a turn off the line) each frame.
 * - `r`, `w`: a circle of radius r about (ax, az) at w radians a second.
 * - `sp`, `len`, `dx`, `dz`, `pathYaw`: a way of len metres from (ax, az) along (dx, dz), walked to and fro at sp metres a second.
 * - otherwise they stand at (ax, az) facing `yaw`, `role` naming what they do and `graze` lowering a beast's head.
 */

/**
 * Where g's routine puts them at clock t, into `at` ({ x, z, yaw, speed, travel, focus, head, rest }). False while they are
 * indoors at the end of a leg. `headAtHalt(leg, held, left)` gives a beast's head at a halt (1 down), from the seconds it has
 * been held there and those left before the next leg; without it the head is down while grazing.
 */
export function followRoutine(g, t, at, headAtHalt) {
  at.x = g.ax;
  at.z = g.az;
  at.yaw = g.yaw || 0;
  at.travel = 0;
  at.speed = 0;
  at.focus = g.role;
  at.head = g.graze ? 1 : 0;
  at.rest = 0;
  if (g.legs) {
    const tt = (t + g.ph) % g.T;
    let l = g.legs[0],
      next = null;
    for (let i = 0; i < g.legs.length; i++) {
      const q = g.legs[i];
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
      let speed = g.walkSpeed;
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
      if (headAtHalt) at.head = headAtHalt(l, local - l.tw, (next ? next.t0 : g.T) - tt);
      at.rest = l.rest | 0;
    }
    at.x = l.x0 + l.dx * u;
    at.z = l.z0 + l.dz * u;
    at.yaw = l.yaw !== undefined && u === 1 ? l.yaw : l.dir;
    at.travel = l.travel + l.len * u;
  } else if (g.speed) {
    at.speed = g.speed;
    at.travel = g.travel;
    at.yaw += g.sway || 0;
  } else if (g.r) {
    const a = t * g.w + g.ph,
      speed = Math.abs(g.w) * g.r;
    at.x = g.ax + Math.cos(a) * g.r;
    at.z = g.az + Math.sin(a) * g.r;
    at.yaw = -a + (g.w > 0 ? 0 : Math.PI);
    at.speed = speed;
    at.travel = t * speed + g.ph;
  } else if (g.sp > 0 && g.len > 0.5) {
    const travel = t * g.sp + g.ph,
      f = (travel / g.len) % 2,
      u = f < 1 ? f : 2 - f;
    at.travel = travel;
    at.x += g.dx * u;
    at.z += g.dz * u;
    at.yaw = g.pathYaw + (f < 1 ? 0 : Math.PI);
    at.speed = g.sp * sstep(0, 0.23, Math.min(u, 1 - u) * g.len);
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
 * @returns {(g: object, space: object) => void} Fits g, whose builder gave it (ox, oz) and, for a walker, the way's far end
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
      const d = Math.min(t, len);
      if (collideIn(grid, x + ux * d, z + uz * d, body)) {
        free = Math.max(0, d - step - short);
        break;
      }
    }
    end.len = free;
    end.x = ux * free;
    end.z = uz * free;
  }
  return function fitWalk(g, sp) {
    g.fit = sp.colliders;
    if (!sp.grid || g.steady || g.legs || g.r || (g.ground !== undefined && !g.onGround)) return;
    let x = g.ox,
      z = g.oz;
    if (sp === worldSpace && onDeck(x, z)) return;
    if (collideIn(sp.grid, x, z, body)) {
      x = hit.x;
      z = hit.z;
    }
    g.ax = x;
    g.az = z;
    if (g.onGround) g.ground = sp.ground(x, z);
    if (!(g.sp > 0)) return;
    const dx = g.bx - x,
      dz = g.bz - z,
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
    g.dx = sx;
    g.dz = sz;
    g.len = run;
    if (run >= least) g.pathYaw = Math.atan2(sx, sz);
    else g.yaw = Math.atan2(dx, dz); // no room to walk: they stand, facing the way they would have gone
  };
}

/**
 * A level of detail chosen with hysteresis: 3 near, 2 medium, 1 light, 0 past them. `near`, `medium` and `light` are each level's
 * outer edge in metres at a lens of 1, as [for one outside it, for one already inside it]: an edge lies a little further out for
 * one inside, so that nobody standing on it changes every frame. `d2` is the distance squared, `previous` the level last frame,
 * `lens` how much nearer the lens brings things (edges move out with it).
 */
export function detailLevel(d2, previous, lens, near, medium, light) {
  const n = (previous === 3 ? near[1] : near[0]) * lens,
    m = (previous >= 2 ? medium[1] : medium[0]) * lens,
    l = (previous >= 1 ? light[1] : light[0]) * lens;
  return d2 < n * n ? 3 : d2 < m * m ? 2 : d2 < l * l ? 1 : 0;
}

/** Turns a heading `dir` towards `want` at `rate` a second over `gap` seconds, at once after a gap of more than `snap` seconds. */
export function easeHeading(dir, want, gap, rate, snap = 0.2) {
  if (gap > snap || gap < 0) return want;
  const turn = want - dir;
  return dir + Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, gap * rate);
}
