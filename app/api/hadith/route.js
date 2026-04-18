// /api/hadith — Dorar.net Hadith API proxy
// Uses server-side fetch (works on Vercel — no CORS issues)

const FOCUS_KEYWORDS = {
  patience:    'الصبر',
  discipline:  'المداومة', 
  gratitude:   'الشكر',
  anger:       'الغضب',
  mindfulness: 'الذكر',
}

const NAWAWI_TERMS = [
  'إنما الأعمال بالنيات', 'الإسلام على خمس', 'من كان يؤمن بالله',
  'لا يؤمن أحدكم حتى يحب', 'من أحدث في أمرنا', 'الحلال بين',
  'الدين النصيحة', 'ما نهيتكم عنه فاجتنبوه', 'دع ما يريبك',
  'من حسن إسلام المرء', 'لا ضرر ولا ضرار', 'لا تغضب',
  'اتق الله حيثما كنت', 'احفظ الله يحفظك', 'إن الله كتب الإحسان',
  'من رأى منكم منكرا', 'من صام رمضان', 'اتقوا الله وصلوا',
  'استفت قلبك', 'خذ لنفسك ما يصلحك',
]

async function fetchDorar(keyword, limit = 3) {
  const url = `https://dorar.net/dorar_api.json?skey=${encodeURIComponent(keyword)}`
  const res = await fetch(url, {
    headers: { 
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; Zakkaha/2.0)',
      'Referer': 'https://dorar.net',
    },
    next: { revalidate: 3600 }, // Next.js cache 1 hour
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Dorar ${res.status}`)
  const text = await res.text()
  // Handle JSONP callback wrapping if present
  const clean = text.replace(/^[^{]*([\s\S]*})[^}]*$/, '$1').trim()
  const data = JSON.parse(clean.startsWith('{') ? clean : '{}')
  return (data.ahadith || []).slice(0, limit).map(h => ({
    id:       h.id        || '',
    text:     (h.th || h.matn || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim(),
    narrator: h.rawi      || '',
    grade:    h.shor      || '',
    source:   h.referance || h.takhrij || '',
    dorarUrl: `https://dorar.net/hadith/search?skey=${encodeURIComponent(keyword)}`,
  })).filter(h => h.text.length > 10)
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const q      = searchParams.get('q')      || ''
  const focus  = searchParams.get('focus')  || ''
  const verify = searchParams.get('verify') || ''
  const nawawi = searchParams.get('nawawi') || ''

  try {
    if (nawawi === '1') {
      const idx     = parseInt(searchParams.get('idx') || '0', 10)
      const term    = NAWAWI_TERMS[idx % NAWAWI_TERMS.length]
      const ahadith = await fetchDorar(term, 1)
      return Response.json({ ahadith, term, idx, total: NAWAWI_TERMS.length }, {
        headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' }
      })
    }

    if (verify) {
      const keywords = verify.trim().split(/\s+/).slice(0, 5).join(' ')
      const ahadith  = await fetchDorar(keywords, 5)
      return Response.json({ ahadith, query: keywords }, {
        headers: { 'Cache-Control': 'public, s-maxage=3600' }
      })
    }

    if (focus) {
      const keyword = FOCUS_KEYWORDS[focus] || 'النية'
      const ahadith = await fetchDorar(keyword, 3)
      const pick    = ahadith.length ? [ahadith[new Date().getDay() % ahadith.length]] : []
      return Response.json({ ahadith: pick, keyword }, {
        headers: { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600' }
      })
    }

    if (!q.trim()) return Response.json({ ahadith: [] })
    const ahadith = await fetchDorar(q, 5)
    return Response.json({ ahadith }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600' }
    })

  } catch (e) {
    console.error('[Dorar]', e.message)
    return Response.json({ ahadith: [], error: e.message })
  }
}
