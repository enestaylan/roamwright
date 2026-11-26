import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { CueCursor } from 'roamwright/runtime/cue-cursor.js';
import { cameraKeyAt, createCameraTrackSampler } from 'roamwright/rendering/camera-track.js';
import { cameraKeyAt as originalImport } from 'roamwright/rendering/stage-lights.js';

test('observatory and ferry cues keep independent cursors, same-time order and lookahead', () => {
  const observatory = [[0, 'open dome'], [2, 'track'], [2, 'expose plate'], [4, 'close shutter']];
  const ferry = [[1, 'board'], [3, 'depart']];
  const clock = new CueCursor();
  const other = new CueCursor();
  const seen = [];
  const record = cue => seen.push([cue[1], clock.nextIndex]);
  clock.advance(observatory, -1, record);
  clock.advance(observatory, 0, record);
  clock.advance(observatory, 1.999, record);
  clock.advance(observatory, 2, record);
  clock.advance(observatory, 2, record);
  assert.deepEqual(seen, [['open dome', 1], ['track', 2], ['expose plate', 3]]);
  assert.equal(other.nextIndex, 0);
  clock.reset(); // skip the remaining cue and start a different sequence
  seen.length = 0;
  clock.advance(ferry, 8, record);
  assert.deepEqual(seen, [['board', 1], ['depart', 2]]);
  clock.reset();
  const replay = [];
  clock.advance([], 0, record);
  clock.advance(observatory, 4, cue => replay.push(cue));
  assert.deepEqual(replay, observatory);
});

test('camera samples offsets, a live subject, held cuts and lenses at exact boundaries', () => {
  assert.equal(originalImport, cameraKeyAt);
  const planet = new Vector3(14, 30, 0);
  const sample = createCameraTrackSampler((name, out) => {
    assert.equal(name, 'planet');
    out.copy(planet);
  });
  const origin = { x: 10, y: 20, z: -2 };
  const position = new Vector3(), aim = new Vector3();
  const keys = [[0, 0, 2, 0, 0, 2, 0, false, 60], [4, 8, 6, 0, 'planet', 0, 0, false, 40],
    [6, 0, 10, 0, 0, 0, 0, true]];
  const at = seconds => [sample(keys, seconds, origin, position, aim), position.toArray(), aim.toArray()];
  assert.deepEqual(at(-3), [60, [10, 22, -2], [10, 22, -2]]);
  assert.deepEqual(at(1), [56.875, [11.25, 22.625, -2], [10.625, 23.25, -1.6875]]);
  assert.deepEqual(at(4), [40, [18, 26, -2], [14, 30, 0]]);
  planet.x++;
  assert.deepEqual(at(5.999), [40, [18, 26, -2], [15, 30, 0]]);
  assert.deepEqual(at(6), [undefined, [10, 30, -2], [10, 20, -2]]);
  assert.deepEqual(at(100), at(6));
  assert.deepEqual(at(0), [60, [10, 22, -2], [10, 22, -2]]);
  assert.equal(sample([keys[2]], 0, origin, position, aim), undefined);
  assert.deepEqual(position.toArray(), [10, 30, -2]);
  assert.deepEqual(aim.toArray(), [10, 20, -2]);
});
