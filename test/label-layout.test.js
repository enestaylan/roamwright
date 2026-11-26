import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabelLayout } from 'roamwright/rendering/label-layout.js';

test('failed candidates reserve nothing; alternatives respect obstacles and all viewport edges', () => {
  const l = createLabelLayout({ margin: 4, capacity: 1, blocked: (x, y, r) => x < 210 && r > 140 && y < 48 });
  l.reset(350, 180);
  for (const [x, y] of [[175, 50], [12, 90], [345, 90], [110, 15], [70, 185]]) assert.ok(Number.isNaN(l.place(x, y, 65, 22)));
  assert.equal(l.place(100, 72, 65, 22), 72);
  assert.equal(l.overlaps(90, 55, 101, 63), true);
  assert.ok(Number.isNaN(l.place(260, 100, 65, 22)));
  l.reset(180, 350);
  assert.equal(l.overlaps(90, 55, 101, 63), false);
});
test('overlapping labels stack within the requested lift', () => {
  const l = createLabelLayout();
  l.reset(300, 200);
  assert.equal(l.place(140, 155, 100, 20), 155);
  assert.equal(l.place(155, 155, 90, 20, 60, 3), 132);
  assert.ok(Number.isNaN(l.place(155, 155, 90, 20, 35, 3)));
  assert.equal(l.place(155, 155, 90, 20, 60, 3), 109);
});
