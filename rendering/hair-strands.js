import { HAIR_NEAR, HAIR_FAR, STRANDS } from '../geometry/hair-tags.js';

const shaderFloat = value => value.toFixed(4);
const LOOK = {
  fade: [0.22, 0.6], //   clumps to a pixel from which the strands fade, and are gone
  stand: [0.1, 0.3], //   and from which the clumps no longer stand out of the surface
  fine: 3, //             finer strands to a clump
  even: 0.945, //         the tone a far body's hair has, the cloth's weave being part of it there: a near body's has no weave
  tone: 0.34, //          how much lighter and darker the strands are than one another
  relief: 0.5, //         how far they stand out of the surface (of the weave's own relief)
  along: [95, 140, 88], // a strand's tone wanders along its length: its phase by where it is (a metre)
  sheen: [8, 20], //      metres from the eye over which the strands' own light fades
  rough: 0.5, //         how rough hair is to the light
  lie: 0.5, //           how far the light's band is drawn out across the strands (0: a round spot)
  shift: 0.55, //         how far the band shifts from one strand to the next
};
// A point's own tag as every other part of the material reads it: near hair's is far hair's.
const HAIR_PARS = `
float gHair = 0.0, gSheen = 0.0, gClump = 0.5; vec2 gAcross = vec2(0.0);
float strandOf(float cell, float period) { return fract(sin(mod(cell, period) * 91.7 + 3.1) * 43758.5453); }`;
const smoothOf = tag => `(${tag} > ${shaderFloat(HAIR_NEAR - 0.5)} ? ${shaderFloat(HAIR_FAR)} : ${tag})`;
// In the surface's colour, once the tag (vSk) and the point as built (vL) are known: the strands' tone and relief.
const HAIR_STRANDS = `/* glsl */
      { vec2 slope = vec2(dFdx(vSk), dFdy(vSk)) * ${shaderFloat(STRANDS.clumps)};
        if (vSk > ${shaderFloat(HAIR_NEAR - 0.5)}) {
          float thick = length(slope);
          gAcross = slope;
          gSheen = 1.0 - smoothstep(${shaderFloat(LOOK.sheen[0])}, ${shaderFloat(LOOK.sheen[1])}, length(vViewPosition));
          gHair = 1.0 - smoothstep(${shaderFloat(LOOK.fade[0])}, ${shaderFloat(LOOK.fade[1])}, thick);
          diffuseColor.rgb = vec3(${shaderFloat(LOOK.even)});
          gH = 0.5;
          if (gHair > 0.0) {
            float across = fract(vSk) * ${shaderFloat(STRANDS.clumps)}, cell = floor(across), t = across - cell;
            float wander = dot(vL, vec3(${LOOK.along.map(shaderFloat).join(', ')})), ease = t * t * (3.0 - 2.0 * t);
            // a clump's tone, and its slow change along its length, each eased into the next clump's
            float clump = mix(strandOf(cell, ${shaderFloat(STRANDS.clumps * STRANDS.period)}) + 0.22 * sin(wander + cell * 2.4),
              strandOf(cell + 1.0, ${shaderFloat(STRANDS.clumps * STRANDS.period)}) + 0.22 * sin(wander + cell * 2.4 + 2.4), ease);
            float thin = across * ${shaderFloat(LOOK.fine)}, cell2 = floor(thin), t2 = thin - cell2;
            float fine = mix(strandOf(cell2 + 7.0, ${shaderFloat(STRANDS.clumps * STRANDS.period * LOOK.fine)}), strandOf(cell2 + 8.0, ${shaderFloat(STRANDS.clumps * STRANDS.period * LOOK.fine)}), t2 * t2 * (3.0 - 2.0 * t2));
            float few = 1.0 - smoothstep(${shaderFloat(LOOK.fade[0] / LOOK.fine)}, ${shaderFloat(LOOK.fade[1] / LOOK.fine)}, thick);
            // the fine strands are a tone only; the clumps also stand out of the surface and shift the light, while they are
            // wide enough on the screen for their slopes to be read from one pixel to the next
            gClump = clamp(clump, 0.0, 1.0);
            diffuseColor.rgb *= 1.0 + gHair * ${shaderFloat(LOOK.tone)} * (mix(gClump, 0.55 * gClump + 0.45 * fine, few) - 0.5);
            gHair *= 1.0 - smoothstep(${shaderFloat(LOOK.stand[0])}, ${shaderFloat(LOOK.stand[1])}, thick);
            gH += gHair * ${shaderFloat(LOOK.relief)} * (gClump - 0.5);
          }
        } }`;
// After the material's own roughness is known.
const HAIR_SHEEN = `/* glsl */
        if (vSk > ${shaderFloat(HAIR_NEAR - 0.5)}) roughnessFactor = mix(roughnessFactor, ${shaderFloat(LOOK.rough)}, gSheen);`;
// After the surface's normal is known: turned toward the normal a strand shows the eye, which is square to the strand, so that
// the light on a head of hair lies in a band across the strands.
const HAIR_LIE = `/* glsl */
        if (gSheen > 0.0 && dot(gAcross, gAcross) > 1e-12) {
          vec3 hgx = dFdx(-vViewPosition), hgy = dFdy(-vViewPosition), h1 = cross(hgy, normal), h2 = cross(normal, hgx);
          vec3 climb = sign(dot(hgx, h1)) * (gAcross.x * h1 + gAcross.y * h2), strand = cross(normal, climb);
          float sl = dot(strand, strand);
          if (sl > 1e-20) {
            strand = normalize(strand * inversesqrt(sl) + normal * (${shaderFloat(LOOK.shift)} * gHair * (gClump - 0.5)));
            vec3 toEye = normalize(vViewPosition), shown = toEye - strand * dot(toEye, strand);
            vec3 lie = mix(normal, shown * inversesqrt(max(dot(shown, shown), 1e-8)), ${shaderFloat(LOOK.lie)} * gSheen);
            normal = lie * inversesqrt(max(dot(lie, lie), 1e-8));
          }
        }`;

export { HAIR_LIE, HAIR_PARS, HAIR_SHEEN, HAIR_STRANDS, smoothOf };
