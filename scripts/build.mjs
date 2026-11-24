import { createHash } from 'node:crypto';
import { cp, lstat, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));

export async function buildSite(root = appRoot) {
  const canonicalRoot = await realpath(root);
  const src = path.join(canonicalRoot, 'src');
  const output = path.join(canonicalRoot, 'dist');
  const entry = await lstat(path.join(src, 'index.html'));
  if (!entry.isFile()) throw new Error('src/index.html must be a regular file');

  const files = (await readdir(src, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(src, path.join(entry.parentPath, entry.name)))
    .sort();
  const fingerprint = createHash('sha256');
  for (const file of files) {
    fingerprint.update(file);
    fingerprint.update(await readFile(path.join(src, file)));
  }
  const outputEntry = await lstat(output).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (outputEntry && (!outputEntry.isDirectory() || outputEntry.isSymbolicLink())) {
    throw new Error('dist must be a regular directory inside the project');
  }
  await rm(output, { recursive: true, force: true });
  await cp(src, output, { recursive: true });

  const precache = files.map((file) => file.split(path.sep).map(encodeURIComponent).join('/'));
  const cacheId = fingerprint.digest('hex').slice(0, 16);
  await writeFile(path.join(output, 'sw.js'), serviceWorker(cacheId, precache));
  return output;
}

function serviceWorker(cacheId, files) {
  return `const prefix = 'lingra-' + self.registration.scope + '-';
const cacheName = prefix + ${JSON.stringify(cacheId)};
const files = ${JSON.stringify(files)};
const entry = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(files.map(file => new Request(new URL(file, self.registration.scope), {cache: 'reload'})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    try {
      return await fetch(request);
    } catch {
      const cache = await caches.open(cacheName);
      return await cache.match(request.mode === 'navigate' ? entry : request) || Response.error();
    }
  })());
});
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log('Built Lingra in ' + await buildSite());
}
