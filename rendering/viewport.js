/**
 * Fit a CSS viewport to a drawing-buffer budget while preserving its aspect ratio.
 * Supply a pixel count or rectangular limits in physical pixels. The returned
 * device pixel ratio never exceeds the requested density.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @param {number} requested Requested pixels per CSS pixel.
 * @param {number | {width: number, height: number}} budget
 */
export function fittedPixelRatio(width, height, requested, budget = Infinity) {
  if (typeof budget === 'number') return Math.min(requested, Math.sqrt(budget / (width * height)));
  return Math.min(requested, budget.width / width, budget.height / height);
}

// Project one world unit at unit depth with a perspective camera's vertical field of view.
export function perspectivePointScale(height, fovDegrees) {
  return height / (2 * Math.tan(fovDegrees * Math.PI / 360));
}
