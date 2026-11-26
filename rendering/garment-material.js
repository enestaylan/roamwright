import { CREASED, PLAIN } from '../geometry/garment-tags.js';
import { FOLD_SLOPES } from '../math/cloth-textures.js';

const FOLDS = {
  hang: [1, 0.3], //      the long folds' texture tiles round the body (once: no fold comes twice) and for each metre up it
  crumple: [5, 4.2], //   the crumple's, and how far it leans round the body for each metre up it
  lean: 1.3,
  deep: [0.014, 0.009], // how far each stands out at its fullest (metres)
  smooth: 0.28, //        how much of the long folds cloth that lies smooth has, of what cloth hanging in folds has
  shade: [0.55, 0.45], // how much darker the foot of a long fold is, and a crease of the crumple
  fade: [0.008, 0.022], // the size of a pixel (metres) from which the folds fade and are gone: a fold a pixel or two wide would crawl
  slope: FOLD_SLOPES, //    the steepest slope each field's byte holds (of its height, for each tile)
};
const shaderFloat = value => value.toFixed(4);
// What each kind of garment is to the eye (KIND order): how much of the
// cloth texture's weave is smoothed away and the tone it is left at (of a plain weave's), how much of the long folds and of
// the crumple it takes, how rough it is (a plain weave keeps the material's own: 0) and how much a metal.
const KINDS = [
    [0, 1, 1, 1, 0, 0], //          wool: the weave as it is, soft and matte
    [0.55, 1.14, 1, 1.35, 0.84, 0], // linen: a finer, paler weave, which crumples more
    [0.82, 1.04, 1.05, 0.6, 0.6, 0], // silk: its fine weave barely seen, and a soft sheen that moves with the light over its folds
    [0.92, 0.96, 0.22, 0.75, 0.56, 0], // leather: smooth, creased where it bends, with a low sheen
    [1, 0.87, 0, 0, 0.48, 0.48], // mail: small links over a dark backing
    [1, 1.12, 0, 0, 0.34, 0.6], //   plate: smooth and bright, no folds
  ],
  WEAVE_TONE = 0.76, // the tone of the plain weave (the cloth texture's, with its gain), which a smoothed kind keeps
  LEATHER = { grain: 0.14, worn: 0.18 },
  PLATE_WEAR = { face: 0.22, edge: 0.38 },
  MAIL = { around: 120, up: 210, fade: [0.18, 0.44] }, // links to the circumference and rows per metre
  kindOf = column =>
    `(kind < 0.5 ? ${shaderFloat(KINDS[0][column])} : kind < 1.5 ? ${shaderFloat(KINDS[1][column])} : kind < 2.5 ? ${shaderFloat(KINDS[2][column])} : kind < 3.5 ? ${shaderFloat(KINDS[3][column])} : kind < 4.5 ? ${shaderFloat(KINDS[4][column])} : ${shaderFloat(KINDS[5][column])})`;
