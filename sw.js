const CACHE = 'scout-pro-v28';

// Derive base path from wherever sw.js is located — works on any host/subdirectory
const BASE = self.location.pathname.replace(/sw\.js$/, '');

const STATIC = [
  BASE,
  BASE + 'index.html',
  BASE + 'css/app.css?v=28',
  BASE + 'js/app.js?v=28',
  BASE + 'manifest.json',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go network-first for API calls
  if (url.pathname.startsWith(BASE + 'api/')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'Offline' }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Cache-first for static assets
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }))
  );
});

// ─── Background Sync (Android) ────────────────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'upload-evaluations') {
    e.waitUntil(swUploadQueue());
  }
});

async function swOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('scout-pro-offline', 1);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function swUploadQueue() {
  let db;
  try { db = await swOpenDB(); } catch { return; }

  const queue = await new Promise((resolve, reject) => {
    const tx  = db.transaction('eval_queue', 'readonly');
    const req = tx.objectStore('eval_queue').getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });

  for (const item of queue) {
    try {
      const res = await fetch(BASE + 'api/evaluations.php?action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id:  item.session_id,
          player_id:   item.player_id,
          skill_index: item.skill_index,
          score:       item.score
        })
      });
      if (res.ok) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('eval_queue', 'readwrite');
          tx.objectStore('eval_queue').delete(item.id);
          tx.oncomplete = resolve;
          tx.onerror    = e => reject(e.target.error);
        });
      } else {
        break; // stop and retry later
      }
    } catch {
      throw new Error('Retry later'); // causes sync to retry
    }
  }
}
