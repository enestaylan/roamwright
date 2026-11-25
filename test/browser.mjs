import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Python reports the assigned port when stdout is unbuffered. Using port zero lets
// independent checkouts run browser tests at the same time.
const root = fileURLToPath(new URL('../', import.meta.url));
const site = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
try {
  const lines = createInterface({ input: site.stdout });
  const [startup] = await Promise.race([
    once(lines, 'line'),
    once(site, 'exit').then(([code]) => { throw new Error('Fixture server exited: ' + code); }),
  ]);
  const port = startup.match(/ port (\d+)/)?.[1];
  if (!port) throw new Error('Unexpected fixture server address: ' + startup);
  const base = 'http://127.0.0.1:' + port;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--enable-webgl', '--enable-unsafe-swiftshader'],
  });
  for (const fixture of ['piece-batch', 'post-processing']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
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
    await page.close();
  }
} finally {
  await browser?.close();
  site.kill();
}
