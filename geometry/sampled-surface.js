/**
 * Tessellate a parametric sheet into triangles with smooth normals for a geometry builder.
 * @module
 */

const buffers = [];
/**
 * Append two triangles per grid cell. On an X/Z sheet where u increases along +X
 * and v along +Z, the front faces point upward. A second side duplicates the
 * triangles with reversed winding and normals.
 * @param {Pick<import('./builder.js').GB, 'raw'>} builder - Destination for the generated vertices.
 * @param {number} columns - Positive integer cell count along u.
 * @param {number} rows - Positive integer cell count along v.
 * @param {(u: number, v: number) => ArrayLike<number>} pointAt - Map coordinates in [0, 1] to [x, y, z].
 * @param {ArrayLike<number> | ((u: number, v: number) => ArrayLike<number>)} surfaceColor -
 *   Linear RGB colour or a function sampled at cell centres, or at vertices when blending.
 * @param {{blend?: boolean, flip?: boolean, back?: boolean | ArrayLike<number>}} [options] -
 *   Blend vertex colours, flip the front winding, or add a back side. Set back to true
 *   to reuse front colours, or supply a separate linear RGB colour.
 * @example
 * ```js
 * import { GeometryBuilder } from 'roamwright';
 * import { sampleSurface } from 'roamwright/geometry/sampled-surface.js';
 *
 * const ground = new GeometryBuilder();
 * sampleSurface(ground, 8, 8, (u, v) => [16 * u, 2 * Math.sin(u * Math.PI), 16 * v], [0.3, 0.5, 0.2]);
 * const parts = ground.parts(); // 128 triangles
 * ```
 */
export function sampleSurface(builder, columns, rows, pointAt, surfaceColor, options = {}) {
  const scratch = buffers.pop() ?? { positions: [], normals: [], colors: [] };
  try {
    writeSurface(builder, columns, rows, pointAt, surfaceColor, options, scratch);
  } finally {
    buffers.push(scratch);
  }
}

function writeSurface(builder, columns, rows, pointAt, surfaceColor, options, scratch) {
  const rowStride = columns + 1,
    positions = scratch.positions,
    normals = scratch.normals,
    hasColorSampler = typeof surfaceColor === 'function',
    back = options.back,
    normalSign = options.flip ? -1 : 1,
    blend = hasColorSampler && options.blend,
    colors = scratch.colors;
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      const point = pointAt(column / columns, row / rows),
        componentOffset = (row * rowStride + column) * 3;
      positions[componentOffset] = point[0];
      positions[componentOffset + 1] = point[1];
      positions[componentOffset + 2] = point[2];
      if (blend) {
        const vertexColor = surfaceColor(column / columns, row / rows);
        colors[componentOffset] = vertexColor[0];
        colors[componentOffset + 1] = vertexColor[1];
        colors[componentOffset + 2] = vertexColor[2];
      }
    }
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      const leftOffset = (row * rowStride + Math.max(0, column - 1)) * 3,
        rightOffset = (row * rowStride + Math.min(columns, column + 1)) * 3,
        previousRowOffset = (Math.max(0, row - 1) * rowStride + column) * 3,
        nextRowOffset = (Math.min(rows, row + 1) * rowStride + column) * 3,
        componentOffset = (row * rowStride + column) * 3;
      const tx = positions[rightOffset] - positions[leftOffset],
        ty = positions[rightOffset + 1] - positions[leftOffset + 1],
        tz = positions[rightOffset + 2] - positions[leftOffset + 2],
        sx = positions[nextRowOffset] - positions[previousRowOffset],
        sy = positions[nextRowOffset + 1] - positions[previousRowOffset + 1],
        sz = positions[nextRowOffset + 2] - positions[previousRowOffset + 2];
      const nx = sy * tz - sz * ty,
        ny = sz * tx - sx * tz,
        nz = sx * ty - sy * tx,
        normalDivisor = (Math.hypot(nx, ny, nz) || 1) * normalSign;
      normals[componentOffset] = nx / normalDivisor;
      normals[componentOffset + 1] = ny / normalDivisor;
      normals[componentOffset + 2] = nz / normalDivisor;
    }
  const writeVertex = (column, row, sideSign, frontColor) => {
    const componentOffset = (row * rowStride + column) * 3;
    if (frontColor) builder.raw(
      positions[componentOffset], positions[componentOffset + 1], positions[componentOffset + 2],
      normals[componentOffset] * sideSign, normals[componentOffset + 1] * sideSign, normals[componentOffset + 2] * sideSign,
      frontColor[0], frontColor[1], frontColor[2],
    );
    else builder.raw(
      positions[componentOffset], positions[componentOffset + 1], positions[componentOffset + 2],
      normals[componentOffset] * sideSign, normals[componentOffset + 1] * sideSign, normals[componentOffset + 2] * sideSign,
      colors[componentOffset], colors[componentOffset + 1], colors[componentOffset + 2],
    );
  };
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const frontColor = blend ? null : hasColorSampler ? surfaceColor((column + 0.5) / columns, (row + 0.5) / rows) : surfaceColor,
        backColor = back === true ? frontColor : back;
      if (normalSign > 0) {
        writeVertex(column, row, 1, frontColor);
        writeVertex(column, row + 1, 1, frontColor);
        writeVertex(column + 1, row + 1, 1, frontColor);
        writeVertex(column, row, 1, frontColor);
        writeVertex(column + 1, row + 1, 1, frontColor);
        writeVertex(column + 1, row, 1, frontColor);
      } else {
        writeVertex(column, row, 1, frontColor);
        writeVertex(column + 1, row + 1, 1, frontColor);
        writeVertex(column, row + 1, 1, frontColor);
        writeVertex(column, row, 1, frontColor);
        writeVertex(column + 1, row, 1, frontColor);
        writeVertex(column + 1, row + 1, 1, frontColor);
      }
      if (back) {
        if (normalSign > 0) {
          writeVertex(column, row, -1, backColor);
          writeVertex(column + 1, row + 1, -1, backColor);
          writeVertex(column, row + 1, -1, backColor);
          writeVertex(column, row, -1, backColor);
          writeVertex(column + 1, row, -1, backColor);
          writeVertex(column + 1, row + 1, -1, backColor);
        } else {
          writeVertex(column, row, -1, backColor);
          writeVertex(column, row + 1, -1, backColor);
          writeVertex(column + 1, row + 1, -1, backColor);
          writeVertex(column, row, -1, backColor);
          writeVertex(column + 1, row + 1, -1, backColor);
          writeVertex(column + 1, row, -1, backColor);
        }
      }
    }
}
