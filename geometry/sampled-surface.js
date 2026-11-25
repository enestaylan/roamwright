// A sheet sampled on a grid with smooth normals: fn(u, v) -> [x, y, z]. Sagging canvas, flags, earth banks and rubble mounds are all made with it.
// col is one colour, or col(u, v) for each cell of the grid; with o.blend, col(u, v) is read at each point of the grid instead and
// blended across the cells (ground whose colour changes smoothly, without a patchwork of cells).
const buffers = [];
// Callbacks may themselves sample another surface. Only inactive buffers are reused.
export function sampleSurface(gb, nu, nv, fn, col, o = {}) {
  const scratch = buffers.pop() ?? { positions: [], normals: [], colors: [] };
  try {
    writeSurface(gb, nu, nv, fn, col, o, scratch);
  } finally {
    buffers.push(scratch);
  }
}

function writeSurface(gb, nu, nv, fn, col, o, scratch) {
  const w1 = nu + 1,
    P_ = scratch.positions,
    N_ = scratch.normals,
    cf = typeof col === 'function',
    back = o.back,
    fl = o.flip ? -1 : 1,
    blend = cf && o.blend,
    C_ = scratch.colors;
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const p = fn(i / nu, j / nv),
        q = (j * w1 + i) * 3;
      P_[q] = p[0];
      P_[q + 1] = p[1];
      P_[q + 2] = p[2];
      if (blend) {
        const c = col(i / nu, j / nv);
        C_[q] = c[0];
        C_[q + 1] = c[1];
        C_[q + 2] = c[2];
      }
    }
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const a = (j * w1 + Math.max(0, i - 1)) * 3,
        b = (j * w1 + Math.min(nu, i + 1)) * 3,
        c = (Math.max(0, j - 1) * w1 + i) * 3,
        d = (Math.min(nv, j + 1) * w1 + i) * 3,
        q = (j * w1 + i) * 3;
      const tx = P_[b] - P_[a],
        ty = P_[b + 1] - P_[a + 1],
        tz = P_[b + 2] - P_[a + 2],
        sx = P_[d] - P_[c],
        sy = P_[d + 1] - P_[c + 1],
        sz = P_[d + 2] - P_[c + 2];
      const nx = sy * tz - sz * ty,
        ny = sz * tx - sx * tz,
        nz = sx * ty - sy * tx,
        l = (Math.hypot(nx, ny, nz) || 1) * fl;
      N_[q] = nx / l;
      N_[q + 1] = ny / l;
      N_[q + 2] = nz / l;
    }
  const V = (i, j, s, cc) => {
    const q = (j * w1 + i) * 3;
    if (cc) gb.raw(P_[q], P_[q + 1], P_[q + 2], N_[q] * s, N_[q + 1] * s, N_[q + 2] * s, cc[0], cc[1], cc[2]);
    else gb.raw(P_[q], P_[q + 1], P_[q + 2], N_[q] * s, N_[q + 1] * s, N_[q + 2] * s, C_[q], C_[q + 1], C_[q + 2]);
  };
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const cc = blend ? null : cf ? col((i + 0.5) / nu, (j + 0.5) / nv) : col,
        bc = back === true ? cc : back;
      if (fl > 0) {
        V(i, j, 1, cc);
        V(i, j + 1, 1, cc);
        V(i + 1, j + 1, 1, cc);
        V(i, j, 1, cc);
        V(i + 1, j + 1, 1, cc);
        V(i + 1, j, 1, cc);
      } else {
        V(i, j, 1, cc);
        V(i + 1, j + 1, 1, cc);
        V(i, j + 1, 1, cc);
        V(i, j, 1, cc);
        V(i + 1, j, 1, cc);
        V(i + 1, j + 1, 1, cc);
      }
      if (back) {
        if (fl > 0) {
          V(i, j, -1, bc);
          V(i + 1, j + 1, -1, bc);
          V(i, j + 1, -1, bc);
          V(i, j, -1, bc);
          V(i + 1, j, -1, bc);
          V(i + 1, j + 1, -1, bc);
        } else {
          V(i, j, -1, bc);
          V(i, j + 1, -1, bc);
          V(i + 1, j + 1, -1, bc);
          V(i, j, -1, bc);
          V(i + 1, j + 1, -1, bc);
          V(i + 1, j, -1, bc);
        }
      }
    }
}
