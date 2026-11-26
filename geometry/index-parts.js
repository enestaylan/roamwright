// Weld identical vertex records without rounding or changing triangle order. Comparing the
// stored bytes preserves seams, signed zero and normalized attributes exactly.
export function indexParts(parts) {
  const count = parts.position.length / 3;
  if (!count || parts.index) return parts;
  const attributes = Object.entries(parts).map(([name, data]) => {
    const strideBytes = data.byteLength / count;
    const words = !(strideBytes % 4 || data.byteOffset % 4);
    const View = words ? Uint32Array : Uint8Array;
    return {
      name,
      data,
      stride: strideBytes / View.BYTES_PER_ELEMENT,
      source: new View(data.buffer, data.byteOffset, data.byteLength / View.BYTES_PER_ELEMENT),
    };
  });
  const buckets = new Uint32Array(2 ** Math.ceil(Math.log2(count)));
  const links = new Uint32Array(count);
  const originals = new Uint32Array(count);
  const index = count <= 65535 ? new Uint16Array(count) : new Uint32Array(count);
  let used = 0;
  for (let vertex = 0; vertex < count; vertex++) {
    // Hash the complete record so coincident positions along seams, or a tight cluster
    // of tiny features, do not all form one long chain.
    let hash = 2166136261;
    for (let i = 0; i < attributes.length; i++) {
      const { source, stride } = attributes[i];
      const offset = vertex * stride;
      for (let j = 0; j < stride; j++) hash = Math.imul(hash ^ source[offset + j], 16777619);
    }
    const bucket = (hash ^ (hash >>> 16)) & (buckets.length - 1);
    let link = buckets[bucket];
    while (link && !sameVertex(attributes, originals[link - 1], vertex)) link = links[link - 1];
    if (!link) {
      originals[used] = vertex;
      links[used] = buckets[bucket];
      link = buckets[bucket] = ++used;
    }
    index[vertex] = link - 1;
  }
  const packed = { index };
  for (const { name, data, stride, source } of attributes) {
    const out = new data.constructor(used * (data.length / count));
    const dest = new source.constructor(out.buffer);
    for (let i = 0; i < used; i++) {
      const from = originals[i] * stride;
      for (let j = 0; j < stride; j++) dest[i * stride + j] = source[from + j];
    }
    packed[name] = out;
  }
  return packed;
}

function sameVertex(attributes, a, b) {
  for (let i = 0; i < attributes.length; i++) {
    const { source, stride } = attributes[i];
    for (let j = 0; j < stride; j++) if (source[a * stride + j] !== source[b * stride + j]) return false;
  }
  return true;
}
