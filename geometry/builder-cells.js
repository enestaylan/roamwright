import { sphereOf } from './builder.js';

// Set builder.pb = [] before adding unindexed, unskinned geometry. Partition whole
// parts by their x-z bounds centres, separating parts smaller than smallSize on every
// axis. Preserve first-encounter order within each cell and among the cells.
// The result owns compact position, normal, colour and optional scalar tag arrays.
export function cutBuilderCells(builder, cellSize, smallSize = 0) {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Cell size must be positive and finite');
  if (!builder.pb || builder.indexed || builder.sk) throw new TypeError('Expected marked, unindexed static geometry');
  const starts = builder.pb,
    bounds = builder.bounds,
    cells = new Map(); // key -> { small, runs: [from, to, ...], numbers }
  for (let partIndex = 0; partIndex < starts.length; partIndex++) {
    const start = starts[partIndex],
      end = partIndex + 1 < starts.length ? starts[partIndex + 1] : builder.count;
    if (end <= start) continue;
    const boundsOffset = partIndex * 6,
      small = Math.max(bounds[boundsOffset + 1] - bounds[boundsOffset], bounds[boundsOffset + 3] - bounds[boundsOffset + 2], bounds[boundsOffset + 5] - bounds[boundsOffset + 4]) < smallSize,
      key =
        Math.floor((bounds[boundsOffset] + bounds[boundsOffset + 1]) / 2 / cellSize) + ':' + Math.floor((bounds[boundsOffset + 4] + bounds[boundsOffset + 5]) / 2 / cellSize) + (small ? 's' : '');
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { small, runs: [], numbers: 0 }));
    cell.runs.push(start, end);
    cell.numbers += end - start;
  }
  const { positions, normalBytes, colourBytes, tg } = builder;
  return [...cells.values()].map(({ small, runs, numbers }) => {
    const parts = { position: new Float32Array(numbers), normal: new Int8Array(numbers), color: new Uint8Array(numbers) };
    if (tg) parts.aTag = new Float32Array(numbers / 3);
    let at = 0;
    for (let runOffset = 0; runOffset < runs.length; runOffset += 2) {
      const from = runs[runOffset],
        to = runs[runOffset + 1];
      parts.position.set(positions.subarray(from, to), at);
      parts.normal.set(normalBytes.subarray(from, to), at);
      parts.color.set(colourBytes.subarray(from, to), at);
      if (tg) for (let i = from / 3, k = at / 3; i < to / 3; i++) parts.aTag[k++] = tg[i];
      at += to - from;
    }
    return { small, parts, sphere: sphereOf(parts.position) };
  });
}
