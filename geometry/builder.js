/**
 * Build static or skinned triangle geometry from coloured parts. Workers can produce attribute arrays for a renderer on the main thread.
 * @module
 */

import * as THREE from 'three';
import { markStill } from '../rendering/still-casters.js';
import { box, TRS } from './primitives.js';

// ════════════════════════════════════════════════════════════════════════
//  Geometry toolkit: a builder that merges many coloured parts into one geometry (GB), the geometry of what it filled
//  (geometryOf), and the primitives it places
// ════════════════════════════════════════════════════════════════════════
const _n3 = new THREE.Matrix3(),
  _v = new THREE.Vector3(),
  _m5 = new THREE.Matrix4();
// Three.js calls this upload callback with the attribute as its receiver. Static
// geometry can release its CPU copy once the GPU owns the buffer.
function releaseArray() {
  this.bytes = this.array.byteLength; // what stands on the card, for the reckoning of memory
  this.array = null;
}
// What a geometry made by a builder is made of, in order, with the numbers to a vertex of each; a skinned mesh reads the
// positions and the two skin attributes to find its bounds.
const ATTRIBUTES = { position: 3, normal: 3, color: 3, aTag: 1, skinIndex: 4, skinWeight: 4 },
  SKIN_BOUNDS = ['position', 'skinIndex', 'skinWeight'];
// The bounding sphere of points [x, y, z, ...] as Three.js works it out (computeBoundingSphere: the centre of their box, the
// distance of the farthest), as [x, y, z, radius], read straight from the array rather than point by point through the attribute:
// workers can compute a bound before transferring their buffers.
function sphereOf(points) {
  if (!points.length) return [0, 0, 0, 0];
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i],
      y = points[i + 1],
      z = points[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const cx = (x0 + x1) * 0.5,
    cy = (y0 + y1) * 0.5,
    cz = (z0 + z1) * 0.5;
  let far = 0;
  for (let i = 0; i < points.length; i += 3) {
    const dx = points[i] - cx,
      dy = points[i + 1] - cy,
      dz = points[i + 2] - cz,
      d = dx * dx + dy * dy + dz * dz;
    if (d > far) far = d;
  }
  return [cx, cy, cz, Math.sqrt(far)];
}
// A geometry of the arrays a builder filled (GB.parts). Byte normals, colours and skin weights are read as fractions; a padded
// normal or colour has four numbers to a vertex (the fourth a colour's opaque alpha, which Three.js reads as vertex alpha).
// `sphere`: its bounding sphere as [x, y, z, radius], where it was worked out already, so the points are
// not read again.
function geometryOf(parts, sphere = null) {
  const g = new THREE.BufferGeometry(),
    vertices = parts.position.length / 3;
  for (const name in ATTRIBUTES) {
    const array = parts[name],
      size = vertices ? array?.length / vertices : ATTRIBUTES[name];
    if (array) g.setAttribute(name, new THREE.BufferAttribute(array, size, name !== 'skinIndex' && !(array instanceof Float32Array)));
  }
  if (parts.index) g.setIndex(new THREE.BufferAttribute(parts.index, 1).onUpload(releaseArray));
  const points = parts.position;
  if (!sphere && points instanceof Float32Array && points.length) sphere = sphereOf(points);
  if (sphere) g.boundingSphere = new THREE.Sphere(new THREE.Vector3(sphere[0], sphere[1], sphere[2]), sphere[3]);
  else g.computeBoundingSphere();
  // Skinned meshes compute bounds on the CPU. Keep their positions, joint indices
  // and weights available, including when several meshes share the geometry.
  for (const name in g.attributes) if (!(parts.skinIndex && SKIN_BOUNDS.includes(name))) g.attributes[name].onUpload(releaseArray);
  return g;
}
// A mesh of a builder's arrays (GB.parts), as GB.mesh makes one, in `parent`
function meshOf(parts, material, parent, shadow = true) {
  const m = stillMesh(geometryOf(parts), material, shadow);
  parent.add(m);
  return m;
}
// A static mesh with its local transform fixed and optional shadow casting.
function stillMesh(geometry, material, shadow) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  if (shadow) markStill(m);
  return m;
}
// Share GPU buffers and bounds while giving each instanced mesh a geometry identity
// of its own. Three.js can then reuse the vertex bindings for each mesh.
function geometryView(source) {
  if (!source.boundingSphere) source.computeBoundingSphere();
  const view = new THREE.BufferGeometry();
  view.setIndex(source.index);
  for (const name in source.attributes) view.setAttribute(name, source.attributes[name]);
  view.boundingSphere = source.boundingSphere.clone();
  return view;
}
const ROOM = 768, // initial capacity in scalar components
  GROWTH = 2, // geometric growth keeps the total copying cost linear
  NO_FLOATS = new Float32Array(0),
  NO_NORMAL_BYTES = new Int8Array(0),
  NO_COLOUR_BYTES = new Uint8Array(0);
