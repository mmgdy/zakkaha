// /api/audio/[surah] — Server-side audio proxy for Sheikh Al-Dosari
// Streams MP3 from CDN through your server — zero CORS issues

export const dynamic = 'force-dynamic'

// Multiple CDN sources for Al-Dosari in priority order
function getAudioUrls(n) {
  const pad = String(n).padStart(3, '0')
  return [
    `https://server11.mp3quran.net/yasser/${pad}.mp3`,
    `https://download.quranicaudio.com/quran/yasser_ad-dossary/${pad}.mp3`,
    `https://cdn.islamic.network/quran/audio-surah/128/ar.YasserAl-Dosari/${pad}.mp3`,
    `https://everyayah.com/data/Yasser_Ad-Dossary_128kbps/${pad}001.mp3`,
  ]
}

export async function GET(request, { params }) {
  const n = parseInt(params.surah)
  if (!n || n < 1 || n > 114) {
    return new Response('Invalid surah', { status: 400 })
  }

  const urls = getAudioUrls(n)

  for (const url of urls) {
    try {
      const upstream = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Zakkaha/2.0)',
          'Accept': 'audio/mpeg, audio/*, */*',
          'Range': request.headers.get('Range') || '',
        },
      })

      if (!upstream.ok || !upstream.body) continue

      // Get content info
      const contentType   = upstream.headers.get('content-type')   || 'audio/mpeg'
      const contentLength = upstream.headers.get('content-length')
      const acceptRanges  = upstream.headers.get('accept-ranges')   || 'bytes'
      const contentRange  = upstream.headers.get('content-range')

      const headers = new Headers({
        'Content-Type':                  contentType,
        'Accept-Ranges':                 acceptRanges,
        'Cache-Control':                 'public, max-age=604800',
        'Access-Control-Allow-Origin':   '*',
        'Access-Control-Allow-Methods':  'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers':  'Range',
      })

      if (contentLength)  headers.set('Content-Length', contentLength)
      if (contentRange)   headers.set('Content-Range',  contentRange)

      const status = upstream.status === 206 ? 206 : 200

      return new Response(upstream.body, { status, headers })

    } catch { continue }
  }

  // All CDNs failed
  return new Response('Audio unavailable', {
    status: 503,
    headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }
  })
}

export async function HEAD(request, { params }) {
  return GET(request, { params })
}
