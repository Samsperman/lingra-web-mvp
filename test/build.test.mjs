import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../scripts/build.mjs';

test('builds a portable offline app and invalidates caches when source changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lingra-build-'));
  const source = join(root, 'src');
  await mkdir(join(source, 'assets'), { recursive: true });
  await writeFile(join(source, 'index.html'), '<h1>Lingra</h1>');
  await writeFile(join(source, 'assets', 'voice.wav'), 'sample');

  const output = await buildSite(root);
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), '<h1>Lingra</h1>');
  const workerBeforeUpdate = await readFile(join(output, 'sw.js'), 'utf8');
  assert.match(workerBeforeUpdate, /assets\/voice\.wav/);

  await writeFile(join(source, 'index.html'), '<h1>Lingra learner</h1>');
  await buildSite(root);
  const workerAfterUpdate = await readFile(join(output, 'sw.js'), 'utf8');
  assert.notEqual(workerAfterUpdate, workerBeforeUpdate);
});

test('reports a missing entry page before creating an output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lingra-build-'));
  await mkdir(join(root, 'src'));
  await assert.rejects(() => buildSite(root), /index\.html/);
});
