// The noise foam is torn by, shared by every water (the sea's surf, a wake) and the beach.
export const FOAM_GLSL = `/* glsl */
      float seaHash(vec2 c) { c = mod(c, 289.0); return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
      float seaNoise(vec2 x) {
        vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(seaHash(i), seaHash(i + vec2(1.0, 0.0)), f.x), mix(seaHash(i + vec2(0.0, 1.0)), seaHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      // foam's lace, 0 to 1: threads of foam round holes of clear water, gathered in patches tens of metres across; once the
      // threads would be finer than a pixel, the share of the water they cover (px: metres to a pixel)
      float seaLace(vec2 q, float t, float px) {
        vec2 a = q * 0.55 + vec2(0.07, 0.04) * t;
        float n = seaNoise(a + 1.6 * vec2(seaNoise(a * 0.43 - 0.03 * t), seaNoise(a * 0.43 + 5.2)));
        float n2 = seaNoise(q * 1.7 - vec2(0.05, 0.11) * t);
        // a thread is about a tenth of a metre wide, the finer net's a third of that: each fades to its share of the water
        // while it is still a pixel or two wide, or it crawls and sparkles as the foam drifts
        float coarse = mix(0.2, smoothstep(0.72, 0.93, 1.0 - abs(2.0 * n - 1.0)), 1.0 - smoothstep(0.03, 0.1, px));
        float fine = mix(0.08, smoothstep(0.78, 0.95, 1.0 - abs(2.0 * n2 - 1.0)), 1.0 - smoothstep(0.01, 0.035, px));
        float gathered = mix(0.35, 1.0, smoothstep(0.3, 0.7, seaNoise(q * 0.09 + 3.1)));
        return max(coarse, 0.7 * fine) * gathered;
      }`;

// Shared by the water and the beach, so a breaking wave and the swash it sends up the sand keep time: the swell's phase at
// the water's edge, and its sets. Positions are measured from the land's corner (uSeaO), so the numbers stay small out here,
// 14 km from the world's middle.
export const SWELL_GLSL = `/* glsl */
      const float SWELL_W = 0.785;                 // radians a second: a wave comes in every eight seconds
      const float SHOAL_K = 8.0;                   // the swell's phase per root metre of depth: its crests close up as the water shoals
      const float SEA_TAU = 6.2831853;
      // how far a crest is put back along the shore, so the waves break in peaks and sections, never in one line
      float swellShift(vec2 q) { return 1.9 * sin(q.x * 0.0123 + 1.3 * sin(q.y * 0.0171)) + 1.2 * sin(q.y * 0.0219 - q.x * 0.0083 + 2.0); }
      // the swell's phase over the shoals, depth metres deep: a crest where it is a whole turn; at the water's edge (depth 0)
      // a crest is a bore reaching the sand
      float swellPhase(vec2 q, float depth, float t) { return SHOAL_K * sqrt(max(depth, 0.0) + 0.03) + t * SWELL_W + swellShift(q); }
      // the height of the set, 0.48 to 1.08: every seventh wave or so is a big one
      float swellSet(vec2 q, float t) { return 0.78 + 0.3 * sin(t * SWELL_W / 7.0 + (q.x + q.y) * 0.0021); }`;

