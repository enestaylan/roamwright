// Fit the drawing buffer to a pixel-area budget while preserving its aspect.
export function fittedPixelRatio(width, height, requested, maxPixels = Infinity) {
  return Math.min(requested, Math.sqrt(maxPixels / (width * height)));
}

// Project one world unit at unit depth with a perspective camera's vertical field of view.
export function perspectivePointScale(height, fovDegrees) {
  return height / (2 * Math.tan(fovDegrees * Math.PI / 360));
}