// A typed array like `array` with room for `room` numbers, the first `used` of them carried over.
function withRoom(array, room, used) {
  const roomier = new array.constructor(room);
  roomier.set(array.subarray(0, used));
  return roomier;
}
// A normal's or a colour's number as the byte a compact geometry stores (the typed array it goes into wraps what is out of range).
const normalByte = n => Math.round(n * 127),
  colourByte = c => Math.min(255, Math.round(c * 255)),
  OPAQUE = 255; // a padded colour's fourth byte: an alpha of one
// The first `count` bytes of three to a vertex, four to a vertex: the three and then `fourth`
function padded(bytes, count, fourth) {
  const out = new bytes.constructor((count / 3) * 4);
  for (let i = 0, o = 0; i < count; i += 3, o += 4) {
    out[o] = bytes[i];
    out[o + 1] = bytes[i + 1];
    out[o + 2] = bytes[i + 2];
    out[o + 3] = fourth;
  }
  return out;
}
/**
 * Accumulate coloured primitives and triangles in one set of vertex buffers.
 * Import this class as `GeometryBuilder` from the package root. Use `parts`
 * to transfer the result from a worker, or `mesh` to add it directly to a scene.
 */
class GB {
  constructor() {
    // Positions, normals and colours fill typed arrays that grow, three numbers to a vertex: four bytes a number where a plain
    // array of numbers takes eight. Normals and colours are kept twice, as floats and as the bytes a compact geometry stores
    // (build), each rounded from the number as it was worked out, so either geometry comes out as if the numbers had been kept whole.
    this.count = 0; // numbers filled so far
    this.indexed = null; // ranges of shared vertices, with their triangles in draw order
    this.positions = this.normals = this.colours = NO_FLOATS;
    this.normalBytes = NO_NORMAL_BYTES;
    this.colourBytes = NO_COLOUR_BYTES;
    this.ox = this.oy = this.oz = 0;
    this.bone = 0;
    this.sk = null;
    this.M = null;
    this.tg = null;
    this.tv = 0;
    this.sk2 = null;
    this.sk3 = null; // a third bone for the few vertices that have one (third)
    this.spent = false; // true once release has let the parts go
    this.wide = false; // true once a colour outside 0..1 or a normal's number outside -1..1 is put in: bytes cannot hold it
    this.skw = null;
    // Set pb to [] to record the start of each part. Its six bounding-box components
    // are measured before vertex positions are rounded to floats.
    this.bounds = [];
  }
  // What has been filled so far, for whoever looks at it: positions, normals and colours, three numbers to a vertex.
  get p() {
    return this.positions.subarray(0, this.count);
  }
  get n() {
    return this.normals.subarray(0, this.count);
  }
  get c() {
    return this.colours.subarray(0, this.count);
  }
  // Makes room for `more` numbers.
  reserve(more) {
    const needed = this.count + more;
    if (needed <= this.positions.length) return;
    const room = Math.max(needed, ROOM, Math.ceil(this.positions.length * GROWTH));
    for (const part of ['positions', 'normals', 'colours', 'normalBytes', 'colourBytes'])
      this[part] = withRoom(this[part], room, this.count);
  }
  // Notes that a part begins here, where parts are noted (pb): its start, and a box with nothing in it yet.
  startPart() {
    this.pb.push(this.count);
    this.bounds.push(1e9, -1e9, 1e9, -1e9, 1e9, -1e9);
  }
  add(geo, col, m) {
    const g = geo.index ? geo.userData.ni || (geo.userData.ni = geo.toNonIndexed()) : geo;
    const pa = g.attributes.position.array,
      na = g.attributes.normal.array,
      numbers = pa.length,
      parts = !!this.pb;
    if (parts) {
      this.startPart();
      this._ra = false;
    }
    if (this.M) m = _m5.multiplyMatrices(this.M, m);
    _n3.getNormalMatrix(m);
    this.reserve(numbers);
    // Three.js's Vector3.applyMatrix4, applyMatrix3 and normalize, written out with the matrices' numbers read once for the
    // part: the same sums in the same order, so every vertex is where Three.js would put it
    const [e0, e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12, e13, e14, e15] = m.elements,
      [f0, f1, f2, f3, f4, f5, f6, f7, f8] = _n3.elements,
      flat = e3 === 0 && e7 === 0 && e11 === 0 && e15 === 1, // no perspective in the matrix: the division Three.js does is by one
      { ox, oy, oz, positions, normals, colours, normalBytes, colourBytes } = this,
      [r, gr, b] = col,
      rByte = colourByte(r),
      grByte = colourByte(gr),
      bByte = colourByte(b);
    if (!(Math.min(r, gr, b) >= 0 && Math.max(r, gr, b) <= 1)) this.wide = true;
    let k = this.count,
      x0 = 1e9,
      x1 = -1e9,
      y0 = 1e9,
      y1 = -1e9,
      z0 = 1e9,
      z1 = -1e9;
    for (let i = 0; i < numbers; i += 3, k += 3) {
      let x = pa[i],
        y = pa[i + 1],
        z = pa[i + 2];
      const w = flat ? 1 : 1 / (e3 * x + e7 * y + e11 * z + e15),
        px = (e0 * x + e4 * y + e8 * z + e12) * w + ox,
        py = (e1 * x + e5 * y + e9 * z + e13) * w + oy,
        pz = (e2 * x + e6 * y + e10 * z + e14) * w + oz;
      positions[k] = px;
      positions[k + 1] = py;
      positions[k + 2] = pz;
      if (parts) {
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        if (pz < z0) z0 = pz;
        if (pz > z1) z1 = pz;
      }
      x = na[i];
      y = na[i + 1];
      z = na[i + 2];
      let nx = f0 * x + f3 * y + f6 * z,
        ny = f1 * x + f4 * y + f7 * z,
        nz = f2 * x + f5 * y + f8 * z;
      const unit = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      nx *= unit;
      ny *= unit;
      nz *= unit;
      normals[k] = nx;
      normals[k + 1] = ny;
      normals[k + 2] = nz;
      normalBytes[k] = normalByte(nx);
      normalBytes[k + 1] = normalByte(ny);
      normalBytes[k + 2] = normalByte(nz);
      colours[k] = r;
      colours[k + 1] = gr;
      colours[k + 2] = b;
      colourBytes[k] = rByte;
      colourBytes[k + 1] = grByte;
      colourBytes[k + 2] = bByte;
    }
    this.count = k;
    if (parts) this.bounds.splice(-6, 6, x0, x1, y0, y1, z0, z1);
    const vertices = numbers / 3;
    if (this.tg) {
      const tag = this.tags?.get(col) ?? this.tv; // a builder may say what each of its colours is made of (a person's body: its metal, its leather)
      for (let i = 0; i < vertices; i++) this.tg.push(tag);
    }
    if (this.sk)
      for (let i = 0; i < vertices; i++) {
        this.sk.push(this.bone);
        if (this.sk2) {
          this.sk2.push(this.bone);
          this.skw.push(1);
        }
      }
    return this;
  }
  /** Append a box with its base centred at (x, y, z). Dimensions are in world units and rotations are in radians. */
  box(x, y, z, sx, sy, sz, col, ry = 0, rx = 0, rz = 0) {
    return this.add(box, col, TRS(x, y, z, sx, sy, sz, ry, rx, rz));
  }
  raw(x, y, z, nx, ny, nz, r, g, b, b1 = 0, b2 = 0, w = 1) {
    // one vertex, optionally weighted between two bones
    if (this.M) {
      _v.set(x, y, z).applyMatrix4(this.M);
      x = _v.x;
      y = _v.y;
      z = _v.z;
      _v.set(nx, ny, nz).transformDirection(this.M);
      nx = _v.x;
      ny = _v.y;
      nz = _v.z;
    }
    if (this.pb) {
      // vertices put in one after another are one part
      if (!this._ra) {
        this.startPart();
        this._ra = true;
      }
      const box = this.bounds,
        at = box.length - 6;
      if (x < box[at]) box[at] = x;
      if (x > box[at + 1]) box[at + 1] = x;
      if (y < box[at + 2]) box[at + 2] = y;
      if (y > box[at + 3]) box[at + 3] = y;
      if (z < box[at + 4]) box[at + 4] = z;
      if (z > box[at + 5]) box[at + 5] = z;
    }
    this.reserve(3);
    if (!(Math.min(r, g, b) >= 0 && Math.max(r, g, b) <= 1 && Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)) <= 1)) this.wide = true;
    const k = this.count,
      { positions, normals, colours, normalBytes, colourBytes } = this;
    positions[k] = x;
    positions[k + 1] = y;
    positions[k + 2] = z;
    normals[k] = nx;
    normals[k + 1] = ny;
    normals[k + 2] = nz;
    normalBytes[k] = normalByte(nx);
    normalBytes[k + 1] = normalByte(ny);
    normalBytes[k + 2] = normalByte(nz);
    colours[k] = r;
    colours[k + 1] = g;
    colours[k + 2] = b;
    colourBytes[k] = colourByte(r);
    colourBytes[k + 1] = colourByte(g);
    colourBytes[k + 2] = colourByte(b);
    this.count = k + 3;
    if (this.tg) this.tg.push(this.tv);
    if (this.sk) {
      this.sk.push(b1);
      if (this.sk2) {
        this.sk2.push(b2);
        this.skw.push(w);
      }
    }
  }
  // Gives the vertex added last a third bone, whose share is taken from its second bone's (a face, where jaw, lips and skull meet).
  third(bone, weight) {
    (this.sk3 ||= new Map()).set(this.sk.length - 1, [bone, weight]);
  }
  // The vertices written since `first` form these triangles, numbered locally from zero. Ordinary parts stay implicit.
  triangles(first, corners, end = this.count / 3) {
    (this.indexed ||= []).push({ first, end, corners });
  }
  // Fill the element buffer once the final number of vertices (and hence the index width) is known.
  elementArray() {
    const vertices = this.count / 3;
    let count = vertices;
    for (const { first, end, corners } of this.indexed) count += corners.length - (end - first);
    // WebGL 2 reserves the largest unsigned index for primitive restart.
    const index = vertices <= 65535 ? new Uint16Array(count) : new Uint32Array(count);
    let v = 0,
      at = 0;
    for (const { first, end, corners } of this.indexed) {
      while (v < first) index[at++] = v++;
      for (let i = 0; i < corners.length; i++) index[at++] = first + corners[i];
      v = end;
    }
    while (v < vertices) index[at++] = v++;
    return index;
  }
  // Takes the numbers `from`..`to` of another builder's vertices as they are, with their tags where both keep tags.
  take(other, from, to) {
    const first = this.count / 3;
    this.reserve(to - from);
    for (const part of ['positions', 'normals', 'colours', 'normalBytes', 'colourBytes'])
      this[part].set(other[part].subarray(from, to), this.count);
    this.count += to - from;
    if (other.indexed) {
      const start = from / 3,
        end = to / 3;
      for (const part of other.indexed) {
        const lo = Math.max(start, part.first),
          hi = Math.min(end, part.end);
        if (lo >= hi) continue;
        let corners = part.corners;
        if (lo !== part.first || hi !== part.end) {
          // A partial range can only draw triangles whose three vertices were taken.
          corners = [];
          const skip = lo - part.first,
            limit = hi - lo;
          for (let i = 0; i < part.corners.length; i += 3) {
            const a = part.corners[i] - skip,
              b = part.corners[i + 1] - skip,
              c = part.corners[i + 2] - skip;
            if (a >= 0 && a < limit && b >= 0 && b < limit && c >= 0 && c < limit) corners.push(a, b, c);
          }
        }
        this.triangles(first + lo - start, corners, first + hi - start);
      }
    }
    if (other.wide) this.wide = true;
    if (this.tg && other.tg) for (let i = from / 3; i < to / 3; i++) this.tg.push(other.tg[i]);
  }
  // A sculptMesh, tinted between two colours by its first channel. cut(dir) leaves out what it is true for; the triangles its edge
  // crosses are clipped where the edge runs (found by halving along each crossed side), so a hairline, beard or hood ends in a
  // smooth line instead of the sphere's triangles.
  sculpt(m, col, col2, cut, k = 1) {
    const { P, N, A, B, D } = m,
      bn = this.bone,
      ox = this.ox,
      oy = this.oy,
      oz = this.oz;
    const emit = v => {
      const a = v[9],
        sh = v[10];
      this.raw(
        v[0] * k + ox,
        v[1] * k + oy,
        v[2] * k + oz,
        v[3],
        v[4],
        v[5],
        (col[0] + (col2[0] - col[0]) * a) * sh,
        (col[1] + (col2[1] - col[1]) * a) * sh,
        (col[2] + (col2[2] - col[2]) * a) * sh,
        bn,
        bn,
        1,
      );
    };
    const vert = i => [
      P[i * 3],
      P[i * 3 + 1],
      P[i * 3 + 2],
      N[i * 3],
      N[i * 3 + 1],
      N[i * 3 + 2],
      D[i * 3],
      D[i * 3 + 1],
      D[i * 3 + 2],
      A[i],
      B[i],
    ];
    const mix = (u, v, t) => {
      const r = u.map((x, j) => x + (v[j] - x) * t),
        l = Math.hypot(r[6], r[7], r[8]) || 1,
        ln = Math.hypot(r[3], r[4], r[5]) || 1;
      r[6] /= l;
      r[7] /= l;
      r[8] /= l;
      r[3] /= ln;
      r[4] /= ln;
      r[5] /= ln;
      return r;
    };
    const out = v => !!cut(v[6], v[7], v[8]);
    for (let t = 0; t < m.n; t += 3) {
      const q = t * 3,
        o0 = cut ? !!cut(D[q], D[q + 1], D[q + 2]) : false,
        o1 = cut ? !!cut(D[q + 3], D[q + 4], D[q + 5]) : false,
        o2 = cut ? !!cut(D[q + 6], D[q + 7], D[q + 8]) : false;
      if (o0 && o1 && o2) continue;
      if (!o0 && !o1 && !o2) {
        for (let i = t; i < t + 3; i++) emit(vert(i));
        continue;
      }
      const tri = [vert(t), vert(t + 1), vert(t + 2)],
        o = [o0, o1, o2],
        poly = [];
      for (let e = 0; e < 3; e++) {
        const a = tri[e],
          b = tri[(e + 1) % 3],
          oa = o[e];
        if (!oa) poly.push(a);
        if (oa !== o[(e + 1) % 3]) {
          let lo = 0,
            hi = 1;
          for (let s = 0; s < 7; s++) {
            const mid = (lo + hi) / 2;
            if (out(mix(a, b, mid)) === oa) lo = mid;
            else hi = mid;
          }
          poly.push(mix(a, b, oa ? hi : lo));
        }
      }
      for (let i = 1; i < poly.length - 1; i++) {
        emit(poly[0]);
        emit(poly[i]);
        emit(poly[i + 1]);
      }
    }
  }
  /**
   * Copy the filled attributes into right-sized typed arrays for `geometryOf`.
   * The arrays can be transferred to another thread. The builder retains its own storage.
   * @param {boolean} [compact] - Store normals and colours as normalized bytes.
   * @param {boolean} [pad] - Pad compact normals and colours to four bytes per vertex for aligned GPU uploads.
   */
  parts(compact, pad = false) {
    if (this.spent) throw new Error('GB: built again after its parts were let go (release)');
    const filled = array => array.slice(0, this.count),
      bytes = (array, fourth) => (pad ? padded(array, this.count, fourth) : filled(array)),
      parts = {
        position: filled(this.positions),
        normal: compact ? bytes(this.normalBytes, 0) : filled(this.normals),
        color: compact ? bytes(this.colourBytes, OPAQUE) : filled(this.colours),
      };
    if (this.indexed) parts.index = this.elementArray();
    if (this.tg) parts.aTag = new Float32Array(this.tg);
    if (this.sk) {
      // rigid skinning: every vertex follows exactly one bone
      const n = this.sk.length,
        si = (parts.skinIndex = new Uint8Array(n * 4)),
        sw = (parts.skinWeight = new Uint8Array(n * 4));
      for (let i = 0; i < n; i++) {
        const w = this.sk2 ? Math.round(this.skw[i] * 255) : 255;
        si[i * 4] = this.sk[i];
        sw[i * 4] = w;
        if (this.sk2) {
          si[i * 4 + 1] = this.sk2[i];
          sw[i * 4 + 1] = 255 - w;
        }
      }
      if (this.sk3)
        for (const [i, third] of this.sk3) {
          si[i * 4 + 2] = third[0];
          sw[i * 4 + 2] = Math.min(255 - sw[i * 4], Math.round(third[1] * 255));
          sw[i * 4 + 1] = 255 - sw[i * 4] - sw[i * 4 + 2];
        }
    }
    return parts;
  }
  // A geometry of what has been filled: byte normals and colours (a quarter of the floats' memory, and the same numbers to within
  // the bytes' step, as the shaders read them) unless a number was put in that bytes cannot hold.
  build(compact = !this.wide) {
    return geometryOf(this.parts(compact));
  }
  // Drop the backing arrays after the geometry has taken ownership of its buffers.
  release() {
    this.positions = this.normals = this.colours = NO_FLOATS;
    this.normalBytes = NO_NORMAL_BYTES;
    this.colourBytes = NO_COLOUR_BYTES;
    this.count = 0;
    this.indexed = null;
    this.bounds = [];
    if (this.tg) this.tg = [];
    if (this.sk) this.sk = [];
    if (this.sk2) this.sk2 = [];
    this.sk3 = null;
    if (this.skw) this.skw = [];
    this.spent = true;
  }
  /** Build a static mesh, release the builder’s backing arrays and attach the mesh to the optional parent. */
  mesh(mat, parent, shadow = true) {
    const m = stillMesh(this.build(), mat, shadow);
    this.release();
    if (parent) parent.add(m);
    return m;
  }
}

export { GB, geometryOf, geometryView, meshOf, releaseArray, sphereOf };