// The water's own: its uniforms, and how far a point lies from the nearest wall and how far the moles shelter it.
export const seaParameters = ({ moleCount, quayCount, moleReach, moleWidth }) => `/* glsl */
      uniform vec4 uSeaO; uniform vec2 uSwellDir;
      uniform vec4 uMole[${moleCount}], uMoleF[${moleCount}], uQuay[${quayCount}];
      ${SWELL_GLSL}
      // (metres from p to the face of the nearest mole or quay, the share of the swell the moles let reach p, how far p lies
      // among them: there they, not the city's sheltered water, say how still it is)
      vec3 seaWalls(vec2 p) {
        float d = 1e4, open = 1.0, among = 0.0;
        for (int i = 0; i < ${moleCount}; i++) {
          vec4 M = uMole[i], F = uMoleF[i];                        // centre x, z, radius, mouth; the city's turn (sin, cos), half the mouth's angle, in use
          vec2 rel = p - M.xy; float r = length(rel);
          if (F.w < 0.5 || r > M.z + 240.0) continue;
          float a = atan(dot(rel, vec2(F.y, -F.x)), dot(rel, F.xy));   // radians round from straight out to sea
          if (abs(a) > ${moleReach.toFixed(2)}) continue;
          among = max(among, smoothstep(M.z + 240.0, M.z + 120.0, r));
          float pastMouth = abs(a - M.w) - F.z;                        // radians beyond the mouth's edge: below 0 in the mouth
          if (pastMouth > 0.0) d = min(d, abs(r - M.z) - ${(moleWidth / 2).toFixed(1)});
          if (r < M.z) open *= mix(1.0, 0.35, smoothstep(0.0, 0.1, pastMouth));   // behind the mole, but for what comes in by its mouth
        }
        for (int i = 0; i < ${quayCount}; i++) {
          vec4 Q = uQuay[i]; vec2 ab = Q.zw - Q.xy, ap = p - Q.xy;
          d = min(d, length(ap - ab * clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0)));
        }
        return vec3(max(d, 0.0), open, among);
      }`;

