const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;
const INTEGRATED = /intel|mali|adreno|powervr/i;

export function createDeviceQuality({
  renderer, handheld = () => false, memoryGB = () => undefined, cores = () => undefined,
  smallMemory = 2, phoneMemory = 4, desktopMemory = 8, desktopCores = 8,
}) {
  // The first renderer query can block on outstanding GPU work. Cache its result for future quality changes.
  let card = null;
  function cardName() {
    if (card !== null) return card;
    const gl = renderer.getContext(),
      info = gl.getExtension('WEBGL_debug_renderer_info');
    return (card = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
  }
  // True where the browser draws in software, with no graphics card: hardware acceleration is switched off, or the card is refused.
  const drawnInSoftware = () => SOFTWARE.test(cardName());
  function deviceQuality() {
    const gpu = cardName(),
      memory = memoryGB() ?? Infinity,
      threads = cores() ?? desktopCores;
    if (SOFTWARE.test(gpu) || memory <= smallMemory) return 'low';
    if (handheld()) return memory <= phoneMemory ? 'low' : 'medium';
    return threads < desktopCores || memory < desktopMemory || INTEGRATED.test(gpu) ? 'medium' : 'high';
  }
  return { deviceQuality, drawnInSoftware };
}
