import * as THREE from 'three';

// Create a canvas of the requested width and height. samplePixel(u, v, out) writes RGBA bytes at each pixel centre. A light's texture is
// made this way, never by a canvas's own gradient: WebKit (an iPhone's engine) dithers a gradient a little in each channel
// apart, which a night's exposure turns into red and green specks over a lantern's pool or a window's patch of light.
function pixelCanvas(width, height, samplePixel) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d'),
    imageData = context.createImageData(width, height),
    pixels = imageData.data,
    out = [0, 0, 0, 255];
  for (let y = 0, pixelOffset = 0; y < height; y++)
    for (let x = 0; x < width; x++, pixelOffset += 4) {
      out[3] = 255;
      samplePixel((x + 0.5) / width, (y + 0.5) / height, out);
      pixels[pixelOffset] = out[0];
      pixels[pixelOffset + 1] = out[1];
      pixels[pixelOffset + 2] = out[2];
      pixels[pixelOffset + 3] = out[3];
    }
  context.putImageData(imageData, 0, 0);
  return canvas;
}
// A square texture built by pixelCanvas, with options.draw(context, size) drawing over it.
function pixelTexture(size, samplePixel, options = {}) {
  const canvas = pixelCanvas(size, size, samplePixel);
  if (options.draw) options.draw(canvas.getContext('2d'), size);
  return canvasTexture(canvas, options);
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
function canvasTexture(canvas, options = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = options.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.colorSpace = options.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.anisotropy = options.aniso || 4;
  return texture;
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
