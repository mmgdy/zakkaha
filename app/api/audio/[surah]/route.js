// /api/audio/[surah] — Quran audio proxy with corrected CDN paths
// Streams audio through Vercel serverless (bypasses browser CORS)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CDN_LIST = {
  dosari:    n => [`https://server11.mp3quran.net/yasser/${n}.mp3`,    `https://cdn.islamic.network/quran/audio-surah/128/ar.YasserAl-Dosari/${n}.mp3`],
  mishary:   n => [`https://server8.mp3quran.net/afs/${n}.mp3`,        `https://cdn.islamic.network/quran/audio-surah/128/ar.Alafasy/${n}.mp3`],
  lahuni:    n => [`https://server7.mp3quran.net/lahoon/${n}.mp3`,     `https://server6.mp3quran.net/lahoon/${n}.mp3`,    `https://server11.mp3quran.net/lahoon/${n}.mp3`],
  hatem:     n => [`https://server6.mp3quran.net/hatm/${n}.mp3`,       `https://server7.mp3quran.net/hatm/${n}.mp3`,      `https://cdn.islamic.network/quran/audio-surah/128/ar.HatemFaridAlWaer/${n}.mp3`],
  hasan:     n => [`https://server8.mp3quran.net/hsmn/${n}.mp3`,       `https://server7.mp3quran.net/hsmn/${n}.mp3`,      `https://cdn.islamic.network/quran/audio-surah/128/ar.Husary/${n}.mp3`],
  ramadan:   n => [`https://server7.mp3quran.net/rmdan/${n}.mp3`,      `https://server11.mp3quran.net/Khalaf/${n}.mp3`,   `https://server6.mp3quran.net/rmdan/${n}.mp3`],
  sibaei:    n => [`https://server8.mp3quran.net/sbaey/${n}.mp3`,      `https://server6.mp3quran.net/sbaey/${n}.mp3`,     `https://server11.mp3quran.net/sbaey/${n}.mp3`],
  atiya:     n => [`https://server8.mp3quran.net/atia/${n}.mp3`,       `https://server8.mp3quran.net/khalaq_atia/${n}.mp3`,`https://server6.mp3quran.net/atia/${n}.mp3`],
  barbari:   n => [`https://server8.mp3quran.net/brb/${n}.mp3`,        `https://server11.mp3quran.net/frg/${n}.mp3`,      `https://server6.mp3quran.net/brb/${n}.mp3`],
  salem:     n => [`https://server7.mp3quran.net/slm/${n}.mp3`,        `https://server11.mp3quran.net/flstn/${n}.mp3`,    `https://server6.mp3quran.net/slm/${n}.mp3`],
  siofi:     n => [`https://server8.mp3quran.net/sfi/${n}.mp3`,        `https://server11.mp3quran.net/rsd_s/${n}.mp3`,    `https://server6.mp3quran.net/sfi/${n}.mp3`],
  minshawi:  n => [`https://server8.mp3quran.net/minsh/${n}.mp3`,      `https://cdn.islamic.network/quran/audio-surah/128/ar.Minshawi/${n}.mp3`],
  minshawi_m:n => [`https://server8.mp3quran.net/Minshawy_Mujawwad/${n}.mp3`, `https://server6.mp3quran.net/Minshawy_Mujawwad/${n}.mp3`, `https://cdn.islamic.network/quran/audio-surah/128/ar.Minshawi/${n}.mp3`],
  banna:     n => [`https://server6.mp3quran.net/bna/${n}.mp3`,        `https://server11.mp3quran.net/bna/${n}.mp3`,      `https://cdn.islamic.network/quran/audio-surah/128/ar.MaherAlMuaiqly/${n}.mp3`],
  imran:     n => [`https://server8.mp3quran.net/imran/${n}.mp3`,      `https://server11.mp3quran.net/moh_emran/${n}.mp3`,`https://server6.mp3quran.net/imran/${n}.mp3`],
}

const FETCH_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
  'Accept':          'audio/mpeg, audio/*, */*;q=0.8',
  'Accept-Encoding': 'identity',
  'Connection':      'keep-alive',
}

export async function GET(request, { params }) {
  const n       = parseInt(params.surah)
  const reqUrl  = new URL(request.url)
  const reciter = reqUrl.searchParams.get('reciter') || 'dosari'

  if (!n || n < 1 || n > 114)
    return new Response('Invalid surah', { status: 400 })

  const pad3 = String(n).padStart(3, '0')
  const urls = (CDN_LIST[reciter] || CDN_LIST.dosari)(pad3)

  const rangeHeader = request.headers.get('range')
  const fetchHeaders = rangeHeader ? { ...FETCH_HEADERS, Range: rangeHeader } : { ...FETCH_HEADERS }

  for (const cdnUrl of urls) {
    try {
      const upstream = await fetch(cdnUrl, { headers: fetchHeaders, signal: AbortSignal.timeout(15000) })
      if (!upstream.ok && upstream.status !== 206) { console.warn(`[Audio] ${cdnUrl} → ${upstream.status}`); continue }

      const resHeaders = new Headers({
        'Content-Type':                upstream.headers.get('Content-Type') || 'audio/mpeg',
        'Accept-Ranges':               'bytes',
        'Cache-Control':               'public, max-age=604800',
        'Access-Control-Allow-Origin': '*',
      })
      const cl = upstream.headers.get('Content-Length'); if (cl) resHeaders.set('Content-Length', cl)
      const cr = upstream.headers.get('Content-Range');  if (cr) resHeaders.set('Content-Range', cr)

      return new Response(upstream.body, { status: upstream.status, headers: resHeaders })
    } catch (err) { console.warn(`[Audio] ${cdnUrl} failed: ${err.message}`) }
  }

  return new Response(JSON.stringify({ error: 'Audio unavailable', reciter, surah: n }),
    { status: 503, headers: { 'Content-Type': 'application/json' } })
}
