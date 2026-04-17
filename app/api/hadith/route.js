// /api/hadith — Server-side proxy for Dorar.net Hadith API
// Docs: https://dorar.net/article/389
// Endpoint: https://dorar.net/dorar_api.json?skey=KEYWORD
// Returns: { ahadith: [{ id, rawi, matn, takhrij, shor, referance, ... }] }

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q') || ''
    if (!q.trim()) return Response.json({ ahadith: [] })

    const url = `https://dorar.net/dorar_api.json?skey=${encodeURIComponent(q)}`
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Zakkaha/2.0 Islamic App',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Dorar API ${res.status}`)
    const data = await res.json()

    // Normalize and limit to 5 results
    const ahadith = (data.ahadith || []).slice(0, 5).map(h => ({
      id:        h.id   || '',
      text:      h.th   || h.matn || '',       // hadith text (Arabic)
      narrator:  h.rawi || '',                  // الراوي
      grade:     h.shor || '',                  // درجة الحديث
      source:    h.referance || h.takhrij || '', // المصدر
      link:      h.id ? `https://dorar.net/hadith/search?skey=${encodeURIComponent(q)}` : '',
    }))

    return Response.json({ ahadith }, {
      headers: { 'Cache-Control': 'public, max-age=3600' }
    })
  } catch (e) {
    console.error('[Dorar API]', e.message)
    return Response.json({ ahadith: [], error: e.message }, { status: 200 })
  }
}
