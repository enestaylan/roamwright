import { sphereOf } from './builder.js';

// Set builder.pb = [] before adding unindexed, unskinned geometry. Partition whole
// parts by their x-z bounds centres, separating parts smaller than smallSize on every
// axis. Preserve first-encounter order within each cell and among the cells.
// The result owns compact position, normal, colour and optional scalar tag arrays.
export function cutBuilderCells(gb, cellSize, smallSize = 0) {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Cell size must be positive and finite');
  if (!gb.pb || gb.indexed || gb.sk) throw new TypeError('Expected marked, unindexed static geometry');
  const starts = gb.pb,
    bounds = gb.bounds,
    cells = new Map(); // key -> { small, runs: [from, to, ...], numbers }
  for (let j = 0; j < starts.length; j++) {
    const a = starts[j],
      b = j + 1 < starts.length ? starts[j + 1] : gb.count;
    if (b <= a) continue;
    const o = j * 6,
      small = Math.max(bounds[o + 1] - bounds[o], bounds[o + 3] - bounds[o + 2], bounds[o + 5] - bounds[o + 4]) < smallSize,
      key =
        Math.floor((bounds[o] + bounds[o + 1]) / 2 / cellSize) + ':' + Math.floor((bounds[o + 4] + bounds[o + 5]) / 2 / cellSize) + (small ? 's' : '');
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { small, runs: [], numbers: 0 }));
    cell.runs.push(a, b);
    cell.numbers += b - a;
  }
  const { positions, normalBytes, colourBytes, tg } = gb;
  return [...cells.values()].map(({ small, runs, numbers }) => {
    const parts = { position: new Float32Array(numbers), normal: new Int8Array(numbers), color: new Uint8Array(numbers) };
    if (tg) parts.aTag = new Float32Array(numbers / 3);
    let at = 0;
    for (let r = 0; r < runs.length; r += 2) {
      const from = runs[r],
        to = runs[r + 1];
      parts.position.set(positions.subarray(from, to), at);
      parts.normal.set(normalBytes.subarray(from, to), at);
      parts.color.set(colourBytes.subarray(from, to), at);
      if (tg) for (let i = from / 3, k = at / 3; i < to / 3; i++) parts.aTag[k++] = tg[i];
      at += to - from;
    }
    return { small, parts, sphere: sphereOf(parts.position) };
  });
}
