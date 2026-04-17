// /api/hadith — Server-side proxy for Dorar.net Hadith API
// https://dorar.net/dorar_api.json?skey=KEYWORD
// Modes: search (q=), daily (focus=), verify (verify=), nawawi

// Focus area → Arabic search keywords for relevant hadiths
const FOCUS_KEYWORDS = {
  patience:    'الصبر',
  discipline:  'المداومة',
  gratitude:   'الشكر',
  anger:       'كظم الغيظ',
  mindfulness: 'التفكر',
}

// Nawawi 40 — key terms to fetch one by one (pre-curated)
const NAWAWI_TERMS = [
  'إنما الأعمال بالنيات', 'الإسلام أن تشهد', 'من كان يؤمن بالله واليوم الآخر',
  'خلق الناس من آدم', 'من أحدث في أمرنا', 'الحلال بين والحرام بين',
  'الدين النصيحة', 'أمرت أن أقاتل الناس', 'ما نهيتكم عنه فاجتنبوه',
  'كل مسلم على مسلم حرام', 'دع ما يريبك', 'من حسن إسلام المرء',
  'لا يؤمن أحدكم حتى يحب لأخيه', 'لا يحل دم امرئ مسلم',
  'من كان يؤمن بالله فليقل خيرا', 'لا تغضب',
  'إن الله كتب الإحسان', 'اتق الله حيثما كنت',
  'احفظ الله يحفظك', 'استفت قلبك',
]

async function fetchDorar(keyword, limit = 3) {
  const url = `https://dorar.net/dorar_api.json?skey=${encodeURIComponent(keyword)}`
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Zakkaha/2.0' },
    signal: AbortSignal.timeout(7000),
  })
  if (!res.ok) throw new Error(`Dorar ${res.status}`)
  const data = await res.json()
  return (data.ahadith || []).slice(0, limit).map(h => ({
    id:       h.id       || '',
    text:     (h.th || h.matn || '').replace(/<[^>]+>/g, '').trim(),
    narrator: h.rawi     || '',
    grade:    h.shor     || '',
    source:   h.referance || h.takhrij || '',
    dorarUrl: `https://dorar.net/hadith/search?skey=${encodeURIComponent(keyword)}`,
  })).filter(h => h.text)
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const q       = searchParams.get('q')       || ''
  const focus   = searchParams.get('focus')   || ''
  const verify  = searchParams.get('verify')  || ''
  const nawawi  = searchParams.get('nawawi')  || ''

  try {
    // ── NAWAWI 40 mode ──────────────────────────────────────────────────────
    if (nawawi === '1') {
      const idx   = parseInt(searchParams.get('idx') || '0', 10)
      const term  = NAWAWI_TERMS[idx % NAWAWI_TERMS.length]
      const ahadith = await fetchDorar(term, 1)
      return Response.json({ ahadith, term, idx, total: NAWAWI_TERMS.length }, {
        headers: { 'Cache-Control': 'public, max-age=86400' }
      })
    }

    // ── VERIFY mode — check authenticity of a pasted hadith ─────────────────
    if (verify) {
      // Use first 6 words as search key for best match
      const keywords = verify.trim().split(/\s+/).slice(0, 6).join(' ')
      const ahadith  = await fetchDorar(keywords, 5)
      return Response.json({ ahadith, query: keywords }, {
        headers: { 'Cache-Control': 'public, max-age=3600' }
      })
    }

    // ── DAILY / FOCUS mode ───────────────────────────────────────────────────
    if (focus) {
      const keyword  = FOCUS_KEYWORDS[focus] || 'النية'
      const ahadith  = await fetchDorar(keyword, 3)
      // Pick one based on day of week for variety
      const pick     = ahadith.length ? [ahadith[new Date().getDay() % ahadith.length]] : []
      return Response.json({ ahadith: pick, keyword }, {
        headers: { 'Cache-Control': 'public, max-age=43200' }
      })
    }

    // ── SEARCH mode ──────────────────────────────────────────────────────────
    if (!q.trim()) return Response.json({ ahadith: [] })
    const ahadith = await fetchDorar(q, 5)
    return Response.json({ ahadith }, {
      headers: { 'Cache-Control': 'public, max-age=3600' }
    })

  } catch (e) {
    console.error('[Dorar API]', e.message)
    return Response.json({ ahadith: [], error: e.message }, { status: 200 })
  }
}

