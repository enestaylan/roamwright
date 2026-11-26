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
  scratchVertex = new THREE.Vector3(),
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
      distanceSquared = dx * dx + dy * dy + dz * dz;
    if (distanceSquared > far) far = distanceSquared;
  }
  return [cx, cy, cz, Math.sqrt(far)];
}
// A geometry of the arrays a builder filled (GB.parts). Byte normals, colours and skin weights are read as fractions; a padded
// normal or colour has four numbers to a vertex (the fourth a colour's opaque alpha, which Three.js reads as vertex alpha).
// `sphere`: its bounding sphere as [x, y, z, radius], where it was worked out already, so the points are
// not read again.
function geometryOf(parts, sphere = null) {
  const geometry = new THREE.BufferGeometry(),
    vertices = parts.position.length / 3;
  for (const name in ATTRIBUTES) {
    const array = parts[name],
      size = vertices ? array?.length / vertices : ATTRIBUTES[name];
    if (array) geometry.setAttribute(name, new THREE.BufferAttribute(array, size, name !== 'skinIndex' && !(array instanceof Float32Array)));
  }
  if (parts.index) geometry.setIndex(new THREE.BufferAttribute(parts.index, 1).onUpload(releaseArray));
  const points = parts.position;
  if (!sphere && points instanceof Float32Array && points.length) sphere = sphereOf(points);
  if (sphere) geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(sphere[0], sphere[1], sphere[2]), sphere[3]);
  else geometry.computeBoundingSphere();
  // Skinned meshes compute bounds on the CPU. Keep their positions, joint indices
  // and weights available, including when several meshes share the geometry.
  for (const name in geometry.attributes) if (!(parts.skinIndex && SKIN_BOUNDS.includes(name))) geometry.attributes[name].onUpload(releaseArray);
  return geometry;
}
// A mesh of a builder's arrays (GB.parts), as GB.mesh makes one, in `parent`
function meshOf(parts, material, parent, shadow = true) {
  const mesh = stillMesh(geometryOf(parts), material, shadow);
  parent.add(mesh);
  return mesh;
}
// A static mesh with its local transform fixed and optional shadow casting.
function stillMesh(geometry, material, shadow) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  if (shadow) markStill(mesh);
  return mesh;
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
const normalByte = component => Math.round(component * 127),
  colourByte = component => Math.min(255, Math.round(component * 255)),
  OPAQUE = 255; // a padded colour's fourth byte: an alpha of one
