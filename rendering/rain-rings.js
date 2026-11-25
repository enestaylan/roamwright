const RAIN_PARS = `/* glsl */
      uniform float uRain;`;

// In the water's main, after its waves (g): adds the rings' slope to g. Reads vW, dist, g, uTime, seaHash and OW.
const RAIN_GLSL = `/* glsl */
        if (uRain > 0.01 && dist < 40.0) {
          float showers = uRain * (1.0 - smoothstep(22.0, 40.0, dist)) * OW(30.0);
          for (int layer = 0; layer < 2; layer++) {
            float cellsAMetre = layer == 0 ? 1.6 : 2.3;                      // two grids of different size, so neither shows
            vec2 q = vW.xz * cellsAMetre + float(layer) * vec2(0.5, 0.37), cell = floor(q), f = fract(q) - 0.5;
            float h = seaHash(cell + float(layer) * 91.7), h2 = seaHash(cell.yx + 17.3), h3 = fract(h * 31.7 + h2 * 7.3);
            float age = fract(uTime * (0.8 + 0.7 * h2) + h * 7.0);           // a drop strikes the cell about once a second
            float reach = 0.14 + 0.16 * h3;                                  // how far its ring spreads, in cells
            vec2 d = f - (vec2(h, h2) - 0.5) * (0.8 - 2.0 * reach);          // from where it struck, so the ring stays in its cell
            float r = length(d) + 1e-4, x = (r - age * reach) * 18.0 * 1.6 / cellsAMetre;   // across the ring: 18 radians a cell of the first grid
            float ring = sin(x) * exp(-x * x * 0.06) * (1.0 - age) * (1.0 - age) * (0.6 + 0.4 * h3);
            float struck = step(fract(h * 53.1 + float(layer) * 0.5), uRain * (layer == 0 ? 0.8 : 0.6));  // a lighter shower, fewer drops
            g += d / r * (0.4 * ring * struck * showers);
          }
        }`;

export { RAIN_GLSL, RAIN_PARS };
