import * as THREE from 'three';

export function createWakes({ slots = 6, minSpeed = 0.25, reach = 450, ease = 4 } = {}) {
  if (!Number.isInteger(slots) || slots < 1) throw new RangeError('Wake slot count must be a positive integer');
  const wakeUniforms = {
    uWake: { value: Array.from({ length: slots }, () => new THREE.Vector4()) }, // her middle x, z; her velocity x, z in m/s
    uWakeS: { value: Array.from({ length: slots }, () => new THREE.Vector4()) }, // her length, beam in metres; 1 while in use
  };
  const hulls = []; // { obj, length, beam, x, z, vx, vz, known, d2 }

  // Follows the hull carried by obj (her middle at its origin), `length` and `beam` metres, for as long as the page lives.
  function followWake(obj, length, beam = length * 0.3) {
    const hull = { obj, length, beam, x: 0, z: 0, vx: 0, vz: 0, known: false, d2: Infinity };
    hulls.push(hull);
    return () => {
      const i = hulls.indexOf(hull);
      if (i >= 0) hulls.splice(i, 1);
    };
  }
  // Whether obj is in the scene and nothing holding it is hidden.
  function shown(obj) {
    let o = obj;
    for (; o.parent; o = o.parent) if (!o.visible) return false;
    return o.isScene === true;
  }
  // Each frame: how fast each hull is moving, measured from where her frame was last drawn; the nearest under way fill the slots.
  function updateWakes(dt, eye) {
    for (let i = 0; i < hulls.length; i++) {
      const h = hulls[i],
        e = h.obj.matrixWorld.elements;
      h.d2 = Infinity;
      if (!shown(h.obj)) {
        h.known = false;
        continue;
      }
      if (h.known && dt > 0) {
        const k = Math.min(1, dt * ease);
        h.vx += ((e[12] - h.x) / dt - h.vx) * k;
        h.vz += ((e[14] - h.z) / dt - h.vz) * k;
      } else h.vx = h.vz = 0;
      h.x = e[12];
      h.z = e[14];
      h.known = true;
      const d2 = (h.x - eye.x) ** 2 + (h.z - eye.z) ** 2;
      if (d2 < reach * reach && h.vx * h.vx + h.vz * h.vz > minSpeed * minSpeed) h.d2 = d2;
    }
    const at = wakeUniforms.uWake.value,
      size = wakeUniforms.uWakeS.value;
    for (let slot = 0; slot < slots; slot++) {
      let best = null;
      for (let i = 0; i < hulls.length; i++) if (hulls[i].d2 < (best ? best.d2 : Infinity)) best = hulls[i];
      if (!best) {
        size[slot].w = 0;
        continue;
      }
      at[slot].set(best.x, best.z, best.vx, best.vz);
      size[slot].set(best.length, best.beam, 0, 1);
      best.d2 = Infinity; // taken
    }
  }

  // In the water's main, after its waves (g) are worked out: adds each wake's slope to g and its foam to the white water
  // (rapid). Reads vW, g, rapid, uTime, and the water's fade of a wave by its fineness (OW).
  const WAKE_GLSL = `/* glsl */
          float wakePx = length(fwidth(vW.xz));                         // taken before the loop, where every pixel runs it
          for (int i = 0; i < ${slots} && uWakeS[0].w > 0.5; i++) {       // the slots fill in order: none if the first is empty
            vec4 H = uWake[i], S = uWakeS[i];
            if (S.w < 0.5) continue;
            vec2 rel = vW.xz - H.xy; float L = S.x, speed = length(H.zw);
            if (dot(rel, rel) > L * L * 144.0) continue;                       // twelve of her lengths
            vec2 fwd = H.zw / speed, side = vec2(-fwd.y, fwd.x);
            float fromBow = L * 0.5 - dot(rel, fwd), across = dot(rel, side), off = abs(across), sgn = sign(across);
            if (fromBow < -L * 0.3) continue;
            float under = smoothstep(0.25, 1.5, speed), back = max(fromBow, 0.0);
            float k = 9.81 / max(speed * speed, 0.6);                          // waves that keep pace with her: 2 pi s^2 / g apart
            float arm = off - back * 0.354;                                   // metres outside the arms of the V (19.5 degrees)
            float spread = 0.7 + back * 0.09, envelope = exp(-arm * arm / (spread * spread)) * exp(-back / (L * 3.0)) * under;
            // along each arm a short train of crests, feathered at 55 degrees to her track
            float phase = k * 1.5 * (back * 0.819 + off * 0.574);
            vec2 dPhase = k * 1.5 * (-fwd * 0.819 + side * sgn * 0.574);
            g -= dPhase * (0.022 * envelope * sin(phase)) * smoothstep(0.0, L * 0.3, back) * OW(k * 1.5);
            // inside the V, crests across her track
            float inside = smoothstep(0.5, -1.5, arm) * exp(-back / (L * 3.0)) * under * smoothstep(0.0, L, back);
            g += fwd * (0.012 * inside * k * sin(k * back)) * OW(k);
            // white water: folding along her sides from the bow, and churned behind her stern, spreading as it falls astern
            vec2 hullAt = vec2(-dot(rel, fwd) / (L * 0.5), across / (S.y * 0.5));
            float bowWave = exp(-(length(hullAt) - 1.0) * 5.0) * smoothstep(0.9, 1.0, length(hullAt)) * smoothstep(-0.3, 0.7, -hullAt.x) * smoothstep(0.6, 2.0, speed);
            float astern = back - L, aft = max(astern, 0.0), wide = S.y * (0.35 + aft / (L * 2.5));
            float churn = exp(-off * off / (wide * wide)) * exp(-aft / (L * 1.4)) * smoothstep(-L * 0.5, 0.0, astern) * under;
            float lace = seaLace(vW.xz * 2.0, uTime, wakePx * 2.0);
            float stern = churn * mix(0.85, lace * 0.8, smoothstep(0.0, L * 0.8, aft));     // solid at her stern, breaking into lace astern
            float armFoam = envelope * exp(-back / L) * lace * 0.6;                    // the bow wave's white running out along the arms a little way
            rapid = max(rapid, clamp(bowWave * (0.55 + 0.45 * lace) + stern + armFoam, 0.0, 1.0));
          }`;
  const WAKE_PARS = `/* glsl */
        uniform vec4 uWake[${slots}], uWakeS[${slots}];`;

  return { followWake, updateWakes, WAKE_GLSL, WAKE_PARS, wakeUniforms };
}
