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
 * @param {boolean} [options.compact=false] Pack only visible transforms and colours when a cell changes.
 * Use for static cells whose materials depend on their transform and colour, not their instance index or other instance attributes.
 * @param {number} [options.tableWidth=64] Texels across the table of what each cell shows.
 * @param {number} [options.thinFrom=0.45] Beyond this share of the drawing distance a thinned cell keeps `thinTo` of its instances.
 * @param {number} [options.thinTo=0.55]
 */
export function createCellLod({ square = 500, compact = false, tableWidth = 64, thinFrom = 0.45, thinTo = 0.55 } = {}) {
  const table = { data: null, tex: null },
    shown = { value: null }, // the table, as the uniform the far materials and the far shadow body share
    batches = [],
    members = [];
  let drawEnds = null,
    dirty = null,
    depth = null,
    distanceMaterial = null;

  // Hides, in the vertex shader, a copy whose cell is not showing its far copy or that lies past the cell's `count`.
  function hideUnshown(shader) {
    shader.uniforms.uFarShown = shown;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFar; uniform sampler2D uFarShown;')
      .replace(/void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/, match => `${match}
        if (aFar.y >= texelFetch(uFarShown, ivec2(int(aFar.x) % ${tableWidth}, int(aFar.x) / ${tableWidth}), 0).r) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }`);
  }
  // A far copy's material: the cell's own, cloned once per material, with its own patch kept and the hiding added.
  function farMaterial(base, cache) {
    if (cache.has(base)) return cache.get(base);
    const material = base.clone(),
      inner = base.onBeforeCompile,
      key = base.customProgramCacheKey();
    material.onBeforeCompile = (shader, r) => {
      inner.call(base, shader, r);
      hideUnshown(shader);
    };
    material.customProgramCacheKey = () => key + ':far-batch';
    cache.set(base, material);
    return material;
  }
  // The shadow body of far copies that cast: the far shape itself, hidden as in the picture, so a cell casts what it shows.
  function depthMaterial() {
    if (depth) return depth;
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    if (!compact) {
      depth.onBeforeCompile = hideUnshown;
      depth.customProgramCacheKey = () => 'far-batch-depth';
    }
    return depth;
  }

  /** Batches the far copies of `cells` (taken out of their parents) into `parent`; returns the batches. */
  function batch(cellList, parent) {
    const cells = cellList.filter(cell => cell.lo && cell.lo.isInstancedMesh),
      groups = new Map(),
      materials = new Map();
    table.data = new Float32Array(tableWidth * Math.ceil(cells.length / tableWidth));
    if (!compact) {
      table.tex = new THREE.DataTexture(table.data, tableWidth, table.data.length / tableWidth, THREE.RedFormat, THREE.FloatType);
      table.tex.needsUpdate = true;
      shown.value = table.tex;
    }
    cells.forEach((cell, slot) => {
      const lo = cell.lo,
        key = [
          lo.geometry.uuid,
          lo.material.uuid,
          lo.layers.mask,
          lo.receiveShadow,
          cell.mesh.castShadow,
          Math.floor(cell.cx / square),
          Math.floor(cell.cz / square),
        ].join('|');
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { lo, casts: cell.mesh.castShadow, cells: [] }));
      group.cells.push(cell);
      cell.far = slot;
      cell.farN = lo.instanceMatrix.count;
      cell.lo = null;
      lo.removeFromParent();
    });
    for (const { lo, casts, cells: list } of groups.values()) {
      const instanceCount = list.reduce((total, cell) => total + cell.farN, 0),
        geometry = new THREE.BufferGeometry();
      for (const name in lo.geometry.attributes) geometry.setAttribute(name, lo.geometry.attributes[name]);
      geometry.setIndex(lo.geometry.index);
      geometry.boundingSphere = lo.geometry.boundingSphere;
      geometry.boundingBox = lo.geometry.boundingBox;
      const ids = compact ? null : new Float32Array(instanceCount * 2),
        mesh = new THREE.InstancedMesh(geometry, compact ? lo.material : farMaterial(lo.material, materials), instanceCount);
      if (lo.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(instanceCount * 3), 3);
      let at = 0;
      for (const cell of list) {
        cell.farBatch = batches.length;
        cell.farStart = at;
        if (cell.lod) cell.lod.batch = cell.farBatch;
        const src = cell.mesh.instanceMatrix.array,
          col = cell.mesh.instanceColor?.array;
        mesh.instanceMatrix.array.set(src.subarray(0, cell.farN * 16), at * 16);
        if (col && mesh.instanceColor) mesh.instanceColor.array.set(col.subarray(0, cell.farN * 3), at * 3);
        if (ids) {
          for (let i = 0; i < cell.farN; i++) {
            ids[(at + i) * 2] = cell.far;
            ids[(at + i) * 2 + 1] = i;
          }
        }
        at += cell.farN;
      }
      if (ids) geometry.setAttribute('aFar', new THREE.InstancedBufferAttribute(ids, 2));
      if (compact) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
        members.push(list);
      }
      mesh.layers.mask = lo.layers.mask;
      mesh.receiveShadow = lo.receiveShadow;
      mesh.castShadow = casts; // as the near copies do
      if (casts) {
        mesh.customDepthMaterial = depthMaterial();
        if (!distanceMaterial) {
          distanceMaterial = new THREE.MeshDistanceMaterial();
          if (!compact) {
            distanceMaterial.onBeforeCompile = hideUnshown;
            distanceMaterial.customProgramCacheKey = () => 'far-batch-distance';
          }
        }
        mesh.customDistanceMaterial = distanceMaterial;
        mesh.userData.partShown = true; // a pass drawing heights with a plain depth material would show every copy
      }
      mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      parent.add(mesh);
      batches.push(mesh);
    }
    drawEnds = new Int32Array(batches.length);
    if (compact) dirty = new Uint8Array(batches.length).fill(1);
    return batches;
  }

  // Near cells own the immutable source records. Keep their order so overlapping
  // surfaces and transparent instances blend exactly as in the original batch.
  function packVisible(batchIndex) {
    const mesh = batches[batchIndex];
    let end = 0;
    for (const cell of members[batchIndex]) {
      const visibleCount = Math.min(table.data[cell.far], cell.farN);
      if (!visibleCount) continue;
      mesh.instanceMatrix.array.set(cell.mesh.instanceMatrix.array.subarray(0, visibleCount * 16), end * 16);
      if (mesh.instanceColor) {
        const colour = cell.mesh.instanceColor;
        if (colour) mesh.instanceColor.array.set(colour.array.subarray(0, visibleCount * 3), end * 3);
        else mesh.instanceColor.array.fill(0, end * 3, (end + visibleCount) * 3);
      }
      end += visibleCount;
    }
    mesh.count = end;
    if (!end) return;
    for (const attribute of [mesh.instanceMatrix, mesh.instanceColor]) {
      if (!attribute) continue;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, end * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  // Where a cell lies and how far it is drawn, kept on it in a record of one shape: cells come from builders of many shapes,
  // and a number read from objects of so many shapes is made anew at every read. A cell does not move.
  const lodOf = cell =>
    (cell.lod ??= { cx: cell.cx, cy: cell.cy ?? 0, cz: cell.cz, r: cell.r, until: cell.until ?? Infinity, near: cell.near ?? Infinity, batch: cell.farBatch ?? -1 });

  /**
   * Each frame: near cells show their detailed mesh, far ones their batched copy, thinned beyond `thinFrom` of the drawing
   * distance. (cx, cz): the eye; `distance` metres past which nothing is drawn, `detail` metres within which the near mesh is,
   * `density` the share of a thinned cell's instances kept. Optional eye height `cy` includes altitude above the cell's
   * centre in the near/far decision. The visibility range stays horizontal. `rangeScale` scales both thresholds, including the radius.
   */
  function update(cells, cx, cz, distance, detail, density, cy, rangeScale = 1) {
    let changed = false;
    if (drawEnds) drawEnds.fill(0);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i],
        at = lodOf(cell),
        dx = cx - at.cx,
        dz = cz - at.cz,
        horizontalSq = dx * dx + dz * dz,
        detailDistance = Math.sqrt(horizontalSq) / rangeScale - at.r,
        hasFar = cell.lo || cell.far !== undefined;
      const vis = detailDistance < Math.min(distance, at.until),
        nearDistance = cy === undefined ? detailDistance : Math.sqrt(horizontalSq + (cy - at.cy) ** 2) / rangeScale - at.r,
        hi = !hasFar || nearDistance < Math.min(detail, at.near);
      cell.mesh.visible = vis && hi;
      if (cell.lo) cell.lo.visible = vis && !hi;
      let count = cell.farN;
      if (cell.full !== undefined) {
        count = Math.max(1, (cell.full * (detailDistance < distance * thinFrom ? 1 : thinTo) * density) | 0);
        cell.mesh.count = count;
        if (cell.lo) cell.lo.count = count;
      }
      if (cell.far !== undefined) {
        const v = vis && !hi ? count : 0;
        // A single draw preserves gl_InstanceID and the order of overlapping instances.
        // Omit its invisible tail; the shader clips gaps before doing any vertex work.
        if (v > 0) drawEnds[at.batch] = Math.max(drawEnds[at.batch], cell.farStart + Math.min(cell.farN, v));
        if (table.data[cell.far] !== v) {
          table.data[cell.far] = v;
          if (compact) dirty[at.batch] = 1;
          changed = true;
        }
      }
    }
    if (changed && table.tex) table.tex.needsUpdate = true;
    for (let i = 0; i < batches.length; i++) {
      if (!compact) batches[i].count = drawEnds[i];
      else if (dirty[i]) {
        packVisible(i);
        dirty[i] = 0;
      }
      batches[i].visible = drawEnds[i] > 0;
    }
  }

  return { batch, update, batches };
}
