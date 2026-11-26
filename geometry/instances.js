import * as THREE from 'three';
import { geometryView } from './builder.js';
import { markStill } from '../rendering/still-casters.js';

// ════════════════════════════════════════════════════════════════════════
//  Copies of one model: the arrays that say where each stands and its tint, filled on a worker of the pool or on the page
//  (instanceArrays, putInstance), and the instanced meshes the page draws from them (instancedMesh, instancedTwin).
// ════════════════════════════════════════════════════════════════════════

// Allocate space for one matrix and one linear RGB colour per instance.
const instanceArrays = instanceCount => ({ matrices: new Float32Array(instanceCount * 16), colours: new Float32Array(instanceCount * 3) });
// Write the transform and linear RGB colour at instanceIndex in Three.js buffer order.
function putInstance(arrays, instanceIndex, matrix, red, green, blue) {
  matrix.toArray(arrays.matrices, instanceIndex * 16);
  arrays.colours[instanceIndex * 3] = red;
  arrays.colours[instanceIndex * 3 + 1] = green;
  arrays.colours[instanceIndex * 3 + 2] = blue;
}
// An instanced mesh of `geometry` drawn at the copies of `arrays`. It is made empty and then given them, so that it does not
// first write a matrix of its own for every copy only to have it replaced.
function instancedMesh(geometry, material, { matrices, colours }) {
  const mesh = new THREE.InstancedMesh(geometry, material, 0);
  mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colours, 3);
  mesh.count = matrices.length / 16;
  return mesh;
}
// A second model drawn at the copies of `mesh` (its far version), once the mesh's bounds are worked out: it shares the arrays
// on the graphics card and the bounds.
function instancedTwin(geometry, material, mesh) {
  const twin = new THREE.InstancedMesh(geometry, material, 0);
  twin.instanceMatrix = mesh.instanceMatrix;
  twin.instanceColor = mesh.instanceColor;
  twin.count = mesh.count;
  twin.boundingSphere = mesh.boundingSphere;
  return twin;
}

// Copies of one unit shape gathered as a builder gathers its parts (add(shape, colour, matrix), as GB's add, at the builder's origin
// ox, oy, oz), then drawn as one instanced mesh: thousands of small stones that would be one mesh of their own vertices are one
// shape and a matrix and a colour to each, a fortieth of the bytes to hand to the card, and as many triangles drawn.
class Copies {
  constructor(shape) {
    this.shape = shape;
    this.ox = this.oy = this.oz = 0;
    this.matrices = [];
    this.colours = [];
  }
  add(shape, color, transform) {
    if (shape !== this.shape) throw new Error('Copies hold one shape');
    const elements = transform.elements;
    this.matrices.push(...elements);
    const at = this.matrices.length - 4; // the translation, moved to the builder's origin
    this.matrices[at] += this.ox;
    this.matrices[at + 1] += this.oy;
    this.matrices[at + 2] += this.oz;
    this.colours.push(color[0], color[1], color[2]);
  }
  // The instanced mesh of the copies under `parent`, standing still, casting a shadow unless told not to; the lists are let go.
  mesh(material, parent, shadow = true) {
    const mesh = instancedMesh(geometryView(this.shape), material, {
      matrices: new Float32Array(this.matrices),
      colours: new Float32Array(this.colours),
    });
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.computeBoundingSphere();
    if (shadow) markStill(mesh);
    this.matrices = this.colours = null;
    if (parent) parent.add(mesh);
    return mesh;
  }
}

export { Copies, instanceArrays, instancedMesh, instancedTwin, putInstance };

// Partition static world-space transforms and their colors into independently cullable
// cells. A single cell keeps its original arrays; order within every cell is stable.
export function partitionInstances(arrays, cellSize) {
  if (!(cellSize > 0)) throw new RangeError('Expected a positive cell size');
  const { matrices, colours } = arrays;
  const cells = new Map();
  for (let i = 0; i < matrices.length / 16; i++) {
    const cellKey = Math.floor(matrices[i*16+12] / cellSize) + ',' + Math.floor(matrices[i*16+14] / cellSize);
    let ids = cells.get(cellKey);
    if (!ids) cells.set(cellKey, ids = []);
    ids.push(i);
  }
  if (cells.size < 2) return matrices.length ? [arrays] : [];
  return Array.from(cells.values(), ids => {
    const cell = instanceArrays(ids.length);
    ids.forEach((id, i) => {
      cell.matrices.set(matrices.subarray(id*16,id*16+16), i*16);
      cell.colours.set(colours.subarray(id*3,id*3+3), i*3);
    });
    return cell;
  });
}