// In the water's main: bends its waves (g) by the swell and gives the white water (rapid) and how churned the water is (surf).
// Reads the water's own: vW, bed, dep, dist, g, fp, OW, wv, uDepth, uDepthR, uTime.
export const SEA_WAVES = `/* glsl */
        vec2 sq = vW.xz - uSeaO.xy;
        float seaPx = length(fwidth(sq)), seaAfar = smoothstep(0.05, 0.3, seaPx);   // metres to a pixel; and how far that is from near
        vec3 walls = dist < 2500.0 ? seaWalls(vW.xz) : vec3(1e4, 1.0, 0.0);
        float exposed = mix(clamp(1.0 - bed.b * 1.15, 0.0, 1.0), 1.0, walls.z) * walls.y;   // the bed's B is sheltered water (0.84 at most): a harbour lies still
        float setH = swellSet(sq, uTime), offshore = smoothstep(5.0, 7.8, dep);
        // offshore, two trains of long swell running before the wind
        vec2 swell2 = mat2(0.9, 0.435, -0.435, 0.9) * uSwellDir;
        g += (wv(sq, -uSwellDir, 0.074, 0.85, 0.34 * setH) * OW(0.074) + wv(sq, -swell2, 0.11, 1.04, 0.18) * OW(0.11)) * offshore * exposed;
        // over the shoals the crests follow the depth, closing up as it shallows: the phase is SHOAL_K times its root, which
        // spaces them as waves are spaced over a steady slope. Offshore and in still water none of this is worked out.
        float shoals = (1.0 - offshore) * exposed, surf = 0.0, white = 0.0, seaLaceK = 0.0;
        vec2 seaward = -uSwellDir;
        if (shoals > 0.0) {
          vec2 bedUv = uDepthR.xy + vW.xz * uDepthR.zw;                               // (no mipmaps: the level is always 0)
          vec2 deepens = (vec2(textureLod(uDepth, bedUv + vec2(uDepthR.z * uSeaO.z, 0.0), 0.0).r, textureLod(uDepth, bedUv + vec2(0.0, uDepthR.w * uSeaO.z), 0.0).r) - bed.r) * (10.0 / uSeaO.z);
          float slope = length(deepens), h = max(dep, 0.0), rootH = sqrt(h + 0.03);
          if (slope > 0.002) seaward = deepens / slope;
          float psi = swellPhase(sq, h, uTime);
          float sharp = mix(1.0, 4.5, smoothstep(4.0, 0.8, h));                     // round swell, peaked as it shoals
          float crest = exp(sharp * (cos(psi) - 1.0));
          float dpsi = SHOAL_K * min(slope, 0.25) / (2.0 * rootH);                  // radians a metre, seaward
          float breakAt = (1.6 + 0.6 * sin(sq.x * 0.029 + sq.y * 0.023)) * setH;    // the depth the crests break at: deeper for a set's big waves, and in peaks
          surf = smoothstep(breakAt, breakAt * 0.5, h) * shoals;
          float swellH = 0.3 * setH * shoals * mix(1.0, 0.45, surf) * smoothstep(0.0, 0.3, h);   // a broken wave runs on as a lower bore
          g -= seaward * (swellH * sharp * sin(psi) * crest * min(dpsi, 2.5)) * OW(dpsi * sharp);
          // white water: the lip as a crest curls, the bore it leaves rolling in, and lace torn from it lying between
          if (surf > 0.0) {
            seaLaceK = seaLace(sq + seaward * (uTime * 0.6), uTime, seaPx);
            float behind = fract(psi / SEA_TAU);
            white = surf * (exp(-behind * 10.0) * (0.65 + 0.35 * seaLaceK) + exp(-behind * 2.2) * seaLaceK * 0.9 + 0.35 * seaLaceK + smoothstep(0.92, 1.0, behind) * 0.5);
            // from afar the breakers' white lines, each a pixel or two, come and go along the whole coast at once: there the white
            // water is held at what it is on average over a wave, as the beach's swash is (SHORE_GLSL)
            white = mix(white, surf * (0.085 + 0.745 * seaLaceK), seaAfar);
          }
        }
        // at a mole or a quay's foot: a ring of foam, bursting out as each crest of the swell strikes; a lap of it in a harbour
        if (walls.x < 60.0) {
          if (surf <= 0.0) seaLaceK = seaLace(sq + seaward * (uTime * 0.6), uTime, seaPx);
          float strike = mix(pow(0.5 + 0.5 * cos(-0.074 * dot(uSwellDir, sq) + 0.85 * uTime), 4.0), 0.27, seaAfar);   // its mean, from afar
          float reach = mix(1.2, 13.0, exposed * (0.3 + 0.7 * strike));                // metres the foam spreads from the wall's foot
          float burst = exp(-walls.x / reach) * (0.6 + 0.4 * seaLaceK) * (0.3 + 0.7 * exposed * (0.45 + 0.55 * strike));
          white = max(white, burst + exp(-walls.x / 22.0) * exposed * seaLaceK * 0.8);   // and the lace it leaves spreading round it
        }
        rapid = clamp(white, 0.0, 1.0) * mix(1.0, 0.7, 1.0 - OW(1.5));`;

// The beach's own colour, in the ground's shader as soon as its baked colour (base) is read: the bake fades the foot of the
// beach into the grey-green of a lake's bed over the 1.6 m about the sea's level, which on the
// sea's shore laid a green band along every beach. There the sea's bed is drawn instead: the beach's pale sand into the
// shallows, darkening and greening with weed only as it deepens. Reads vWP, landUv, uLandR, uSea, uShore; sets base, and past the
// map's edge under the sea tint's salt and cover too.
export const shoreBed = ({ beach, lakeBed, weed }) => `/* glsl */
      if (uShore > 0.5 && vWP.y < uSea + 1.4 && texture2D(uSeaDepth, landUv).a > 0.5) {   // the sea's bed, never a lake's sunk below the sea (the map's A)
        const vec3 BEACH = vec3(${beach.join(', ')}), LAKE_BED = vec3(${lakeBed.join(', ')}), WEED = vec3(${weed.join(', ')});   // palette values in linear light
        const float OFF_MAP_FADE = 150.0;                                               // metres past the map's edge over which its own bed gives way
        float baked = 1.0 - smoothstep(uSea - 0.2, uSea + 1.4, vWP.y);                 // how much of the bed's tone the bake laid here
        float under = uSea - vWP.y;                                                     // metres of water over the bed
        // wet sand in the shallows, weed on the middle slope, and the bed's own tone by 7 m, the plain bed material's
        vec3 seaBed = mix(BEACH * 0.72, mix(LAKE_BED, WEED, 0.4 * (1.0 - smoothstep(4.5, 7.0, under))), smoothstep(1.2, 6.0, under));
        // past the map's edge its maps are read at the edge, so a cape that meets it ran on as a pale band of sand under the sea
        // to the horizon: under water out there the bed takes the tone the bake lays under all the sea, crust and cover none
        vec2 pastUv = max(-landUv, landUv - 1.0);
        float offMap = smoothstep(0.0, OFF_MAP_FADE, max(pastUv.x / uLandR.z, pastUv.y / uLandR.w)) * (1.0 - smoothstep(uSea - 0.3, uSea + 0.3, vWP.y));
        base = mix(base, LAKE_BED, offMap); tint.a *= 1.0 - offMap; cover *= 1.0 - offMap;
        base += (seaBed - LAKE_BED) * baked;
      }`;

