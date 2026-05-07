// /api/audio/[surah] — Returns 302 redirect to CDN audio URL
// WHY REDIRECT: All Quran CDNs block server-side proxying (hotlink protection).
// A 302 redirect lets the user's browser fetch directly from the CDN —
// the CDN sees the browser IP + browser headers and serves the file.

export const dynamic = 'force-dynamic'

// mp3quran.net server paths per reciter (verified from mp3quran.net)
const RECITER_URLS = {
  // ── HAFS NARRATION (رواية حفص) ──────────────────────────────────────────
  dosari:    n => `https://server11.mp3quran.net/yasser/${n}.mp3`,
  lahuni:    n => `https://server7.mp3quran.net/lahoon/${n}.mp3`,
  hatem:     n => `https://server7.mp3quran.net/hatm/${n}.mp3`,
  hasan:     n => `https://server7.mp3quran.net/hsmn/${n}.mp3`,
  ramadan:   n => `https://server11.mp3quran.net/Khalaf/${n}.mp3`,
  sibaei:    n => `https://server8.mp3quran.net/sbaey/${n}.mp3`,
  atiya:     n => `https://server8.mp3quran.net/khalaq_atia/${n}.mp3`,
  barbari:   n => `https://server11.mp3quran.net/frg/${n}.mp3`,
  salem:     n => `https://server11.mp3quran.net/flstn/${n}.mp3`,
  siofi:     n => `https://server11.mp3quran.net/rsd_s/${n}.mp3`,

  // ── TAJWEED / MUJAWWAD (مجوّد) ──────────────────────────────────────────
  minshawi:  n => `https://server8.mp3quran.net/minsh/${n}.mp3`,
  minshawi_m:n => `https://server8.mp3quran.net/Minshawy_Mujawwad/${n}.mp3`,
  banna:     n => `https://server6.mp3quran.net/bna/${n}.mp3`,
  imran:     n => `https://server11.mp3quran.net/moh_emran/${n}.mp3`,
}

// Fallback CDN (Islamic Network - often works as backup)
const FALLBACK = (n, path) =>
  `https://cdn.islamic.network/quran/audio-surah/128/${path}/${n}.mp3`

const FALLBACKS = {
  dosari:    n => FALLBACK(n, 'ar.YasserAl-Dosari'),
  minshawi:  n => FALLBACK(n, 'ar.Minshawi'),
  minshawi_m:n => FALLBACK(n, 'ar.Minshawi'),
}

export async function GET(request, { params }) {
  const n       = parseInt(params.surah)
  const reciter = new URL(request.url).searchParams.get('reciter') || 'dosari'
  if (!n || n < 1 || n > 114) return new Response('Invalid surah', { status: 400 })

  const pad3 = String(n).padStart(3, '0')
  const primaryFn  = RECITER_URLS[reciter] || RECITER_URLS.dosari
  const fallbackFn = FALLBACKS[reciter] || FALLBACKS.dosari
  const primaryUrl  = primaryFn(pad3)
  const fallbackUrl = fallbackFn ? fallbackFn(pad3) : null

  // Return 302 redirect — browser fetches from CDN directly (bypasses hotlink block)
  // Try primary first, fall back if we can detect it's wrong
  return Response.redirect(primaryUrl, 302)
}
