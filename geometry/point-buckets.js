import { cellKey } from '../math/cell-key.js';

// Index points of an append-only list. Filed x, z and radius are immutable.
export class PointBuckets {
  // `list`: the things, an array that only grows; `cell`: metres to a side of a cell; `radius(item)`: how far the thing reaches
  // beyond its point, if it has a size (the largest is kept, so a test can widen its reach by it).
  constructor(list, cell, radius = () => 0) {
    if (!(Number.isFinite(cell) && cell > 0)) throw new RangeError('Cell size must be positive and finite');
    this.list = list;
    this.cell = cell;
    this.radius = radius;
    this.widest = 0; // the largest radius filed
    this.filed = 0; // how many of the list are filed
    this.cells = new Map();
  }
  // Files what has been pushed onto the list since the last test.
  catchUp() {
    const { list, cell, cells } = this;
    for (; this.filed < list.length; this.filed++) {
      const item = list[this.filed],
        key = cellKey(Math.floor(item.x / cell), Math.floor(item.z / cell));
      this.widest = Math.max(this.widest, this.radius(item));
      const held = cells.get(key);
      if (held) held.push(item);
      else cells.set(key, [item]);
    }
  }
  // Visit candidate cells in column, row and insertion order. The predicate performs
  // the exact distance or footprint test. widen extends reach by the largest filed radius.
  find(x, z, reach, test, widen = false) {
    this.catchUp();
    const { cell, cells } = this,
      r = reach + (widen ? this.widest : 0),
      i1 = Math.floor((x + r) / cell),
      j0 = Math.floor((z - r) / cell),
      j1 = Math.floor((z + r) / cell),
      i0 = Math.floor((x - r) / cell);
    if (!Number.isSafeInteger(i0) || !Number.isSafeInteger(i1) || !Number.isSafeInteger(j0) || !Number.isSafeInteger(j1))
      throw new RangeError('Query exceeds the supported grid coordinates');
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const held = cells.get(cellKey(i, j));
        if (held) for (const item of held) if (test(item)) return item;
      }
    return undefined;
  }
  some(x, z, reach, test, widen = false) {
    return this.find(x, z, reach, test, widen) !== undefined;
  }
}
