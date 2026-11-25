import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Python reports the assigned port when stdout is unbuffered. Using port zero lets
// independent checkouts run browser tests at the same time.
const root = fileURLToPath(new URL('../', import.meta.url));
const site = spawn('python3', ['-u', 'scripts/serve.py', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
try {
  const lines = createInterface({ input: site.stdout });
  const [startup] = await Promise.race([
    once(lines, 'line'),
    once(site, 'exit').then(([code]) => { throw new Error('Fixture server exited: ' + code); }),
  ]);
  const port = startup.match(/ port (\d+)/)?.[1];
  if (!port) throw new Error('Unexpected fixture server address: ' + startup);
  const base = 'http://localhost:' + port;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--mute-audio', '--enable-webgl', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 720, height: 405 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  for (const fixture of ['water-surface', 'shadow-passes', 'shader-warmup', 'piece-batch', 'post-processing', 'contact-shadows', 'outline-render', 'strata-material', 'terrain-rock', 'atmosphere', 'grid-cache-probe', 'garment-material', 'particle-audio', 'material-lod']) {
    await page.goto(base + '/test/' + fixture + '.html');
    await page.waitForFunction(() => {
      const result = document.getElementById('result');
      return result && (result.dataset.result || /^(PASS|FAIL)/.test(result.textContent));
    });
    const result = page.locator('#result');
    const report = await result.textContent();
    assert.ok(await result.getAttribute('data-result') === 'pass' || report.startsWith('PASS'), report);
    assert.deepEqual(errors, []);
    console.log(fixture, report);
  }
  // Seed changes must reach the shipped scene. Comparing captures within a run
  // avoids coupling the example to a particular GPU's rasterization.
  for (const example of ['index.html', 'viaduct.html']) {
    const captures = [];
    for (const seed of [42, 81]) {
      await page.goto(base + '/examples/' + example + '?seed=' + seed);
      await page.waitForFunction(() => document.querySelector('canvas')?.width === innerWidth);
      captures.push(await page.locator('canvas').screenshot({ style: 'header, footer { visibility: hidden }' }));
      assert.deepEqual(errors, []);
    }
    assert.ok(!captures[0].equals(captures[1]), example + ' should render different seeds');
    console.log(example, 'rendered both seeds');
  }
  const canvas = page.locator('canvas');
  const capture = () => canvas.screenshot({ style: 'header, footer { visibility: hidden }' });
  const valley = await capture();
  await page.getByRole('button', { name: 'Trackside' }).click();
  const trackside = await capture();
  assert.ok(!trackside.equals(valley), 'Trackside should move the camera');
  await page.getByRole('button', { name: 'Run train' }).click();
  // Wait for a visible change rather than assuming a particular animation frame rate.
  let moving = await capture();
  for (let attempt = 0; attempt < 5 && moving.equals(trackside); attempt++) moving = await capture();
  assert.ok(!moving.equals(trackside), 'Train should move relative to the bridge');
  await page.getByRole('button', { name: 'Pause train' }).click();
  const paused = await capture();
  assert.ok((await capture()).equals(paused), 'Pausing should stop the train');
  assert.deepEqual(errors, []);

} finally {
  await browser?.close();
  site.kill();
}
