/**
 * Keep terrain heights, raised decks and collision queries together for each space the player can enter.
 * @module
 */

import { cellKey } from '../math/cell-key.js';

/** Highest rotated rectangular deck at a point. k is rise per unit of local z. */
export function deckTop(list, x, z) {
  let best = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const deck = list[i],
      dx = x - deck.x,
      dz = z - deck.z,
      lx = dx * deck.c - dz * deck.s,
      lz = dx * deck.s + dz * deck.c;
    if (Math.abs(lx) <= deck.hx && Math.abs(lz) <= deck.hz) {
      const y = deck.k ? deck.y + lz * deck.k : deck.y;
      if (y > best) best = y;
    }
  }
  return best;
}

const turns = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4];

/**
 * Create an independent registry around a root space with an id and optional
 * terrain height function. Other spaces supply their own ground and collider grid.
 * maxRadius is the largest querying body's radius, in the same units as the grid.
 */
export function createSpaces(definition, { deckCellSize = 32, colliderCellSize = 16, maxRadius = 1 } = {}) {
  if (!(Number.isFinite(deckCellSize) && deckCellSize > 0 && Number.isFinite(colliderCellSize) && colliderCellSize > 0))
    throw new RangeError('Grid cells must have finite positive dimensions');
  if (!(Number.isFinite(maxRadius) && maxRadius >= 0)) throw new RangeError('maxRadius must be finite and nonnegative');
  const decks = [],
    deckGrid = new Map(),
    built = new Set(),
    hit = { x: 0, z: 0 };
  let indexedDecks = -1,
    terrain = definition.ground ?? (() => 0);

  function setTerrain(heightAt) {
    terrain = heightAt;
  }
  // Length changes are observed automatically. Call this after editing a deck in place.
  function invalidateDecks() {
    indexedDecks = -1;
  }
  function deckHeight(x, z) {
    if (indexedDecks !== decks.length) {
      deckGrid.clear();
      indexedDecks = decks.length;
      for (const deck of decks) {
        const reach = Math.hypot(deck.hx, deck.hz);
        for (let i = Math.floor((deck.x - reach) / deckCellSize); i <= Math.floor((deck.x + reach) / deckCellSize); i++)
          for (let j = Math.floor((deck.z - reach) / deckCellSize); j <= Math.floor((deck.z + reach) / deckCellSize); j++) {
            const key = cellKey(i, j);
            let list = deckGrid.get(key);
            if (!list) deckGrid.set(key, (list = []));
            list.push(deck);
          }
      }
    }
    const list = deckGrid.get(cellKey(Math.floor(x / deckCellSize), Math.floor(z / deckCellSize)));
    return list ? deckTop(list, x, z) : -Infinity;
  }
  const onDeck = (x, z) => deckHeight(x, z) !== -Infinity;
  const worldSpace = {
    cx: 0,
    cz: 0,
    bound: Infinity,
    ...definition,
    colliders: definition.colliders ?? 0,
    grid: definition.grid ?? new Map(),
    ground(x, z) {
      const height = terrain(x, z);
      return decks.length ? Math.max(height, deckHeight(x, z)) : height;
    },
  };
  let space = worldSpace;
  const spaces = Object.assign(Object.create(null), { [worldSpace.id]: worldSpace });
  function useSpace(next) {
    space = next;
  }
  const isBuilt = id => built.has(id);
  function markBuilt(id) {
    built.add(id);
  }
  const overhead = { ground: () => -Infinity, wall: () => false, keepOut: () => null };
  function setOverhead(ground, wall, keepOut) {
    overhead.ground = ground;
    overhead.wall = wall;
    overhead.keepOut = keepOut;
  }
  // File the obstacle in every cell a querying body's centre could occupy.
  function addCollider(target, obstacle) {
    target.colliders = (target.colliders ?? 0) + 1;
    const reach = (obstacle.r !== undefined ? obstacle.r : Math.hypot(obstacle.hx, obstacle.hz)) + maxRadius;
    const x0 = Math.floor((obstacle.x - reach) / colliderCellSize),
      x1 = Math.floor((obstacle.x + reach) / colliderCellSize),
      z0 = Math.floor((obstacle.z - reach) / colliderCellSize),
      z1 = Math.floor((obstacle.z + reach) / colliderCellSize);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const key = cellKey(ix, iz);
        let list = target.grid.get(key);
        if (!list) target.grid.set(key, (list = []));
        list.push(obstacle);
      }
  }
  const addBox = (target, x, z, hx, hz, angle = 0) => addCollider(target, { x, z, hx, hz, c: Math.cos(angle), s: Math.sin(angle) });
  const addCircle = (target, x, z, r) => addCollider(target, { x, z, r });
  // Broad-phase candidates in all intersecting cells, in insertion order within each cell.
  function collidersOver(target, x0, z0, x1, z1) {
    const found = new Set();
    for (let ix = Math.floor(x0 / colliderCellSize); ix <= Math.floor(x1 / colliderCellSize); ix++)
      for (let iz = Math.floor(z0 / colliderCellSize); iz <= Math.floor(z1 / colliderCellSize); iz++)
        for (const obstacle of target.grid.get(cellKey(ix, iz)) ?? []) found.add(obstacle);
    return [...found];
  }
  function colliderGrid(list) {
    const holder = { grid: new Map() };
    for (const obstacle of list) addCollider(holder, obstacle);
    return holder.grid;
  }
  // Two passes allow a push away from one wall to meet an adjacent face. A resolved
  // point is written into this instance's hit record so a frame needs no allocation.
  function collideIn(grid, x, z, r) {
    if (!grid) return false;
    let moved = false;
    for (let pass = 0; pass < 2; pass++) {
      const list = grid.get(cellKey(Math.floor(x / colliderCellSize), Math.floor(z / colliderCellSize)));
      if (!list) break;
      let any = false;
      for (let i = 0; i < list.length; i++) {
        const collider = list[i],
          dx = x - collider.x,
          dz = z - collider.z;
        if (collider.r !== undefined) {
          const distance = Math.hypot(dx, dz),
            clearance = collider.r + r;
          if (distance < clearance && distance > 1e-4) {
            x = collider.x + (dx / distance) * clearance;
            z = collider.z + (dz / distance) * clearance;
            any = true;
          }
        } else {
          let lx = dx * collider.c - dz * collider.s,
            lz = dx * collider.s + dz * collider.c;
          const px = collider.hx + r - Math.abs(lx),
            pz = collider.hz + r - Math.abs(lz);
          if (px > 0 && pz > 0) {
            if (px < pz) lx = (lx < 0 ? -1 : 1) * (collider.hx + r);
            else lz = (lz < 0 ? -1 : 1) * (collider.hz + r);
            x = collider.x + lx * collider.c + lz * collider.s;
            z = collider.z - lx * collider.s + lz * collider.c;
            any = true;
          }
        }
      }
      if (!any) break;
      moved = true;
    }
    hit.x = x;
    hit.z = z;
    return moved;
  }
  const collide = (x, z, r) => collideIn(space.grid, x, z, r);
  // Try offsets on alternating sides of the desired heading. A body already
  // inside a solid is free to move out along its desired heading.
  function steer(x, z, want, step, r, lean = 1) {
    if (collide(x, z, r)) return want;
    for (let i = 0; i < turns.length; i++) {
      const heading = want + turns[i] * lean;
      if (!collide(x + Math.sin(heading) * step, z + Math.cos(heading) * step, r)) return heading;
    }
    return undefined;
  }
  return {
    worldSpace,
    spaces,
    get space() {
      return space;
    },
    useSpace,
    isBuilt,
    markBuilt,
    decks,
    deckHeight,
    onDeck,
    invalidateDecks,
    setTerrain,
    overhead,
    setOverhead,
    hit,
    addBox,
    addCircle,
    addCollider,
    collidersOver,
    colliderGrid,
    collide,
    collideIn,
    steer,
  };
}
