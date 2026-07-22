// GreenCount offline support:
// - Precache app shell + local Leaflet
// - Cache OpenStreetMap tiles for offline map viewing

const APP_CACHE = 'greencount-app-v7';
const TILE_CACHE = 'greencount-tiles-v1';
const MAX_TILES = 800;

const PRECACHE_URLS = [
  './',
  './index.html',
  './sw.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png'
];

function isOsmTile(url) {
  return /^https:\/\/[abc]\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png(?:\?.*)?$/.test(url);
}

async function trimTileCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  const removeCount = keys.length - MAX_TILES;
  for (let i = 0; i < removeCount; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== TILE_CACHE && k !== 'greencount-cache-v6')
          .filter((k) => k.startsWith('greencount-'))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  if (isOsmTile(url)) {
    event.respondWith(handleTileRequest(event.request));
    return;
  }

  // Same-origin / relative app assets
  const reqUrl = new URL(url);
  if (reqUrl.origin === self.location.origin) {
    event.respondWith(handleAppRequest(event.request));
  }
});

async function handleAppRequest(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    // Refresh in background when online
    fetch(request).then((res) => {
      if (res && res.status === 200) cache.put(request, res.clone());
    }).catch(() => {});
    return cached;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (e) {
    // Navigation fallback
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    throw e;
  }
}

async function handleTileRequest(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request, { mode: 'cors', credentials: 'omit' });
    if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
      await cache.put(request, networkResponse.clone());
      trimTileCache(cache);
    }
    return networkResponse;
  } catch (e) {
    // Try alternate OSM subdomains already cached for same z/x/y
    const m = request.url.match(/^(https:\/\/)[abc](\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png)/);
    if (m) {
      for (const sub of ['a', 'b', 'c']) {
        const alt = await cache.match(m[1] + sub + m[2]);
        if (alt) return alt;
      }
    }
    // Transparent 1x1 PNG so Leaflet doesn't spam errors forever
    return new Response(
      Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WNfoAAAAASUVORK5CYII='), c => c.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }, status: 200 }
    );
  }
}

// Allow the page to ask SW to prefetch tile URLs
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'PREFETCH_TILES' || !Array.isArray(data.urls)) return;

  event.waitUntil((async () => {
    const cache = await caches.open(TILE_CACHE);
    for (const url of data.urls) {
      if (!isOsmTile(url)) continue;
      try {
        const existing = await cache.match(url);
        if (existing) continue;
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res && res.status === 200) {
          await cache.put(url, res.clone());
        }
      } catch (e) { /* ignore individual tile failures */ }
    }
    await trimTileCache(cache);
  })());
});
