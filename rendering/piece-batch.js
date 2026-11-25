import * as THREE from 'three';

const GL_TYPE = new Map([
  [Float32Array, 5126],
  [Int8Array, 5120],
  [Uint8Array, 5121],
]);
const GL_UNSIGNED_INT = 5125,
  INDEX_BYTES = 4,
  PACK_LEAST = 65536; // a batch is packed only if it has room for at least this many vertices
// How a batch's buffers fit its pieces: `growth`, how much larger they are made when they are full; `use`, the share of them its
// pieces must fill for it not to be packed (pack); `room`, how much larger than its pieces the buffers it is packed into are.
// TIGHT trades more frequent GPU copies for less unused buffer capacity.
const LOOSE = { growth: 1.5, use: 2 / 3, room: 1.2 },
  TIGHT = { growth: 1.2, use: 0.8, room: 1.1 };
// Runs of items in a buffer: a new run takes the first gap it fits, or goes at the end
class Runs {
  constructor(end = 0) {
    this.end = end; // the first item after the last run
    this.gaps = []; // [start, count] of let-go runs before `end`, in order
  }
  claim(count) {
    for (let i = 0; i < this.gaps.length; i++) {
      const gap = this.gaps[i];
      if (gap[1] < count) continue;
      const start = gap[0];
      if (gap[1] === count) this.gaps.splice(i, 1);
      else this.gaps[i] = [start + count, gap[1] - count];
      return start;
    }
    const start = this.end;
    this.end += count;
    return start;
  }
  release(start, count) {
    if (start + count === this.end) {
      this.end = start;
      const last = this.gaps[this.gaps.length - 1];
      if (last && last[0] + last[1] === this.end) this.end = this.gaps.pop()[0];
      return;
    }
    let i = 0;
    while (i < this.gaps.length && this.gaps[i][0] < start) i++;
    this.gaps.splice(i, 0, [start, count]);
    for (const at of [i, i - 1]) {
      const a = this.gaps[at],
        b = this.gaps[at + 1];
      if (a && b && a[0] + a[1] === b[0]) this.gaps.splice(at, 2, [a[0], a[1] + b[1]]);
    }
  }
}

/**
 * Create a mesh class bound to a renderer and its main camera. All instances
 * share sorting scratch space and the WebGL multi-draw extension for that
 * context. Shadow hooks optionally integrate a cache of static point shadows.
 * Supply static triangle geometry with matching layouts and indexing to each
 * batch. Attributes use contiguous Float32Array, Int8Array or Uint8Array data.
 */
