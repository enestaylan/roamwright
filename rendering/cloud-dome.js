import * as THREE from 'three';
import { QUAD_VS } from './post-shaders.js';

export function createCloudDome({ renderer, field, warmProgram }) {
  const {
    fieldGLSL: CLOUD_FIELD_PARS,
    dip: DIP,
    projection: FLARE,
    fadeStart: LOWEST,
    span: SPAN,
    thickness: THICK,
    billows: cloudBillows,
    uniforms: cloudU,
    overhead,
    sheetSpan: CLOUD_SHEET,
  } = field;
  const RIM = 1.02, // the map's rim, where the horizon lies at 1: a little below the horizon is drawn too
    DEPTH = FLARE * THICK, // the layer's depth in the field's units
    SEEN_AT = FLARE * (1 + 0.3 * THICK), // the height in the layer, in the field's units, at which a map is moved to follow the viewer
    BLOCKS = 12 / CLOUD_SHEET, // blocks of billows to a unit of the field: a whole number to the sheet, so the two repeat together
    TEXELS = field.textureSize / CLOUD_SHEET, // the sheet's texels to a unit of the field
    FADE = 0.14, // seconds a finished map takes to fade in
    RISE = 0.0018, // blocks a second the billows rise through the clouds (about 3 m/s), and
    SIDLE = 0.0006, // drift against them
    JUMP = 0.6, // the viewer carried further than this in one frame (the field's units) is a cut: the clouds are drawn whole at once
    TURNED = 0.96, // and so is a light that turned by more than this cosine,
    CHANGED = 0.1; // or a sky whose threshold moved by more
  const formatFloat = (v, digits = 4) => v.toFixed(digits);

  const DOME_FS = `/* glsl */
    precision highp float; precision highp sampler3D;
    uniform sampler3D uBillows;
    uniform vec2 uAt;         // the sheet over the viewer
    uniform vec3 uLight;      // towards the light
    uniform vec3 uChurn;      // how far the billows have risen and drifted, in blocks
    uniform float uCloud;     // the field's value where cloud begins
    ${CLOUD_FIELD_PARS}
    varying vec2 vUv;
    const float SIGMA = 32.0;        // how much light a unit of the field's length of full cloud takes, as an optical depth
    const float SOFT = 0.022;        // how far into a cloud's body (in the field's value) its edge thickens to full cloud
    const float BASE_SOFT = 0.05;    // and how far up from its flat base, as a share of the layer
    const float BASE_HOLLOW = 0.07, BASE_HOLLOW_CLOSED = 0.2;      // how far up the hollows of a cloud's base reach, as a share of the layer: under a fair sky, and that much more under a closed one
    const float ERODE = 0.12;        // how far the creases between billows eat into the body, and
    const float FINER = 0.42;        // the finer ones, as a share of that
    // Where a point lies in the block of billows: p from the viewer in the field's units, h its height in the layer.
    vec3 inBlock(vec2 p, float h) { return vec3(uAt * ${formatFloat(CLOUD_SHEET, 1)} + p, h * ${formatFloat(DEPTH)}).xzy * ${formatFloat(BLOCKS)}; }
    // How far inside a cloud's body a point lies, in the field's value: 0 at its edge, SOFT and more in full cloud, below 0 in
    // clear air. p: from the viewer in the field's units; h: its height in the layer (0 the base, 1 the top). over: how far the
    // field stands over the threshold there; base: what the cloud's underside leaves of it there (0 below it, 1 well above);
    // rough: how far the billows eat into it there.
    float bodyAt(vec2 p, float h, float lod, out float over, out float base, out float rough) {
      vec4 texel = textureLod(uCloudField, uAt + p * ${formatFloat(1 / CLOUD_SHEET, 6)}, lod);
      over = cloudField(texel) - uCloud;
      float h2 = h * h, body = over - ${formatFloat(SPAN)} * h2 * h2;
      rough = ERODE * (0.45 + 0.55 * smoothstep(0.0, 0.3, h));      // a cloud's base is smoother than its sides and top
      // the base is level but for shallow hollows between hanging bulges (the sheet's finer lumps), deeper under a closed sky
      base = smoothstep(0.0, BASE_SOFT, h - (BASE_HOLLOW + BASE_HOLLOW_CLOSED * smoothstep(0.25, 0.6, over)) * (1.0 - texel.g));
      if (body <= 0.0 || base <= 0.0) return min(body, 0.0) - rough * 0.55;      // clear air: as far out as the billows are eaten back on the whole
      return body - rough * (1.0 - dot(textureLod(uBillows, inBlock(p, h) + uChurn, lod).rgb, vec3(0.38, 0.38, 0.24)));
    }
    // The share of a stretch that is cloud when its two ends lie a and b inside the body, the body taken to change evenly between
    // them: a cloud's edge is found where it lies between two steps, not at the nearer step (which drew it in terraces).
    float filled(float startDensity, float endDensity) {
      vec2 densities = max(vec2(startDensity, endDensity), 0.0), sum = mix(densities * densities * ${formatFloat(0.5)} / SOFT, densities - 0.5 * SOFT, step(SOFT, densities));
      return abs(endDensity - startDensity) > 1e-4 ? clamp((sum.y - sum.x) / (endDensity - startDensity), 0.0, 1.0) : clamp(startDensity / SOFT, 0.0, 1.0);
    }
    void main() {
      vec2 r = (vUv - 0.5) * ${formatFloat(2 * RIM)};
      float r2 = dot(r, r);
      if (r2 >= ${formatFloat(RIM * RIM)}) { gl_FragColor = vec4(0.0); return; }
      float up = (1.0 - r2) / (1.0 + r2);                       // the direction's height: 1 overhead, 0 at the horizon
      if (up < ${formatFloat(LOWEST - 0.012)}) { gl_FragColor = vec4(0.0); return; }      // no cloud is drawn that low in the sky (cloud-field.js)
      vec2 q = r * (1.0 + up) / (max(up, 0.0) + ${formatFloat(DIP)});     // how far the ray runs level for each unit it climbs
      float reach = length(q), slope = sqrt(1.0 + reach * reach);
      int steps = int(min(float(STEPS) + 9.0 * reach, float(MAX_STEPS)));      // a ray near the horizon runs long through the layer
      float dh = 1.0 / float(steps);
      // the sheet's level of detail: a step is not finer than the way it travels, or a far cloud showed as a stack of slivers
      float lod = clamp(log2(max(reach * dh * ${formatFloat(DEPTH * TEXELS)}, 0.01)) - 0.5, 0.0, 3.0);
      float finer = FINER * (1.0 - lod / 1.5);      // the finer billows fade out where a step is too long to show them
      // each ray's steps stand a little higher or lower than its neighbours', so what is left of the layer's levels in a cloud's
      // shading does not run on as lines
      float shift = 0.33 + 0.34 * fract(52.9829189 * fract(dot(gl_FragCoord.yx, vec2(0.06711056, 0.00583715))));
      float seen = 1.0, was = -1.0, wasFine = -1.0, over, base, rough, none;
      vec3 sum = vec3(0.0);
      for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= steps) break;
        float h = (float(i) + shift) * dh;
        vec2 p = q * (${formatFloat(FLARE)} * (1.0 + h * ${formatFloat(THICK)}));
        float body = bodyAt(p, h, lod, over, base, rough), cloud;
        #if FINE
          if (finer > 0.0 && max(was, body) > 0.0) {
            // the stretch since the last step in three parts, the finer billows read in each: they are smaller than a step
            cloud = 0.0;
            for (int k = 1; k <= 3; k++) {
              float t = float(k) / 3.0, hk = h - (1.0 - t) * dh, part = mix(was, body, t);
              if (part > 0.0) {
                vec3 small = textureLod(uBillows, inBlock(q * (${formatFloat(FLARE)} * (1.0 + hk * ${formatFloat(THICK)})), hk) * 4.0 + uChurn.zxy * 3.0, lod).rgb;
                part -= rough * finer * (1.0 - dot(small, vec3(0.5, 0.3, 0.2)));
              }
              cloud += filled(wasFine, part);
              wasFine = part;
            }
            cloud *= base / 3.0;
          } else
        #endif
        {
          cloud = filled(was, body) * base;
          wasFine = body;
        }
        // the light is found at the middle of the part of the stretch that is cloud, not at the step: a cloud's face lit at the
        // steps' own levels, a little inside it or far, showed those levels as lines in its shading
        float enters = was < 0.0 && body > 0.0 ? was / (was - body) : 0.0, leaves = was > 0.0 && body < 0.0 ? was / (was - body) : 1.0;
        float lit = h - (1.0 - 0.5 * (enters + leaves)) * dh;
        was = body;
        if (cloud < 0.003) continue;
        // the cloud between this point and the light, in steps that lengthen
        float between = 0.0, gone = 0.0, span = float(L_FIRST);
        vec2 from = q * (${formatFloat(FLARE)} * (1.0 + lit * ${formatFloat(THICK)}));
        for (int j = 0; j < LIGHT_STEPS; j++) {
          float l = gone + 0.5 * span, hl = lit + uLight.y * l * ${formatFloat(1 / DEPTH)};
          if (hl <= 0.0 || hl >= 1.0) break;
          between += clamp(bodyAt(from + uLight.xz * l, hl, max(lod, 0.5) + 0.5 * float(j), none, base, rough) / SOFT, 0.0, 1.0) * base * span;
          gone += span; span *= float(L_GROW);
        }
        between *= SIGMA;
        float once = exp(-between);                                                 // light that comes straight through
        float many = 0.7 * exp(-between * 0.3) + 0.3 * exp(-between * 0.1);         // and light passed on from drop to drop, which reaches deeper
        float top = sqrt(sqrt(clamp(over * ${formatFloat(1 / SPAN)}, 0.0, 1.0)));
        // the sky's light: from above, less the deeper under the cloud's top, and a little from below on its base
        float sky = 0.84 * exp(-3.0 * max(top - lit, 0.0)) * (0.5 + 0.5 * lit) + 0.16 * exp(-5.0 * lit);
        float a = 1.0 - exp(-cloud * (SIGMA * ${formatFloat(DEPTH)}) * dh * slope);
        sum += seen * a * vec3(many, once, sky);
        seen *= 1.0 - a;
        if (seen < 0.02) break;
      }
      // each is kept in a byte: a grain of half a step of it hides the steps between
      float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
      gl_FragColor = vec4(sum, min((1.0 - seen) * ${formatFloat(1 / 0.98)}, 1.0)) + grain * ${formatFloat(1 / 255, 6)};
    }`;

  // For the sky's shader: declares cloudDome(d), the clouds' picture in a direction above the horizon (r, g, b, a as above).
  const DOME_PARS = `/* glsl */
    uniform sampler2D uDome, uDomeNext; uniform vec4 uDomeShift; uniform float uDomeMix;
    // where a ray that runs q level for each unit it climbs lies in a map
    vec2 domeUv(vec2 q) {
      float Q = dot(q, q), up = (sqrt(1.0 + Q * ${formatFloat(1 - DIP * DIP, 6)}) - Q * ${formatFloat(DIP)}) / (1.0 + Q);
      return 0.5 + q * ((up + ${formatFloat(DIP)}) / (1.0 + up) * ${formatFloat(0.5 / RIM, 6)});
    }
    vec4 cloudDome(vec3 d) {
      vec2 q = d.xz / (max(d.y, 0.0) + ${formatFloat(DIP)});
      vec4 c = textureLod(uDome, domeUv(q + uDomeShift.xy), 0.0);
      if (uDomeMix > 0.0) c = mix(c, textureLod(uDomeNext, domeUv(q + uDomeShift.zw), 0.0), uDomeMix);
      return c;
    }`;
  // What the sky's shader reads: the map on show, the one fading in over it and how far it has; xy and zw how far each is moved.
  const domeU = {
    uDome: { value: null },
    uDomeNext: { value: null },
    uDomeShift: { value: new THREE.Vector4() },
    uDomeMix: { value: 0 },
  };

  const domeMat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uCloudField: cloudU.uCloudField,
      uBillows: cloudBillows,
      uAt: { value: new THREE.Vector2() },
      uLight: { value: new THREE.Vector3(0, 1, 0) },
      uChurn: { value: new THREE.Vector3() },
      uCloud: { value: 0.5 },
    },
    defines: { STEPS: 36, MAX_STEPS: 104, LIGHT_STEPS: 5, L_FIRST: '0.04', L_GROW: '1.7', FINE: 1 },
    vertexShader: QUAD_VS,
    fragmentShader: DOME_FS,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), domeMat),
    quadScene = new THREE.Scene().add(quad),
    quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad.frustumCulled = false;

  // The two maps: `shown` is whole and on show, `next` is being drawn (its bands below `band` are done) or fading in (`mix`).
  // (x, z): where the field lay over the viewer when each was begun. `last`: what the frame before saw, to know a cut by.
  const dome = {
    level: null,
    shown: null,
    next: null,
    shownAt: { x: 0, z: 0 },
    nextAt: { x: 0, z: 0 },
    bands: null, // the rows the map's bands begin at (equalBands)
    band: 0,
    fading: false,
    mix: 0,
    whole: false, // a whole map is on show
    last: { x: 0, z: 0, threshold: 0, light: new THREE.Vector3(), space: null },
  };
  // The rows at which a map is cut into `bands` bands that hold equal shares of the dome's circle: a frame draws one, and so
  // about as much sky as any other frame (a band of equal height at the map's middle held far more than one at its edge).
  function equalBands(size, bands) {
    const below = y => 0.5 + (y * Math.sqrt(1 - y * y) + Math.asin(y)) / Math.PI, // the share of a circle below y (-1 its foot, 1 its top)
      rows = [0];
    for (let bandIndex = 1; bandIndex < bands; bandIndex++) {
      let low = -1,
        high = 1;
      for (let i = 0; i < 30; i++) {
        const mid = (low + high) / 2;
        if (below(mid) < bandIndex / bands) low = mid;
        else high = mid;
      }
      rows.push(Math.round(((low + 1) / 2) * size));
    }
    rows.push(size);
    return rows;
  }
  const makeMap = size => {
    const map = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    map.scissorTest = true;
    return map;
  };
  // Sets the preset's level of cloud detail (3, 4 or 5): the maps' size and the steps of their drawing.
  let pending = Promise.resolve(),
    disposed = false;
  function setCloudDetail(level) {
    if (disposed) throw new Error('Cloud dome has been disposed');
    if (dome.level === level) return pending;
    dome.level = level;
    dome.bands = equalBands(level.size, level.frames);
    if (!dome.shown || dome.shown.width !== level.size) {
      dome.shown?.dispose();
      dome.next?.dispose();
      dome.shown = makeMap(level.size);
      dome.next = makeMap(level.size);
    }
    dome.whole = false;
    Object.assign(domeMat.defines, {
      STEPS: level.steps,
      MAX_STEPS: level.most,
      LIGHT_STEPS: level.light,
      L_FIRST: formatFloat(level.first),
      L_GROW: formatFloat(level.grow),
      FINE: level.fine,
    });
    domeMat.needsUpdate = true;
    const previous = renderer.getRenderTarget();
    const face = previous ? renderer.getActiveCubeFace() : 0;
    const mip = previous ? renderer.getActiveMipmapLevel() : 0;
    renderer.setRenderTarget(dome.shown);
    // compiled on the driver's threads before the first map is drawn, and put to its first use as soon as it is: used at that first
    // draw instead, it waited there behind every program begun since (30 to 50 ms of a later visit's "Setting the scenes")
    try {
      if (warmProgram) {
        const compilation = renderer.compileAsync(quad, quadCam).then(() => (disposed ? undefined : warmProgram(domeMat)));
        pending = Promise.all([pending, compilation]).then(() => undefined);
      }
    } finally {
      renderer.setRenderTarget(previous, face, mip);
    }
    return pending;
  }
  const wrap = v => v - Math.floor(v);
  // Begins a map: the clouds as they stand now, seen from where the viewer is, lit from `light`.
  function begin(at, light, threshold, seconds) {
    const u = domeMat.uniforms;
    at.x = overhead.x;
    at.z = overhead.z;
    u.uAt.value.set(wrap(at.x / CLOUD_SHEET), wrap(at.z / CLOUD_SHEET));
    u.uLight.value.copy(light);
    u.uCloud.value = threshold;
    u.uChurn.value.set(wrap(seconds * SIDLE), wrap(-seconds * RISE), wrap(seconds * -SIDLE * 0.7)); // read lower as time passes: the billows rise
  }
  // Draws `rows` rows of a map from `row` up, as the clouds stood when it was begun.
  function draw(map, row, rows) {
    const clears = renderer.autoClear;
    const previous = renderer.getRenderTarget();
    const face = previous ? renderer.getActiveCubeFace() : 0;
    const mip = previous ? renderer.getActiveMipmapLevel() : 0;
    map.scissor.set(0, row, map.width, rows);
    renderer.autoClear = false;
    renderer.setRenderTarget(map);
    try {
      renderer.render(quadScene, quadCam);
    } finally {
      renderer.setRenderTarget(previous, face, mip);
      renderer.autoClear = clears;
    }
  }
  // Each frame, after the field is placed: draws a little more of the next map of the clouds, or fades it in, and tells the
  // sky where the maps lie. light: towards the sun or the moon, whichever lights the clouds; threshold: the field's value
  // where cloud begins; seconds: the world's time; bright: how strong that light is now (a dark one may turn unseen, as when
  // the moon takes over from the sun that has set).
  function updateCloudDome(deltaSeconds, light, threshold, seconds, bright, region) {
    const { level, last } = dome,
      sheet = cloudU.uCloudField.value,
      billows = cloudBillows.value;
    if (!level || !sheet?.version || !billows?.version) return; // no preset yet, or the workers have not filled the sheet and the block
    const cut =
      !dome.whole ||
      last.space !== region ||
      Math.hypot(overhead.x - last.x, overhead.z - last.z) > JUMP ||
      Math.abs(threshold - last.threshold) > CHANGED ||
      (light.dot(last.light) < TURNED && bright > 0.01);
    last.space = region;
    last.x = overhead.x;
    last.z = overhead.z;
    last.threshold = threshold;
    last.light.copy(light);
    if (cut) {
      // nothing on show can be kept: the whole sky at once, and the next map begun from the same moment
      begin(dome.shownAt, light, threshold, seconds);
      draw(dome.shown, 0, level.size);
      dome.nextAt.x = dome.shownAt.x;
      dome.nextAt.z = dome.shownAt.z;
      dome.whole = true;
      dome.fading = false;
      dome.band = 0;
      dome.mix = 0;
    } else if (dome.fading) {
      dome.mix += deltaSeconds / FADE;
      if (dome.mix >= 1) {
        const shown = dome.next,
          at = dome.nextAt;
        dome.next = dome.shown;
        dome.nextAt = dome.shownAt;
        dome.shown = shown;
        dome.shownAt = at;
        dome.fading = false;
        dome.mix = 0;
      }
    } else {
      if (dome.band === 0) begin(dome.nextAt, light, threshold, seconds);
      const row = dome.bands[dome.band];
      draw(dome.next, row, dome.bands[++dome.band] - row);
      if (dome.band >= level.frames) {
        dome.band = 0;
        dome.fading = true;
      }
    }
    domeU.uDome.value = dome.shown.texture;
    domeU.uDomeNext.value = dome.next.texture;
    domeU.uDomeMix.value = dome.fading ? dome.mix : 0;
    domeU.uDomeShift.value.set(
      (overhead.x - dome.shownAt.x) / SEEN_AT,
      (overhead.z - dome.shownAt.z) / SEEN_AT,
      (overhead.x - dome.nextAt.x) / SEEN_AT,
      (overhead.z - dome.nextAt.z) / SEEN_AT,
    );
  }
  return {
    uniforms: domeU,
    sampleGLSL: DOME_PARS,
    setDetail: setCloudDetail,
    update: updateCloudDome,
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await pending;
      } finally {
        dome.shown?.dispose();
        dome.next?.dispose();
        quad.geometry.dispose();
        domeMat.dispose();
      }
    },
  };
}
