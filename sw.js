// Service worker: makes Lantern open and play with no connection.
//
// Scripture files never change, so they are cached permanently on first read.
// The app shell is fetched from the network first so updates roll out, with the
// cache as the fallback when offline.

const VERSION = 'v4';
const SHELL_CACHE = `lantern-shell-${VERSION}`;
const TEXT_CACHE = 'lantern-text';

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'js/app.js',
  'js/ui.js',
  'js/player.js',
  'js/speech.js',
  'js/store.js',
  'js/library.js',
  'js/plans.js',
  'js/monetize.js',
  'js/narration.js',
  'js/ads-admob.js',
  'js/notify.js',
  'js/share.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('lantern-shell-') && k !== SHELL_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The narration catalogue is the one file under /data/ that changes: it
  // grows every time a narrator finishes recording. Cache-first would pin an
  // install to whatever narrators existed the day it was opened, so this is
  // network-first, falling back to the cached copy when offline.
  if (url.pathname.endsWith('/narration/catalogue.json')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(TEXT_CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.open(TEXT_CACHE).then(cache => cache.match(request)))
    );
    return;
  }

  // Scripture: cache-first and kept forever. This is what the premium
  // "download for offline" flow fills, simply by fetching every book once.
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      caches.open(TEXT_CACHE).then(async cache => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // App shell: fresh when online, cached when not.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        if (request.mode === 'navigate') return caches.match('index.html');
        throw new Error('offline');
      })
  );
});
