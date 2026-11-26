// Noise every bed is cut from, its end blended into its start so it loops unheard: pink (Kellet's filter, as much in each octave,
// normalised) for the wind, or brown (a leaky sum, with a little white) for water, crowds and rain, at the level they were set to.
export function createNoiseLoop(audioContext, { pink = false, seconds = 8, crossfade = 0.25, random = Math.random } = {}) {
  const n = Math.floor(audioContext.sampleRate * seconds),
    seam = Math.min(n, Math.floor(audioContext.sampleRate * crossfade)),
    buffer = audioContext.createBuffer(1, n, audioContext.sampleRate),
    samples = buffer.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    peak = 0;
  for (let i = 0; i < n; i++) {
    const w = random() * 2 - 1;
    if (pink) {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      samples[i] = b0 + b1 + b2 + w * 0.1848;
    } else {
      b0 = (b0 + 0.03 * w) / 1.03;
      samples[i] = b0 * 3.2 + w * 0.05;
    }
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  for (let i = 0; i < seam; i++) {
    const k = i / seam;
    samples[i] = samples[i] * k + samples[n - seam + i] * (1 - k);
  }
  if (pink && peak > 0) for (let i = 0; i < n; i++) samples[i] *= 0.9 / peak;
  return buffer;
}
export function createSpatialPanner(audioContext, x, y, z, referenceDistance = 10) {
  const pan = audioContext.createPanner();
  pan.panningModel = 'equalpower';
  pan.distanceModel = 'inverse';
  pan.refDistance = referenceDistance;
  if (pan.positionX) {
    pan.positionX.value = x;
    pan.positionY.value = y;
    pan.positionZ.value = z;
  } else pan.setPosition(x, y, z);
  return pan;
}

export function placeListener(L, matrix) {
  const e = matrix.elements;
  if (!L.positionX) return; // a browser without the listener's parameters hears every sound where it stands
  L.positionX.value = e[12];
  L.positionY.value = e[13];
  L.positionZ.value = e[14];
  L.forwardX.value = -e[8];
  L.forwardY.value = -e[9];
  L.forwardZ.value = -e[10];
  L.upX.value = e[4];
  L.upY.value = e[5];
  L.upZ.value = e[6];
}
