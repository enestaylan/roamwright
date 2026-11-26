// Keep common cells as small numeric keys. A row outside the packed range uses
// a separate key so two distant places can never share a collider bucket.
export function cellKey(column, row) {
  if (row >= -2048 && row < 2048 && Math.abs(column) < 2 ** 39) return (column + 2048) * 4096 + row + 2048;
  return column + ',' + row;
}
