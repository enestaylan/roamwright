// A structured-cloneable row-major grid. Membership costs one bit per cell.
export function packCellMask(width, height, includesIndex) {
  if (!(Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0))
    throw new RangeError('Cell mask dimensions must be positive integers');
  const length = width * height;
  const bits = new Uint8Array(Math.ceil(length / 8));
  for (let i = 0; i < length; i++) {
    if (includesIndex(i)) bits[Math.floor(i / 8)] |= 1 << (i & 7);
  }
  return { width, height, bits };
}

// Coordinates are in cell units, with the origin at the first cell's lower edge.
export function cellIsSet(mask, x, y) {
  if (!(x >= 0 && x < mask.width && y >= 0 && y < mask.height)) return false;
  const i = Math.floor(y) * mask.width + Math.floor(x);
  return (mask.bits[Math.floor(i / 8)] & (1 << (i & 7))) !== 0;
}
