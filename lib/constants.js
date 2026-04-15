export const FOCUS_AREAS = [
  { id:'patience',    label:'Patience',      arabic:'الصبر',       emoji:'🌊' },
  { id:'discipline',  label:'Discipline',    arabic:'الانضباط',    emoji:'⚡' },
  { id:'gratitude',   label:'Gratitude',     arabic:'الشكر',       emoji:'✨' },
  { id:'anger',       label:'Anger Control', arabic:'كظم الغيظ',  emoji:'🔥' },
  { id:'mindfulness', label:'Mindfulness',   arabic:'اليقظة',      emoji:'🌙' },
]

export const CHALLENGES_DATA = [
  { id:'fajr30',    name:'30 Days of Fajr',      nameAr:'٣٠ يوماً من الفجر',    days:30, emoji:'🌅', desc:'Wake for Fajr every day', descAr:'استيقظ لصلاة الفجر كل يوم', xp:500, verse:'إِنَّ قُرْآنَ الْفَجْرِ كَانَ مَشْهُودًا [١٧:٧٨]' },
  { id:'anger30',   name:'Anger-Free 30',         nameAr:'٣٠ يوماً بلا غضب',    days:30, emoji:'🧘', desc:'Zero anger incidents for 30 days', descAr:'لا غضب لمدة ٣٠ يوماً', xp:600, verse:'الشديد الذي يملك نفسه عند الغضب [البخاري]' },
  { id:'gratitude', name:'21 Days of Shukr',      nameAr:'٢١ يوماً من الشكر',   days:21, emoji:'📿', desc:'3 gratitudes every morning', descAr:'ثلاث شكريات كل صباح', xp:400, verse:'لَئِن شَكَرْتُمْ لَأَزِيدَنَّكُمْ [١٤:٧]' },
  { id:'quran40',   name:'40-Day Quran Pledge',   nameAr:'عهد القرآن ٤٠ يوماً',  days:40, emoji:'📖', desc:'At least one page daily', descAr:'صفحة واحدة على الأقل يومياً', xp:700, verse:'خيركم من تعلم القرآن وعلمه [البخاري]' },
  { id:'tongue14',  name:'Guard the Tongue',      nameAr:'حفظ اللسان ١٤ يوماً',  days:14, emoji:'🤫', desc:'No backbiting for 14 days', descAr:'لا غيبة لمدة ١٤ يوماً', xp:450, verse:'من كان يؤمن بالله فليقل خيراً أو ليصمت [البخاري]' },
  { id:'sadaqah21', name:'Daily Sadaqah',         nameAr:'الصدقة اليومية',       days:21, emoji:'🤲', desc:'Give in charity every day', descAr:'تصدق بشيء يومياً', xp:380, verse:'ما نقصت صدقة من مال [مسلم]' },
  { id:'adhkar30',  name:'Adhkar 30-Day Habit',   nameAr:'عادة الأذكار ٣٠ يوماً', days:30, emoji:'📿', desc:'Complete morning OR evening adhkar daily', descAr:'أذكار الصباح أو المساء يومياً', xp:550, verse:'أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ [١٣:٢٨]' },
]

