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

/**
 * Size a renderer and notify its consumer of the actual framebuffer dimensions.
 * Normal resizes use the current CSS viewport and device density. A capture can
 * hold a size across resizes and release it by calling holdSize() without a width.
 * CSS layout remains under the host application's control.
 * @param {{renderer: import('three').WebGLRenderer, width: () => number, height: () => number,
 *   budget?: number | {width:number,height:number}, density?: () => number,
 *   onResize?: (cssWidth:number, cssHeight:number, physicalWidth:number, physicalHeight:number) => void}} options
 */
export function createViewportSizer({renderer, width, height, budget = Infinity,
  density = () => globalThis.devicePixelRatio || 1, onResize}) {
  let held;
  function resize() {
    const w = held?.width ?? width(), h = held?.height ?? height();
    if (!(w > 0 && h > 0)) return;
    const ratio = fittedPixelRatio(w, h, held?.density ?? density(), held?.budget ?? budget);
    renderer.setDrawingBufferSize(w, h, ratio);
    onResize?.(w, h, renderer.domElement.width, renderer.domElement.height);
  }
  /** CSS viewport and density for a capture. A capture may supply its own physical pixel budget. */
  function holdSize(width, height, density = 1, captureBudget = budget) {
    held = width > 0 ? {width, height, density, budget: captureBudget} : undefined;
    resize();
  }
  const drawnSize = () => [renderer.domElement.width, renderer.domElement.height];
  return {resize, holdSize, drawnSize};
}

/** Observe pixel-density changes, including a window moving between displays without a resize.
 * @param {() => void} onChange Called after a density change.
 * @param {Window} [host] Browser window.
 * @returns {() => void} Remove the active listener.
 */
export function watchPixelDensity(onChange, host = window) {
  let query;
  function bind() {
    query = host.matchMedia(`(resolution: ${host.devicePixelRatio || 1}dppx)`);
    query.addEventListener('change', changed, {once: true});
  }
  function changed() {
    bind();
    onChange();
  }
  bind();
  return () => query.removeEventListener('change', changed);
}
