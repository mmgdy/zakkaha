// /api/audio/[surah] — Proxy Quran audio with multiple CDN fallbacks
// Streams audio through our server so browser never hits CDN hotlink protection.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Ordered lists of CDN URLs per reciter — tried in sequence until one works
const CDN_LIST = {
  dosari:    n => [`https://server11.mp3quran.net/yasser/${n}.mp3`,    `https://cdn.islamic.network/quran/audio-surah/128/ar.YasserAl-Dosari/${n}.mp3`],
  mishary:   n => [`https://server8.mp3quran.net/afs/${n}.mp3`,        `https://cdn.islamic.network/quran/audio-surah/128/ar.Alafasy/${n}.mp3`],
  lahuni:    n => [`https://server7.mp3quran.net/lahoon/${n}.mp3`,     `https://server11.mp3quran.net/lahoon/${n}.mp3`],
  hatem:     n => [`https://server7.mp3quran.net/hatm/${n}.mp3`,       `https://server11.mp3quran.net/hatm/${n}.mp3`],
  hasan:     n => [`https://server7.mp3quran.net/hsmn/${n}.mp3`,       `https://server11.mp3quran.net/hsmn/${n}.mp3`],
  ramadan:   n => [`https://server11.mp3quran.net/Khalaf/${n}.mp3`,    `https://server8.mp3quran.net/Khalaf/${n}.mp3`],
  sibaei:    n => [`https://server8.mp3quran.net/sbaey/${n}.mp3`,      `https://server11.mp3quran.net/sbaey/${n}.mp3`],
  atiya:     n => [`https://server8.mp3quran.net/khalaq_atia/${n}.mp3`,`https://server11.mp3quran.net/khalaq_atia/${n}.mp3`],
  barbari:   n => [`https://server11.mp3quran.net/frg/${n}.mp3`,       `https://server8.mp3quran.net/frg/${n}.mp3`],
  salem:     n => [`https://server11.mp3quran.net/flstn/${n}.mp3`,     `https://server8.mp3quran.net/flstn/${n}.mp3`],
  siofi:     n => [`https://server11.mp3quran.net/rsd_s/${n}.mp3`,     `https://server8.mp3quran.net/rsd_s/${n}.mp3`],
  minshawi:  n => [`https://server8.mp3quran.net/minsh/${n}.mp3`,      `https://cdn.islamic.network/quran/audio-surah/128/ar.Minshawi/${n}.mp3`],
  minshawi_m:n => [`https://server8.mp3quran.net/Minshawy_Mujawwad/${n}.mp3`, `https://server11.mp3quran.net/Minshawy_Mujawwad/${n}.mp3`],
  banna:     n => [`https://server6.mp3quran.net/bna/${n}.mp3`,        `https://server11.mp3quran.net/bna/${n}.mp3`],
  imran:     n => [`https://server11.mp3quran.net/moh_emran/${n}.mp3`, `https://server8.mp3quran.net/moh_emran/${n}.mp3`],
}

// Browser-like headers so CDNs accept the request
const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
  'Accept':          'audio/mpeg, audio/*, */*;q=0.8',
  'Accept-Encoding': 'identity',
  'Connection':      'keep-alive',
}

export async function GET(request, { params }) {
  const n       = parseInt(params.surah)
  const url     = new URL(request.url)
  const reciter = url.searchParams.get('reciter') || 'dosari'

  if (!n || n < 1 || n > 114)
    return new Response('Invalid surah', { status: 400 })

  const pad3    = String(n).padStart(3, '0')
  const urls    = (CDN_LIST[reciter] || CDN_LIST.dosari)(pad3)

  // Forward Range header for seeking support
  const rangeHeader = request.headers.get('range')
  const fetchHeaders = { ...HEADERS }
  if (rangeHeader) fetchHeaders['Range'] = rangeHeader

  for (const cdnUrl of urls) {
    try {
      const upstream = await fetch(cdnUrl, {
        headers: fetchHeaders,
        signal:  AbortSignal.timeout(12000),
      })

      if (!upstream.ok && upstream.status !== 206) continue

      // Build response headers — keep CDN's content-type, length, range info
      const resHeaders = new Headers()
      resHeaders.set('Content-Type',  upstream.headers.get('Content-Type')  || 'audio/mpeg')
      resHeaders.set('Accept-Ranges', 'bytes')
      resHeaders.set('Cache-Control', 'public, max-age=604800')
      resHeaders.set('Access-Control-Allow-Origin', '*')

      const cl = upstream.headers.get('Content-Length')
      if (cl) resHeaders.set('Content-Length', cl)

      const cr = upstream.headers.get('Content-Range')
      if (cr) resHeaders.set('Content-Range', cr)

      return new Response(upstream.body, {
        status:  upstream.status,
        headers: resHeaders,
      })
    } catch (err) {
      console.warn(`[Audio] ${cdnUrl} failed: ${err.message}`)
      continue
    }
  }

  return new Response('Audio unavailable', { status: 503 })
}
