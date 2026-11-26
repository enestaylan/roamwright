import * as THREE from 'three';
import { onCardOnly } from './textures.js';

// Each instance owns the startup queue for one renderer. Fill functions return RGBA bytes.
export function createTextureFills({ definitions, fillPixels, request, available = () => !!request }) {
  const pending = [],
    waiting = [];
  let asking = false,
    started = false; // once the first frame has been drawn: a texture asked for later is filled here, so it is never drawn empty

  // Relative cost passed to the application’s scheduler.
  const fillCost = name => definitions[name].cost ?? 1;
  // An empty texture of a fill by name, repeating unless clamped, in sRGB unless it holds data, as `pixelTexture` makes one, and what
  // puts pixels in it. A fill with a `depth` is a block: a texture in three dimensions.
  function emptyTexture(name, options) {
    const { size, depth } = definitions[name],
      texture = depth ? new THREE.Data3DTexture(null, size, size, depth) : new THREE.DataTexture(null, size, size);
    texture.wrapS = texture.wrapT = texture.wrapR = options.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.colorSpace = options.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.anisotropy = options.aniso || 4;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    const fill = pixels => {
      texture.image.data = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      texture.needsUpdate = true;
      onCardOnly(texture); // the card keeps it, with its mipmaps
    };
    return { texture, fill };
  }
  // The texture of a fill by name.
  function filledTexture(name, options = {}) {
    const { texture, fill } = emptyTexture(name, options),
      ask = () => pending.push(request(name, fillCost(name)).then(fill, () => fill(fillPixels(name))));
    if (!available() || started) fill(fillPixels(name));
    else if (asking) ask();
    else waiting.push(ask);
    return texture;
  }
  // Sends the textures made so far to the workers, and every one made after this at once.
  function fillTextures() {
    asking = true;
    for (const ask of waiting.splice(0)) ask();
  }
  // Kept when every texture asked for so far has its pixels: the first frame waits for it.
  function texturesFilled() {
    fillTextures();
    started = true;
    return Promise.all(pending.splice(0));
  }

  // A texture asked for in the world, by something built ahead of need, that is not drawn before `filled()`: filled on the pool's
  // workers, or here by `fillNow()` if it is wanted before they answer.
  function filledLater(name, options = {}) {
    const { texture, fill } = emptyTexture(name, options);
    let done = false;
    const fillOnce = pixels => {
      if (done) return;
      done = true;
      fill(pixels);
    };
    const fillNow = () => done || fillOnce(fillPixels(name));
    if (available()) request(name, fillCost(name)).then(fillOnce, fillNow);
    else fillNow();
    return { texture, filled: () => done, fillNow };
  }
  return { filledLater, filledTexture, fillTextures, texturesFilled };
}
