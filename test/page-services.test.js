import assert from 'node:assert/strict';
import test from 'node:test';
import { searchWords, fuzzyScore } from 'roamwright/runtime/search.js';
import { createModulePreloader } from 'roamwright/runtime/module-preload.js';
import { nextFrame, painted } from 'roamwright/runtime/frame-yield.js';

test('title matches outweigh description matches and tolerate transposed letters', () => {
  const title = searchWords('Crème Harbor');
  const description = searchWords('marina');
  assert.deepEqual(title, ['creme', 'harbor']);
  assert.equal(fuzzyScore(['harbor'], title, description), 8);
  assert.equal(fuzzyScore(['creme', 'marina'], title, description), 12);
  assert.ok(fuzzyScore(['harobr'], title, description) > 0);
  assert.equal(fuzzyScore(['harbor', 'city'], title, description), 0);
});

test('shared module dependencies are preloaded once per document', () => {
  const links = [];
  const document = { createElement: () => ({}), head: { appendChild: el => links.push(el) } };
  const preload = createModulePreloader('https://example.org/scripts/main.js', document);
  preload(['shared.js', 'one.js']);
  preload(['./shared.js']);
  assert.deepEqual(links.map(link => link.href), ['https://example.org/scripts/shared.js', 'https://example.org/scripts/one.js']);
  assert.ok(links.every(link => link.rel === 'modulepreload'));
});

test('paused animation frames still yield and cancel unused callbacks', async t => {
  let cancelled = 0;
  t.after(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
  globalThis.requestAnimationFrame = () => 42;
  globalThis.cancelAnimationFrame = id => { assert.equal(id, 42); cancelled++; };
  await nextFrame(1);
  await painted(1);
  assert.equal(cancelled, 2);
});

test('diagnostics preserve earlier visits and coalesce repeated warnings', async () => {
  const { createDiagnosticLog } = await import('roamwright/runtime/diagnostic-log.js');
  const data = new Map();
  const page = {
    localStorage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) },
    performance: { now: () => 1000 }, location: { pathname: '/test', search: '' }, setTimeout: () => 1,
  };
  const options = { storageKey: 'test', page, capacity: 2 };
  const first = createDiagnosticLog({ ...options, visit: 'first' });
  first.setLogPlace(() => 'station');
  first.noteLog('warn', 'slow');
  first.noteLog('warn', 'slow');
  first.save();
  const second = createDiagnosticLog({ ...options, visit: 'second' });
  second.noteLog('warn', 'slow');
  assert.equal(second.readLog()[0].n, 2);
  assert.equal(second.readLog()[0].ctx, 'station');
  assert.equal(second.readLog().length, 2);
  second.clearLog();
  assert.deepEqual(first.readLog().map(entry => entry.visit), ['first']);
  assert.deepEqual(createDiagnosticLog(options).readLog(), []);
});
