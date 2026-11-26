/** Perspective magnification relative to a reference vertical FOV in degrees. Compute once per view. */
export function detailLens(camera, referenceFov = camera.fov) {
  if (camera.fov === referenceFov) return camera.zoom;
  return camera.zoom * Math.tan(referenceFov * Math.PI / 360) / Math.tan(camera.fov * Math.PI / 360);
}

/**
 * Choose near detail using squared world distance and [enter, leave] distances at unit magnification.
 * Pass the last boolean result for this object, or undefined on first sight to use the midpoint.
 * Magnification can include object scale when the edges describe a unit-sized model.
 */
export function withinDetailRange(distanceSquared, wasNear, magnification, edges) {
  const edge = wasNear === undefined ? (edges[0] + edges[1]) / 2 : edges[wasNear ? 1 : 0];
  const range = edge * magnification;
  return distanceSquared < range * range;
}

/**
 * A level of detail chosen with hysteresis: 3 near, 2 medium, 1 light, 0 past them. `near`, `medium` and `light` are each level's
 * outer edge in metres at a lens of 1, as [for one outside it, for one already inside it]: an edge lies a little further out for
 * one inside, so that nobody standing on it changes every frame. `d2` is the distance squared, `previous` the level last frame,
 * `lens` how much nearer the lens brings things (edges move out with it).
 */
export function detailLevel(d2, previous, lens, near, medium, light) {
  if (withinDetailRange(d2, previous === 3, lens, near)) return 3;
  if (withinDetailRange(d2, previous >= 2, lens, medium)) return 2;
  return withinDetailRange(d2, previous >= 1, lens, light) ? 1 : 0;
}
