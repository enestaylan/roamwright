/**
 * Render the sky and its depth mask from a cloud field and a cloud dome.
 * @module
 */

import * as THREE from 'three';

/**
 * Combine a cloud field and dome into a sky mesh and a mask for effects passes.
 * Both meshes share geometry. Call the returned `dispose()` when finished with the pair.
 * @param options - Outputs from `createCloudField` and `createCloudDome`, plus an optional moon angular radius in radians.
 */
export function createSky({ field, dome, moonRadius: MOON_RADIUS = 0.0347 }) {
  const {
    fieldGLSL: CLOUD_FIELD_PARS,
    dip: DIP,
    projection: FLARE,
    fadeStart: LOWEST,
    fadeEnd: WHOLE,
    uniforms: cloudU,
    sheetSpan: CLOUD_SHEET,
  } = field;
  const { sampleGLSL: DOME_PARS, uniforms: domeU } = dome;
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3() },
      uMoonDir: { value: new THREE.Vector3() },
      uMoonLit: { value: 1 }, // how bright the moon is for its phase: its halo's strength
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunCol: { value: new THREE.Color() },
      uNight: { value: 0 },
      uDusk: { value: 0 },
      uDay: { value: 1 },
      uLow: { value: 0 },
      uTime: { value: 0 },
      uCloud: { value: 0.5 }, // the field's value where cloud begins: the lower, the more of the sky is covered
      uWet: { value: 0 },
      uDust: { value: 0 }, // how much blown sand is in the air: it hides the stars and pales the sun and moon
      uThin: { value: 0 }, // how far the sky is closed over by a thin, dry sheet of cloud (a scene's own sky), not by rain cloud
      uGlow: { value: new THREE.Color(0, 0, 0) },
      uGlowDir: { value: new THREE.Vector3(0, -1, 0) },
      uCloudField: cloudU.uCloudField,
      uCloudAt: { value: new THREE.Vector2() }, // where the sheet lies over the viewer, for the thin high cloud
      uCloudDir: { value: new THREE.Vector3(0, 1, 0) }, // towards the light on the clouds: the sun, or by night the moon
      uCloudLight: { value: new THREE.Color() }, // that light: white by day, gold as the sun sinks, rose after it has set
      ...domeU,
    },
    vertexShader: `/* glsl */ varying vec3 vDir;
      void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `/* glsl */
      uniform float uMoonLit;
      uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uSunCol, uGlow, uGlowDir, uCloudDir, uCloudLight;
      uniform float uNight, uDusk, uDay, uLow, uTime, uCloud, uWet, uDust, uThin;
      uniform vec2 uCloudAt;
      ${CLOUD_FIELD_PARS}
      ${DOME_PARS}
      varying vec3 vDir;
      const float SHEET = ${(FLARE / CLOUD_SHEET).toFixed(6)};      // the sheet's share of a unit of the layer
      const float MANY = 0.86;       // how much of the light scattered many times in a cloud comes out of it,
      const float ONCE = 0.5;        // and of the light scattered once
      float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float hash13(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
      // where a direction meets the clouds' base, on the sheet
      vec2 sheetAt(vec3 d){ return d.xz / (max(d.y, 0.0) + ${DIP}) * SHEET + uCloudAt; }
      // how much of a cloud is drawn at a direction's height: none low in the sky, over the roofs and hills (cloud-field.js)
      float aloft(float y){ return smoothstep(${LOWEST}, ${WHOLE}, y); }
      // how much of the light a drop sends on at an angle from the way it came (c the cosine): g > 0 mostly onwards
      float sentOn(float c, float g){ float k = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (k * sqrt(k)); }
      // the clouds in a direction: rgb the light they send to the eye, a how much of the sky behind them they hide
      vec4 clouds(vec3 d, vec3 behind){
        vec4 dome = cloudDome(d);
        vec3 sky = mix(vec3(dot(uHorizon, vec3(0.3, 0.5, 0.2))), mix(uHorizon, uZenith, 0.35 + 0.35 * uLow), 0.55 + 0.2 * uLow);      // the sky's own light on a cloud: greyed, bluer than the horizon, and cool against the gold of a low sun
        sky *= 1.0 + 0.3 * uDusk + 0.9 * uWet;      // at dusk the whole sky glows; under rain cloud all the light there is comes down through the cloud
        float toLight = dot(d, uCloudDir);
        // light scattered once goes mostly on the way it came, so a thin edge before the sun is the brightest thing in the sky; a little comes back
        float once = 0.35 * sentOn(toLight, 0.75) + 0.45 * sentOn(toLight, 0.4) + 0.2 * sentOn(toLight, -0.3);
        vec3 lit = uCloudLight * (dome.r * MANY * (1.0 + 0.15 * toLight) + dome.g * ONCE * once) + sky * dome.b;
        // a closed, dry sky is a thin sheet: pale with the light that comes through it, a little darker where it hangs thicker, bright round the sun
        vec3 sheet = (uCloudLight * (0.55 + 0.12 * sentOn(toLight, 0.6)) + sky * 0.6) * (0.55 * dome.a + 1.1 * dome.b);
        lit = mix(lit, sheet, uThin);
        float far = exp(-d.y * 7.0);      // far clouds sink into the haze over the horizon
        lit = mix(lit, behind * dome.a, far * 0.8);
        return vec4(lit, dome.a) * aloft(d.y);
      }
      #ifdef SKY_MASK
      uniform sampler2D tDepth; uniform vec2 uPx;
      #endif
      void main(){
        vec3 d = normalize(vDir);
        #ifdef SKY_MASK
        // what blocks the light shafts: anything solid (it wrote depth) fully, cloud by how thick it lies (its thin edges pass the light), open sky not at all
        gl_FragColor = vec4(texture2D(tDepth, gl_FragCoord.xy * uPx).x < 1.0 ? 1.0 : d.y > 0.0 ? smoothstep(0.3, 1.0, cloudDome(d).a) * aloft(d.y) * 0.75 : 0.0);
        return;
        #endif
        float up = max(d.y, 0.0);
        float sd = max(dot(d, uSunDir), 0.0), md = max(dot(d, uMoonDir), 0.0);
        // scattering-style gradient: dense air at the horizon, deep colour overhead
        // while the sun is low the gold lies round the sun's side of the horizon; the far side stays cool, and the blue comes down nearer
        float toSun = dot(d, uSunDir) * 0.5 + 0.5;
        vec3 hor = mix(mix(uHorizon, uZenith, 0.5 * uLow), uHorizon, toSun * toSun);
        vec3 col = mix(hor, uZenith, pow(up, mix(0.42, 0.3, uLow)));
        // warm forward scattering toward a low sun
        col += vec3(1.0, 0.42, 0.14) * uDusk * pow(sd, 6.0) * (1.0 - up) * 0.7;
        col += uSunCol * uLow * (pow(sd, 3.0) * 0.3 + pow(sd, 14.0) * 0.35) * (1.0 - 0.75 * up);      // and a wide glow of its own colour through the thick low air
        col += uSunCol * uDay * (pow(sd, 48.0) * 0.22 + pow(sd, 900.0) * 1.2) * (1.0 - 0.45 * uLow);
        // light from a source below the horizon
        vec3 gd = normalize(vec3(uGlowDir.x, 0.0, uGlowDir.z) + 1e-5);
        float gw = pow(max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), gd), 0.0), 2.5) * pow(1.0 - up, 3.0);
        col += uGlow * gw;
        vec3 air = col;      // the sky's own colour in this direction, which far clouds sink into
        vec4 cl = d.y > 0.0 ? clouds(d, air) : vec4(0.0);
        // sun disc
        col += uSunCol * smoothstep(0.99955, 0.99985, dot(d, uSunDir)) * 28.0 * (1.0 - 0.6 * uLow) * (1.0 - 0.8 * uDust) * step(-0.05, d.y);      // dimmed and reddened by the air it shines through when low
        // stars
        vec3 sp = d * 190.0; vec3 ip = floor(sp);
        float sr = hash13(ip);
        float star = step(0.9965, sr) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5));
        star *= 0.6 + 0.4 * sin(uTime * (1.5 + sr * 40.0) + sr * 90.0);
        col += vec3(0.8, 0.9, 1.0) * star * uNight * 2.2 * smoothstep(0.0, 0.2, d.y) * (1.0 - uDust);
        // moon disc with soft halo and a hint of maria
        float mdisc = smoothstep(0.99925, 0.99955, md), mlit = 0.0;
        if (mdisc > 0.0) {
          // its phase: the face is a sphere lit from the sun's side, the rest of it faint with the light the world throws back
          vec3 mo = (d - uMoonDir * md) / ${MOON_RADIUS};
          vec3 mn = mo - uMoonDir * sqrt(max(1.0 - dot(mo, mo), 0.0));
          mlit = mix(0.03, 1.0, smoothstep(-0.03, 0.09, dot(mn, uSunDir)));
        }
        float mtex = 0.75 + 0.25 * vn(d.xy * 60.0 + d.z * 31.0);
        col += vec3(0.80, 0.86, 1.0) * (mdisc * mlit * mtex * 2.4 + (pow(md, 220.0) * 0.20 + pow(md, 24.0) * 0.035) * uMoonLit) * (0.25 + 0.75 * uNight) * (1.0 - 0.8 * uDust);
        if (d.y > 0.0) {
          // a thin veil of high cloud, far above the layer: only well up the sky, where it does not draw out into streaks
          vec2 across = sheetAt(d) * ${field.textureSize.toFixed(1)};      // in texels
          float fine = min(log2(max(length(dFdx(across)), length(dFdy(across)))), 7.0);      // the sheet's level of detail a pixel can show
          float high = textureLod(uCloudField, sheetAt(d) * 0.45 + 0.37, max(fine - 1.0, 0.0)).b;
          float veil = smoothstep(0.5, 0.95, high) * smoothstep(0.1, 0.45, d.y) * smoothstep(0.95, 0.6, uCloud) * 0.26 * (1.0 - 0.6 * uNight);
          col = mix(col, uCloudLight * (0.8 + 1.2 * pow(sd, 6.0)) + mix(uHorizon, uZenith, 0.3) * 0.6, veil);
          col = col * (1.0 - cl.a) + cl.rgb + uGlow * gw * 1.6 * cl.a;      // the clouds hide what lies behind them, the sun, moon and stars too; smoke and cloud over a fire are lit from beneath
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -1000;

  // The same sky drawn as the light-shaft pass's mask (post.js), sharing the sky's uniforms; the scene's colour has no alpha to carry it.
  const skyMask = new THREE.Mesh(
    skyMesh.geometry,
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      uniforms: { ...skyMat.uniforms, tDepth: { value: null }, uPx: { value: new THREE.Vector2() } },
      defines: { SKY_MASK: 1 },
      vertexShader: skyMat.vertexShader,
      fragmentShader: skyMat.fragmentShader,
    }),
  );
  skyMask.frustumCulled = false;
  return {
    mesh: skyMesh,
    mask: skyMask,
    material: skyMat,
    dispose() {
      skyMesh.geometry.dispose();
      skyMat.dispose();
      skyMask.material.dispose();
    },
  };
}