// What the fragment shader declares: the textures; the folds' slopes across the screen (metres of height a pixel), which
// GARMENT_FOLDS works out and FOLD_RELIEF turns the normal by; and how worn smooth a spot of leather is, for its sheen.
const FOLD_PARS = `/* glsl */
uniform sampler2D uFolds, uCrumple;
vec2 gFold = vec2(0.0);
float gWorn = 0.0;
float mailLink(vec2 uv, float row, float aa) {
  float x = fract(uv.x + 0.5 * mod(row, 2.0)) - 0.5;
  float y = uv.y - row - 0.5;
  float radius = length(vec2(x + y * (0.24 - 0.48 * mod(row, 2.0)), y * 0.74));
  return 1.0 - smoothstep(0.052, 0.052 + aa, abs(radius - 0.42));
}`;
// In the surface's colour (after vSk, the tag, and vL, the point as built, are known): the garment's own weave or smoothness,
// the folds' slopes, and their shade.
const GARMENT_FOLDS = `/* glsl */
      { float worn = -vSk, kind = floor(worn + 0.001), show = step(0.05, worn) * (1.0 - smoothstep(${shaderFloat(FOLDS.fade[0])}, ${shaderFloat(FOLDS.fade[1])}, length(fwidth(vViewPosition))));
        vec3 bx = dFdx(vL), by = dFdy(vL);
        if (worn > 0.05) { float even = ${kindOf(0)}; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${shaderFloat(WEAVE_TONE)}), even) * ${kindOf(1)}; gH = mix(gH, 0.5, even); }
        if (show > 0.0) {
          float crease = clamp((worn - kind - ${shaderFloat(PLAIN)}) / ${shaderFloat(CREASED - PLAIN)}, 0.0, 1.0), turn = atan(vL.x, vL.z) * 0.15915494;
          // how far round the body, and up it, a pixel to the right and a pixel up are
          vec2 round = vec2(vL.z * bx.x - vL.x * bx.z, vL.z * by.x - vL.x * by.z) / (6.2832 * max(dot(vL.xz, vL.xz), 0.0036)), up = vec2(bx.y, by.y);
          vec2 hu = round * ${shaderFloat(FOLDS.hang[0])}, cu = round * ${shaderFloat(FOLDS.crumple[0])} + up * ${shaderFloat(FOLDS.lean)}, cv = up * ${shaderFloat(FOLDS.crumple[1])};
          vec2 hang = textureLod(uFolds, vec2(turn * ${shaderFloat(FOLDS.hang[0])}, vL.y * ${shaderFloat(FOLDS.hang[1])}), 0.5 * log2(max(dot(hu, hu), dot(up, up) * ${shaderFloat(FOLDS.hang[1] ** 2)}) * 65536.0)).rg;
          vec3 crumple = textureLod(uCrumple, vec2(turn * ${shaderFloat(FOLDS.crumple[0])} + vL.y * ${shaderFloat(FOLDS.lean)}, vL.y * ${shaderFloat(FOLDS.crumple[1])}), 0.5 * log2(max(dot(cu, cu), dot(cv, cv)) * 65536.0)).rgb;
          // half gathered, the cloth hangs in its long folds; past that it is crumpled as well. Leather is creased a little wherever it is
          float leather = 1.0 - step(0.5, abs(kind - 3.0)), fall = show * mix(${shaderFloat(FOLDS.smooth)}, 1.0, min(1.0, crease * 2.0)) * ${kindOf(2)};
          float crush = max(crease * 2.0 - 1.0, 0.0); crush = show * max(crush * crush, 0.15 * leather) * ${kindOf(3)};
          gFold = fall * ${shaderFloat(FOLDS.deep[0] * FOLDS.slope[0])} * (hang.r * 2.0 - 1.0) * hu
            + crush * ${shaderFloat(FOLDS.deep[1] * FOLDS.slope[1])} * ((crumple.r * 2.0 - 1.0) * cu + (crumple.g * 2.0 - 1.0) * cv);
          diffuseColor.rgb *= (1.0 - ${shaderFloat(FOLDS.shade[0])} * fall * (1.0 - hang.g)) * (1.0 - ${shaderFloat(FOLDS.shade[1])} * crush * (1.0 - crumple.b));
          // Plate's tag can mark an exposed edge. The existing crease field breaks up its polish.
          float plate = step(4.5, kind);
          float edge = plate * smoothstep(0.65, 0.96, crease) * mix(0.6, 1.0, crumple.b);
          gWorn = show * max(max(leather, plate) * crumple.b, edge);
          diffuseColor.rgb *= 1.0 + show * (${shaderFloat(PLATE_WEAR.edge)} * edge - plate * ${shaderFloat(PLATE_WEAR.face)} * (1.0 - crumple.b) * (1.0 - edge));
          diffuseColor.rgb *= 1.0 + leather * show * (${shaderFloat(LEATHER.worn)} * crumple.b * crumple.b - ${shaderFloat(LEATHER.grain)} * (1.0 - crumple.b));
          if (kind == 4.0) {
            float pixel = max(length(round) * ${shaderFloat(MAIL.around)}, length(up) * ${shaderFloat(MAIL.up)});
            float detail = 1.0 - smoothstep(${shaderFloat(MAIL.fade[0])}, ${shaderFloat(MAIL.fade[1])}, pixel);
            if (detail > 0.0) {
              vec2 uv = vec2(turn * ${shaderFloat(MAIL.around)}, vL.y * ${shaderFloat(MAIL.up)});
              float row = floor(uv.y), aa = max(0.02, pixel * 0.5);
              // Alternating rows lean and stagger so adjacent links meet on the half-row.
              float link = max(mailLink(uv, row, aa), mailLink(uv, row + (fract(uv.y) < 0.5 ? -1.0 : 1.0), aa));
              diffuseColor.rgb *= 1.0 + detail * (link - 0.4) * 0.75;
              gH += detail * (link - 0.4) * 0.10;
              gWorn = detail * link * 0.32;
            }
          }
        } }`;
// After the material's own roughness and metalness are known: the garment's.
const GARMENT_SHEEN = `/* glsl */
        { float worn = -vSk, kind = floor(worn + 0.001), rough = ${kindOf(4)};
          if (worn > 0.05) { if (rough > 0.0) roughnessFactor = rough - 0.16 * gWorn; metalnessFactor = ${kindOf(5)}; } }`;
// After the surface's normal is known: turned down the folds' slopes.
const FOLD_RELIEF = `/* glsl */
        { vec3 fgx = dFdx(-vViewPosition), fgy = dFdy(-vViewPosition), f1 = cross(fgy, normal), f2 = cross(normal, fgx);
          float fdet = dot(fgx, f1);
          vec3 fn = abs(fdet) * normal - sign(fdet) * (gFold.x * f1 + gFold.y * f2); float fl = dot(fn, fn);
          if (fl > 1e-16) normal = fn * inversesqrt(fl); }`;

// GLSL stages for a standard material. The host supplies its object-space position vL,
// garment tag vSk, sampled weave tx, and scalar relief gH.
function garmentShader({ scale = 1, threads = 64, smoothness = 'vSk', textureSize = 256 } = {}) {
  const sampleArea = (textureSize * textureSize).toFixed(1);
  const weaveScale = typeof scale === 'number' ? scale.toFixed(4) : scale;
  return {
    declarations: FOLD_PARS,
    color: `/* glsl */
      { float sk = clamp(${smoothness}, 0.0, 1.0); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.14 + 0.12 * tx.g), sk); gH = mix(gH, 0.5, sk); }
      gH = mix(gH, 0.5, smoothstep(0.15, 0.45, length(fwidth(vViewPosition)) * ${weaveScale} * ${threads.toFixed(1)}));
      ${GARMENT_FOLDS.replaceAll('65536.0', sampleArea)}`,
    normal: FOLD_RELIEF,
    roughness: `roughnessFactor = mix(mix(roughnessFactor, 0.56, clamp(${smoothness}, 0.0, 1.0)), 0.1, clamp(${smoothness} - 1.0, 0.0, 1.0));`,
    metalness: GARMENT_SHEEN,
  };
}
export { garmentShader };
