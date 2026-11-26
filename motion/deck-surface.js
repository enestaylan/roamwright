import { deckTop } from './spaces.js';

/**
 * Return a height query over an append-only list of fixed decks in deckTop format.
 * Supply the terrain height function, the square's minimum x and z, its size, and
 * its cell size in world units. The grid rounds up to whole cells. Queries outside
 * it return the terrain height. The query indexes appended decks on first use.
 */
export function createDeckSurface(decks, terrain, x0, z0, size, cellSize) {
  if (!(Number.isFinite(size) && size > 0 && Number.isFinite(cellSize) && cellSize > 0))
    throw new RangeError('Surface and cell sizes must be positive and finite');
  const side = Math.ceil(size / cellSize),
    count = side * side,
    indices = count <= 65535 ? new Uint16Array(count) : new Uint32Array(count),
    lists = [];
  let filed = 0;
  const cell = distance => Math.min(side - 1, Math.max(0, Math.floor(distance / cellSize)));

  function fileNewDecks() {
    while (filed < decks.length) {
      const deck = decks[filed++], radius = Math.hypot(deck.hx, deck.hz);
      for (let row = cell(deck.z - radius - z0); row <= cell(deck.z + radius - z0); row++)
        for (let column = cell(deck.x - radius - x0); column <= cell(deck.x + radius - x0); column++) {
          const key = row * side + column;
          if (!indices[key]) indices[key] = lists.push([]);
          lists[indices[key] - 1].push(deck);
        }
    }
  }

  return (x, z) => {
    if (filed < decks.length) fileNewDecks();
    const i = Math.floor((x - x0) / cellSize), j = Math.floor((z - z0) / cellSize),
      index = i >= 0 && j >= 0 && i < side && j < side ? indices[j * side + i] : 0,
      ground = terrain(x, z);
    return index ? Math.max(ground, deckTop(lists[index - 1], x, z)) : ground;
  };
}
