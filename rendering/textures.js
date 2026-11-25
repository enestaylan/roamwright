import * as THREE from 'three';

// A canvas w x h whose every pixel is worked out here, fn(u, v, out) -> rgba (0..255) at the pixel's middle. A light's texture is
// made this way, never by a canvas's own gradient: WebKit (an iPhone's engine) dithers a gradient a little in each channel
// apart, which a night's exposure turns into red and green specks over a lantern's pool or a window's patch of light.
function pixelCanvas(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d'),
    img = g.createImageData(w, h),
    d = img.data,
    out = [0, 0, 0, 255];
  for (let y = 0, k = 0; y < h; y++)
    for (let x = 0; x < w; x++, k += 4) {
      out[3] = 255;
      fn((x + 0.5) / w, (y + 0.5) / h, out);
      d[k] = out[0];
      d[k + 1] = out[1];
      d[k + 2] = out[2];
      d[k + 3] = out[3];
    }
  g.putImageData(img, 0, 0);
  return c;
}
// A square texture built by pixelCanvas, with opts.draw(context, size) drawing over it.
function pixelTexture(size, fn, opts = {}) {
  const c = pixelCanvas(size, size, fn);
  if (opts.draw) opts.draw(c.getContext('2d'), size);
  return canvasTexture(c, opts);
}
// The value at t of a falloff given by stops [[t, value], ...] in rising t, straight between them and held beyond the ends, as
// a canvas gradient's stops are.
function falloffAt(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, v1] = stops[i];
    if (t <= t1) {
      const [t0, v0] = stops[i - 1];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return stops[stops.length - 1][1];
}
// A texture from a canvas: repeating unless clamped, in sRGB unless it holds data.
function canvasTexture(c, opts = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso || 4;
  return t;
}
// A map of numbers that is written once need not stay in memory once it is on the graphics card: its array is let go there.
// Regenerate the texture after a graphics context loss when using this option.
function onCardOnly(texture) {
  texture.onUpdate = () => {
    texture.image.data = null;
    texture.onUpdate = null;
  };
  return texture;
}

export { canvasTexture, falloffAt, onCardOnly, pixelCanvas, pixelTexture };
