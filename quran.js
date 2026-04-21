// /api/quran/[surah] — Server-side proxy for Quran text
// Browser calls /api/quran/1 → server fetches alquran.cloud → no CORS

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const n = parseInt(params.surah)
  if (!n || n < 1 || n > 114) {
    return Response.json({ error: 'Invalid surah number' }, { status: 400 })
  }

  // Multiple fallback sources
  const sources = [
    `https://api.alquran.cloud/v1/surah/${n}/quran-uthmani`,
    `https://api.alquran.cloud/v1/surah/${n}`,
  ]

  for (const url of sources) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Zakkaha/2.0' },
        next: { revalidate: 604800 }, // cache 7 days
      })
      if (!res.ok) continue
      const data = await res.json()
      if (!data.data?.ayahs?.length) continue

      const ayahs = data.data.ayahs.map(a => ({
        n:    a.numberInSurah,
        text: a.text,
      }))

      return Response.json(
        { ok: true, surah: n, ayahs },
        { headers: {
          'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
          'Access-Control-Allow-Origin': '*',
        }}
      )
    } catch { continue }
  }

  return Response.json({ error: 'Failed to load Quran text' }, { status: 503 })
}
