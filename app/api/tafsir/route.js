// /api/tafsir — Server-side proxy for alquran.cloud tafsir API
// Fetches per-ayah tafsir/translation server-side (bypasses CORS/hotlink blocks)

export const dynamic = 'force-dynamic'

// Supported editions
const EDITIONS = {
  'ar.jalalayn': 'تفسير الجلالين',
  'en.sahih':    'Saheeh International',
  'en.asad':     'Muhammad Asad',
  'ar.muyassar': 'الميسّر',
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const surah  = parseInt(searchParams.get('s') || '1')
  const ayah   = parseInt(searchParams.get('a') || '1')
  const edition = searchParams.get('ed') || 'en.sahih'

  if (!surah || surah < 1 || surah > 114)
    return Response.json({ error: 'Invalid surah' }, { status: 400 })
  if (!ayah || ayah < 1)
    return Response.json({ error: 'Invalid ayah' }, { status: 400 })
  if (!EDITIONS[edition])
    return Response.json({ error: 'Invalid edition' }, { status: 400 })

  try {
    const url = `https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/${edition}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Zakkaha/2.0)',
        'Accept':     'application/json',
        'Referer':    'https://alquran.cloud/',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) throw new Error(`alquran.cloud ${res.status}`)
    const data = await res.json()
    const text = data?.data?.text || ''

    return Response.json(
      { text, edition, surah, ayah },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' } }
    )
  } catch (e) {
    console.error('[Tafsir]', e.message)
    return Response.json({ text: '', error: e.message })
  }
}
