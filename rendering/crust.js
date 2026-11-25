// Derivative-filtered drying plates. Coordinates count plates and warp is a smooth signed vector.
export const crustGLSL = /* glsl */ `
      // a cell's number is wrapped before it is hashed: far from the world's middle it ran to tens of thousands, sin() was asked
      // for the sine of millions, and a graphics card that takes sines quickly and roughly (iOS) laid the cells out in fans and rows
      const float CELL_WRAP = 289.0;
      vec2 cellPoint(vec2 c) { c = mod(c, CELL_WRAP); return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453); }
      // the cells nearest q: x and y the nearest two distances, zw the nearest cell
      vec4 nearestCells(vec2 q) {
        vec2 ci = floor(q), cf = fract(q), near = ci; float f1 = 9.0, f2 = 9.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 o = vec2(float(i), float(j)), r = o + cellPoint(ci + o) - cf; float dd = dot(r, r);
          if (dd < f1) { f2 = f1; f1 = dd; near = ci + o; } else if (dd < f2) f2 = dd;
        }
        return vec4(sqrt(f1), sqrt(f2), near);
      }
      // the crust at q (in plates: a plate is about one across), warped by w (-1 to 1, smooth): x its seams, y the plates' curled
      // rims, z the finer seams within a plate
      vec3 crustCracks(vec2 q, vec2 w) {
        q += w * 0.45;
        vec4 c = nearestCells(q); float blur = length(fwidth(q)), edge = c.y - c.x;
        vec2 own = cellPoint(c.zw + 7.0);                        // the plate's own numbers: how wide its seams gape, whether it splits
        float gape = mix(0.022, 0.07, own.x);
        float seam = (1.0 - smoothstep(gape * 0.4, gape + blur, edge)) * (1.0 - smoothstep(0.2, 0.6, blur));
        float rim = (1.0 - smoothstep(gape, gape + 0.22, edge)) * (1.0 - seam) * (1.0 - smoothstep(0.3, 0.8, blur));
        vec2 s = q * 2.3 + 3.7; vec4 f = nearestCells(s); float sBlur = length(fwidth(s));
        float fine = (1.0 - smoothstep(0.015, 0.045 + sBlur, f.y - f.x)) * (1.0 - smoothstep(0.15, 0.45, sBlur)) * step(0.45, own.y) * (1.0 - seam);
        return vec3(seam, rim, fine);
      }`;