export function createPieceBatch({ renderer, camera, markStill = () => {}, isStill = () => false, keptAway = () => false }) {
  const _clip = new THREE.Matrix4(),
    _view = new THREE.Frustum(),
    _seen = []; // the pieces a camera sees, by their place in _keys (kept from frame to frame: never emptied, only written over)
  // The pieces are put in order by one number each, sorted in place by the typed array's own sort, which makes nothing: an array's
  // sort copied the list each time, and a comparator's result was a new number (hundreds of batches a frame). A key is the piece's
  // depth in steps of DEPTH_STEP metres, from DEPTH_FROM, times PIECES_MOST, plus its place in _seen.
  const DEPTH_STEP = 1 / 16,
    DEPTH_FROM = -1024,
    PIECES_MOST = 65536;
  let _keys = new Float64Array(64);
  // The i-th of `seen` pieces in order, nearest first (farthest first, from the end of the keys, where `far`)
  const nthSeen = (i, seen, far) => _seen[_keys[far ? seen - 1 - i : i] % PIECES_MOST];
  let multi; // the multi-draw extension, or null where the browser has none (the pieces are then drawn one by one)

  return class PieceBatch extends THREE.Mesh {
    // vertices, indices: how many to make room for at first (a batch that is filled once says exactly how many); fit: LOOSE or TIGHT
    constructor(material, vertices = 0, indices = 0, fit = LOOSE) {
      super(new THREE.BufferGeometry(), material);
      this.room = { vertices, indices };
      this.fit = fit;
      this.held = { vertices: 0, indices: 0 }; // what the buffers have room for
      this.used = { vertices: 0, indices: 0 }; // and what the pieces fill
      this.vertexRuns = new Runs();
      this.indexRuns = new Runs();
      this.layout = null; // [name, array type, item size, normalized] of each attribute, from the first piece
      this.indices = null; // an indexed batch keeps its indices here as well, to fill a larger buffer from when it grows
      this.pieces = []; // by id: { vertexStart, vertexCount, start, count, sphere, shown, depth }, or null where one was removed
      this.spare = []; // ids to give out again
      this.starts = new Int32Array(16); // the pieces after the first that the pass being drawn sees: where each begins (in bytes, if indexed)
      this.counts = new Int32Array(16);
      this.rest = 0;
      this.restTriangles = 0;
      this.pointShadow = true; // whether it casts in a point light's shadow as well as directional shadows
      this.changes = 0; // how many times a piece was added, let go, shown or hidden: a cached point shadow tracks this revision
      markStill(this); // a batch never moves
      this.matrixAutoUpdate = false;
      this.bound();
    }
    // Writes a geometry's vertices (and indices) to the card and returns the piece's id. The geometry itself is not kept and never uploaded.
    // first, count: the part of an indexed geometry's indices that makes the piece (one of its groups); all of them if not given.
    add(geometry, first = 0, count = geometry.index ? geometry.index.count : geometry.attributes.position.count) {
      const vertexCount = geometry.attributes.position.count,
        index = geometry.index,
        gl = renderer.getContext();
      if (!this.layout) {
        this.layout = Object.entries(geometry.attributes).map(([name, a]) => [name, a.array.constructor, a.itemSize, a.normalized]);
        if (index) this.indices = new Uint32Array(0);
      }
      const { vertexStart, start } = this.claim(vertexCount, count);
      for (const [name, , itemSize] of this.layout) {
        const array = geometry.attributes[name].array;
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.geometry.attributes[name].buffer);
        gl.bufferSubData(gl.COPY_WRITE_BUFFER, vertexStart * itemSize * array.BYTES_PER_ELEMENT, array);
      }
      if (index) this.writeIndices(start, count, i => index.array[first + i] + vertexStart);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      return this.record({ vertexStart, vertexCount, start, count, sphere: geometry.boundingSphere.clone() });
    }
    // Moves a piece into another batch of the same layout (one drawn in another material), copied from buffer to buffer on the card;
    // returns its id there
    move(id, to) {
      const piece = this.pieces[id],
        gl = renderer.getContext();
      if (!to.layout) {
        to.layout = this.layout;
        if (this.indices) to.indices = new Uint32Array(0);
      }
      const { vertexStart, start } = to.claim(piece.vertexCount, piece.count);
      for (const [name, type, itemSize] of this.layout) {
        const bytes = itemSize * type.BYTES_PER_ELEMENT;
        gl.bindBuffer(gl.COPY_READ_BUFFER, this.geometry.attributes[name].buffer);
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, to.geometry.attributes[name].buffer);
        gl.copyBufferSubData(
          gl.COPY_READ_BUFFER,
          gl.COPY_WRITE_BUFFER,
          piece.vertexStart * bytes,
          vertexStart * bytes,
          piece.vertexCount * bytes,
        );
      }
      gl.bindBuffer(gl.COPY_READ_BUFFER, null);
      if (this.indices) to.writeIndices(start, piece.count, i => this.indices[piece.start + i] - piece.vertexStart + vertexStart);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
      const moved = to.record({ vertexStart, vertexCount: piece.vertexCount, start, count: piece.count, sphere: piece.sphere });
      this.remove(id);
      return moved;
    }
    // Room in the buffers for a piece of `vertexCount` vertices and `count` indices (if indexed), grown if need be
    claim(vertexCount, count) {
      const vertexStart = this.vertexRuns.claim(vertexCount),
        start = this.indices ? this.indexRuns.claim(count) : vertexStart;
      if (this.vertexRuns.end > this.held.vertices || this.indexRuns.end > this.held.indices) this.grow();
      return { vertexStart, start };
    }
    // A piece's `count` indices from `start` on, index(i) each, kept here and written to the card
    writeIndices(start, count, index) {
      const gl = renderer.getContext(),
        own = this.indices.subarray(start, start + count);
      for (let i = 0; i < count; i++) own[i] = index(i);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.geometry.index.buffer);
      gl.bufferSubData(gl.COPY_WRITE_BUFFER, start * INDEX_BYTES, own);
    }
    // A piece whose vertices are in place: its id
    record(piece) {
      const id = this.spare.length ? this.spare.pop() : this.pieces.length;
      this.pieces[id] = { ...piece, shown: true, depth: 0 };
      this.changes++;
      this.used.vertices += piece.vertexCount;
      if (this.indices) this.used.indices += piece.count;
      this.bound();
      return id;
    }
    remove(id) {
      const piece = this.pieces[id];
      this.pieces[id] = null;
      this.spare.push(id);
      this.changes++;
      this.vertexRuns.release(piece.vertexStart, piece.vertexCount);
      this.used.vertices -= piece.vertexCount;
      if (this.indices) {
        this.indexRuns.release(piece.start, piece.count);
        this.used.indices -= piece.count;
      }
      this.bound();
    }
    // Gives the card back the buffers' room once no piece is left; they grow again when asked
    empty() {
      if (this.pieces.some(Boolean) || !this.held.vertices) return;
      this.discard(this.geometry);
      this.geometry = new THREE.BufferGeometry();
      this.held = { vertices: 0, indices: 0 };
      this.used = { vertices: 0, indices: 0 };
      this.vertexRuns = new Runs();
      this.indexRuns = new Runs();
      this.pieces = [];
      this.spare = [];
      this.changes++;
      if (this.indices) this.indices = new Uint32Array(0);
      this.bound();
    }
    show(id, shown) {
      const piece = this.pieces[id];
      if (piece.shown === shown) return;
      piece.shown = shown;
      this.changes++;
    }
    // The bounds of all pieces, by which Three decides whether the batch is in view at all; with no piece it never is
    bound() {
      const all = new THREE.Sphere(new THREE.Vector3(), -1);
      for (const piece of this.pieces) if (piece) all.union(piece.sphere);
      if (all.isEmpty()) all.radius = -Infinity;
      this.geometry.boundingSphere = all;
      this.boundingSphere = all.clone();
    }
    // Three sorts the opaque things of a pass nearest first by the centre of this sphere, so that what stands in front hides what is
    // behind before it is shaded: the batch is placed where its nearest piece in the viewer's picture stands, as that piece's own mesh
    // was, with a radius that still holds every piece (the sphere is also what Three culls the whole batch by)
    sortBy(nearest) {
      const all = this.geometry.boundingSphere,
        at = this.boundingSphere;
      at.center.copy(nearest.sphere.center);
      at.radius = all.radius + at.center.distanceTo(all.center);
    }
    // Larger buffers: at least what is asked of them now and what was said at the start, and half as large again as the old ones. What
    // the old vertex buffers held is copied across on the card; the indices are written again from the copy kept here.
    grow() {
      const size = (needed, room, held) => (needed > held ? Math.max(needed, room, Math.ceil(held * this.fit.growth)) : held),
        vertices = size(this.vertexRuns.end, this.room.vertices, this.held.vertices),
        indices = size(this.indexRuns.end, this.room.indices, this.held.indices),
        kept = this.indices && new Uint32Array(indices),
        length = this.held.vertices;
      if (kept) kept.set(this.indices);
      this.remake(vertices, kept, (gl, bytes) => gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, length * bytes));
      this.held = { vertices, indices };
    }
    // Packs the pieces together, one after another, into buffers `room` times what they fill, once they fill less than `use`
    // of the ones they are in (a buffer only ever grows, and pieces are let go): what each piece holds is copied across on the card,
    // and its indices are written again from the copy kept here; a batch with no piece left gives its room back. Returns whether it did either.
    pack() {
      const { vertices: filled, indices: filledIndices } = this.used;
      if (this.held.vertices < PACK_LEAST || filled >= this.held.vertices * this.fit.use) return false;
      if (!filled) {
        this.empty();
        return true;
      }
      const vertices = Math.ceil(filled * this.fit.room),
        indices = Math.ceil(filledIndices * this.fit.room),
        kept = this.indices && new Uint32Array(indices);
      let at = 0,
        indexAt = 0;
      if (kept)
        for (const piece of this.pieces) {
          if (!piece) continue;
          for (let i = 0; i < piece.count; i++) kept[indexAt + i] = this.indices[piece.start + i] - piece.vertexStart + at;
          at += piece.vertexCount;
          indexAt += piece.count;
        }
      this.remake(vertices, kept, (gl, bytes) => {
        let to = 0;
        for (const piece of this.pieces) {
          if (!piece) continue;
          gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, piece.vertexStart * bytes, to * bytes, piece.vertexCount * bytes);
          to += piece.vertexCount;
        }
      });
      at = indexAt = 0;
      for (const piece of this.pieces) {
        if (!piece) continue;
        piece.vertexStart = at;
        at += piece.vertexCount;
        if (kept) {
          piece.start = indexAt;
          indexAt += piece.count;
        } else piece.start = piece.vertexStart;
      }
      this.held = { vertices, indices };
      this.vertexRuns = new Runs(at);
      this.indexRuns = new Runs(indexAt);
      return true;
    }
    // New buffers on the card in place of the old ones: room for `vertices` in each attribute's, filled by copy(gl, bytes a vertex)
    // from the old one while both are bound (the old as COPY_READ_BUFFER, the new as COPY_WRITE_BUFFER), and `kept`, the indices of an
    // indexed batch, written whole.
    remake(vertices, kept, copy) {
      const gl = renderer.getContext(),
        old = this.geometry;
      this.geometry = new THREE.BufferGeometry();
      for (const [name, type, itemSize, normalized] of this.layout) {
        const bytes = itemSize * type.BYTES_PER_ELEMENT,
          buffer = gl.createBuffer();
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer);
        gl.bufferData(gl.COPY_WRITE_BUFFER, vertices * bytes, gl.STATIC_DRAW);
        if (this.held.vertices) {
          gl.bindBuffer(gl.COPY_READ_BUFFER, old.attributes[name].buffer);
          copy(gl, bytes);
          gl.bindBuffer(gl.COPY_READ_BUFFER, null);
        }
        const attribute = new THREE.GLBufferAttribute(buffer, GL_TYPE.get(type), itemSize, type.BYTES_PER_ELEMENT, vertices);
        attribute.normalized = normalized;
        this.geometry.setAttribute(name, attribute);
      }
      if (kept) {
        const buffer = gl.createBuffer();
        this.indices = kept;
        // a buffer of indices must be an index buffer from its first binding on, and that binding belongs to whichever vertex
        // array Three bound last: it is given back what it had
        const bound = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, kept, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bound);
        this.geometry.setIndex(new THREE.GLBufferAttribute(buffer, GL_UNSIGNED_INT, 1, INDEX_BYTES, kept.length));
      }
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
      this.geometry.boundingSphere = old.boundingSphere;
      this.discard(old);
    }
    // Frees the batch's buffers on the card, once it is let go
    free() {
      this.discard(this.geometry);
    }
    // Frees a geometry's buffers on the card, whether or not Three has drawn from them yet
    discard(geometry) {
      const gl = renderer.getContext();
      for (const name in geometry.attributes) gl.deleteBuffer(geometry.attributes[name].buffer);
      if (geometry.index) gl.deleteBuffer(geometry.index.buffer);
      geometry.dispose();
    }
    // The pieces a camera sees, nearest first (farthest first in a see-through material): the first becomes the range Three draws,
    // the others are listed for the multi-draw that follows it
    choose(viewer) {
      _view.setFromProjectionMatrix(_clip.multiplyMatrices(viewer.projectionMatrix, viewer.matrixWorldInverse).multiply(this.matrixWorld));
      const e = _clip.elements;
      let seen = 0;
      for (const piece of this.pieces) {
        if (!piece || !piece.shown || !_view.intersectsSphere(piece.sphere)) continue;
        const c = piece.sphere.center;
        piece.depth = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
        _seen[seen++] = piece;
      }
      if (seen > _keys.length) _keys = new Float64Array(2 ** Math.ceil(Math.log2(seen)));
      for (let i = 0; i < seen; i++) _keys[i] = Math.max(0, Math.floor((_seen[i].depth - DEPTH_FROM) / DEPTH_STEP)) * PIECES_MOST + i;
      _keys.fill(Infinity, seen);
      _keys.sort();
      const far = this.material.transparent,
        first = seen ? nthSeen(0, seen, far) : null;
      if (first && camera === viewer && !this.material.transparent) this.sortBy(first);
      if (first) this.geometry.setDrawRange(first.start, first.count);
      else this.geometry.setDrawRange(0, -1); // a range Three takes for nothing to draw
      this.rest = Math.max(0, seen - 1);
      if (this.rest > this.starts.length) {
        this.starts = new Int32Array(this.rest * 2);
        this.counts = new Int32Array(this.rest * 2);
      }
      const unit = this.indices ? INDEX_BYTES : 1;
      let drawn = 0;
      for (let i = 0; i < this.rest; i++) {
        const piece = nthSeen(i + 1, seen, far);
        this.starts[i] = piece.start * unit;
        this.counts[i] = piece.count;
        drawn += piece.count;
      }
      this.restTriangles = drawn / 3;
    }
    // Hands over the pieces after the first, with everything Three bound for the first still in place
    drawRest(material) {
      if (!this.rest) return;
      const gl = renderer.getContext(),
        twoPasses = material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass;
      // Three draws such a material's back faces and then its front faces, and has just drawn the fronts: so do the rest
      if (twoPasses) {
        gl.frontFace(gl.CW);
        this.multiDraw(gl);
        gl.frontFace(gl.CCW);
      }
      this.multiDraw(gl);
    }
    multiDraw(gl) {
      const { starts, counts, rest } = this;
      if (multi === undefined) multi = renderer.extensions.has('WEBGL_multi_draw') ? renderer.extensions.get('WEBGL_multi_draw') : null;
      if (this.indices) {
        if (multi) multi.multiDrawElementsWEBGL(gl.TRIANGLES, counts, 0, GL_UNSIGNED_INT, starts, 0, rest);
        else for (let i = 0; i < rest; i++) gl.drawElements(gl.TRIANGLES, counts[i], GL_UNSIGNED_INT, starts[i]);
      } else if (multi) multi.multiDrawArraysWEBGL(gl.TRIANGLES, starts, 0, counts, 0, rest);
      else for (let i = 0; i < rest; i++) gl.drawArrays(gl.TRIANGLES, starts[i], counts[i]);
      renderer.info.render.calls += multi ? 1 : rest;
      renderer.info.render.triangles += this.restTriangles;
    }
    onBeforeRender(_renderer, _scene, viewer) {
      this.choose(viewer);
    }
    onAfterRender(_renderer, _scene, _camera, _geometry, material) {
      this.drawRest(material);
    }
    // In a point light's shadow it is drawn only where it casts there, and not where a cached point shadow already contains its current revision
    onBeforeShadow(_renderer, _object, _camera, shadowCamera, _geometry, drawnWith) {
      if (!drawnWith.isMeshDistanceMaterial || (this.pointShadow && !(isStill(this) && keptAway(this, this.changes))))
        this.choose(shadowCamera);
      else {
        this.geometry.setDrawRange(0, -1);
        this.rest = 0;
      }
    }
    onAfterShadow(_renderer, _object, _camera, _shadowCamera, _geometry, depthMaterial) {
      this.drawRest(depthMaterial);
    }
    raycast() {} // the vertices are on the card only
  };
}

export { TIGHT };
