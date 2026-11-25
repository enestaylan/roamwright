// Rows of baked grids, cut out to be sent from a worker and put back in their place on the page. A grid is a typed array of
// `rows` rows, with any number of values to a row (a height, three of a normal, four of a cover).

// Copy the half-open row interval [j0, j1) from each grid.
const cutRows = (grids, rows, j0, j1) => grids.map(grid => grid.slice((j0 * grid.length) / rows, (j1 * grid.length) / rows));
// Puts what cutRows cut back into grids of the same shapes, from row j0 on.
const pasteRows = (grids, rows, j0, cut) => grids.forEach((grid, i) => grid.set(cut[i], (j0 * grid.length) / rows));

export { cutRows, pasteRows };
