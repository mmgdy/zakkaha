// ── Quran Audio Proxy ─────────────────────────────────────────────────────────
// Streams Sheikh Al-Dosari audio server-side.
// Tries multiple CDN sources automatically.

const AUDIO_SOURCES = [
  // Islamic Network CDN — primary (no padding)
  n => `https://cdn.islamic.network/quran/audio-surah/128/ar.YasserAl-Dosari/${n}.mp3`,
  // Islamic Network CDN — zero-padded variant
  n => `https://cdn.islamic.network/quran/audio-surah/128/ar.YasserAl-Dosari/${String(n).padStart(3,'0')}.mp3`,
  // QuranicAudio — backup
  n => `https://download.quranicaudio.com/quran/yasser_ad-dossary/${String(n).padStart(3,'0')}.mp3`,
  // Server11 mp3quran
  n => `https://server11.mp3quran.net/yasser/${String(n).padStart(3,'0')}.mp3`,
]

export async function GET(request, { params }) {
  const n = parseInt(params.surah)
  if (!n || n < 1 || n > 114) {
    return new Response('Invalid surah number', { status: 400 })
  }

  // Support range requests for audio seeking
  const range = request.headers.get('range')

  for (const getUrl of AUDIO_SOURCES) {
    const url = getUrl(n)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const headers = { 'User-Agent': 'Zakkaha-App/1.0' }
      if (range) headers['Range'] = range

      const upstream = await fetch(url, { signal: controller.signal, headers })
      clearTimeout(timeout)

      if (!upstream.ok && upstream.status !== 206) continue

      // Stream the audio back to the client
      const responseHeaders = {
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=2592000', // 30 days
        'Access-Control-Allow-Origin': '*',
      }

      const contentLength = upstream.headers.get('content-length')
      const contentRange  = upstream.headers.get('content-range')
      if (contentLength) responseHeaders['Content-Length'] = contentLength
      if (contentRange)  responseHeaders['Content-Range']  = contentRange

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      })
    } catch (err) {
      console.warn(`[Audio] Source failed for surah ${n}:`, url, err?.message)
      continue
    }
  }

  return new Response('Audio not available', { status: 503 })
}
