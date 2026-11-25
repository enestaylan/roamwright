import { Vector4 } from 'three';

export function createCloudField({
  textureSize = 512,
  height: CLOUD_HEIGHT = 1500,
  projection: FLARE = 1.15,
  horizonDip: DIP = 0.04,
  fadeStart: LOWEST = 0.05,
  fadeEnd: WHOLE = 0.14,
  thickness: THICK = 0.75,
  span: SPAN = 1.2,
  sheetSpan: CLOUD_SHEET = 16,
  windFactor: ALOFT = 4.5,
  shadowHeight: SHADOW_AT = 0.15,
  shadowThreshold: SHADOW_FROM = 0.02,
  shadowEdge: SHADOW_EDGE = 0.05,
  shadowStrength: SHADOW_DEPTH = 0.42,
} = {}) {
  const FIELD_PER_METRE = FLARE / CLOUD_HEIGHT,
    SHEET_PER_METRE = FIELD_PER_METRE / CLOUD_SHEET;
  const cloudU = {
    uCloudField: { value: null },
    uCloudSh: { value: new Vector4(0, 0, 0.5, 0) },
  };
  // The block of billows the clouds' sides and tops are shaped by of the procedural volume texture.
  const cloudBillows = { value: null };
  // Where the field lies over the viewer, in its own units and not wrapped to the sheet: what the clouds' picture is taken from
  // and moved by (the cloud dome).
  const overhead = { x: 0, z: 0 };
  // Declares the sheet and cloudField(texel): the field's value from a texel of it, its coarse part and its fine part
  // added.
  const CLOUD_FIELD_PARS = `/* glsl */
  uniform sampler2D uCloudField;
  float cloudField(vec4 texel) { return texel.r + (texel.a - 0.5) * ${(1 / 255).toFixed(8)}; }`;
  // Declares cloudShade(xz): what is left of the light at a point of the land (1 in the open, less under a cloud).
  const CLOUD_SHADE_PARS = `/* glsl */
  ${CLOUD_FIELD_PARS}
  uniform vec4 uCloudSh;
  float cloudShade(vec2 xz) { return 1.0 - uCloudSh.w * smoothstep(uCloudSh.z, uCloudSh.z + ${SHADOW_EDGE}, cloudField(texture2D(uCloudField, xz * ${SHEET_PER_METRE.toExponential(6)} + uCloudSh.xy))); }`;
  // The same for a material whose fragment shader has no texture unit to spare for the sheet and whose `map` is the ground's
  // grain, which carries a copy of the field in its alpha. A macro, since Three
  // declares `map` after the place this is spliced in.
  const CLOUD_SHADE_FROM_GRAIN = `/* glsl */
  uniform vec4 uCloudSh;
  #define cloudShade(xz) (1.0 - uCloudSh.w * smoothstep(uCloudSh.z, uCloudSh.z + ${SHADOW_EDGE}, texture2D(map, (xz) * ${SHEET_PER_METRE.toExponential(6)} + uCloudSh.xy).a))`;

  const wrap = v => v - Math.floor(v);
  // Each frame: where the sheet lies. Over the viewer at (x, z) it is `overhead`; the shadows' place is the same drift moved by
  // the light's slant (`light` points at the sun or moon). drift (a Vector2): how far the wind near the ground has carried the
  // air, in metres; threshold: the field's value where cloud begins; shade: 0 to 1, how much of a shadow's full depth shows
  // (none at night, under a closed sky, or indoors).
  function placeCloudField(x, z, drift, light, threshold, shade) {
    const driftX = drift.x * ALOFT * FIELD_PER_METRE,
      driftZ = drift.y * ALOFT * FIELD_PER_METRE,
      slant = (FLARE * (1 + SHADOW_AT * THICK)) / (Math.max(light.y, 0) + DIP),
      sh = cloudU.uCloudSh.value;
    overhead.x = x * FIELD_PER_METRE + driftX;
    overhead.z = z * FIELD_PER_METRE + driftZ;
    sh.set(
      wrap((driftX + light.x * slant) / CLOUD_SHEET),
      wrap((driftZ + light.z * slant) / CLOUD_SHEET),
      threshold + SHADOW_FROM,
      SHADOW_DEPTH * shade,
    );
  }
  return {
    textureSize,
    projection: FLARE,
    dip: DIP,
    fadeStart: LOWEST,
    fadeEnd: WHOLE,
    thickness: THICK,
    span: SPAN,
    sheetSpan: CLOUD_SHEET,
    fieldGLSL: CLOUD_FIELD_PARS,
    shadowGLSL: CLOUD_SHADE_PARS,
    packedShadowGLSL: CLOUD_SHADE_FROM_GRAIN,
    uniforms: cloudU,
    billows: cloudBillows,
    overhead,
    place: placeCloudField,
  };
}