// The first `count` bytes of three to a vertex, four to a vertex: the three and then `fourth`
function padded(bytes, count, fourth) {
  const out = new bytes.constructor((count / 3) * 4);
  for (let i = 0, writeOffset = 0; i < count; i += 3, writeOffset += 4) {
    out[writeOffset] = bytes[i];
    out[writeOffset + 1] = bytes[i + 1];
    out[writeOffset + 2] = bytes[i + 2];
    out[writeOffset + 3] = fourth;
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
  add(geometry, color, transform) {
    const sourceGeometry = geometry.index ? geometry.userData.ni || (geometry.userData.ni = geometry.toNonIndexed()) : geometry;
    const positionArray = sourceGeometry.attributes.position.array,
      normalArray = sourceGeometry.attributes.normal.array,
      numbers = positionArray.length,
      parts = !!this.pb;
    if (parts) {
      this.startPart();
      this._ra = false;
    }
    if (this.M) transform = _m5.multiplyMatrices(this.M, transform);
    _n3.getNormalMatrix(transform);
    this.reserve(numbers);
    // Three.js's Vector3.applyMatrix4, applyMatrix3 and normalize, written out with the matrices' numbers read once for the
    // part: the same sums in the same order, so every vertex is where Three.js would put it
    const [e0, e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12, e13, e14, e15] = transform.elements,
      [f0, f1, f2, f3, f4, f5, f6, f7, f8] = _n3.elements,
      flat = e3 === 0 && e7 === 0 && e11 === 0 && e15 === 1, // no perspective in the matrix: the division Three.js does is by one
      { ox, oy, oz, positions, normals, colours, normalBytes, colourBytes } = this,
      [red, green, blue] = color,
      rByte = colourByte(red),
      grByte = colourByte(green),
      bByte = colourByte(blue);
    if (!(Math.min(red, green, blue) >= 0 && Math.max(red, green, blue) <= 1)) this.wide = true;
    let writeOffset = this.count,
      x0 = 1e9,
      x1 = -1e9,
      y0 = 1e9,
      y1 = -1e9,
      z0 = 1e9,
      z1 = -1e9;
    for (let i = 0; i < numbers; i += 3, writeOffset += 3) {
      let x = positionArray[i],
        y = positionArray[i + 1],
        z = positionArray[i + 2];
      const w = flat ? 1 : 1 / (e3 * x + e7 * y + e11 * z + e15),
        px = (e0 * x + e4 * y + e8 * z + e12) * w + ox,
        py = (e1 * x + e5 * y + e9 * z + e13) * w + oy,
        pz = (e2 * x + e6 * y + e10 * z + e14) * w + oz;
      positions[writeOffset] = px;
      positions[writeOffset + 1] = py;
      positions[writeOffset + 2] = pz;
      if (parts) {
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        if (pz < z0) z0 = pz;
        if (pz > z1) z1 = pz;
      }
      x = normalArray[i];
      y = normalArray[i + 1];
      z = normalArray[i + 2];
      let nx = f0 * x + f3 * y + f6 * z,
        ny = f1 * x + f4 * y + f7 * z,
        nz = f2 * x + f5 * y + f8 * z;
      const unit = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      nx *= unit;
      ny *= unit;
      nz *= unit;
      normals[writeOffset] = nx;
      normals[writeOffset + 1] = ny;
      normals[writeOffset + 2] = nz;
      normalBytes[writeOffset] = normalByte(nx);
      normalBytes[writeOffset + 1] = normalByte(ny);
      normalBytes[writeOffset + 2] = normalByte(nz);
      colours[writeOffset] = red;
      colours[writeOffset + 1] = green;
      colours[writeOffset + 2] = blue;
      colourBytes[writeOffset] = rByte;
      colourBytes[writeOffset + 1] = grByte;
      colourBytes[writeOffset + 2] = bByte;
    }
    this.count = writeOffset;
    if (parts) this.bounds.splice(-6, 6, x0, x1, y0, y1, z0, z1);
    const vertices = numbers / 3;
    if (this.tg) {
      const tag = this.tags?.get(color) ?? this.tv; // a builder may say what each of its colours is made of (a person's body: its metal, its leather)
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
  box(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    return this.add(box, color, TRS(x, y, z, sx, sy, sz, ry, rx, rz));
  }
  raw(x, y, z, nx, ny, nz, red, green, blue, primaryBone = 0, secondaryBone = 0, w = 1) {
    // one vertex, optionally weighted between two bones
    if (this.M) {
      scratchVertex.set(x, y, z).applyMatrix4(this.M);
      x = scratchVertex.x;
      y = scratchVertex.y;
      z = scratchVertex.z;
      scratchVertex.set(nx, ny, nz).transformDirection(this.M);
      nx = scratchVertex.x;
      ny = scratchVertex.y;
      nz = scratchVertex.z;
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
    if (!(Math.min(red, green, blue) >= 0 && Math.max(red, green, blue) <= 1 && Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)) <= 1)) this.wide = true;
    const writeOffset = this.count,
      { positions, normals, colours, normalBytes, colourBytes } = this;
    positions[writeOffset] = x;
    positions[writeOffset + 1] = y;
    positions[writeOffset + 2] = z;
    normals[writeOffset] = nx;
    normals[writeOffset + 1] = ny;
    normals[writeOffset + 2] = nz;
    normalBytes[writeOffset] = normalByte(nx);
    normalBytes[writeOffset + 1] = normalByte(ny);
    normalBytes[writeOffset + 2] = normalByte(nz);
    colours[writeOffset] = red;
    colours[writeOffset + 1] = green;
    colours[writeOffset + 2] = blue;
    colourBytes[writeOffset] = colourByte(red);
    colourBytes[writeOffset + 1] = colourByte(green);
    colourBytes[writeOffset + 2] = colourByte(blue);
    this.count = writeOffset + 3;
    if (this.tg) this.tg.push(this.tv);
    if (this.sk) {
      this.sk.push(primaryBone);
      if (this.sk2) {
        this.sk2.push(secondaryBone);
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
            const firstCorner = part.corners[i] - skip,
              secondCorner = part.corners[i + 1] - skip,
              thirdCorner = part.corners[i + 2] - skip;
            if (firstCorner >= 0 && firstCorner < limit && secondCorner >= 0 && secondCorner < limit && thirdCorner >= 0 && thirdCorner < limit) corners.push(firstCorner, secondCorner, thirdCorner);
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
  sculpt(sculptedMesh, color, secondColor, cut, scale = 1) {
    const { P: positions, N: normals, A: tintWeights, B: shades, D: directions } = sculptedMesh,
      boneIndex = this.bone,
      ox = this.ox,
      oy = this.oy,
      oz = this.oz;
    const emit = vertex => {
      const tintWeight = vertex[9],
        shade = vertex[10];
      this.raw(
        vertex[0] * scale + ox,
        vertex[1] * scale + oy,
        vertex[2] * scale + oz,
        vertex[3],
        vertex[4],
        vertex[5],
        (color[0] + (secondColor[0] - color[0]) * tintWeight) * shade,
        (color[1] + (secondColor[1] - color[1]) * tintWeight) * shade,
        (color[2] + (secondColor[2] - color[2]) * tintWeight) * shade,
        boneIndex,
        boneIndex,
        1,
      );
    };
    const vert = i => [
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
      normals[i * 3],
      normals[i * 3 + 1],
      normals[i * 3 + 2],
      directions[i * 3],
      directions[i * 3 + 1],
      directions[i * 3 + 2],
      tintWeights[i],
      shades[i],
    ];
    const mix = (startVertex, endVertex, fraction) => {
      const interpolated = startVertex.map((x, j) => x + (endVertex[j] - x) * fraction),
        directionLength = Math.hypot(interpolated[6], interpolated[7], interpolated[8]) || 1,
        normalLength = Math.hypot(interpolated[3], interpolated[4], interpolated[5]) || 1;
      interpolated[6] /= directionLength;
      interpolated[7] /= directionLength;
      interpolated[8] /= directionLength;
      interpolated[3] /= normalLength;
      interpolated[4] /= normalLength;
      interpolated[5] /= normalLength;
      return interpolated;
    };
    const out = vertex => !!cut(vertex[6], vertex[7], vertex[8]);
    for (let triangleStart = 0; triangleStart < sculptedMesh.n; triangleStart += 3) {
      const directionOffset = triangleStart * 3,
        o0 = cut ? !!cut(directions[directionOffset], directions[directionOffset + 1], directions[directionOffset + 2]) : false,
        o1 = cut ? !!cut(directions[directionOffset + 3], directions[directionOffset + 4], directions[directionOffset + 5]) : false,
        o2 = cut ? !!cut(directions[directionOffset + 6], directions[directionOffset + 7], directions[directionOffset + 8]) : false;
      if (o0 && o1 && o2) continue;
      if (!o0 && !o1 && !o2) {
        for (let i = triangleStart; i < triangleStart + 3; i++) emit(vert(i));
        continue;
      }
      const tri = [vert(triangleStart), vert(triangleStart + 1), vert(triangleStart + 2)],
        outsideFlags = [o0, o1, o2],
        poly = [];
      for (let e = 0; e < 3; e++) {
        const edgeStart = tri[e],
          edgeEnd = tri[(e + 1) % 3],
          startOutside = outsideFlags[e];
        if (!startOutside) poly.push(edgeStart);
        if (startOutside !== outsideFlags[(e + 1) % 3]) {
          let lo = 0,
            hi = 1;
          for (let iteration = 0; iteration < 7; iteration++) {
            const mid = (lo + hi) / 2;
            if (out(mix(edgeStart, edgeEnd, mid)) === startOutside) lo = mid;
            else hi = mid;
          }
          poly.push(mix(edgeStart, edgeEnd, startOutside ? hi : lo));
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
      const vertexCount = this.sk.length,
        skinIndices = (parts.skinIndex = new Uint8Array(vertexCount * 4)),
        skinWeights = (parts.skinWeight = new Uint8Array(vertexCount * 4));
      for (let i = 0; i < vertexCount; i++) {
        const w = this.sk2 ? Math.round(this.skw[i] * 255) : 255;
        skinIndices[i * 4] = this.sk[i];
        skinWeights[i * 4] = w;
        if (this.sk2) {
          skinIndices[i * 4 + 1] = this.sk2[i];
          skinWeights[i * 4 + 1] = 255 - w;
        }
      }
      if (this.sk3)
        for (const [i, third] of this.sk3) {
          skinIndices[i * 4 + 2] = third[0];
          skinWeights[i * 4 + 2] = Math.min(255 - skinWeights[i * 4], Math.round(third[1] * 255));
          skinWeights[i * 4 + 1] = 255 - skinWeights[i * 4] - skinWeights[i * 4 + 2];
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
  mesh(material, parent, shadow = true) {
    const mesh = stillMesh(this.build(), material, shadow);
    this.release();
    if (parent) parent.add(mesh);
    return mesh;
  }
}

export { GB, geometryOf, geometryView, meshOf, releaseArray, sphereOf };
