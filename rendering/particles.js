import * as THREE from 'three';

export function createParticleSystem({ scene, pointScale, sceneDepth, elapsed, noiseTexture, random = Math.random, layer = 0, alphaOrder = 0, additiveOrder = 1 }) {
  const fxU = {
    uTime: { value: 0 },
    uScale: pointScale,
    uFog: { value: new THREE.Color() },
    uFogD: { value: 0.001 },
    uLight: { value: 1 },
    uNoise: { value: null },
    uSunW: { value: new THREE.Vector3(0, 1, 0) },
    uSunC: { value: new THREE.Color() },
    uSkyC: { value: new THREE.Color() },
    uGndC: { value: new THREE.Color() },
    uWind: { value: new THREE.Vector2(1.6, 0.6) },
  };
  // How far a particle stands in front of what the scene drew under it, as a share of its soft length (vSoft: its own distance, that
  // length): it fades where it meets the ground or a wall instead of cutting a line through it. The distance is the occlusion pass's,
  // at half size: of the four half-size pixels round this one the farthest is taken, so a puff behind a near roof is not thinned
  // along the roof's edge (the depth test still hides it there).
  const MEET = /* glsl */ `uniform sampler2D uDepth; uniform vec2 uDepthPx; uniform float uSoft; varying vec2 vSoft;
  float meet(){
    if (uSoft < 0.5 || vSoft.y <= 0.0) return 1.0;
    ivec2 b = ivec2(floor(gl_FragCoord.xy * 0.5 - 0.5)), hi = ivec2(1.0 / uDepthPx) - 1;
    float d = max(max(texelFetch(uDepth, clamp(b, ivec2(0), hi), 0).g, texelFetch(uDepth, clamp(b + ivec2(1, 0), ivec2(0), hi), 0).g),
                  max(texelFetch(uDepth, clamp(b + ivec2(0, 1), ivec2(0), hi), 0).g, texelFetch(uDepth, clamp(b + 1, ivec2(0), hi), 0).g));
    return clamp((d - vSoft.x) / vSoft.y, 0.0, 1.0);
  }`;
  // Embers and coals: bright and dark crawling slowly over a surface. The mesh's colour attribute carries (phase, intensity, -).
  // over: laid as a glow over a surface of its own (a heap of rubble) rather than as the surface itself.
  function emberMaterial(scale, over = false) {
    return new THREE.ShaderMaterial({
      // over the ash the glow is added to the picture, so in haze it fades rather than taking the haze's colour
      ...(over && { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, defines: { EMBER_OVER: 1, FOG_FADES: '' } }),
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: fxU.uTime,
        uNoise: fxU.uNoise,
        uLight: fxU.uLight,
        uS: { value: scale },
      },
      vertexShader: `/* glsl */ uniform float uTime, uS; attribute vec3 color; varying vec2 vW; varying vec3 vE;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = (w.xz + w.y * 0.71) * uS; vE = vec3(color.x, color.y * (0.78 + 0.22 * sin(uTime * (2.0 + color.x * 3.0) + color.x * 40.0)), fract(uTime * 0.02));
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: `/* glsl */ uniform sampler2D uNoise; uniform float uLight; varying vec2 vW; varying vec3 vE;
      #include <fog_pars_fragment>
      void main(){ float n = texture2D(uNoise, vW + vE.x * 3.0).r, m = texture2D(uNoise, vW * 2.7 + vec2(vE.z, vE.x)).a;
        #ifdef EMBER_OVER
          float f = smoothstep(0.7, 0.98, n * 0.65 + m * 0.6);                                       // only the hottest specks show over the ash
          gl_FragColor = vec4((vec3(2.4, 0.5, 0.07) * 1.5 * f * f + vec3(0.9, 0.5, 0.1) * pow(f, 6.0)) * vE.y * (1.22 - uLight), 1.0);   // by day the glow is lost in the light
        #else
          float f = smoothstep(0.2, 0.85, n * 0.65 + m * 0.6);
          gl_FragColor = vec4(vec3(2.4, 0.5, 0.07) * vE.y * (0.06 + 1.5 * f * f) + vec3(0.9, 0.5, 0.1) * vE.y * pow(f, 6.0), 1.0);
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    });
  }
  // Each particle is one camera-facing quad (instanced), moved entirely in the vertex shader from its spawn data.
  // The alpha pool draws smoke, dust and shadow as lit, billowing puffs; the additive pool draws glows (kind 0),
  // flame tongues that stand upright and lick upward (kind 1) and embers (kind 2).
  function makeParticles(capacity, additive) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Particle capacity must be a positive integer');
    if (!fxU.uNoise.value) fxU.uNoise.value = noiseTexture();
    const particleGeometry = new THREE.InstancedBufferGeometry(),
      quadGeometry = new THREE.PlaneGeometry(1, 1);
    particleGeometry.setIndex(quadGeometry.index);
    particleGeometry.setAttribute('position', quadGeometry.attributes.position);
    const mk = itemSize => {
      const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
      attribute.setUsage(THREE.DynamicDrawUsage);
      return attribute;
    };
    const pos = mk(3),
      vel = mk(3),
      dat = mk(4),
      col = mk(4),
      sed = mk(4);
    for (let i = 0; i < capacity; i++) {
      dat.array[i * 4] = -1e5;
      dat.array[i * 4 + 1] = 1;
    }
    particleGeometry.setAttribute('aPos', pos);
    particleGeometry.setAttribute('aVel', vel);
    particleGeometry.setAttribute('aData', dat);
    particleGeometry.setAttribute('aCol', col);
    particleGeometry.setAttribute('aSeed', sed);
    particleGeometry.instanceCount = 0;
    particleGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
      side: THREE.DoubleSide,
      defines: additive ? { FX_ADD: 1 } : {},
      uniforms: {
        uTime: fxU.uTime,
        uFog: fxU.uFog,
        uFogD: fxU.uFogD,
        uNoise: fxU.uNoise,
        uSunW: fxU.uSunW,
        uSunC: fxU.uSunC,
        uSkyC: fxU.uSkyC,
        uGndC: fxU.uGndC,
        uWind: fxU.uWind,
        uGrow: { value: additive ? 1.0 : 4.0 },
        ...sceneDepth,
      },
      vertexShader: `/* glsl */ uniform float uTime, uGrow, uFogD; uniform vec2 uWind; uniform vec3 uSunW;
      attribute vec3 aPos, aVel; attribute vec4 aData, aCol, aSeed;
      varying vec4 vCol, vP, vRot; varying float vFogF; varying vec2 vUv, vSoft; varying vec3 vLd, vUd;
      void main(){
        float age = uTime - aData.x, k = age / aData.y;
        vUv = position.xy * 2.0; vLd = vUd = vec3(0.0, 1.0, 0.0); vSoft = vec2(0.0);
        if (k < 0.0 || k >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vCol = vP = vRot = vec4(0.0); vFogF = 0.0; return; }
        float drag = aCol.w, tt = drag > 0.01 ? (1.0 - exp(-drag * age)) / drag : age, seed = aSeed.x;
        float still = aSeed.z < -0.5 ? 0.0 : 1.0;                                                     // 0: a drop (blood), which neither swells nor drifts
        vec3 p = aPos + aVel * tt; p.y += aData.w * age * age * 0.5;
        p.xz += uWind * (aSeed.w * age * age / (age + 2.5));                                          // the wind takes hold as the puff climbs: columns lean and trail
        p.xz += sin(vec2(age * 1.9 + aPos.z, age * 1.6 + aPos.x) + seed * 6.283) * min(age, 5.0) * (uGrow > 1.5 ? 0.24 : 0.1) * still;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = max(-mv.z, 0.1), gk = k * (1.7 - 0.7 * k) * still;
        float sz = min(aData.z * mix(1.0, uGrow, gk), dist * 1.3);
        vSoft.x = dist;
        vec2 c = position.xy;
        vUd = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz; vLd = (viewMatrix * vec4(uSunW, 0.0)).xyz;
        float fade = (1.0 - smoothstep(0.45, 1.0, k));
        #ifdef FX_ADD
          float kind = aSeed.y; vRot = vec4(1.0, 0.0, age, 0.0);
          if (kind > 0.5 && kind < 1.5) {                                                             // a flame: upright whatever the camera does, narrowing and stretching as it rises
            vec2 up2 = vUd.xy; float ul = length(up2); up2 = ul > 0.05 ? up2 / ul : vec2(0.0, 1.0); vec2 rt2 = vec2(up2.y, -up2.x);
            float w = sz * (1.0 - 0.3 * k), h = sz * 1.5 * (0.45 + 0.55 * smoothstep(0.0, 0.4, k)), sway = sin(age * (7.0 + seed * 5.0) + seed * 40.0) * 0.22 * w;
            mv.xy += rt2 * (c.x * w + (c.y + 0.5) * sway) + up2 * ((c.y + 0.4) * h);
            fade *= smoothstep(0.0, 0.06, k); vSoft.y = 0.15 * w;                                    // a tongue's root meets the logs softly
          } else {
            if (kind > 1.5) sz = max(sz, dist * 0.0022);                                              // an ember never shrinks below a pixel or two
            else vSoft.y = 0.5 * sz;
            mv.xy += c * sz; fade *= smoothstep(0.0, 0.1, k);
          }
          fade *= kind > 0.5 ? smoothstep(0.25, 1.2, dist) : smoothstep(0.7, 4.0, dist);                // a flame stays lit when you sit beside it; the big soft glows fade before they fill the eye
          vP = vec4(seed, kind, k, 0.0);
        #else
          float ang = seed * 6.283 + (seed - 0.5) * age * 0.22; vRot = vec4(cos(ang), sin(ang), age, step(aSeed.y, 0.0));   // w: dust (a negative opacity)
          if (still < 0.5) {                                                                          // a drop: never below a pixel or so, streaked along its flight
            sz = max(sz, dist * 0.0016);
            vec2 v = (viewMatrix * vec4(aVel * exp(-drag * age) + vec3(0.0, aData.w * age, 0.0), 0.0)).xy;
            float vl = length(v); vec2 d = vl > 1e-3 ? v / vl : vec2(0.0, 1.0);
            mv.xy += d * (c.y * (sz + vl * 0.02)) + vec2(-d.y, d.x) * (c.x * sz);
            fade *= smoothstep(0.15, 0.5, dist) * aSeed.y;
          } else {
            mv.xy += c * sz; vSoft.y = 0.5 * sz;                                                      // a puff fades over its radius into what it meets
            fade *= smoothstep(0.0, 0.1, k) * smoothstep(0.7, max(4.0, sz * 0.7), dist) * abs(aSeed.y);
          }
          vP = vec4(seed, 1.0 - still, k, still * aSeed.z * exp(-max(p.y - aPos.y, 0.0) / (aData.z * 1.6 + 0.5)));      // the glow of the fire below dies away as the smoke climbs, sooner over a small fire
        #endif
        gl_Position = projectionMatrix * mv;
        vCol = vec4(aCol.rgb, fade);
        float fd = uFogD * dist; vFogF = 1.0 - exp(-fd * fd * 0.6);
      }`,
      fragmentShader:
        (additive
          ? `/* glsl */ uniform sampler2D uNoise; varying vec4 vCol, vP, vRot; varying float vFogF; varying vec2 vUv; varying vec3 vLd, vUd; ${MEET}
      void main(){
        float kind = vP.y, seed = vP.x; vec3 c;
        if (kind < 0.5) { float a = max(1.0 - length(vUv), 0.0); a = a * a * (0.5 + 2.2 * a * a); c = vCol.rgb * a; }
        else if (kind < 1.5) {
          float y = vUv.y * 0.5 + 0.5;                                                               // 0 at the root of the tongue, 1 at its tip
          vec4 n = texture2D(uNoise, vec2(vUv.x * 0.13 + seed * 5.3, y * 0.2 - vRot.z * 0.42 + seed * 3.1));
          float x = vUv.x + (n.g - 0.5) * 1.1 * y, wd = (0.3 + 0.48 * smoothstep(0.0, 0.25, y)) * pow(1.0 - y, 1.15) + 0.04;
          float f = clamp(1.0 - abs(x) / wd, 0.0, 1.0) * smoothstep(0.0, 0.1, y);
          f = clamp(f * 1.7 - (0.1 + 0.95 * y) * (1.0 - n.r) * 1.25 - (1.0 - n.a) * 0.35 * y, 0.0, 1.0);   // torn open toward the tip, solid at the root
          c = vCol.rgb * f * (0.35 + 1.25 * f) * mix(vec3(1.0), vec3(1.0, 0.46, 0.2), y * y) + vec3(1.0, 0.78, 0.36) * vCol.r * 0.42 * f * f * f * (1.0 - y);      // yellow at the heart, reddening to the tip
        } else { float a = smoothstep(1.0, 0.0, length(vUv)); c = vCol.rgb * a * a * (0.6 + 0.4 * sin(vRot.z * (9.0 + seed * 14.0) + seed * 40.0)); }
        gl_FragColor = vec4(c * vCol.a * (1.0 - vFogF) * meet(), 1.0);`
          : `/* glsl */ uniform sampler2D uNoise; uniform vec3 uFog, uSunC, uSkyC, uGndC; varying vec4 vCol, vP, vRot; varying float vFogF; varying vec2 vUv; varying vec3 vLd, vUd; ${MEET}
      void main(){
        float r2 = dot(vUv, vUv); if (r2 >= 1.0) discard;
        if (vP.y > 0.5) {                                                                             // a drop: a dark bead, lit from outside, with a wet glint
          vec3 N = vec3(vUv, sqrt(1.0 - r2)), L = normalize(vLd);
          float sunw = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0), spec = pow(max(dot(N, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 40.0);
          vec3 col = vCol.rgb * 0.5 * (uSunC * sunw + uSkyC * (0.6 + 0.4 * dot(N, vUd))) + uSunC * spec * 0.12;
          gl_FragColor = vec4(mix(col, uFog, vFogF), vCol.a * smoothstep(1.0, 0.6, r2));
        } else {
        float r = sqrt(r2), seed = vP.x, k = vP.z;
        vec2 q = vec2(vUv.x * vRot.x - vUv.y * vRot.y, vUv.x * vRot.y + vUv.y * vRot.x);
        vec2 nuv = q * 0.2 + vec2(seed * 7.13, fract(seed * 13.7) * 5.1);
        vec4 n = texture2D(uNoise, nuv); float w = texture2D(uNoise, nuv * 2.7 + 0.31).a;
        float body = 1.0 - r, e = 0.06 + 0.4 * k;                                                     // an old puff frays into wisps
        float den = smoothstep(e, e + 0.5, body + (n.r - 0.5) * 0.8 + (w - 0.5) * 0.35) * smoothstep(0.0, 0.16, body);
        vec2 gr = (n.gb - 0.5) * 2.0; gr = vec2(gr.x * vRot.x + gr.y * vRot.y, gr.y * vRot.x - gr.x * vRot.y);
        vec3 N = normalize(vec3(vUv * 0.9 - gr * 0.8, sqrt(max(1.0 - r2 * 0.81, 0.04))));          // a rounded puff with the noise as relief
        float up = dot(N, vUd), sunw = clamp(dot(N, vLd) * 0.62 + 0.38, 0.0, 1.0), cav = 0.5 + 0.5 * smoothstep(0.1, 0.55, n.r);
        vec3 alb = vCol.rgb, col;
        if (vRot.w > 0.5)                                                                             // dust: lit as the ground it rose from is (the sun on level ground, the whole sky), more
          col = alb * 0.3183 * (uSunC * max(dot(vLd, vUd), 0.0) * (1.0 + 0.7 * clamp(dot(N, vLd), 0.0, 1.0) * cav) + uSkyC);   // where it faces the sun, never less
        else {
          alb *= mix(0.5, 1.0, smoothstep(0.0, 0.4, k));                                              // smoke is sooty where it leaves the fire
          col = alb * 0.5 * (uSunC * sunw * sunw * cav + uSkyC * (0.5 + 0.5 * up) * (0.6 + 0.4 * cav) + uGndC * (0.5 - 0.5 * up));
        }
        col += alb * uSunC * pow(max(-vLd.z, 0.0), 3.0) * (1.0 - den) * 0.22;                        // thin edges let the sun through
        col += vec3(1.0, 0.3, 0.055) * vP.w * (0.2 + 0.8 * clamp(0.5 - 0.75 * up, 0.0, 1.0)) * (0.45 + 0.9 * w);   // lit from underneath by the fire
        gl_FragColor = vec4(mix(col, uFog, vFogF), den * vCol.a * meet());
        }`) +
        `/* glsl */
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    const mesh = new THREE.Mesh(particleGeometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = additive ? additiveOrder : alphaOrder;
    mesh.layers.set(layer);
    scene.add(mesh);
    return {
      cap: capacity,
      add: additive,
      head: 0,
      cycleEnd: -Infinity,
      previousCycleEnd: -Infinity,
      pos: pos.array,
      vel: vel.array,
      dat: dat.array,
      col: col.array,
      sed: sed.array,
      attrs: [pos, vel, dat, col, sed],
      lo: 1e9,
      hi: -1,
      dirty: false,
      wrapped: false,
      until: 0, // when the last particle sent out dies: until then the pool is drawn
      pts: mesh,
    };
  }
  // The particle pSpawn sends out next, set field by field by its caller: pSpawn is too long for the engine to take into its callers,
  // and the numbers it was passed as arguments were made anew at every call, sixteen a particle. Place, velocity, life (seconds),
  // size, colour, drag and gravity are set for every particle; e1, e2 and e3 only where they differ from what pSpawn puts back:
  // additive pool: kind (0 glow, 1 flame, 2 ember), unused, how hard the wind pushes it;
  // alpha pool: opacity (negative for dust, which is lit as the ground it rose from), heat (orange light from a fire beneath), how
  // hard the wind pushes it.
  const spawn = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, size: 0, r: 0, g: 0, b: 0, drag: 0, grav: 0, e1: NaN, e2: 0, e3: 0 };
  // Sends out the particle set in `spawn` from pool s, and puts its e1 (NaN: the pool's own, 0 additive, 0.5 alpha), e2 and e3 back.
  function pSpawn(system) {
    const particle = spawn,
      i = system.head,
      i3 = i * 3,
      i4 = i * 4;
    system.head = i + 1 === system.cap ? 0 : i + 1;
    if (system.head === 0) system.wrapped = true;
    system.pos[i3] = particle.x;
    system.pos[i3 + 1] = particle.y;
    system.pos[i3 + 2] = particle.z;
    system.vel[i3] = particle.vx;
    system.vel[i3 + 1] = particle.vy;
    system.vel[i3 + 2] = particle.vz;
    const time = elapsed();
    system.dat[i4] = time;
    system.dat[i4 + 1] = particle.life;
    // Use the birth and lifetime the shader receives, including float32 rounding.
    system.cycleEnd = Math.max(system.cycleEnd, system.dat[i4] + system.dat[i4 + 1]);
    if (system.head === 0) {
      system.previousCycleEnd = system.cycleEnd;
      system.cycleEnd = -Infinity;
    }
    if (time + particle.life > system.until) system.until = time + particle.life;
    system.dat[i4 + 2] = particle.size;
    system.dat[i4 + 3] = particle.grav;
    system.col[i4] = particle.r;
    system.col[i4 + 1] = particle.g;
    system.col[i4 + 2] = particle.b;
    system.col[i4 + 3] = particle.drag;
    system.sed[i4] = random();
    system.sed[i4 + 1] = Number.isNaN(particle.e1) ? (system.add ? 0 : 0.5) : particle.e1;
    system.sed[i4 + 2] = particle.e2;
    system.sed[i4 + 3] = particle.e3;
    particle.e1 = NaN;
    particle.e2 = particle.e3 = 0;
    if (i < system.lo) system.lo = i;
    if (i > system.hi) system.hi = i;
    system.dirty = true;
  }
  // Uploads the parts of a particle system's buffers that changed this frame, and draws the system only while a particle lives.
  function pFlush(system) {
    system.pts.visible = elapsed() < system.until;
    // All slots at or beyond the write head are from the previous lap of the ring.
    // Keep their original blend order until even its longest-lived particle has expired.
    system.pts.geometry.instanceCount = Math.fround(fxU.uTime.value) <= system.previousCycleEnd ? system.cap : system.head;
    if (!system.dirty) return;
    for (let k = 0; k < system.attrs.length; k++) {
      const attribute = system.attrs[k];
      attribute.clearUpdateRanges();
      if (!system.wrapped) attribute.addUpdateRange(system.lo * attribute.itemSize, (system.hi - system.lo + 1) * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    system.dirty = false;
    system.wrapped = false;
    system.lo = 1e9;
    system.hi = -1;
  }

  return { emberMaterial, fxU, makeParticles, pFlush, pSpawn, spawn };
}
