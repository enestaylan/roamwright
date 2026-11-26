/**
 * Pack a grid into one bit per cell. The predicate receives the row-major index
 * `row * width + column`. Transfer the returned `bits.buffer` with the mask when
 * handing it to a worker.
 * @param {number} width - Positive integer column count.
 * @param {number} height - Positive integer row count.
 * @param {(index: number) => boolean} includesIndex - Selects cells to mark.
 */
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

/** Read membership at cell coordinates, rounding down within a cell. Coordinates outside the grid return false. */
export function cellIsSet(mask, x, y) {
  if (!(x >= 0 && x < mask.width && y >= 0 && y < mask.height)) return false;
  const i = Math.floor(y) * mask.width + Math.floor(x);
  return (mask.bits[Math.floor(i / 8)] & (1 << (i & 7))) !== 0;
}
