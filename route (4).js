// /api/audio/[surah] — Serves Quran audio for multiple reciters
// Supports: dosari (default), minshawi

export const dynamic = 'force-dynamic'

function getUrls(n, reciter) {
  const pad3 = String(n).padStart(3, '0')

  if (reciter === 'minshawi') {
    return [
      `https://server8.mp3quran.net/minsh/${pad3}.mp3`,
      `https://download.quranicaudio.com/quran/muhammad_siddiq_al-minshawi/${pad3}.mp3`,
      `https://cdn.islamic.network/quran/audio-surah/128/ar.Minshawi/${pad3}.mp3`,
    ]
  }
  // default: dosari
  return [
    `https://server11.mp3quran.net/yasser/${pad3}.mp3`,
    `https://download.quranicaudio.com/quran/yasser_ad-dossary/${pad3}.mp3`,
    `https://cdn.islamic.network/quran/audio-surah/128/ar.YasserAl-Dosari/${pad3}.mp3`,
    `https://everyayah.com/data/Yasser_Ad-Dossary_128kbps/${pad3}001.mp3`,
  ]
}

export async function GET(request, { params }) {
  const n       = parseInt(params.surah)
  const reciter = new URL(request.url).searchParams.get('reciter') || 'dosari'
  if (!n || n < 1 || n > 114) return new Response('Invalid surah', { status: 400 })

  for (const url of getUrls(n, reciter)) {
    try {
      const upstream = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'audio/mpeg, audio/*, */*' },
        signal: AbortSignal.timeout(8000),
      })
      if (!upstream.ok) continue
      return new Response(upstream.body, {
        headers: {
          'Content-Type':  upstream.headers.get('Content-Type')  || 'audio/mpeg',
          'Content-Length': upstream.headers.get('Content-Length') || '',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=604800',
        },
      })
    } catch {}
  }
  return new Response('Audio unavailable', { status: 503 })
}
