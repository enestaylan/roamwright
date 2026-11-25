import * as THREE from 'three';

/**
 * Level of detail for scattered things laid out in cells (trees, scrub, rocks, reeds). Each cell has a detailed instanced mesh for
 * near and, most of them, a low-detail instanced copy for far. Hundreds of far cells hold a handful of instances each, and each would
 * be a draw call in every pass, so the far copies are batched: one instanced mesh per kind and square of ground. In a batch every
 * instance knows its cell and its place in it, and the vertex shader hides it unless its cell shows its far copy and it is among the
 * cell's first `count` (the far thinning), read from a small table written each frame. What is drawn is exactly what the cells drew
 * one by one, and a batch none of whose cells shows is hidden, so no pass runs its vertices only to drop them.
 *
 * A cell is a record: `mesh` (its near InstancedMesh), `lo` (its far InstancedMesh, or none), `cx`, `cz`, `r` (where it lies and its
 * radius, metres), optionally `until` (metres past which it is not drawn at all), `near` (metres past which it shows its far copy
 * sooner than the caller's), `full` (its instances before thinning). The batching writes `far`, `farN`, `farBatch` and `lod` on it.
 *
 * @param {object} [options]
 * @param {number} [options.square=500] Metres: far copies are batched by kind within squares of this side.
 * @param {number} [options.tableWidth=64] Texels across the table of what each cell shows.
 * @param {number} [options.thinFrom=0.45] Beyond this share of the drawing distance a thinned cell keeps `thinTo` of its instances.
 * @param {number} [options.thinTo=0.55]
 */