// The beach, in the ground's shader after its colour and relief (diffuseColor, gTH) are worked out: where the sea meets the
// sand, the swash runs up and drains back with a band of foam at its front, the sand under it dark and glassy; below the
// highest reach of a set's swash the sand lies wet, darker and glossier the lower it is, and at that reach a line of the
// foam's last lace and the wrack it left. shoreGloss (glassy) and shoreDamp (wet) are for the roughness. Reads vWP, landUv,
// vd, gWN, uSea, uTime, uLandR, uShore, uSeaDepth (the water's depth map, its B sheltered water), uWind, uNight; a shore with no
// depth map defines SHORE_EXPOSED, how open to the swell it is (0 to 1), instead.
export const SHORE_GLSL = `/* glsl */
#ifndef SHORE_EXPOSED
#define SHORE_EXPOSED clamp(1.0 - texture2D(uSeaDepth, landUv).b * 1.15, 0.0, 1.0)
#define SHORE_AT_SEA (texture2D(uSeaDepth, landUv).a > 0.5)
#else
#define SHORE_AT_SEA true
#endif
      float shoreGloss = 0.0, shoreDamp = 0.0;
      float rise = vWP.y - uSea;                                  // metres above the still sea
      if (uShore > 0.5 && rise < 1.0 && rise > -0.3 && SHORE_AT_SEA) {   // the sea's swash, never on a lake's bed sunk below it
        // the swash's marks fade out over the last of the block, under the still sea, rather than stop at a line along the shore
        vec3 dry = diffuseColor.rgb; float flatTH = gTH, inSwash = smoothstep(-0.3, -0.1, rise);
        vec2 sq = vWP.xz - uLandR.xy;
        float exposed = SHORE_EXPOSED, px = length(fwidth(sq));    // metres to a pixel
        // seen from afar the swash's running edge is a pixel or less across and its sheet sweeps metres of sand at a time:
        // there its edge is softened and the sheet held nearer its average, so the coast does not pulse
        float afar = smoothstep(0.05, 0.3, px);
        float setH = swellSet(sq, uTime);
        float runUp = 0.05 + 0.42 * setH * exposed;               // how high the swash climbs: a lap of a few centimetres in a harbour
        float tau = fract(swellPhase(sq, 0.0, uTime) / SEA_TAU);  // how far through its wave: 0 as the bore reaches the sand
        float up = tau < 0.3 ? 1.0 - (1.0 - tau / 0.3) * (1.0 - tau / 0.3) : 1.0 - pow((tau - 0.3) / 0.7, 1.4);   // a quick rush up, a slow drain back
        float front = runUp * up + 0.03 * (seaNoise(sq * 0.31) - 0.5) - 0.02, fw = fwidth(rise) + 0.003 + 0.06 * afar * runUp;
        float sheet = 1.0 - smoothstep(front - fw, front + fw, rise);                 // the sheet of water as it is now; the foam rides its front
        float film = mix(sheet, 1.0 - smoothstep(-0.02, runUp * 0.75, rise), afar * 0.85);   // and as it darkens the sand: from afar, the time it covers it
        float lace = seaLace(sq, uTime, px);
        // the foam rides the front up the sand, thick in the rush and thinning as it drains; what it strands lies as lace
        float rush = 1.0 - smoothstep(0.15, 0.55, tau);
        float edge = sheet * smoothstep(front - 0.05 - 0.05 * rush - fw, front - fw * 0.5, rise) * (0.35 + 0.65 * rush) * (0.6 + 0.4 * lace);
        float stranded = sheet * lace * 0.4 * (1.0 - rush) * (1.0 - smoothstep(0.0, 0.6, rise / max(front, 0.05)));   // lying low, where the drain left it
        // from afar the foam riding up and down the sand is a white line sweeping the beach every eight seconds, which reads as the
        // whole coast flickering (the owner): there it is held at where it lies on average, a faint band over the swash's middle
        float meanFoam = exp(-abs(rise - 0.5 * runUp) / max(0.4 * runUp, fw)) * (0.15 + 0.15 * lace);
        float foam = clamp(mix(max(edge, stranded), meanFoam, afar) * (0.3 + 0.7 * exposed), 0.0, 1.0);
        // the tide line: as high as a set's big waves reach, ragged along the shore; the sand below it is wet, darkest and
        // glossiest at the bottom, and glassy for a moment where the backwash has just drained off it
        float reach = 0.07 + 0.46 * exposed * (0.9 + 0.2 * seaNoise(sq * 0.045)) + 0.09 * (seaNoise(sq * 0.11 + 7.0) - 0.5) + 0.03 * (seaNoise(sq * 0.6) - 0.5);   // meandering
        float wet = 1.0 - smoothstep(reach - 0.1, reach + fw, rise), low = 1.0 - smoothstep(0.0, reach, rise);
        float drained = (1.0 - smoothstep(front, front + 0.1, rise)) * (1.0 - sheet) * (1.0 - rush) * (1.0 - afar);
        // the foot of the beach is already the wet sand of the bed (SHORE_BED): darkened again here, and again under the still sea,
        // it lay along every shore as a dark outline between the dry sand and the shallows, metres wide on a gentle beach
        float notUnder = smoothstep(-0.15, 0.05, rise);
        diffuseColor.rgb *= 1.0 - wet * mix(0.08, 0.16, low) * notUnder;
        shoreDamp = wet * mix(0.6, 1.0, low);
        // the foam's last reach: a line of its dried lace a hand wide, with dark wrack caught in it, gone to a faint line
        // before it is finer than a pixel
        // (measured across the sand, not up it: on a flat beach the rise hardly changes from pixel to pixel however far off)
        float lineW = 0.012 + fw, atLine = exp(-abs(rise - reach - 0.01) / lineW), sharpLine = (1.0 - smoothstep(0.012, 0.04, fw)) * (1.0 - smoothstep(0.02, 0.06, px));
        float wrack = smoothstep(0.66, 0.82, seaNoise(sq * 6.5 + 3.0)) * smoothstep(0.4, 0.7, seaNoise(sq * 0.5)) * sharpLine;   // in flecks, gathered in stretches
        float dried = atLine * mix(0.35, 0.4 + 0.6 * smoothstep(0.1, 0.5, seaLace(sq * 1.7, 0.0, px * 1.7)), sharpLine) * exposed;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.69, 0.64), dried * 0.75);
        diffuseColor.rgb *= 1.0 - atLine * wrack * 0.45 * exposed;
        diffuseColor.rgb *= 1.0 - 0.14 * film * notUnder;          // sand under a sheet of water is darker,
        shoreGloss = max(film, drained * 0.7);                     // and glassy, and so for a moment where it has drained
        gTH *= 1.0 - 0.7 * film - 0.25 * wet;                      // water smooths the grain over
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.78), foam);
        diffuseColor.rgb = mix(dry, diffuseColor.rgb, inSwash);
        gTH = mix(flatTH, gTH, inSwash);
        shoreGloss *= inSwash;
        shoreDamp *= inSwash;
      }
      // the bed under the shallows: ripples the waves raise in the sand, running along the shore a hand's breadth high, and the
      // sun's light gathered by the waves into a moving net; each gone before it is finer than a pixel
      if (uShore > 0.5 && rise < 0.05 && rise > -4.5 && vd < 70.0 && SHORE_AT_SEA) {
        vec2 sq = vWP.xz - uLandR.xy, down = length(gWN.xz) > 0.004 ? normalize(gWN.xz) : uWind;   // down the bed's slope: out to sea
        float across = dot(sq, down), along = dot(sq, vec2(-down.y, down.x));
        float phase = across * 8.5 + 1.8 * sin(along * 0.9 + across * 0.3) + 0.9 * sin(along * 2.3 - across * 0.5);
        float seenR = (1.0 - smoothstep(0.4, 1.2, fwidth(phase))) * (1.0 - smoothstep(30.0, 70.0, vd)) * smoothstep(0.02, 0.4, -rise);
        float ripple = sin(phase) + 0.3 * sin(2.0 * phase + 1.1);
        gTH += ripple * seenR * 0.2;
        diffuseColor.rgb *= 1.0 + 0.07 * ripple * seenR;                // silt settles in the troughs
        vec2 cq = sq * 0.9;
        float lines = abs(sin(cq.x + sin(cq.y * 1.3 + uTime * 0.9)) + sin(cq.y * 1.1 + sin(cq.x * 0.8 - uTime * 0.7)));
        float lines2 = abs(sin(cq.x * 1.7 - cq.y * 0.6 + sin(cq.y * 1.9 - uTime * 1.1)) + sin(cq.y * 1.5 + cq.x * 0.4 + sin(cq.x * 1.4 + uTime * 0.8)));
        float caustic = (1.0 - smoothstep(0.0, 0.3, lines)) + (1.0 - smoothstep(0.0, 0.3, lines2)) * 0.7;
        float seenC = (1.0 - smoothstep(0.05, 0.15, length(fwidth(cq)))) * smoothstep(0.03, 0.3, -rise) * (1.0 - smoothstep(1.5, 4.5, -rise));
        diffuseColor.rgb *= 1.0 + caustic * seenC * 0.55 * (1.0 - uNight);
      }`;

// The colour of the sea's body: clear and green-blue over pale sand in the shallows, churned where the waves break, dark
// where it is deep. Reads waterline, surf, uDeep, uLum.
export const SEA_BODY = `/* glsl */
        body = mix(uDeep, vec3(0.028, 0.15, 0.142) * uLum, exp(-waterline * 0.38));
        body = mix(body, vec3(0.11, 0.15, 0.14) * uLum, surf * 0.45);`;
// How much of the bed the sea hides: less than the lake does, so the sand shows through the shallows; and all of it once
// the water is deep. The bed is drawn in two materials that meet along the cells of the ground at 9 m (the plain bed,
// the submerged bed), and the depth map reads no deeper than 8 m: where the water still let a tenth of the bed through, that seam
// showed from the air as stair steps along every coast. So the bed fades out from 6 m and is gone just short of 8 m, where
// every texel of the map round the seam reads (a harbour's basin, 6 m deep, shows its floor as before).
export const SEA_OPACITY = `/* glsl */
        opacity = mix(0.06, 0.94, 1.0 - exp(-waterline * 0.3 / max(V.y, 0.3)));
        opacity = mix(opacity, 1.0, smoothstep(6.0, 7.8, waterline));`;

