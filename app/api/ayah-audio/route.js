// /api/ayah-audio — Server-side proxy for individual ayah audio (kids mode)
// everyayah.com blocks direct browser fetches via CORS, proxy bypasses it

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const surah = parseInt(searchParams.get('s') || '1')
  const ayah  = parseInt(searchParams.get('a') || '1')

  if (!surah || surah < 1 || surah > 114 || !ayah || ayah < 1)
    return new Response('Invalid params', { status: 400 })

  const padS = String(surah).padStart(3, '0')
  const padA = String(ayah).padStart(3, '0')

  const urls = [
    `https://everyayah.com/data/Yasser_Ad-Dossary_128kbps/${padS}${padA}.mp3`,
    `https://everyayah.com/data/AbdulSamad_64kbps_QuranExplorer.Com/${padS}${padA}.mp3`,
    `https://everyayah.com/data/Alafasy_128kbps/${padS}${padA}.mp3`,
    `https://everyayah.com/data/MinshawiFull_mujawwad_Suras/${padS}${padA}.mp3`,
  ]

  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
    'Accept':     'audio/mpeg, audio/*, */*',
    'Referer':    'https://everyayah.com/',
    'Origin':     'https://everyayah.com',
  }

  const rangeHeader = request.headers.get('range')
  if (rangeHeader) fetchHeaders['Range'] = rangeHeader

  for (const url of urls) {
    try {
      const upstream = await fetch(url, {
        headers: fetchHeaders,
        signal:  AbortSignal.timeout(10000),
      })
      if (!upstream.ok && upstream.status !== 206) continue

      const resHeaders = new Headers({
        'Content-Type':                upstream.headers.get('Content-Type') || 'audio/mpeg',
        'Accept-Ranges':               'bytes',
        'Cache-Control':               'public, max-age=604800',
        'Access-Control-Allow-Origin': '*',
      })
      const cl = upstream.headers.get('Content-Length'); if (cl) resHeaders.set('Content-Length', cl)
      const cr = upstream.headers.get('Content-Range');  if (cr) resHeaders.set('Content-Range', cr)

      return new Response(upstream.body, { status: upstream.status, headers: resHeaders })
    } catch (e) {
      console.warn(`[AyahAudio] ${url} failed: ${e.message}`)
    }
  }

  return new Response('Ayah audio unavailable', { status: 503 })
}
