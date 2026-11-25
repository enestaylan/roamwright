import * as THREE from 'three';
import { TAU, clamp } from '../math/scalar.js';

// Scopes mutable scratch space, LOD selection and cached geometry to a single consumer.
export function createSculptor({ vertexTag } = {}) {
  const _lp = [],
    _ln = [],
    _lt = [],
    _pt = [0, 0, 0];
  function setLodLo(level) {
    LOD_LO = level;
  }
  // Level 1 halves detail. Level 2 is for the smallest screen-space silhouettes.
  let LOD_LO = 0;
  // rings: [y, rx, rz, cx, cz, col, bone1, bone2, weight1]; a ring marked `fine` is left out of the far and light versions.
  // o.fold(v, a) scales the radius (pleats); o.lay(p, a, ring) moves a ring's point p = [x, y, z] at angle a from where the level
  // ring puts it (a hem that dips, a ring that slopes, a muscle's swell); o.tint(p, a, ring) is how bright the ring's colour is
  // there (a crease's shade, at most 1); o.sk(y, a, ring) gives a point's bones and weight in place of its ring's; o.a0/o.a1
  // give an open sheet; o.joined puts each point in once and joins the triangles through them by number (a sixth of the points,
  // for a builder whose geometry is drawn by its numbers: a person's body). o.relief(y, a, ring) is what stands out of the surface
  // at a ring's height y and angle a, in metres along its normal (cloth's folds): its slopes turn the normals as well, worked out
  // from the relief itself and not from the points round about, so that folds only two or three rings or sides apart are lit as
  // folds even on sparse meshes. The optional factory vertexTag callback classifies individual vertices.
  const RELIEF_STEP = [0.002, 0.02], // how far apart the relief is read to find its slope: metres of height, radians round
    _lq = [],
    _lm = [];
  function loft(gb, ox, oy, oz, rings, seg, o = {}) {
    if (LOD_LO) {
      seg = LOD_LO > 1 ? Math.max(5, Math.round(seg * 0.38)) : Math.max(5, (seg + 1) >> 1);
      rings = rings.filter(r => !r.fine);
    }
    const nr = rings.length,
      a0 = o.a0 ?? 0,
      a1 = o.a1 ?? TAU,
      closed = a1 - a0 > TAU - 1e-4,
      ns = closed ? seg : seg + 1,
      P_ = _lp,
      N_ = _ln,
      T_ = _lt,
      { fold, lay, tint } = o,
      up = rings[nr - 1][0] > rings[0][0];
    for (let i = 0; i < nr; i++) {
      const r = rings[i];
      for (let j = 0; j < ns; j++) {
        const a = a0 + ((a1 - a0) * j) / seg,
          k = fold ? fold(i / (nr - 1), a) : 1,
          q = (i * ns + j) * 3;
        _pt[0] = r[3] + Math.cos(a) * r[1] * k;
        _pt[1] = r[0];
        _pt[2] = r[4] + Math.sin(a) * r[2] * k;
        if (lay) lay(_pt, a, r);
        if (tint) T_[i * ns + j] = tint(_pt, a, r);
        P_[q] = ox + _pt[0];
        P_[q + 1] = oy + _pt[1];
        P_[q + 2] = oz + _pt[2];
      }
    }
    const idx = (i, j) => (i * ns + (closed ? (j + ns) % ns : clamp(j, 0, ns - 1))) * 3;
    for (let i = 0; i < nr; i++)
      for (let j = 0; j < ns; j++) {
        const A = idx(i, j - 1),
          B_ = idx(i, j + 1),
          C_ = idx(Math.max(0, i - 1), j),
          D = idx(Math.min(nr - 1, i + 1), j),
          q = (i * ns + j) * 3,
          r = rings[i];
        const tx = P_[B_] - P_[A],
          ty = P_[B_ + 1] - P_[A + 1],
          tz = P_[B_ + 2] - P_[A + 2],
          ux = P_[D] - P_[C_],
          uy = P_[D + 1] - P_[C_ + 1],
          uz = P_[D + 2] - P_[C_ + 2];
        const nx = ty * uz - tz * uy,
          ny = tz * ux - tx * uz,
          nz = tx * uy - ty * ux,
          l = Math.hypot(nx, ny, nz) || 1,
          s = nx * (P_[q] - ox - r[3]) + nz * (P_[q + 2] - oz - r[4]) < 0 ? -1 : 1;
        N_[q] = (nx / l) * s;
        N_[q + 1] = (ny / l) * s;
        N_[q + 2] = (nz / l) * s;
      }
    if (o.relief) raise(rings, ns, closed, a0, (a1 - a0) / seg, idx, o.relief);
    const tag = gb.tv,
      sk = o.sk,
      V = (i, j) => {
        const q = idx(i, j),
          r = rings[i],
          c = r[5],
          t = tint ? T_[q / 3] : 1,
          a = a0 + ((a1 - a0) * j) / seg;
        if (vertexTag) gb.tv = vertexTag(gb, r, a, o, tag);
        const w = sk ? sk(r[0], a, r) : null;
        gb.raw(
          P_[q],
          P_[q + 1],
          P_[q + 2],
          N_[q],
          N_[q + 1],
          N_[q + 2],
          c[0] * t,
          c[1] * t,
          c[2] * t,
          w ? w[0] : r[6] || 0,
          w ? w[1] : (r[7] ?? (r[6] || 0)),
          w ? w[2] : (r[8] ?? 1),
        );
      };
    if (o.joined) {
      // each point once, and the triangles through them by number
      const first = gb.count / 3,
        corners = [],
        at = (i, j) => i * ns + (closed ? j % ns : j);
      for (let i = 0; i < nr; i++) for (let j = 0; j < ns; j++) V(i, j);
      for (let i = 0; i < nr - 1; i++)
        for (let j = 0; j < seg; j++) {
          if (up) corners.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
          else corners.push(at(i, j), at(i + 1, j + 1), at(i + 1, j), at(i, j), at(i, j + 1), at(i + 1, j + 1));
        }
      gb.triangles(first, corners);
    } else
      for (let i = 0; i < nr - 1; i++)
        for (let j = 0; j < seg; j++) {
          if (up) {
            V(i, j);
            V(i + 1, j);
            V(i + 1, j + 1);
            V(i, j);
            V(i + 1, j + 1);
            V(i, j + 1);
          } else {
            V(i, j);
            V(i + 1, j + 1);
            V(i + 1, j);
            V(i, j);
            V(i, j + 1);
            V(i + 1, j + 1);
          }
        }
    if (vertexTag) gb.tv = tag;
  }
  // Moves a loft's points (_lp, with their normals _ln) out by its relief and turns each normal down the relief's slopes: along the
  // ring (the slope for each radian, over the metres a radian is there) and from ring to ring (the slope for each metre of
  // height, over the metres of surface a metre of height is there).
  function raise(rings, ns, closed, a0, step, idx, relief) {
    const nr = rings.length,
      P_ = _lp,
      N_ = _ln,
      [dy, da] = RELIEF_STEP;
    for (let i = 0; i < nr; i++) {
      const r = rings[i],
        y = r[0],
        low = Math.max(0, i - 1),
        high = Math.min(nr - 1, i + 1),
        rise = rings[high][0] - rings[low][0];
      for (let j = 0; j < ns; j++) {
        const a = a0 + step * j,
          q = (i * ns + j) * 3,
          A = idx(i, j - 1),
          B_ = idx(i, j + 1),
          C_ = idx(low, j),
          D = idx(high, j),
          out = relief(y, a, r),
          round = (relief(y, a + da, r) - relief(y, a - da, r)) / (2 * da),
          up = (relief(y + dy, a, r) - relief(y - dy, a, r)) / (2 * dy),
          tx = P_[B_] - P_[A],
          ty = P_[B_ + 1] - P_[A + 1],
          tz = P_[B_ + 2] - P_[A + 2],
          ux = P_[D] - P_[C_],
          uy = P_[D + 1] - P_[C_ + 1],
          uz = P_[D + 2] - P_[C_ + 2],
          turn = (closed ? 2 : Math.min(ns - 1, j + 1) - Math.max(0, j - 1)) * step, // radians between the two neighbours (one step at an open sheet's edge)
          kt = (round * turn) / (tx * tx + ty * ty + tz * tz || 1),
          ku = (up * rise) / (ux * ux + uy * uy + uz * uz || 1),
          nx = N_[q] - kt * tx - ku * ux,
          ny = N_[q + 1] - kt * ty - ku * uy,
          nz = N_[q + 2] - kt * tz - ku * uz,
          l = Math.hypot(nx, ny, nz) || 1;
        _lq[q] = P_[q] + N_[q] * out;
        _lq[q + 1] = P_[q + 1] + N_[q + 1] * out;
        _lq[q + 2] = P_[q + 2] + N_[q + 2] * out;
        _lm[q] = nx / l;
        _lm[q + 1] = ny / l;
        _lm[q + 2] = nz / l;
      }
    }
    for (let k = nr * ns * 3 - 1; k >= 0; k--) {
      P_[k] = _lq[k];
      N_[k] = _lm[k];
    }
  }
  const meshes = new Map();
  // A sphere pushed into shape by fn(dir, outPos, channels). Cached by key; channels are a colour mix and a brightness.
  function sculptMesh(key, detail, fn, warp = 0) {
    if (LOD_LO > 1) {
      key += ':light';
      detail = Math.max(2, (detail + 1) >> 2);
    } else if (LOD_LO) {
      key += ':lo';
      detail = Math.max(3, detail >> 1);
    }
    if (meshes.has(key)) return meshes.get(key);
    const pa = new THREE.IcosahedronGeometry(1, detail).attributes.position.array,
      n = pa.length / 3;
    const P_ = new Float32Array(n * 3),
      N_ = new Float32Array(n * 3),
      A = new Float32Array(n),
      Bc = new Float32Array(n),
      D = new Float32Array(n * 3);
    const d = new THREE.Vector3(),
      t1 = new THREE.Vector3(),
      t2 = new THREE.Vector3(),
      p0 = new THREE.Vector3(),
      p1 = new THREE.Vector3(),
      p2 = new THREE.Vector3(),
      ch = [0, 1],
      c2 = [0, 1],
      e = 0.02;
    for (let i = 0; i < n; i++) {
      d.set(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2] + warp).normalize();
      D[i * 3] = d.x;
      D[i * 3 + 1] = d.y;
      D[i * 3 + 2] = d.z;
      fn(d, p0, ch);
      t1.set(d.z, 0, -d.x);
      if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
      t1.normalize();
      t2.crossVectors(d, t1);
      fn(t1.multiplyScalar(e).add(d).normalize(), p1, c2);
      fn(t2.multiplyScalar(e).add(d).normalize(), p2, c2);
      p1.sub(p0);
      p2.sub(p0);
      t1.crossVectors(p1, p2).normalize();
      if (t1.dot(d) < 0) t1.negate();
      P_[i * 3] = p0.x;
      P_[i * 3 + 1] = p0.y;
      P_[i * 3 + 2] = p0.z;
      N_[i * 3] = t1.x;
      N_[i * 3 + 1] = t1.y;
      N_[i * 3 + 2] = t1.z;
      A[i] = ch[0];
      Bc[i] = ch[1];
    }
    const mesh = { P: P_, N: N_, A, B: Bc, D, n };
    meshes.set(key, mesh);
    return mesh;
  }
  return { loft, sculptMesh, setLodLo };
}

const _e1 = new THREE.Vector3(),
  _e2 = new THREE.Vector3();
// One triangle of points [x, y, z, nx, ny, nz, own colour, own weight], wound so that it faces the way its normals do. A point
// without a colour or a weight of its own takes col and weight.
export function triangle(gb, p, q, r, col, bone, other = bone, weight = 1) {
  _e1.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  _e2.set(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
  _e1.cross(_e2);
  const flip = _e1.x * (p[3] + q[3] + r[3]) + _e1.y * (p[4] + q[4] + r[4]) + _e1.z * (p[5] + q[5] + r[5]) < 0;
  for (const v of flip ? [p, r, q] : [p, q, r]) {
    const c = v[6] || col;
    gb.raw(v[0], v[1], v[2], v[3], v[4], v[5], c[0], c[1], c[2], bone, other, v[7] ?? weight);
  }
}
