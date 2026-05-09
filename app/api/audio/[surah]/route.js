// /api/audio/[surah] — 302 redirect to CDN
// WHY: All Quran CDNs block server-side proxy (hotlink protection).
// 302 lets the browser fetch directly — CDN sees browser IP and allows it.

export const dynamic = 'force-dynamic'

const RECITER_URLS = {
  // ── حفص (Hafs) ──────────────────────────────────────────────────────
  dosari:    n => `https://server11.mp3quran.net/yasser/${n}.mp3`,
  mishary:   n => `https://server8.mp3quran.net/afs/${n}.mp3`,
  lahuni:    n => `https://server7.mp3quran.net/lahoon/${n}.mp3`,
  hatem:     n => `https://server7.mp3quran.net/hatm/${n}.mp3`,
  hasan:     n => `https://server7.mp3quran.net/hsmn/${n}.mp3`,
  ramadan:   n => `https://server11.mp3quran.net/Khalaf/${n}.mp3`,
  sibaei:    n => `https://server8.mp3quran.net/sbaey/${n}.mp3`,
  atiya:     n => `https://server8.mp3quran.net/khalaq_atia/${n}.mp3`,
  barbari:   n => `https://server11.mp3quran.net/frg/${n}.mp3`,
  salem:     n => `https://server11.mp3quran.net/flstn/${n}.mp3`,
  siofi:     n => `https://server11.mp3quran.net/rsd_s/${n}.mp3`,
  // ── تجويد (Tajweed) ─────────────────────────────────────────────────
  minshawi:  n => `https://server8.mp3quran.net/minsh/${n}.mp3`,
  minshawi_m:n => `https://server8.mp3quran.net/Minshawy_Mujawwad/${n}.mp3`,
  banna:     n => `https://server6.mp3quran.net/bna/${n}.mp3`,
  imran:     n => `https://server11.mp3quran.net/moh_emran/${n}.mp3`,
}

// Fallback URLs (Islamic.Network CDN)
const FALLBACKS = {
  dosari:   n => `https://cdn.islamic.network/quran/audio-surah/128/ar.YasserAl-Dosari/${n}.mp3`,
  mishary:  n => `https://cdn.islamic.network/quran/audio-surah/128/ar.Alafasy/${n}.mp3`,
  minshawi: n => `https://cdn.islamic.network/quran/audio-surah/128/ar.Minshawi/${n}.mp3`,
}

export async function GET(request, { params }) {
  const n       = parseInt(params.surah)
  const url     = new URL(request.url)
  const reciter = url.searchParams.get('reciter') || 'dosari'
  const fallback = url.searchParams.get('fallback') === '1'

  if (!n || n < 1 || n > 114)
    return new Response('Invalid surah', { status: 400 })

  const pad3 = String(n).padStart(3, '0')

  // If browser signals primary failed, use fallback CDN
  if (fallback) {
    const fb = FALLBACKS[reciter] || FALLBACKS.dosari
    return Response.redirect(fb(pad3), 302)
  }

  const primary = RECITER_URLS[reciter] || RECITER_URLS.dosari
  return Response.redirect(primary(pad3), 302)
}
