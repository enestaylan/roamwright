// Rows of baked grids, cut out to be sent from a worker and put back in their place on the page. A grid is a typed array of
// `rows` rows, with any number of values to a row (a height, three of a normal, four of a cover).

// Copy the half-open row interval [j0, j1) from each grid.
const cutRows = (grids, rows, j0, j1) => grids.map(grid => grid.slice((j0 * grid.length) / rows, (j1 * grid.length) / rows));
// Puts what cutRows cut back into grids of the same shapes, from row j0 on.
const pasteRows = (grids, rows, j0, cut) => grids.forEach((grid, i) => grid.set(cut[i], (j0 * grid.length) / rows));

function checkBandSize(size) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new RangeError('Band size must be a positive integer');
}

// Bake a grid locally with one yield after each synchronous band, including the tail.
async function bakeRowBands(rows, bandSize, bake, yieldTurn) {
  checkBandSize(bandSize);
  if (!Number.isSafeInteger(rows) || rows < 0) throw new RangeError('Invalid row count');
  for (let from = 0; from < rows; from += bandSize) {
    bake(from, Math.min(rows, from + bandSize));
    await yieldTurn();
  }
}

// Submit every band synchronously so later work can be queued behind it. Release each
// result as soon as it lands. On failure, drain outstanding writers before handing back the grids.
async function fillRowBands(grids, rows, bandSize, request, from = 0, to = rows) {
  checkBandSize(bandSize);
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
      from < 0 || to < from || to > rows) throw new RangeError('Invalid row interval');
  const pending = [];
  async function fill(start, end) {
    const cut = await request(start, end);
    pasteRows(grids, rows, start, cut);
  }
  for (let start = from; start < to; start += bandSize)
    pending.push(fill(start, Math.min(start + bandSize, to)));
  try {
    await Promise.all(pending);
  } catch (error) {
    await Promise.allSettled(pending);
    throw error;
  }
}

export { bakeRowBands, cutRows, fillRowBands, pasteRows };
