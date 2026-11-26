import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewportSizer, watchPixelDensity } from 'roamwright/rendering/viewport.js';
import { createQualityFit } from 'roamwright/runtime/quality-fit.js';

test('native output fits presets without applying or overwriting a saved scale', () => {
  for (const adaptiveResolution of [false, true]) {
    const scales = [];
    const writes = [];
    const presets = [];
    const fit = createQualityFit({
      adaptiveResolution, state: {quality: 'medium'}, post: {on: true},
      store: {keptChoice: () => 'medium', keptOnce: () => null, keptFit: () => 'medium',
        keptScale: () => 0.75, keepChoice() {}, keepScale: (...args) => writes.push(args)},
      applyQuality: name => presets.push(name), setDrawScale: scale => scales.push(scale), warmShaders() {},
    });
    fit.startQuality();
    fit.chooseQuality('high');
    assert.deepEqual(presets, ['medium','high']);
    assert.deepEqual(scales, adaptiveResolution ? [0.75,1] : []);
    assert.deepEqual(writes, adaptiveResolution ? [['high',1]] : []);
  }
});

test('sizing reports actual physical pixels through window resizes and explicit captures', () => {
  const canvas = {};
  const renderer = {domElement: canvas, setDrawingBufferSize(w,h,density) {
    canvas.width = Math.floor(w*density); canvas.height = Math.floor(h*density);
  }};
  let width = 1920, height = 1080;
  const sizes = [];
  const v = createViewportSizer({renderer, width: () => width, height: () => height,
    density: () => 2, budget: {width:3840,height:2160}, onResize: (...dimensions) => sizes.push(dimensions)});
  v.resize();
  width = 2560;
  v.resize();
  v.holdSize(1728,1117,2,3840*2160);
  width = 800; height = 500;
  v.resize();
  v.holdSize();
  assert.deepEqual(sizes, [[1920,1080,3840,2160],[2560,1080,3840,1620],
    [1728,1117,3456,2234],[1728,1117,3456,2234],[800,500,1600,1000]]);
  assert.deepEqual(v.drawnSize(), [1600,1000]);
});

test('density observer rearms on its new display and releases the current listener', () => {
  const queries = [];
  const host = {devicePixelRatio:2, matchMedia(media) {
    const query = Object.assign(new EventTarget(), {media}); queries.push(query); return query;
  }};
  let changes = 0;
  const stop = watchPixelDensity(() => changes++, host);
  host.devicePixelRatio = 1;
  queries[0].dispatchEvent(new Event('change'));
  assert.equal(queries[1].media, '(resolution: 1dppx)');
  stop();
  queries[1].dispatchEvent(new Event('change'));
  assert.equal(changes, 1);
});

test('slow frames on a native output still lower the automatic preset', async () => {
  const state = {quality:'medium'};
  let clock = performance.now(), fence = 0;
  const fit = createQualityFit({
    adaptiveResolution: false, state, post: {on:true},
    store: {keptChoice: () => null, keptOnce: () => null, keptFit: () => 'medium', keepFit() {}},
    applyQuality(name) { state.quality = name; },
    warmShaders() {}, emit() {}, noteLog() {},
    cardBlocks: () => true, cardDone: () => Promise.resolve({at:(fence += 25)}),
  });
  fit.startQuality();
  for (let frame = 0; frame < 800 && state.quality === 'medium'; frame++) {
    clock += 25;
    if (fit.probeDue(clock)) {
      fit.probed(clock);
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  assert.equal(state.quality, 'low');
});
