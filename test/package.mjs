import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const peer = JSON.parse(readFileSync(new URL('../node_modules/three/package.json', import.meta.url))).version;
const consumer = mkdtempSync(join(tmpdir(), 'roamwright-consumer-'));
const npm = process.env.npm_execpath;

try {
  const packed = execFileSync(process.execPath, [npm, 'pack', '--json', '--pack-destination', consumer], { encoding: 'utf8' });
  const [{ filename }] = JSON.parse(packed);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  copyFileSync(new URL('./fixtures/package-consumer.mjs', import.meta.url), join(consumer, 'check.mjs'));
  const options = { cwd: consumer, stdio: 'inherit' };
  execFileSync(process.execPath, [npm, 'install', '--no-audit', '--no-fund', './' + filename, 'three@' + peer], options);
  execFileSync(process.execPath, ['check.mjs'], options);
  console.log('Packed consumer passed with Three.js ' + peer);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