export function createCellLod({ square = 500, tableWidth = 64, thinFrom = 0.45, thinTo = 0.55 } = {}) {
  const table = { data: null, tex: null },
    shown = { value: null }, // the table, as the uniform the far materials and the far shadow body share
    batches = [];
  let batchShows = null,
    depth = null;

  // Hides, in the vertex shader, a copy whose cell is not showing its far copy or that lies past the cell's `count`.
  function hideUnshown(sh) {
    sh.uniforms.uFarShown = shown;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFar; uniform sampler2D uFarShown;')
      .replace(
        '#include <project_vertex>',
        `/* glsl */
#include <project_vertex>
        if (aFar.y >= texelFetch(uFarShown, ivec2(int(aFar.x) % ${tableWidth}, int(aFar.x) / ${tableWidth}), 0).r) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`,
      );
  }
  // A far copy's material: the cell's own, cloned once per material, with its own patch kept and the hiding added.
  function farMaterial(base, cache) {
    if (cache.has(base)) return cache.get(base);
    const m = base.clone(),
      inner = base.onBeforeCompile,
      key = base.customProgramCacheKey();
    m.onBeforeCompile = (sh, r) => {
      inner.call(base, sh, r);
      hideUnshown(sh);
    };
    m.customProgramCacheKey = () => key + ':far-batch';
    cache.set(base, m);
    return m;
  }
  // The shadow body of far copies that cast: the far shape itself, hidden as in the picture, so a cell casts what it shows.
  function depthMaterial() {
    if (depth) return depth;
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = hideUnshown;
    depth.customProgramCacheKey = () => 'far-batch-depth';
    return depth;
  }

  /** Batches the far copies of `cells` (taken out of their parents) into `parent`; returns the batches. */
  function batch(cellList, parent) {
    const cells = cellList.filter(t => t.lo && t.lo.isInstancedMesh),
      groups = new Map(),
      materials = new Map();
    table.data = new Float32Array(tableWidth * Math.ceil(cells.length / tableWidth));
    table.tex = new THREE.DataTexture(table.data, tableWidth, table.data.length / tableWidth, THREE.RedFormat, THREE.FloatType);
    table.tex.needsUpdate = true;
    shown.value = table.tex;
    cells.forEach((t, slot) => {
      const lo = t.lo,
        key = [
          lo.geometry.uuid,
          lo.material.uuid,
          lo.layers.mask,
          lo.receiveShadow,
          t.mesh.castShadow,
          Math.floor(t.cx / square),
          Math.floor(t.cz / square),
        ].join('|');
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { lo, casts: t.mesh.castShadow, cells: [] }));
      g.cells.push(t);
      t.far = slot;
      t.farN = lo.instanceMatrix.count;
      t.lo = null;
      lo.removeFromParent();
    });
    for (const { lo, casts, cells: list } of groups.values()) {
      for (const t of list) t.farBatch = batches.length;
      const n = list.reduce((s, t) => s + t.farN, 0),
        geo = new THREE.BufferGeometry();
      for (const name in lo.geometry.attributes) geo.setAttribute(name, lo.geometry.attributes[name]);
      geo.setIndex(lo.geometry.index);
      geo.boundingSphere = lo.geometry.boundingSphere;
      geo.boundingBox = lo.geometry.boundingBox;
      const ids = new Float32Array(n * 2),
        mesh = new THREE.InstancedMesh(geo, farMaterial(lo.material, materials), n);
      if (lo.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      let at = 0;
      for (const t of list) {
        const src = t.mesh.instanceMatrix.array,
          col = t.mesh.instanceColor?.array;
        mesh.instanceMatrix.array.set(src.subarray(0, t.farN * 16), at * 16);
        if (col && mesh.instanceColor) mesh.instanceColor.array.set(col.subarray(0, t.farN * 3), at * 3);
        for (let i = 0; i < t.farN; i++) {
          ids[(at + i) * 2] = t.far;
          ids[(at + i) * 2 + 1] = i;
        }
        at += t.farN;
      }
      geo.setAttribute('aFar', new THREE.InstancedBufferAttribute(ids, 2));
      mesh.layers.mask = lo.layers.mask;
      mesh.receiveShadow = lo.receiveShadow;
      mesh.castShadow = casts; // as the near copies do
      if (casts) {
        mesh.customDepthMaterial = depthMaterial();
        mesh.userData.partShown = true; // a pass drawing heights with a plain depth material would show every copy
      }
      mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      parent.add(mesh);
      batches.push(mesh);
    }
    batchShows = new Int32Array(batches.length);
    return batches;
  }

  // Where a cell lies and how far it is drawn, kept on it in a record of one shape: cells come from builders of many shapes,
  // and a number read from objects of so many shapes is made anew at every read. A cell does not move.
  const lodOf = t =>
    (t.lod ??= { cx: t.cx, cz: t.cz, r: t.r, until: t.until ?? Infinity, near: t.near ?? Infinity, batch: t.farBatch ?? -1 });

  /**
   * Each frame: near cells show their detailed mesh, far ones their batched copy, thinned beyond `thinFrom` of the drawing
   * distance. (cx, cz): the eye; `distance` metres past which nothing is drawn, `detail` metres within which the near mesh is,
   * `density` the share of a thinned cell's instances kept.
   */
  function update(cells, cx, cz, distance, detail, density) {
    let changed = false;
    if (batchShows) batchShows.fill(0);
    for (let i = 0; i < cells.length; i++) {
      const t = cells[i],
        at = lodOf(t),
        dx = cx - at.cx,
        dz = cz - at.cz,
        d = Math.sqrt(dx * dx + dz * dz) - at.r,
        hasFar = t.lo || t.far !== undefined;
      const vis = d < Math.min(distance, at.until),
        hi = !hasFar || d < Math.min(detail, at.near);
      t.mesh.visible = vis && hi;
      if (t.lo) t.lo.visible = vis && !hi;
      let count = t.farN;
      if (t.full !== undefined) {
        count = Math.max(1, (t.full * (d < distance * thinFrom ? 1 : thinTo) * density) | 0);
        t.mesh.count = count;
        if (t.lo) t.lo.count = count;
      }
      if (t.far !== undefined) {
        const v = vis && !hi ? count : 0;
        if (v > 0) batchShows[at.batch]++;
        if (table.data[t.far] !== v) {
          table.data[t.far] = v;
          changed = true;
        }
      }
    }
    if (changed) table.tex.needsUpdate = true;
    for (let i = 0; i < batches.length; i++) batches[i].visible = batchShows[i] > 0;
  }

  return { batch, update, batches };
}
