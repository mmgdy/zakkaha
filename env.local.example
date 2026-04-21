// /api/hadith — Returns the JSONP URL for client-side fetch
// dorar.net blocks server-side requests (403) but allows browser JSONP
// Client uses this to get the correct URL and calls dorar.net directly

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const q      = searchParams.get('q')      || ''
  const focus  = searchParams.get('focus')  || ''
  const nawawi = searchParams.get('nawawi') || ''
  const idx    = parseInt(searchParams.get('idx') || '0', 10)

  const FOCUS_KEYWORDS = {
    patience:    'الصبر',
    discipline:  'المداومة',
    gratitude:   'الشكر',
    anger:       'الغضب',
    mindfulness: 'الذكر',
  }

  const NAWAWI_TERMS = [
    'إنما الأعمال بالنيات','الإسلام على خمس','من كان يؤمن بالله',
    'لا يؤمن أحدكم حتى يحب','من أحدث في أمرنا','الحلال بين',
    'الدين النصيحة','ما نهيتكم عنه فاجتنبوه','دع ما يريبك',
    'من حسن إسلام المرء','لا ضرر ولا ضرار','لا تغضب',
    'اتق الله حيثما كنت','احفظ الله يحفظك','إن الله كتب الإحسان',
    'من رأى منكم منكرا','من صام رمضان','اتقوا الله وصلوا',
    'استفت قلبك','خذ لنفسك ما يصلحك',
  ]

  let keyword = q
  if (focus)  keyword = FOCUS_KEYWORDS[focus] || 'النية'
  if (nawawi === '1') keyword = NAWAWI_TERMS[idx % NAWAWI_TERMS.length]

  return Response.json({
    jsonpUrl: keyword
      ? `https://dorar.net/dorar_api.json?skey=${encodeURIComponent(keyword)}&callback=dorarCb`
      : null,
    keyword,
    nawawi: nawawi === '1' ? { idx, total: NAWAWI_TERMS.length, term: keyword } : null,
    dorarSearchUrl: `https://dorar.net/hadith/search?skey=${encodeURIComponent(keyword)}`,
  })
}
