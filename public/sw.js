// ── Zakkaha Service Worker ────────────────────────────────────────────────────
// Handles: offline Quran cache, push notifications, background sync

const CACHE_VERSION  = 'zakkaha-v4'
const QURAN_CACHE    = 'zakkaha-quran-v1'
const STATIC_CACHE   = 'zakkaha-static-v4'

// Static assets to cache on install
const STATIC_ASSETS = ['/', '/manifest.json']

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(
    caches.open(STATIC_CACHE).then(c => c.addAll(STATIC_ASSETS)).catch(() => {})
  )
})

// ── ACTIVATE ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== QURAN_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

// ── FETCH — network first, Quran cache fallback ───────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url

  // Quran API requests → cache indefinitely (text doesn't change)
  // Cache our own Quran proxy routes (/api/quran/*)  
  if (url.includes('/api/quran/')) {
    e.respondWith(
      caches.open(QURAN_CACHE).then(async cache => {
        const cached = await cache.match(e.request)
        if (cached) return cached
        try {
          const fresh = await fetch(e.request)
          if (fresh.ok) cache.put(e.request, fresh.clone())
          return fresh
        } catch {
          return cached || new Response(JSON.stringify({ error: 'offline' }), {
            headers: { 'Content-Type': 'application/json' }
          })
        }
      })
    )
    return
  }

  // App shell → network first, cache fallback
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match('/').then(r => r || fetch(e.request))
      )
    )
    return
  }

  // Everything else → network first
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
})

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'زكّاها', body: 'رسالة من زكّاها', icon: '/icons/icon-192.png', tag: 'zakkaha' }
  try { if (e.data) data = { ...data, ...e.data.json() } } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon || '/icons/icon-192.png',
      badge:   '/icons/icon-192.png',
      tag:     data.tag || 'zakkaha',
      vibrate: [200, 100, 200],
      data:    { url: data.url || '/' },
      actions: data.actions || [],
      requireInteraction: data.requireInteraction || false,
    })
  )
})

// ── NOTIFICATION CLICK ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin))
      if (existing) { existing.focus(); existing.navigate(url) }
      else self.clients.openWindow(url)
    })
  )
})

// ── BACKGROUND SYNC — pre-fetch all Quran surahs ─────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'PREFETCH_QURAN') {
    e.waitUntil(prefetchAllSurahs(e.data.progress))
  }
  // Show notification immediately — timers are kept in the page thread, not here
  if (e.data?.type === 'SHOW_NOTIFICATION_NOW') {
    const { title, body, tag, url, icon } = e.data.notification || {}
    e.waitUntil(
      self.registration.showNotification(title || 'زكّاها', {
        body:    body || '',
        icon:    icon || '/icons/icon-192.png',
        badge:   '/icons/icon-192.png',
        tag:     tag  || 'zakkaha',
        vibrate: [200, 100, 200],
        data:    { url: url || '/' },
        requireInteraction: false,
      })
    )
  }
  // Legacy support
  if (e.data?.type === 'SCHEDULE_NOTIFICATION') {
    const n = e.data.notification || {}
    e.waitUntil(
      self.registration.showNotification(n.title || 'زكّاها', {
        body: n.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
        tag: n.tag || 'zakkaha', vibrate: [200,100,200], data: { url: n.url || '/' },
      })
    )
  }
})

async function prefetchAllSurahs(onProgress) {
  const cache = await caches.open(QURAN_CACHE)
  let done = 0
  for (let n = 1; n <= 114; n++) {
    const url = `/api/quran/${n}`
    const cached = await cache.match(url)
    if (!cached) {
      try {
        const res = await fetch(url)
        if (res.ok) await cache.put(url, res)
      } catch { /* skip on network error */ }
    }
    done++
    // Report progress to all clients
    const clients = await self.clients.matchAll()
    clients.forEach(c => c.postMessage({ type: 'QURAN_PROGRESS', done, total: 114 }))
    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 120))
  }
  const clients = await self.clients.matchAll()
  clients.forEach(c => c.postMessage({ type: 'QURAN_COMPLETE' }))
}



