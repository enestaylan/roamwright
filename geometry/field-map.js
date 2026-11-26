/**
 * Soften the alpha mask of a row-major RGBA byte field map in place. Interior
 * texels take the lesser of their coverage and their original 3 × 3 mean.
 * The outermost texels retain their values.
 */
export function softenFieldCoverage(rgba, width, height) {
  const coverage = new Uint8Array(width * height);
  for (let i = 0; i < coverage.length; i++) coverage[i] = rgba[i * 4 + 3];
  for (let row = 1; row < height - 1; row++) {
    for (let column = 1; column < width - 1; column++) {
      const index = row * width + column;
      if (!coverage[index]) continue;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) sum += coverage[index + dy * width + dx];
      rgba[index * 4 + 3] = Math.min(coverage[index], sum / 9);
    }
  }
}

/**
 * Extend field attributes one texel beyond the coverage mask for linear filtering.
 * Both maps are row-major RGBA bytes. Copy the covered neighbour's first two
 * field channels and all four companion channels. Coverage and the third field
 * channel stay intact, so newly filled texels cannot propagate into the next row.
 * Neighbours are tried left, right, above and below. The perimeter is untouched.
 */
export function extendFieldBorders(rgba, attributes, width, height) {
  const stride = width * 4;
  const offsets = [-4, 4, -stride, stride];
  for (let row = 1; row < height - 1; row++) {
    for (let column = 1; column < width - 1; column++) {
      const target = row * stride + column * 4;
      if (rgba[target + 3]) continue;
      for (const offset of offsets) {
        const source = target + offset;
        if (!rgba[source + 3]) continue;
        rgba[target] = rgba[source];
        rgba[target + 1] = rgba[source + 1];
        for (let channel = 0; channel < 4; channel++) attributes[target + channel] = attributes[source + channel];
        break;
      }
    }
  }
}