export const BADGES_DATA = [
  { id:'first_step',  name:'First Step',     nameAr:'الخطوة الأولى',  emoji:'🌱', desc:'Began the journey', req:(u)=>u.totalCheckIns>=1 },
  { id:'week_one',    name:'Week Warrior',   nameAr:'محارب الأسبوع',  emoji:'⚔️',  desc:'7-day streak',      req:(u)=>u.streak>=7 },
  { id:'steadfast',   name:'Al-Mustaqim',    nameAr:'المستقيم',       emoji:'🏆', desc:'30-day streak',     req:(u)=>u.streak>=30 },
  { id:'reflector',   name:'The Reflector',  nameAr:'المتأمل',        emoji:'📜', desc:'10 journal entries', req:(u,l,j)=>j.length>=10 },
  { id:'seeker',      name:'Mentor Seeker',  nameAr:'طالب النصيحة',  emoji:'🔮', desc:'5 mentor convos',   req:(u,l,j,m)=>m>=5 },
  { id:'challenger',  name:'The Challenger', nameAr:'المتحدي',        emoji:'🎯', desc:'First challenge',   req:(u,l,j,m,c)=>c.length>=1 },
  { id:'hafidh',      name:'Hafidh Journey', nameAr:'رحلة الحافظ',   emoji:'📖', desc:'Started khatma',    req:(u,l,j,m,c,k)=>k?.startDate!=null },
  { id:'adhkar_hero', name:'Adhkar Hero',    nameAr:'بطل الأذكار',   emoji:'📿', desc:'Complete 7 adhkar sessions', req:(u)=>(u.adhkarSessions||0)>=7 },
  { id:'consistent',  name:'Al-Muhsin',      nameAr:'المحسن',         emoji:'💎', desc:'500 XP earned',     req:(u)=>u.xp>=500 },
]

export const JOURNAL_PROMPTS = {
  en: [
    "What's one moment today where you showed the character you aspire to have?",
    "What reaction do you wish you could change? What would your best self have done?",
    "Name three very specific things you're grateful for right now.",
    "What struggle today revealed something true about who you still need to become?",
    "If your best self wrote you a letter tonight, what would it say?",
    "What habit is quietly pulling you away from who you want to be?",
    "Describe a moment today where you felt close to Allah.",
    "What did you do today that the person you were 3 months ago couldn't have done?",
    "Who needs your forgiveness — including yourself?",
    "How will you be different tomorrow because of what happened today?",
  ],
  ar: [
    "ما اللحظة التي أظهرت فيها اليوم الأخلاق التي تطمح إليها؟",
    "ما ردة الفعل التي تتمنى تغييرها؟ ماذا كان سيفعل نسختك الأفضل؟",
    "اذكر ثلاثة أشياء محددة جداً تشكر عليها الآن.",
    "ما الصراع الذي كشف لك اليوم حقيقة من تحتاج أن تصبح؟",
    "لو كتبت نسختك الأفضل لك رسالة الليلة، ماذا ستقول؟",
    "ما العادة التي تبتعد بك بهدوء عمن تريد أن تكون؟",
    "صف لحظة شعرت فيها اليوم بالقرب من الله.",
    "ما الذي فعلته اليوم لم تكن قادراً على فعله قبل ثلاثة أشهر؟",
    "من يحتاج إلى مغفرتك — بما في ذلك نفسك؟",
    "كيف ستكون مختلفاً غداً بسبب ما حدث اليوم؟",
  ]
}

export const getLevelInfo = (xp) => {
  if (xp < 200)  return { name:'Al-Mubtadi',  arabic:'المبتدئ',  level:1, next:200,  color:'#6b9e7a' }
  if (xp < 600)  return { name:'Al-Mujahid',  arabic:'المجاهد',  level:2, next:600,  color:'#c9952a' }
  if (xp < 1500) return { name:'Al-Mustaqim', arabic:'المستقيم', level:3, next:1500, color:'#2d9b6f' }
  if (xp < 3000) return { name:'Al-Muhsin',   arabic:'المحسن',   level:4, next:3000, color:'#7b5ea7' }
  return               { name:'Al-Wali',      arabic:'الولي',    level:5, next:9999, color:'#d4a843' }
}

export const todayStr     = () => new Date().toISOString().split('T')[0]
export const yesterdayStr = () => new Date(Date.now()-86400000).toISOString().split('T')[0]
export const fmtDate      = (d,lang='en') => new Date(d).toLocaleDateString(lang==='ar'?'ar-SA':'en',{month:'short',day:'numeric'})
export const SITE_URL     = process.env.NEXT_PUBLIC_SITE_URL || 'https://zakkaha.vercel.app'
