/**
 * Build a GLSL ES 3 fragment chunk for furrows, standing grain, mown pasture,
 * fallow land, orchards and farmyards. The caller supplies its palette and parcel sampler.
 * Insert the chunk inside a terrain material block. It blends into vec4 diffuseColor and
 * float gTH (surface relief). Supply vec4 farm (normalized row angle, kind × 42/255,
 * unused, coverage), vec2 groundX and groundY (plan-space pixel derivatives), detail
 * samples d2 and d3 with a green channel, floats fleck and grit, world position vWP,
 * a detail sampler2D map and the horizontal wind displacement uWindDrift.
 * Coordinates and distances are in metres.
 *
 * @param {{read: string, dirt: string[], straw: string[], pasture: string[],
 * standing: string[], baked: string, kinds?: string}} look GLSL expressions.
 * Each palette pair gives the dark and light RGB ends. The read snippet declares
 * vec2 plan and vec4 lot (tint, row-end distance / 12.75, signed work depth
 * encoded as (metres × 20 + 127.5) / 255, edge distance / 12.75).
 * baked is the base RGB tint to divide out. Optional else-if branches in kinds
 * can set crop, rough and arable for additional land uses.
 * @returns {string} Fragment statements for use within their own scope.
 */
export const fieldSurfaceGLSL = look => `/* glsl */
          ${look.read}
          float kind = floor(farm.g * (255.0 / 42.0) + 0.5), angle = farm.r * 3.14159265, tint = lot.r;
          // the grain texture's samples run from about 0.73 to 1: these spread them over nought to one
          float speck = fleck * 0.57 + grit * 0.43, tone = smoothstep(0.76, 0.96, speck), patchy = smoothstep(0.74, 0.96, d2.g), wide = smoothstep(0.76, 0.94, d3.r);
          float worked = smoothstep(-0.25, 0.25, (lot.b * 255.0 - 127.5) / 20.0 + (d2.b - 0.83) * 2.0);          // metres inside the part the season's work has reached
          vec2 axis = vec2(cos(angle), sin(angle));
          float along = dot(plan, axis), across = dot(plan, vec2(-axis.y, axis.x));
          float head = step(lot.g * 12.75 + (patchy - 0.5) * 1.3, 3.2);                              // the headland, where the team turns: worked last, across the rows
          float row = (mix(across, along, head) + (wide - 0.5) * 0.42 + sin((along + across) * 0.123) * 0.16) * (kind < 0.5 ? 1.78 : kind > 5.5 ? 2.1 : 1.45);
          float rows = sin(row * 6.2831853) * 0.5 + 0.5;
          // how far a pixel reaches along and across the rows, from groundX and groundY (taken outside every branch, so the GPU can skip all this off the fields)
          float spanAlong = abs(dot(groundX, axis)) + abs(dot(groundY, axis)), spanAcross = abs(axis.x * groundX.y - axis.y * groundX.x) + abs(axis.x * groundY.y - axis.y * groundY.x);
          float resolved = 1.0 - smoothstep(0.09, 0.3, mix(spanAcross, spanAlong, head) * (kind < 0.5 ? 1.78 : kind > 5.5 ? 2.1 : 1.45));                                  // rows finer than a few pixels are left out: they would shimmer
          float lined = mix(0.5, rows, resolved);                                                    // the rows while they can be told apart, their mean beyond
          float land = across / 7.4 + tint * 13.0, landW = spanAcross / 7.4;                              // strips a day's ploughing wide, each worked a little differently
          float strip = fract(sin(floor(land) * 12.9898 + tint * 78.233) * 43758.5453) - 0.5;
          float open = (1.0 - smoothstep(0.022, 0.022 + landW * 1.5, min(fract(land), 1.0 - fract(land)))) * min(1.0, 0.07 / max(landW, 0.0001));       // the open furrow between two strips
          float broad = 0.72 + 0.16 * patchy + 0.4 * wide;
          // the colours below are the ground's own: the baked colour the mesh carries is divided out where they are laid on
          vec3 dirt = mix(${look.dirt[0]}, ${look.dirt[1]}, tone);
          vec3 straw = mix(${look.straw[0]}, ${look.straw[1]}, tone);
          vec3 pasture = mix(${look.pasture[0]}, ${look.pasture[1]}, patchy * 0.8 + tone * 0.2);
          vec3 crop; float rough = 0.72 * speck, arable = 1.0;
          if (kind < 0.5) {                                                                           // under the plough: fresh furrows behind the team, last year's weedy stubble ahead of it
            float furrow = mix(0.33, 1.0 - smoothstep(0.03, 0.51, rows), resolved);
            vec3 turned = dirt * (1.04 + 0.38 * (lined - 0.5) - 0.46 * (furrow - 0.33));
            vec3 old = mix(dirt * 1.7, straw * 0.75, smoothstep(0.3, 0.7, tone * 0.75 + lined * 0.25));
            old = mix(old, pasture * 0.85, smoothstep(0.55, 0.8, patchy) * 0.5);
            crop = mix(old, turned, worked);
            rough += 0.58 * rows * resolved * worked;
          } else if (kind < 1.5) {                                                                    // grain: standing gold ahead of the reapers, pale stubble in rows behind them
            float gust = smoothstep(0.8, 0.92, textureLod(map, (vWP.xz - uWindDrift * 0.8) * 0.013, max(0.0, log2((spanAlong + spanAcross) * 3.3))).r);      // the one wind running over the standing corn, a little slower than the air
            vec3 standing = mix(${look.standing[0]}, ${look.standing[1]}, tone) * (0.88 + 0.26 * gust) * (0.94 + 0.12 * lined);
            vec3 cut = mix(dirt * 1.9, straw * 1.05, 0.35 + 0.5 * lined);
            crop = mix(standing, cut, worked);
            rough += mix(0.5 * speck, 0.13 * rows * resolved, worked);
          } else if (kind < 2.5) {                                                                    // grass: pasture grazed unevenly, or a meadow mown with its hay lying in swathes
            float graze = smoothstep(0.25, 0.75, wide * 0.7 + patchy * 0.3);
            vec3 grazed = pasture * mix(vec3(1.12, 1.08, 0.86), vec3(0.8, 0.92, 0.8), graze);
            float sw = across / 2.3 + (wide - 0.5) * 0.3;
            float swathe = mix(0.4, smoothstep(0.1, 0.6, sin(sw * 6.2831853) * 0.5 + 0.5), 1.0 - smoothstep(0.09, 0.3, spanAcross / 2.3));
            vec3 mown = mix(pasture * vec3(1.25, 1.2, 0.95), straw * vec3(0.9, 1.02, 0.85), swathe * 0.75);
            crop = mix(grazed, mown, worked);
            arable = worked;
          } else if (kind < 3.5) {                                                                    // fallow: bare in places, weeds taking it back in others
            crop = mix(vec3(0.22, 0.18, 0.09), vec3(0.4, 0.35, 0.17), tone);
            crop = mix(crop, pasture, smoothstep(0.3, 0.8, wide * 0.8 + patchy * 0.2) * 0.65);
            arable = 0.35;
          } else if (kind < 4.5) {                                                                    // orchard: grass under the trees
            crop = pasture * (0.9 + 0.2 * wide);
            arable = 0.0;
          } else if (kind < 5.5) {                                                                    // the farmyard's beaten earth
            crop = mix(vec3(0.2, 0.155, 0.1), vec3(0.34, 0.28, 0.19), tone);
            arable = 0.0;
          }${look.kinds ?? ''} else {                                                                                    // sown and sprouting: green lines on harrowed soil
            float sprout = mix(0.42, smoothstep(0.42, 0.9, rows), resolved) * (0.55 + 0.45 * patchy);
            crop = mix(dirt * 1.5, vec3(0.11, 0.2, 0.045) * (0.8 + 0.5 * tone), sprout * 0.9);
            rough += 0.2 * rows * resolved;
          }
          crop *= mix(0.86, 1.14, tint) * mix(vec3(1.05, 1.0, 0.93), vec3(0.95, 1.0, 1.06), fract(tint * 7.31));       // every parcel a shade of its own
          crop *= (1.0 + strip * 0.16 * arable * (1.0 - head)) * (1.0 - 0.17 * open * arable * (1.0 - head)) * (1.0 - 0.07 * head * arable);
          diffuseColor.rgb = mix(diffuseColor.rgb, crop * broad / max(${look.baked}, vec3(0.02)), farm.a * 0.96);
          gTH = mix(gTH, rough, farm.a);`;
