import { TAU, clamp } from '../math/scalar.js';

/**
 * Recipes for particles that sites send up, for a particle system such as `createParticleSystem`: ground mist, columns of smoke and
 * fires with their sparks, glow and soot. Each fills the system's `spawn` record and hands it over with `put(pool)`, once per
 * particle; nothing is allocated.
 *
 * `spawn` fields written: x, y, z (metres), vx, vy, vz (metres a second), life (seconds), size (metres), r, g, b (linear, may
 * exceed 1 for light), drag, grav, and e1, e2, e3: the shader's opacity, heat and growth for this particle.
 *
 * @param {object} options
 * @param {object} options.spawn The particle system's spawn record.
 * @param {(pool: object) => void} options.put Hands the spawn record to a pool.
 * @param {() => number} [options.random=Math.random]
 * @param {number} [options.hearth=4] Metres: a column of smoke narrower than this is a hearth's or a campfire's (thin, pale, brief),
 *   not a burning building's.
 */
export function createParticleEmitters({ spawn, put, random = Math.random, hearth = 4 }) {
  const randomValue = random;

  /**
   * One wisp of mist lying low over a disc of radius `site.r` about (site.x, site.z): broad pale veils, thickest at night (`day`
   * 0 at night, 1 by day), drifting slowly. `groundAt(x, z)` is the ground's height there. site.size: the wisp's size.
   */
  function mist(site, groundAt, day, pool) {
    const angle = randomValue() * TAU,
      radialDistance = Math.sqrt(randomValue()) * site.r,
      x = site.x + Math.cos(angle) * radialDistance,
      z = site.z + Math.sin(angle) * radialDistance,
      brightness = 0.62 + randomValue() * 0.12,
      thick = 0.45 + 0.55 * (1 - day);
    spawn.x = x;
    spawn.y = groundAt(x, z) + 0.25 + randomValue() * 0.6;
    spawn.z = z;
    spawn.vx = (randomValue() - 0.5) * 0.25;
    spawn.vy = 0.02 + randomValue() * 0.04;
    spawn.vz = (randomValue() - 0.5) * 0.25;
    spawn.life = 12 + randomValue() * 8;
    spawn.size = site.size * (0.7 + randomValue() * 0.6);
    spawn.r = brightness;
    spawn.g = brightness * 1.02;
    spawn.b = brightness * 1.06;
    spawn.drag = 0.02;
    spawn.grav = 0;
    spawn.e1 = (0.1 + randomValue() * 0.08) * thick;
    spawn.e2 = 0;
    spawn.e3 = 0.12;
    put(pool);
  }

  /**
   * One puff of a column of smoke at (site.x, site.y, site.z), `site.size` metres across: dense dark puffs at the root, and now and
   * then a big slow one that carries it high and downwind. A narrow column (under `hearth`) is paler and briefer, as a cooking
   * fire's is. Optional: site.dark (darkness, 1), site.heat (how it rises, 0.08), site.thin (opacity, 1).
   */
  function smoke(site, pool) {
    const S = site.size,
      small = 1 - clamp(S / hearth, 0, 1),
      brightness = (0.1 + randomValue() * 0.17) * (site.dark ?? 1) * (1 + 1.8 * small),
      brief = 1 - 0.6 * small,
      j = S * 0.16,
      heat = site.heat ?? 0.08,
      up = Math.sqrt(S / 8),
      thin = site.thin ?? 1;
    if (randomValue() < 0.24) {
      spawn.x = site.x + (randomValue() - 0.5) * j;
      spawn.y = site.y + S * 0.2;
      spawn.z = site.z + (randomValue() - 0.5) * j;
      spawn.vx = (randomValue() - 0.5) * 0.6;
      spawn.vy = (2.3 + randomValue() * 1.5) * up;
      spawn.vz = (randomValue() - 0.5) * 0.6;
      spawn.life = (14 + randomValue() * 9) * brief;
      spawn.size = S * (0.4 + randomValue() * 0.3);
      spawn.r = brightness * 1.3;
      spawn.g = brightness * 1.3;
      spawn.b = brightness * 1.36;
      spawn.drag = 0.1;
      spawn.grav = 0.1;
      spawn.e1 = (0.34 + randomValue() * 0.2) * thin * brief;
      spawn.e2 = heat * 0.5;
      spawn.e3 = 1.1 + randomValue() * 0.4;
    } else {
      spawn.x = site.x + (randomValue() - 0.5) * j;
      spawn.y = site.y;
      spawn.z = site.z + (randomValue() - 0.5) * j;
      spawn.vx = (randomValue() - 0.5) * 0.9;
      spawn.vy = (2.0 + randomValue() * 1.7) * up;
      spawn.vz = (randomValue() - 0.5) * 0.9;
      spawn.life = 5.5 + randomValue() * 4.5;
      spawn.size = S * (0.22 + randomValue() * 0.2);
      spawn.r = brightness;
      spawn.g = brightness;
      spawn.b = brightness * 1.05;
      spawn.drag = 0.12;
      spawn.grav = 0.12;
      spawn.e1 = (0.5 + randomValue() * 0.3) * thin;
      spawn.e2 = heat;
      spawn.e3 = 0.9 + randomValue() * 0.6;
    }
    put(pool);
  }

  /**
   * One tongue of a fire at (site.x, site.y, site.z), `site.size` metres across, into the additive pool `add`; with it, by chance,
   * a spark (site.sparks, 0.32), a glow in the air above (site.halo, 0.1) and soot into the blended pool `alpha` (site.soot, 0.14):
   * thin pale wisps for a wood fire burning well (site.wood), black soot otherwise. site.hot scales its light (1).
   */
  function fire(site, add, alpha) {
    const z = site.size,
      sq = Math.sqrt(z),
      hot = site.hot ?? 1;
    spawn.x = site.x + (randomValue() - 0.5) * z * 0.9;
    spawn.y = site.y + randomValue() * 0.12 * z;
    spawn.z = site.z + (randomValue() - 0.5) * z * 0.9;
    spawn.vx = (randomValue() - 0.5) * 0.35;
    spawn.vy = (0.5 + randomValue() * 0.9) * sq;
    spawn.vz = (randomValue() - 0.5) * 0.35;
    spawn.life = 0.45 + randomValue() * 0.5;
    spawn.size = z * (0.6 + randomValue() * 0.6);
    spawn.r = 1.3 * hot;
    spawn.g = (0.42 + randomValue() * 0.2) * hot;
    spawn.b = 0.065 * hot;
    spawn.drag = 0.6;
    spawn.grav = 0.8;
    spawn.e1 = 1;
    spawn.e2 = 0;
    spawn.e3 = 0.12;
    put(add);
    if (randomValue() < (site.sparks ?? 0.32)) {
      spawn.x = site.x + (randomValue() - 0.5) * z * 0.6;
      spawn.y = site.y + 0.5 * z;
      spawn.z = site.z + (randomValue() - 0.5) * z * 0.6;
      spawn.vx = (randomValue() - 0.5) * 1.6 * sq;
      spawn.vy = (1.8 + randomValue() * 2.6) * sq;
      spawn.vz = (randomValue() - 0.5) * 1.6 * sq;
      spawn.life = 1.4 + randomValue() * 2.6;
      spawn.size = (0.035 + randomValue() * 0.04) * sq;
      spawn.r = 4.6;
      spawn.g = 1.7;
      spawn.b = 0.36;
      spawn.drag = 0.35;
      spawn.grav = 0.3;
      spawn.e1 = 2;
      spawn.e2 = 0;
      spawn.e3 = 0.7;
      put(add);
    }
    if (randomValue() < (site.halo ?? 0.1)) {
      spawn.x = site.x;
      spawn.y = site.y + z * 1.7;
      spawn.z = site.z;
      spawn.vx = 0;
      spawn.vy = 0.4;
      spawn.vz = 0;
      spawn.life = 0.5 + randomValue() * 0.5;
      spawn.size = z * 3.2;
      spawn.r = 0.3 * hot;
      spawn.g = 0.09 * hot;
      spawn.b = 0.018 * hot;
      spawn.drag = 0.5;
      spawn.grav = 0;
      put(add);
    }
    if (randomValue() < (site.soot ?? 0.14)) {
      if (site.wood) {
        const brightness = 0.36 + randomValue() * 0.16;
        spawn.x = site.x + (randomValue() - 0.5) * z * 0.4;
        spawn.y = site.y + z * 1.3;
        spawn.z = site.z + (randomValue() - 0.5) * z * 0.4;
        spawn.vx = (randomValue() - 0.5) * 0.3;
        spawn.vy = (1.3 + randomValue() * 0.9) * sq;
        spawn.vz = (randomValue() - 0.5) * 0.3;
        spawn.life = (6 + randomValue() * 5) * Math.sqrt(sq);
        spawn.size = z * (0.9 + randomValue() * 0.8);
        spawn.r = brightness;
        spawn.g = brightness * 1.02;
        spawn.b = brightness * 1.08;
        spawn.drag = 0.15;
        spawn.grav = 0.15;
        spawn.e1 = 0.13 + randomValue() * 0.11;
        spawn.e2 = 0.35;
        spawn.e3 = 1.3;
      } else {
        const brightness = 0.04 + randomValue() * 0.04;
        spawn.x = site.x + (randomValue() - 0.5) * z * 0.5;
        spawn.y = site.y + z * 1.5;
        spawn.z = site.z + (randomValue() - 0.5) * z * 0.5;
        spawn.vx = (randomValue() - 0.5) * 0.4;
        spawn.vy = (1.6 + randomValue() * 1.2) * sq;
        spawn.vz = (randomValue() - 0.5) * 0.4;
        spawn.life = (4 + randomValue() * 3.5) * Math.sqrt(sq);
        spawn.size = z * (0.8 + randomValue() * 0.7);
        spawn.r = brightness;
        spawn.g = brightness * 0.95;
        spawn.b = brightness * 0.9;
        spawn.drag = 0.2;
        spawn.grav = 0.2;
        spawn.e1 = 0.42 + randomValue() * 0.28;
        spawn.e2 = 0.6;
        spawn.e3 = 1.2;
      }
      put(alpha);
    }
  }

  return { mist, smoke, fire };
}

/**
 * A camera's shake as a tremor that rolls through the ground: a few slow, smooth waves (two to three a second) that die away, never
 * a new random offset every frame (which makes the whole picture jitter). Writes the offset into `out` ({ set(x, y, z) }, such as
 * a Vector3) for a shake of `strength` with `left` of its `duration` seconds remaining; `reach` is the metres moved per unit of
 * strength.
 */
export function shakeOffset(out, strength, left, duration, reach = 0.18) {
  const amplitude = strength * reach * Math.max(0, left / duration) ** 1.5,
    u = left;
  return out.set(
    amplitude * (Math.sin(u * 13.1) * 0.6 + Math.sin(u * 19.7 + 1.3) * 0.4),
    amplitude * (Math.sin(u * 11.3 + 2.1) * 0.6 + Math.sin(u * 21.9) * 0.4) * 0.7,
    amplitude * (Math.sin(u * 15.5 + 0.7) * 0.6 + Math.sin(u * 9.7 + 2.9) * 0.4),
  );
}
