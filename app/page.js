'use client'
import { useState, useEffect, useRef } from 'react'
import { t } from '../lib/i18n'
import { FOCUS_AREAS, CHALLENGES_DATA, BADGES_DATA, JOURNAL_PROMPTS, getLevelInfo, todayStr, yesterdayStr, fmtDate, SITE_URL } from '../lib/constants'
import { ADHKAR_CATEGORIES, ADHKAR, DAILY_VERSES } from '../lib/adhkar'
import { JUZZ, KHATMA_GOALS } from '../lib/quran'
import { SURAHS, audioUrl, textUrl } from '../lib/surahs'

// ── STORAGE ──────────────────────────────────────────────────────────────────
const S = {
  get: k => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):null } catch{ return null } },
  set: (k,v) => { try { localStorage.setItem(k,JSON.stringify(v)) } catch{} },
}

// ── ISLAMIC CALENDAR ENGINE ────────────────────────────────────────────────
const IslamicCal = {
  // Gregorian to Julian Day Number
  toJD: (y,m,d) => {
    if (m<=2){y--;m+=12}
    const A=Math.floor(y/100), B=2-A+Math.floor(A/4)
    return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+B-1524.5
  },
  // Julian Day to Islamic date
  jdToHijri: jd => {
    jd=Math.floor(jd)+0.5
    const z=jd-1948439.5
    const a=Math.floor((z-0.25)/10631)
    const b=z-0.25-10631*a
    const c=Math.floor((b+0.5166)/354.3671)
    const d=Math.floor(b+0.5166-354.3671*c)
    const j=Math.floor((d+0.5)/29.5)+1
    const day=Math.floor(d+0.5-29.5*Math.floor((d+0.5)/29.5))+1
    const month=j>12?j-12:j
    const year=30*a+(j>12?c+1:c)+(j>12?0:0)
    return { year, month, day }
  },
  // Get current Hijri date
  today: () => {
    const now=new Date()
    const jd=IslamicCal.toJD(now.getFullYear(),now.getMonth()+1,now.getDate())
    return IslamicCal.jdToHijri(jd)
  },
  // Days until next Ramadan (month 9)
  daysUntilRamadan: () => {
    const h=IslamicCal.today()
    let months
    if (h.month < 9) months=9-h.month
    else if (h.month===9) return 0
    else months=12-h.month+9
    return months*29+(29-h.day) // approximate
  },
  // Is today Monday (1) or Thursday (4)?
  isFastingDay: () => { const d=new Date().getDay(); return d===1||d===4 },
  // Day name
  dayName: (lang) => {
    const days=lang==='ar'
      ?['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']
      :['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    return days[new Date().getDay()]
  },
  HIJRI_MONTHS_AR: ['محرم','صفر','ربيع الأول','ربيع الثاني','جمادى الأولى','جمادى الثانية','رجب','شعبان','رمضان','شوال','ذو القعدة','ذو الحجة'],
  HIJRI_MONTHS_EN: ['Muharram','Safar','Rabi al-Awwal','Rabi al-Thani','Jumada al-Awwal','Jumada al-Thani','Rajab','Shaban','Ramadan','Shawwal','Dhu al-Qidah','Dhu al-Hijjah'],
}

// ── SERVICE WORKER + PWA ───────────────────────────────────────────────────
const PWA = {
  registerSW: async () => {
    if (typeof window==='undefined'||!('serviceWorker' in navigator)) return null
    try {
      const reg = await navigator.serviceWorker.register('/sw.js',{scope:'/'})
      return reg
    } catch(e) { console.warn('SW register failed',e); return null }
  },
  requestNotifications: async () => {
    if (typeof window==='undefined'||!('Notification' in window)) return 'unsupported'
    if (Notification.permission==='granted') return 'granted'
    if (Notification.permission==='denied') return 'denied'
    return await Notification.requestPermission()
  },
  // Prefetch all 114 surahs for offline use
  prefetchQuran: async (onProgress) => {
    const reg = await navigator.serviceWorker.ready
    if (!reg?.active) return
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type==='QURAN_PROGRESS' && onProgress) onProgress(e.data.done, e.data.total)
    }, { once: false })
    reg.active.postMessage({ type: 'PREFETCH_QURAN' })
  },
  // Schedule a local notification via service worker
  scheduleNotif: async (id, delayMs, title, body, tag, url) => {
    const reg = await navigator.serviceWorker.ready
    if (!reg?.active) return
    reg.active.postMessage({ type:'SCHEDULE_NOTIFICATION', notification:{id,delayMs,title,body,tag,url} })
  },
}

// ── NOTIFICATION SCHEDULER ────────────────────────────────────────────────
// Fetches AI-generated messages, then schedules via service worker

async function fetchNotifMsg(type, lang, userName, streak, extra='') {
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, lang, userName, streak, extra }),
    })
    const d = await res.json()
    return d.message || null
  } catch { return null }
}

// Prayer time offsets from midnight (hours) — user can adjust in settings
// These are approximate — a full app would use the user's location + sun calc
const PRAYER_TIMES = {
  fajr:    5.0,   // 5:00 AM
  dhuhr:   12.25, // 12:15 PM
  asr:     15.5,  // 3:30 PM
  maghrib: 18.0,  // 6:00 PM (approximate — varies by season)
  isha:    20.0,  // 8:00 PM
}

async function scheduleAllNotifications(lang, user) {
  if (typeof window === 'undefined') return
  if (Notification.permission !== 'granted') return

  const now   = new Date()
  const ar    = lang === 'ar'
  const name  = user?.name || (ar ? 'أخي' : 'friend')
  const streak = user?.streak || 0

  function msUntilHour(h, daysOffset = 0) {
    const t = new Date(now)
    t.setDate(t.getDate() + daysOffset)
    t.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0)
    let diff = t - now
    if (diff <= 0 && daysOffset === 0) { t.setDate(t.getDate() + 1); diff = t - now }
    return Math.max(diff, 1500)
  }

  const day = now.getDay() // 0=Sun,1=Mon...6=Sat

  // ── 5 DAILY PRAYERS ───────────────────────────────────────────────────
  const prayers = [
    { id: 'fajr',    type: 'fajr',    title: ar ? '🌅 وقت الفجر'    : '🌅 Fajr Time',    h: PRAYER_TIMES.fajr    },
    { id: 'dhuhr',   type: 'dhuhr',   title: ar ? '☀️ وقت الظهر'    : '☀️ Dhuhr Time',   h: PRAYER_TIMES.dhuhr   },
    { id: 'asr',     type: 'asr',     title: ar ? '🌤 وقت العصر'    : '🌤 Asr Time',     h: PRAYER_TIMES.asr     },
    { id: 'maghrib', type: 'maghrib', title: ar ? '🌅 وقت المغرب'   : '🌅 Maghrib Time', h: PRAYER_TIMES.maghrib },
    { id: 'isha',    type: 'isha',    title: ar ? '🌙 وقت العشاء'   : '🌙 Isha Time',    h: PRAYER_TIMES.isha    },
  ]

  for (const p of prayers) {
    const body = await fetchNotifMsg(p.type, lang, name, streak)
    if (body) PWA.scheduleNotif(p.id, msUntilHour(p.h), p.title, body, p.id, '/?tab=adhkar')
  }

  // ── MORNING ADHKAR ── 6:30 AM
  const adhkarM = await fetchNotifMsg('adhkar_m', lang, name, streak)
  if (adhkarM) PWA.scheduleNotif('adhkar_m', msUntilHour(6.5), ar ? '📿 أذكار الصباح' : '📿 Morning Adhkar', adhkarM, 'adhkar_m', '/?tab=adhkar')

  // ── EVENING ADHKAR ── 5:30 PM
  const adhkarE = await fetchNotifMsg('adhkar_e', lang, name, streak)
  if (adhkarE) PWA.scheduleNotif('adhkar_e', msUntilHour(17.5), ar ? '🌙 أذكار المساء' : '🌙 Evening Adhkar', adhkarE, 'adhkar_e', '/?tab=adhkar')

  // ── STREAK AT RISK ── 9 PM if not checked in yet
  if (!S.get('zk:checkin-' + now.toDateString())) {
    const streakMsg = await fetchNotifMsg('streak', lang, name, streak)
    if (streakMsg) PWA.scheduleNotif('streak', msUntilHour(21), ar ? '🔥 لا تكسر سلسلتك' : '🔥 Protect Your Streak', streakMsg, 'streak', '/?tab=home')
  }

  // ── MONDAY FAST REMINDER ── Sunday 8 PM
  if (day === 0) {
    const fastMsg = await fetchNotifMsg('fasting', lang, name, streak, ar ? 'الاثنين' : 'Monday')
    if (fastMsg) PWA.scheduleNotif('fast-mon', msUntilHour(20), ar ? '🤲 صيام الاثنين' : '🤲 Monday Fast Reminder', fastMsg, 'fast', '/?tab=home')
  }
  // ── THURSDAY FAST REMINDER ── Wednesday 8 PM
  if (day === 3) {
    const fastMsg = await fetchNotifMsg('fasting', lang, name, streak, ar ? 'الخميس' : 'Thursday')
    if (fastMsg) PWA.scheduleNotif('fast-thu', msUntilHour(20), ar ? '🤲 صيام الخميس' : '🤲 Thursday Fast Reminder', fastMsg, 'fast', '/?tab=home')
  }

  // ── JUMMAH ── Thursday 9 PM
  if (day === 4) {
    const jummahMsg = await fetchNotifMsg('jummah', lang, name, streak)
    if (jummahMsg) PWA.scheduleNotif('jummah', msUntilHour(21), ar ? '🕌 تذكير الجمعة' : '🕌 Jummah Tomorrow', jummahMsg, 'jummah', '/?tab=adhkar')
  }

  // ── RAMADAN ──
  const daysToRamadan = IslamicCal.daysUntilRamadan()
  if (daysToRamadan > 0 && daysToRamadan <= 30) {
    const extra = ar ? `رمضان بعد ${daysToRamadan} يوم` : `${daysToRamadan} days until Ramadan`
    const ramMsg = await fetchNotifMsg('ramadan', lang, name, streak, extra)
    if (ramMsg) PWA.scheduleNotif('ramadan', msUntilHour(7), ar ? '🌙 رمضان يقترب' : '🌙 Ramadan is Near', ramMsg, 'ramadan', '/?tab=challenges')
  }
  if (daysToRamadan === 0) {
    const ramMsg = await fetchNotifMsg('ramadan', lang, name, streak, ar ? 'بداية رمضان' : 'Ramadan begins today')
    if (ramMsg) PWA.scheduleNotif('ramadan-now', 2000, ar ? '🌙 رمضان كريم' : '🌙 Ramadan Mubarak', ramMsg, 'ramadan', '/?tab=challenges')
  }

  // ── DHUL HIJJAH ──
  const hijri = IslamicCal.today()
  if (hijri.month === 12 && hijri.day <= 10) {
    const extra = ar ? `اليوم ${hijri.day} من ذي الحجة` : `Day ${hijri.day} of Dhul Hijjah`
    const dhMsg = await fetchNotifMsg('general', lang, name, streak)
    if (dhMsg) PWA.scheduleNotif('dhulhijjah', 2000, ar ? '🕋 أيام ذي الحجة' : '🕋 Blessed Dhul Hijjah', dhMsg, 'dhulhijjah', '/?tab=adhkar')
  }

  S.set('zk:notif-scheduled', new Date().toDateString())
}

// ── ICONS ─────────────────────────────────────────────────────────────────────
const Ic = ({d,s=22,fill='none',sw=1.75}) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d}/>
  </svg>
)
const IcHome  = ({s=22}) => <Ic s={s} d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10"/>
const IcBook  = ({s=22}) => <Ic s={s} d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/>
const IcStar  = ({s=22}) => <Ic s={s} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor" sw={0}/>
const IcZap   = ({s=22}) => <Ic s={s} d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
const IcMsg   = ({s=22}) => <Ic s={s} d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
const IcUser  = ({s=22}) => <Ic s={s} d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>
const IcSend  = ({s=18}) => <Ic s={s} d="M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z"/>
const IcCheck = ({s=20}) => <Ic s={s} d="M20 6L9 17l-5-5"/>
const IcChev  = ({s=16,left}) => <Ic s={s} d={left?"M15 18l-6-6 6-6":"M9 18l6-6-6-6"}/>
const IcGlobe = ({s=18}) => <Ic s={s} d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
const IcHeart = ({s=18}) => <Ic s={s} d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="currentColor" sw={0}/>
const IcShare = ({s=18}) => <Ic s={s} d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13"/>
const IcCopy  = ({s=16}) => <Ic s={s} d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 2h6v4H9z"/>
const IcArrow = ({s=20,left}) => <Ic s={s} d={left?"M19 12H5 M12 19l-7-7 7-7":"M5 12h14 M12 5l7 7-7 7"}/>
const IcReset = ({s=16}) => <Ic s={s} d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5"/>

// ── DECORATIVE ────────────────────────────────────────────────────────────────
const GeomBg = () => (
  <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',opacity:.055}} viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice">
    <defs>
      <pattern id="gp" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M20 0L40 20L20 40L0 20Z" fill="none" stroke="#d4a843" strokeWidth=".5"/>
        <circle cx="20" cy="20" r="2.5" fill="none" stroke="#d4a843" strokeWidth=".5"/>
        <line x1="0" y1="0" x2="40" y2="40" stroke="#d4a843" strokeWidth=".3"/>
        <line x1="40" y1="0" x2="0" y2="40" stroke="#d4a843" strokeWidth=".3"/>
      </pattern>
    </defs>
    <rect width="400" height="200" fill="url(#gp)"/>
  </svg>
)

// ── TOAST ─────────────────────────────────────────────────────────────────────
const Toast = ({msg}) => (
  <div style={{position:'fixed',top:20,left:'50%',transform:'translateX(-50%)',background:'#0f1f12',border:'1px solid #d4a843',borderRadius:8,padding:'11px 22px',color:'#f0e8d8',fontSize:14,zIndex:9999,whiteSpace:'nowrap',boxShadow:'0 8px 32px rgba(0,0,0,.6)',fontFamily:'system-ui',animation:'toastIn .35s ease forwards'}}>
    {msg}
  </div>
)

// ── OVERLAY ───────────────────────────────────────────────────────────────────
const Overlay = ({children,onClose}) => (
  <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.88)',zIndex:900,display:'flex',alignItems:'flex-end',padding:'0 12px'}} onClick={onClose}>
    <div style={{background:'#0c1a0f',border:'1px solid #1a2e1f',borderRadius:'16px 16px 0 0',padding:'26px 22px 38px',width:'100%',maxWidth:520,margin:'0 auto',maxHeight:'92vh',overflowY:'auto'}}
      onClick={e=>e.stopPropagation()}>
      {children}
    </div>
  </div>
)

// ── PROGRESS BAR ──────────────────────────────────────────────────────────────
const ProgBar = ({pct,color='#d4a843',h=6}) => (
  <div style={{background:'#1a2e1f',borderRadius:4,height:h,overflow:'hidden'}}>
    <div style={{height:'100%',borderRadius:4,background:color,width:`${Math.min(pct,100)}%`,transition:'width .5s ease'}}/>
  </div>
)

// ── CARD ──────────────────────────────────────────────────────────────────────
const Card = ({children,style={}}) => (
  <div style={{background:'#0c1a0f',border:'1px solid #1a2e1f',borderRadius:12,padding:18,...style}}>
    {children}
  </div>
)

// ── ONBOARDING ────────────────────────────────────────────────────────────────
function Onboarding({lang,setLang,onComplete}) {
  const [step,setStep] = useState(0)
  const [name,setName] = useState('')
  const [focus,setFocus] = useState(null)
  const rtl = lang==='ar'
  const canGo = step===0||(step===1&&name.trim().length>1)||(step===2&&!!focus)

  return (
    <div className="zk-shell" dir={rtl?'rtl':'ltr'} style={{alignItems:'center',justifyContent:'center',padding:'20px 16px'}}>
      <style>{`
        .ob-inp{background:rgba(255,255,255,.05);border:1px solid #1a2e1f;color:#f0e8d8;padding:14px 18px;border-radius:6px;font-size:17px;width:100%;font-family:Georgia,serif;outline:none;transition:border .2s}
        .ob-inp:focus{border-color:#d4a843}
        .ob-inp::placeholder{color:#3a5045}
        .ob-fb{border:1px solid #1a2e1f;background:#0c1a0f;border-radius:8px;padding:14px;cursor:pointer;transition:all .2s;width:100%;text-align:${rtl?'right':'left'}}
        .ob-fb:hover{border-color:rgba(212,168,67,.5)}
        .ob-sel{border-color:#d4a843!important;background:rgba(212,168,67,.08)!important}
      `}</style>

      <div style={{width:'100%',maxWidth:460,background:'#060e09',borderRadius:16,border:'1px solid #1a2e1f',overflow:'hidden',boxShadow:'0 32px 80px rgba(0,0,0,.6)'}}>
        {/* Lang toggle */}
        <div style={{padding:'16px 20px 0',display:'flex',justifyContent:rtl?'flex-start':'flex-end'}}>
          <button onClick={()=>setLang(lang==='en'?'ar':'en')} style={{background:'rgba(212,168,67,.1)',border:'1px solid rgba(212,168,67,.25)',color:'#d4a843',borderRadius:20,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'system-ui',display:'flex',alignItems:'center',gap:5}}>
            <IcGlobe s={12}/> {t(lang,'lang_btn')}
          </button>
        </div>

        {/* Header */}
        <div style={{padding:'28px 28px 16px',textAlign:'center',position:'relative',overflow:'hidden'}}>
          <GeomBg/>
          <div style={{fontSize:44,color:'#d4a843',letterSpacing:2,position:'relative'}}>زكّاها</div>
          <div style={{fontSize:10,letterSpacing:5,color:'#3a5045',fontFamily:'system-ui',position:'relative'}}>{t(lang,'tagline').toUpperCase()}</div>
        </div>

        {/* Steps */}
        <div style={{display:'flex',justifyContent:'center',gap:8,padding:'6px 0'}}>
          {[0,1,2].map(i=><div key={i} style={{width:i===step?22:7,height:7,borderRadius:4,background:i<=step?'#d4a843':'#1a2e1f',transition:'all .3s'}}/>)}
        </div>

        {/* Content */}
        <div style={{padding:'22px 28px',minHeight:280}} key={step} className="zu">
          {step===0&&(
            <>
              <div style={{color:'#d4a843',fontSize:11,letterSpacing:3,fontFamily:'system-ui',marginBottom:10}}>{t(lang,'ob_badge')}</div>
              <h2 style={{color:'#f0e8d8',fontSize:24,lineHeight:1.35,marginBottom:14}}>{t(lang,'ob_title')}</h2>
              <p style={{color:'#7a9082',fontSize:13,lineHeight:1.75,fontFamily:'system-ui',marginBottom:24}}>
                {lang==='en'?'Zakkaha is your daily companion — adhkar, Quran khatma, challenges, and AI mentor. Built on ':<>زكّاها رفيقك اليومي — أذكار، ختمة قرآن، تحديات، ومرشد ذكي. مبني على </>}
                <em style={{color:'#d4a843'}}>{lang==='en'?'tazkiyah al-nafs':'تزكية النفس'}</em>
                {lang==='en'?', the purification of the soul.':'، تطهير الروح.'}
              </p>
              <div style={{background:'rgba(212,168,67,.07)',border:'1px solid rgba(212,168,67,.18)',borderRadius:8,padding:'14px 16px'}}>
                <div style={{color:'#d4a843',fontSize:18,fontStyle:'italic',marginBottom:6}}>وَقَدْ أَفْلَحَ مَن زَكَّاهَا</div>
                <div style={{color:'#7a9082',fontSize:12,fontFamily:'system-ui',lineHeight:1.5}}>
                  {lang==='en'?'"And he has succeeded who purifies it." — Ash-Shams 91:9':'"وقد أفلح من زكّاها" — سورة الشمس ٩١:٩'}
                </div>
              </div>
            </>
          )}
          {step===1&&(
            <>
              <div style={{color:'#d4a843',fontSize:11,letterSpacing:3,fontFamily:'system-ui',marginBottom:10}}>{t(lang,'ob_step1')}</div>
              <h2 style={{color:'#f0e8d8',fontSize:24,marginBottom:8}}>{t(lang,'ob_name_title')}</h2>
              <p style={{color:'#7a9082',fontSize:13,fontFamily:'system-ui',marginBottom:22}}>{t(lang,'ob_name_sub')}</p>
              <input className="ob-inp" value={name} onChange={e=>setName(e.target.value)} placeholder={t(lang,'ob_name_ph')} autoFocus
                onKeyDown={e=>e.key==='Enter'&&name.trim().length>1&&setStep(2)} dir={rtl?'rtl':'ltr'}/>
            </>
          )}
          {step===2&&(
            <>
              <div style={{color:'#d4a843',fontSize:11,letterSpacing:3,fontFamily:'system-ui',marginBottom:10}}>{t(lang,'ob_step2')}</div>
              <h2 style={{color:'#f0e8d8',fontSize:24,marginBottom:8}}>{t(lang,'ob_focus_title')}</h2>
              <p style={{color:'#7a9082',fontSize:13,fontFamily:'system-ui',marginBottom:16}}>{t(lang,'ob_focus_sub')}</p>
              <div style={{display:'flex',flexDirection:'column',gap:9}}>
                {FOCUS_AREAS.map(f=>(
                  <button key={f.id} className={`ob-fb ${focus===f.id?'ob-sel':''}`} onClick={()=>setFocus(f.id)}>
                    <div style={{display:'flex',alignItems:'center',gap:12}}>
                      <span style={{fontSize:22}}>{f.emoji}</span>
                      <div>
                        <div style={{color:'#f0e8d8',fontSize:14,marginBottom:1}}>{f.label}</div>
                        <div style={{color:'#7a9082',fontSize:12}}>{f.arabic}</div>
                      </div>
                      {focus===f.id&&<span style={{marginLeft:'auto',color:'#d4a843',fontSize:16}}>✓</span>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{padding:'0 28px 32px'}}>
          <button onClick={()=>step<2?setStep(s=>s+1):onComplete(name.trim(),focus)}
            disabled={!canGo}
            style={{width:'100%',padding:17,background:canGo?'#d4a843':'#1a2e1f',color:canGo?'#060e09':'#3a5045',border:'none',borderRadius:8,fontSize:15,fontFamily:'Georgia,serif',cursor:canGo?'pointer':'not-allowed',transition:'all .3s',fontWeight:600}}>
            {step===0?t(lang,'ob_btn0'):step===1?t(lang,'ob_btn1'):t(lang,'ob_btn2')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── HOME TAB ──────────────────────────────────────────────────────────────────
function HomeTab({user,lang,logs,journals,challenges,badges,checkInDone,doCheckIn,setTab,setJournalView,setJournalPrompt,khatma,hijriToday}) {
  const lv=getLevelInfo(user.xp), rtl=lang==='ar'
  const xpPct=Math.min((user.xp/lv.next)*100,100)
  const fa=FOCUS_AREAS.find(f=>f.id===user.focusArea)||FOCUS_AREAS[0]
  const verse=DAILY_VERSES[new Date().getDay()%DAILY_VERSES.length]

  return (
    <div dir={rtl?'rtl':'ltr'}>
      <div className="zk-banner" style={{background:'linear-gradient(180deg,#0f1f12,#060e09)',padding:'52px 20px 20px',position:'relative',overflow:'hidden'}}>
        <GeomBg/>
        <div style={{position:'relative'}}>
          <div style={{color:'#7a9082',fontSize:10,letterSpacing:3,fontFamily:'system-ui',marginBottom:4}}>
            {new Date().toLocaleDateString(rtl?'ar-SA':'en',{weekday:'long',month:'long',day:'numeric'})}
            {hijriToday&&(
              <span style={{color:'rgba(212,168,67,.6)',marginRight:8,marginLeft:8}}>
                · {hijriToday.day} {rtl?IslamicCal.HIJRI_MONTHS_AR[hijriToday.month-1]:IslamicCal.HIJRI_MONTHS_EN[hijriToday.month-1]}
              </span>
            )}
          </div>
          <div style={{color:'#d4a843',fontSize:14,marginBottom:2}}>{rtl?`أهلاً، ${user.name}`:`Welcome back, ${user.name}`}</div>
          {IslamicCal.isFastingDay()&&(
            <div style={{display:'inline-flex',alignItems:'center',gap:6,background:'rgba(45,155,111,.1)',border:'1px solid rgba(45,155,111,.2)',borderRadius:20,padding:'4px 12px',marginTop:6}}>
              <span>🤲</span>
              <span style={{color:'#2d9b6f',fontSize:12,fontFamily:'system-ui'}}>{rtl?'اليوم يوم صيام سنة':'Sunnah fasting day today'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="zk-page" style={{paddingTop:14}}>
        {/* Streak + XP card */}
        <Card style={{background:'linear-gradient(135deg,#0f1f12,#0a1a0c)',border:'1px solid rgba(212,168,67,.25)',marginBottom:12,marginTop:-18,position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',top:-24,right:-24,width:100,height:100,borderRadius:'50%',background:'rgba(212,168,67,.04)',border:'1px solid rgba(212,168,67,.06)'}}/>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{color:'#7a9082',fontSize:9,letterSpacing:3,fontFamily:'system-ui',marginBottom:4}}>{t(lang,'streak')}</div>
              <div style={{display:'flex',alignItems:'flex-end',gap:6}}>
                <span style={{fontSize:50,color:'#d4a843',lineHeight:1,fontFamily:'Georgia,serif'}}>{user.streak}</span>
                <span style={{color:'#7a9082',fontSize:13,fontFamily:'system-ui',marginBottom:6}}>{t(lang,'days')}</span>
              </div>
              <div style={{color:'#3a5045',fontSize:11,fontFamily:'system-ui',marginTop:2}}>{user.streak===0?t(lang,'begin_today'):t(lang,'keep_going')}</div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:36}}>🔥</div>
              <div style={{color:'#3a5045',fontSize:10,fontFamily:'system-ui',marginTop:3}}>{user.totalCheckIns} {t(lang,'days')}</div>
            </div>
          </div>
          <div style={{marginTop:12}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
              <div style={{color:'#d4a843',fontSize:10,fontFamily:'system-ui'}}>{lv.name} <span style={{color:'#3a5045'}}>{lv.arabic}</span></div>
              <div style={{color:'#3a5045',fontSize:10,fontFamily:'system-ui'}}>{user.xp}/{lv.next} {t(lang,'xp')}</div>
            </div>
            <ProgBar pct={xpPct} color={`linear-gradient(90deg,${lv.color},#d4a843)`}/>
          </div>
        </Card>

        {/* Check-in */}
        <button onClick={doCheckIn} disabled={checkInDone} style={{
          width:'100%',marginBottom:11,padding:16,fontFamily:'Georgia,serif',fontWeight:600,fontSize:15,
          background:checkInDone?'rgba(45,155,111,.1)':'#d4a843',color:checkInDone?'#2d9b6f':'#060e09',
          border:checkInDone?'1px solid rgba(45,155,111,.25)':'none',borderRadius:10,
          cursor:checkInDone?'default':'pointer',transition:'all .3s',
          display:'flex',alignItems:'center',justifyContent:'center',gap:10,
        }}>
          {checkInDone?<><IcCheck s={18}/>{t(lang,'checkin_done')}</>:t(lang,'checkin_btn')}
        </button>

        {/* Focus + Adhkar quick access */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:11}} className="g2">
          <Card style={{display:'flex',alignItems:'center',gap:10,padding:14,cursor:'pointer'}} onClick={()=>setTab('adhkar')}>
            <div style={{fontSize:26}}>{fa.emoji}</div>
            <div>
              <div style={{color:'#7a9082',fontSize:9,letterSpacing:2,fontFamily:'system-ui',marginBottom:2}}>{t(lang,'your_focus')}</div>
              <div style={{color:'#f0e8d8',fontSize:13}}>{fa.label}</div>
              <div style={{color:'#d4a843',fontSize:11,fontStyle:'italic'}}>{fa.arabic}</div>
            </div>
          </Card>
          <Card style={{display:'flex',alignItems:'center',gap:10,padding:14,cursor:'pointer',borderColor:'rgba(212,168,67,.2)'}} onClick={()=>setTab('adhkar')}>
            <div style={{fontSize:26}}>📿</div>
            <div>
              <div style={{color:'#7a9082',fontSize:9,letterSpacing:2,fontFamily:'system-ui',marginBottom:2}}>{rtl?'الأذكار':'ADHKAR'}</div>
              <div style={{color:'#f0e8d8',fontSize:13}}>{rtl?'أذكار اليوم':'Daily Dhikr'}</div>
              <div style={{color:'#d4a843',fontSize:11}}>{rtl?'صباحاً ومساءً':'Morning & Evening'}</div>
            </div>
          </Card>
        </div>

        {/* Khatma mini progress */}
        {khatma?.startDate&&(
          <Card style={{marginBottom:11,cursor:'pointer',borderColor:'rgba(45,155,111,.2)'}} onClick={()=>setTab('quran')}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
              <span style={{fontSize:24}}>📖</span>
              <div style={{flex:1}}>
                <div style={{color:'#7a9082',fontSize:9,letterSpacing:2,fontFamily:'system-ui',marginBottom:2}}>{rtl?'ختمة القرآن':'QURAN KHATMA'}</div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{color:'#f0e8d8',fontSize:13}}>{(khatma.completedSurahs||[]).length}/114 {rtl?'سورة':'surahs'}</span>
                  <span style={{color:'#2d9b6f',fontSize:12,fontFamily:'system-ui'}}>{Math.round(((khatma.completedSurahs||[]).length/114)*100)}%</span>
                </div>
              </div>
            </div>
            <ProgBar pct={((khatma.completedSurahs||[]).length/114)*100} color="#2d9b6f"/>
          </Card>
        )}

        {/* Active challenges mini */}
        {challenges.length>0&&(
          <div style={{marginBottom:11}}>
            <div style={{color:'#7a9082',fontSize:9,letterSpacing:3,fontFamily:'system-ui',marginBottom:8}}>{t(lang,'active_ch')}</div>
            {challenges.slice(0,2).map(c=>{
              const ch=CHALLENGES_DATA.find(x=>x.id===c.id); if(!ch) return null
              const pct=Math.min((c.daysDone/ch.days)*100,100), done=c.daysDone>=ch.days
              return (
                <Card key={c.id} style={{marginBottom:8,borderColor:done?'rgba(45,155,111,.25)':'#1a2e1f'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                    <span style={{fontSize:20}}>{ch.emoji}</span>
                    <div style={{flex:1}}>
                      <div style={{color:done?'#2d9b6f':'#f0e8d8',fontSize:13,marginBottom:1}}>{lang==='ar'?ch.nameAr:ch.name}</div>
                      <div style={{color:'#3a5045',fontSize:11,fontFamily:'system-ui'}}>{done?t(lang,'done_badge'):t(lang,'day_of',{d:c.daysDone,t:ch.days})}</div>
                    </div>
                    {done&&<IcCheck s={16} />}
                  </div>
                  <ProgBar pct={pct} color={done?'#2d9b6f':`linear-gradient(90deg,#2d9b6f,#d4a843)`}/>
                </Card>
              )
            })}
          </div>
        )}

        {/* Stats */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:9,marginBottom:11}} className="g3">
          {[
            {l:t(lang,'checkins'),v:user.totalCheckIns,e:'📅'},
            {l:t(lang,'journals'),v:journals.length,e:'📜'},
            {l:t(lang,'badges_s'),v:badges.length,e:'🏅'},
          ].map(s=>(
            <Card key={s.l} style={{textAlign:'center',padding:13}}>
              <div style={{fontSize:18,marginBottom:4}}>{s.e}</div>
              <div style={{color:'#d4a843',fontSize:18,fontFamily:'Georgia,serif'}}>{s.v}</div>
              <div style={{color:'#7a9082',fontSize:10,fontFamily:'system-ui'}}>{s.l}</div>
            </Card>
          ))}
        </div>

        {/* Daily verse */}
        <Card style={{textAlign:'center',border:'1px solid rgba(212,168,67,.12)',marginBottom:11}}>
          <div style={{color:'#7a9082',fontSize:9,letterSpacing:3,fontFamily:'system-ui',marginBottom:10}}>{t(lang,'daily_ref')}</div>
          <div style={{color:'#d4a843',fontSize:18,fontStyle:'italic',lineHeight:1.7,marginBottom:8}}>{verse.arabic}</div>
          <div style={{color:'#7a9082',fontSize:12,fontFamily:'system-ui',lineHeight:1.5}}>{verse.en} — {verse.ref}</div>
        </Card>

        {/* Action buttons */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}} className="g2">
          <button onClick={()=>{const p=JOURNAL_PROMPTS[lang]||JOURNAL_PROMPTS.en;setJournalPrompt(p[Math.floor(Math.random()*p.length)]);setJournalView('write');setTab('journal')}}
            style={{background:'rgba(212,168,67,.08)',border:'1px solid rgba(212,168,67,.18)',color:'#d4a843',borderRadius:8,padding:14,fontSize:14,fontFamily:'Georgia,serif',cursor:'pointer'}}>
            {t(lang,'write_j')}
          </button>
          <button onClick={()=>setTab('challenges')}
            style={{background:'rgba(45,155,111,.09)',border:'1px solid rgba(45,155,111,.22)',color:'#2d9b6f',borderRadius:8,padding:14,fontSize:14,fontFamily:'Georgia,serif',cursor:'pointer'}}>
            {t(lang,'challenges_btn')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── QURAN TAB — Full Reader + Surah Khatma ──────────────────────────────────
function QuranTab({ lang, khatma, setKhatma, setUser, showNotif }) {
  const rtl = lang === 'ar'

  // ── view: 'list' | 'reader' | 'khatma' ──
  const [view,       setView]        = useState('list')
  const [surah,      setSurah]       = useState(null)
  const [ayahs,      setAyahs]       = useState([])
  const [loadText,   setLoadText]    = useState(false)
  const [textErr,    setTextErr]     = useState(false)
  const [search,     setSearch]      = useState('')
  const [lastRead,   setLastRead]    = useState(() => S.get('zk:lastread') || null)
  const [audioPos,   setAudioPos]    = useState(() => S.get('zk:audiopos') || null)
  const [showKhatmaPrompt, setShowKhatmaPrompt] = useState(false)

  // ── Audio ─────────────────────────────────────────────────────────────────
  const audioRef      = useRef(null)
  const seekOnLoadRef = useRef(null)  // seconds to seek once audio canplay fires
  const [playing,   setPlaying]      = useState(false)
  const [buffering, setBuffering]    = useState(false)
  const [audioErr,  setAudioErr]     = useState(false)
  const [progress,  setProgress]     = useState(0)
  const [duration,  setDuration]     = useState(0)

  // Khatma: completedSurahs is array of surah numbers (1–114)
  const completedSurahs = khatma?.completedSurahs || []
  const khatmaPct = Math.round((completedSurahs.length / 114) * 100)
  const isKhatmaComplete = completedSurahs.length >= 114

  // ── Persist last read ─────────────────────────────────────────────────────
  useEffect(() => { if (lastRead) S.set('zk:lastread', lastRead) }, [lastRead])

  // ── Load surah text ───────────────────────────────────────────────────────
  useEffect(() => {
    if (view !== 'reader' || !surah) return
    setLoadText(true); setTextErr(false); setAyahs([])
    // Fetch via our server proxy (avoids CORS)
    fetch(`/api/quran/${surah.n}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => {
        const list = d.ayahs || d.data?.ayahs || []
        if (!list.length) throw new Error('empty')
        setAyahs(list); setLoadText(false)
      })
      .catch(err => { console.error('[Quran text]', err); setTextErr(true); setLoadText(false) })
  }, [view, surah?.n])

  // ── Audio event wiring ────────────────────────────────────────────────────
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const handlers = {
      timeupdate:     () => setProgress(a.currentTime),
      durationchange: () => setDuration(a.duration || 0),
      ended:          () => {
        setPlaying(false); setProgress(0)
        // Surah finished — clear saved position
        S.set('zk:audiopos', null)
        setAudioPos(null)
      },
      playing:        () => { setPlaying(true);  setBuffering(false) },
      pause:          () => {
        setPlaying(false)
        // Save exact position so user can resume next session
        if (surah && a.currentTime > 3) {
          const pos = { n: surah.n, time: a.currentTime }
          S.set('zk:audiopos', pos)
          setAudioPos(pos)
        }
      },
      waiting:        () => setBuffering(true),
      canplay:        () => {
        setBuffering(false)
        // Restore saved position if one was queued for this surah
        if (seekOnLoadRef.current != null) {
          a.currentTime = seekOnLoadRef.current
          setProgress(seekOnLoadRef.current)
          seekOnLoadRef.current = null
        }
      },
      error:          () => {
        // Try backup URL on first error
        if (surah && !a.dataset.triedBackup) {
          a.dataset.triedBackup = '1'
          // Backup: retry same proxy (server will try next CDN automatically)
          // Proxy already handles retries server-side
          setAudioErr(true); setBuffering(false); setPlaying(false)
          a.load()
          if (playing) a.play().catch(() => setAudioErr(true))
        } else {
          setAudioErr(true); setBuffering(false); setPlaying(false)
        }
      },
    }
    Object.entries(handlers).forEach(([e, fn]) => a.addEventListener(e, fn))
    return () => Object.entries(handlers).forEach(([e, fn]) => a.removeEventListener(e, fn))
  }, [surah?.n, playing])

  // ── Stop audio on unmount ─────────────────────────────────────────────────
  useEffect(() => () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = '' }
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────────
  function openSurah(s) {
    const a = audioRef.current
    if (a) { a.pause(); a.src = '' }
    setPlaying(false); setBuffering(false); setAudioErr(false)
    setProgress(0); setDuration(0)
    // Queue a seek if there's a saved audio position for this surah
    const savedPos = S.get('zk:audiopos')
    if (savedPos && savedPos.n === s.n && savedPos.time > 3) {
      seekOnLoadRef.current = savedPos.time
    } else {
      seekOnLoadRef.current = null
    }
    setSurah(s); setView('reader')
    setLastRead({ n: s.n, ar: s.ar, en: s.en })
  }

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (playing) {
      a.pause()
    } else {
      if (!a.src || audioErr) {
        a.dataset.triedBackup = ''
        setAudioErr(false)
        a.src = `/api/audio/${surah.n}`
        a.load()
      }
      setBuffering(true)
      a.play().catch(() => { setAudioErr(true); setBuffering(false) })
    }
  }

  function seek(e) {
    const a = audioRef.current
    if (!a || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    a.currentTime = pct * duration
    setProgress(pct * duration)
  }

  function prevSurah() { if (surah?.n > 1)   openSurah(SURAHS[surah.n - 2]) }
  function nextSurah() { if (surah?.n < 114)  openSurah(SURAHS[surah.n]) }

  function markSurahRead(n) {
    if (completedSurahs.includes(n)) return
    const newList = [...completedSurahs, n]
    const complete = newList.length >= 114
    const updated = {
      ...(khatma || { startDate: todayStr() }),
      completedSurahs: newList,
      completedAt: complete ? todayStr() : null,
    }
    setKhatma(updated)
    setUser(u => ({ ...u, xp: u.xp + (complete ? 1000 : 20) }))
    if (complete) showNotif(rtl ? '🎉 أتممت الختمة! تقبل الله منك.' : '🎉 Khatma complete! May Allah accept it.')
    else showNotif(rtl ? `✓ ${SURAHS.find(s=>s.n===n)?.ar} — تمت` : `✓ ${SURAHS.find(s=>s.n===n)?.en} marked as read`)
  }

  function unmarkSurah(n) {
    if (!completedSurahs.includes(n)) return
    setKhatma(prev => ({
      ...prev,
      completedSurahs: completedSurahs.filter(x => x !== n),
      completedAt: null,
    }))
  }

  function startKhatma() {
    setKhatma({ startDate: todayStr(), completedSurahs: [], completedAt: null })
    setShowKhatmaPrompt(false)
    showNotif(rtl ? 'بدأت ختمتك 📖 بارك الله فيك' : 'Khatma started! 📖 May Allah bless your journey')
  }

  function resetKhatma() {
    setKhatma(null)
    showNotif(rtl ? 'تمت إعادة الختمة' : 'Khatma reset')
  }

  const fmtTime = s => {
    if (!s || isNaN(s)) return '0:00'
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }

  const filtered = SURAHS.filter(s => {
    const q = search.trim().toLowerCase()
    return !q || s.en.toLowerCase().includes(q) || s.ar.includes(search.trim()) || String(s.n) === q
  })

  // ══════════════════════════════════════════════════════════════════════════
  // ── READER VIEW ──────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (view === 'reader' && surah) {
    const isDone = completedSurahs.includes(surah.n)
    const progPct = duration ? (progress / duration) * 100 : 0

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 70px)' }} className="zk-mentor-h" dir="rtl">
        <audio ref={audioRef} preload="none" />

        {/* ── Top bar ── */}
        <div style={{ background: '#07120a', borderBottom: '1px solid #1a2e1f', padding: '50px 16px 12px', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
          <GeomBg />
          <div style={{ position: 'relative' }}>

            {/* Nav row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, direction: 'ltr' }}>
              <button onClick={() => { if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = '' }; setPlaying(false); setView('list') }}
                style={{ background: 'rgba(212,168,67,.1)', border: '1px solid rgba(212,168,67,.22)', color: '#d4a843', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'system-ui', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                ← {rtl ? 'القائمة' : 'List'}
              </button>

              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ color: '#f0e8d8', fontSize: 19, direction: 'rtl' }}>{surah.ar}</div>
                <div style={{ color: '#7a9082', fontSize: 11, fontFamily: 'system-ui' }}>
                  {surah.en} · {surah.ayahs} {rtl ? 'آية' : 'ayahs'} · {rtl ? (surah.type === 'Meccan' ? 'مكية' : 'مدنية') : surah.type} · {rtl ? `ج${surah.juz}` : `Juz ${surah.juz}`}
                </div>
              </div>

              {/* Prev / Next */}
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                <button onClick={prevSurah} disabled={surah.n <= 1}
                  style={{ background: surah.n <= 1 ? 'transparent' : 'rgba(255,255,255,.05)', border: '1px solid #1a2e1f', color: surah.n <= 1 ? '#3a5045' : '#7a9082', borderRadius: 7, padding: '7px 11px', fontSize: 14, cursor: surah.n <= 1 ? 'default' : 'pointer' }}>‹</button>
                <button onClick={nextSurah} disabled={surah.n >= 114}
                  style={{ background: surah.n >= 114 ? 'transparent' : 'rgba(255,255,255,.05)', border: '1px solid #1a2e1f', color: surah.n >= 114 ? '#3a5045' : '#7a9082', borderRadius: 7, padding: '7px 11px', fontSize: 14, cursor: surah.n >= 114 ? 'default' : 'pointer' }}>›</button>
              </div>
            </div>

            {/* ── Audio player ── */}
            <div style={{ background: 'rgba(212,168,67,.06)', border: '1px solid rgba(212,168,67,.15)', borderRadius: 10, padding: '11px 14px', direction: 'ltr' }}>
              {/* Sheikh label */}
              <div style={{ color: '#7a9082', fontSize: 10, letterSpacing: 2, fontFamily: 'system-ui', marginBottom: 8, textAlign: 'center' }}>
                🎙️ Sheikh Yasser Al-Dosari
                {buffering && !audioErr && <span style={{ color: '#d4a843', marginLeft: 8 }}>● buffering...</span>}
                {audioErr && <span style={{ color: '#e07050', marginLeft: 8 }}>⚠ {rtl ? 'الصوت غير متاح' : 'audio unavailable'}</span>}
                {!buffering && !audioErr && audioPos && audioPos.n === surah.n && progress > 3 && (
                  <span style={{ color: '#2d9b6f', marginLeft: 8 }}>⏱ {rtl ? 'استؤنف' : 'resumed'}</span>
                )}
              </div>

              {/* Progress bar — clickable */}
              <div onClick={seek} style={{ background: '#1a2e1f', borderRadius: 4, height: 6, cursor: 'pointer', marginBottom: 8, overflow: 'hidden', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 4, background: 'linear-gradient(90deg,#2d9b6f,#d4a843)', width: `${progPct}%`, transition: 'width .2s linear' }} />
              </div>

              {/* Controls row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: '#3a5045', fontSize: 10, fontFamily: 'system-ui', minWidth: 32 }}>{fmtTime(progress)}</span>

                {/* Skip back 10s */}
                <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, progress - 10) }}
                  style={{ background: 'none', border: 'none', color: '#7a9082', cursor: 'pointer', fontSize: 15, padding: '2px 6px' }} title="-10s">⏪</button>

                {/* Play/Pause */}
                <button onClick={togglePlay}
                  style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', background: playing ? 'rgba(212,168,67,.15)' : '#d4a843', color: playing ? '#d4a843' : '#060e09', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s', flexShrink: 0 }}>
                  {buffering && !audioErr ? '⏳' : playing ? '⏸' : '▶'}
                </button>

                {/* Skip forward 10s */}
                <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.min(duration, progress + 10) }}
                  style={{ background: 'none', border: 'none', color: '#7a9082', cursor: 'pointer', fontSize: 15, padding: '2px 6px' }} title="+10s">⏩</button>

                <span style={{ color: '#3a5045', fontSize: 10, fontFamily: 'system-ui', minWidth: 32, textAlign: 'right' }}>{fmtTime(duration)}</span>

                {/* Mark as read button */}
                <button onClick={() => isDone ? unmarkSurah(surah.n) : markSurahRead(surah.n)}
                  style={{ marginLeft: 'auto', background: isDone ? 'rgba(45,155,111,.15)' : 'rgba(45,155,111,.08)', border: `1px solid ${isDone ? 'rgba(45,155,111,.45)' : 'rgba(45,155,111,.22)'}`, color: isDone ? '#2d9b6f' : '#7a9082', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontFamily: 'system-ui', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .2s', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {isDone ? '✓ ' : '+ '}{rtl ? (isDone ? 'تمت القراءة' : 'علّم قُرئت') : (isDone ? 'Read ✓' : 'Mark Read')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Ayah text ── */}
        <div className="scrl" style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
          {/* Bismillah — all surahs except At-Tawbah (9) */}
          {!loadText && ayahs.length > 0 && surah.n !== 9 && (
            <div style={{ textAlign: 'center', color: '#d4a843', fontSize: 26, lineHeight: 2.2, marginBottom: 16, fontFamily: "'Amiri', Georgia, serif", direction: 'rtl' }}>
              بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
            </div>
          )}

          {loadText && (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <div style={{ width: 30, height: 30, border: '2px solid #1a2e1f', borderTopColor: '#d4a843', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin 1s linear infinite' }} />
              <div style={{ color: '#7a9082', fontSize: 13, fontFamily: 'system-ui' }}>{rtl ? 'جارٍ تحميل النص...' : 'Loading text...'}</div>
            </div>
          )}

          {textErr && (
            <div style={{ textAlign: 'center', padding: 40, color: '#7a9082', fontSize: 14, fontFamily: 'system-ui', lineHeight: 1.7 }}>
              ⚠️ {rtl ? 'تعذّر تحميل النص. تحقق من الاتصال بالإنترنت.' : 'Could not load text. Check your internet connection.'}
            </div>
          )}

          {!loadText && ayahs.map(a => (
            <div key={a.n} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid rgba(26,46,31,.5)' }}>
              <div style={{ fontSize: 23, lineHeight: 2.3, color: '#f0e8d8', direction: 'rtl', textAlign: 'right', fontFamily: "'Amiri', 'Scheherazade New', Georgia, serif" }}>
                {a.text}
                {' '}
                <span style={{ display: 'inline-block', width: 32, height: 32, borderRadius: '50%', border: '1px solid rgba(212,168,67,.3)', textAlign: 'center', lineHeight: '30px', color: '#d4a843', fontSize: 12, fontFamily: 'system-ui', verticalAlign: 'middle', flexShrink: 0 }}>
                  {a.n}
                </span>
              </div>
            </div>
          ))}

          {/* Mark as read at bottom */}
          {!loadText && !textErr && ayahs.length > 0 && (
            <div style={{ textAlign: 'center', padding: '16px 0 32px' }}>
              <button onClick={() => isDone ? unmarkSurah(surah.n) : markSurahRead(surah.n)}
                style={{ background: isDone ? 'rgba(45,155,111,.1)' : '#d4a843', color: isDone ? '#2d9b6f' : '#060e09', border: isDone ? '1px solid rgba(45,155,111,.3)' : 'none', borderRadius: 10, padding: '14px 32px', fontSize: 15, fontFamily: 'Georgia, serif', cursor: 'pointer', fontWeight: 600, transition: 'all .3s' }}>
                {isDone ? (rtl ? '✓ تمت القراءة — إلغاء؟' : '✓ Marked as read — Undo?') : (rtl ? 'علّم هذه السورة مقروءة ✓' : 'Mark this surah as read ✓')}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── KHATMA VIEW ──────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (view === 'khatma') return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="zk-page" style={{ paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button onClick={() => setView('list')}
          style={{ background: 'rgba(212,168,67,.1)', border: '1px solid rgba(212,168,67,.2)', color: '#d4a843', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'system-ui' }}>
          ← {rtl ? 'رجوع' : 'Back'}
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ color: '#f0e8d8', fontSize: 20 }}>{rtl ? 'ختمة القرآن' : 'Quran Khatma'}</h2>
          <div style={{ color: '#7a9082', fontSize: 12, fontFamily: 'system-ui' }}>
            {rtl ? 'ضع علامة على كل سورة بعد قراءتها' : 'Mark each surah after you finish reading it'}
          </div>
        </div>
        <button onClick={resetKhatma}
          style={{ background: 'rgba(181,69,27,.08)', border: '1px solid rgba(181,69,27,.2)', color: '#e07050', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: 'system-ui', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <IcReset s={13} /> {rtl ? 'إعادة' : 'Reset'}
        </button>
      </div>

      {isKhatmaComplete && (
        <Card style={{ textAlign: 'center', border: '1px solid rgba(45,155,111,.4)', marginBottom: 16, padding: 24 }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>🎉</div>
          <div style={{ color: '#2d9b6f', fontSize: 20, marginBottom: 4 }}>{rtl ? 'أتممت الختمة!' : 'Khatma Complete!'}</div>
          <div style={{ color: '#7a9082', fontSize: 13, fontFamily: 'system-ui' }}>{rtl ? 'تقبل الله منك. قراءة بركة.' : 'May Allah accept it from you. +1000 XP'}</div>
        </Card>
      )}

      {/* Progress summary */}
      <Card style={{ marginBottom: 14, border: '1px solid rgba(45,155,111,.2)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          {[
            { v: completedSurahs.length, l: rtl ? 'سورة مقروءة' : 'Surahs Read',     c: '#2d9b6f' },
            { v: `${khatmaPct}%`,        l: rtl ? 'مكتمل' : 'Complete',              c: '#d4a843' },
            { v: 114 - completedSurahs.length, l: rtl ? 'متبقٍ' : 'Remaining',      c: '#f0e8d8' },
          ].map(s => (
            <div key={s.l} style={{ textAlign: 'center' }}>
              <div style={{ color: s.c, fontSize: 24, fontFamily: 'Georgia, serif' }}>{s.v}</div>
              <div style={{ color: '#7a9082', fontSize: 11, fontFamily: 'system-ui' }}>{s.l}</div>
            </div>
          ))}
        </div>
        <ProgBar pct={khatmaPct} color="linear-gradient(90deg,#2d9b6f,#d4a843)" h={8} />
      </Card>

      <div style={{ color: '#7a9082', fontSize: 11, fontFamily: 'system-ui', marginBottom: 12 }}>
        {rtl ? 'اضغط على السورة للقراءة · اضغط ✓ لتعليمها مقروءة' : 'Tap surah name to read · Tap ✓ to mark as read'}
      </div>

      {/* 114 surahs grid - compact */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {SURAHS.map(s => {
          const done = completedSurahs.includes(s.n)
          return (
            <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8, background: done ? 'rgba(45,155,111,.07)' : '#0c1a0f', border: `1px solid ${done ? 'rgba(45,155,111,.25)' : '#1a2e1f'}`, borderRadius: 8, padding: '8px 12px', transition: 'all .2s' }}>
              {/* Number */}
              <div style={{ color: '#3a5045', fontSize: 11, fontFamily: 'system-ui', minWidth: 22, textAlign: 'center' }}>{s.n}</div>
              {/* Name — tap to open reader */}
              <button onClick={() => openSurah(s)} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: rtl ? 'right' : 'left', padding: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: done ? 'rgba(240,232,216,.55)' : '#f0e8d8', fontSize: 14, fontFamily: 'Georgia, serif' }}>{s.ar}</span>
                <span style={{ color: '#3a5045', fontSize: 11, fontFamily: 'system-ui' }}>{s.en}</span>
              </button>
              {/* Juz badge */}
              <div style={{ color: '#3a5045', fontSize: 10, fontFamily: 'system-ui', flexShrink: 0 }}>{rtl ? `ج${s.juz}` : `J${s.juz}`}</div>
              {/* Mark button */}
              <button onClick={() => done ? unmarkSurah(s.n) : markSurahRead(s.n)}
                style={{ width: 30, height: 30, borderRadius: '50%', border: `1px solid ${done ? 'rgba(45,155,111,.4)' : '#1a2e1f'}`, background: done ? 'rgba(45,155,111,.15)' : 'transparent', color: done ? '#2d9b6f' : '#3a5045', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s', flexShrink: 0 }}>
                {done ? '✓' : '+'}
              </button>
            </div>
          )
        })}
      </div>
      <div style={{ height: 24 }} />
    </div>
  )

  // ══════════════════════════════════════════════════════════════════════════
  // ── LIST VIEW (default) ───────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="zk-page" style={{ paddingTop: 52 }}>
      <div style={{ color: '#d4a843', fontSize: 10, letterSpacing: 4, fontFamily: 'system-ui', marginBottom: 4 }}>
        {(rtl ? 'القرآن الكريم' : 'HOLY QURAN').toUpperCase()}
      </div>
      <h2 style={{ color: '#f0e8d8', fontSize: 24, marginBottom: 16 }}>
        {rtl ? '١١٤ سورة' : '114 Surahs'}
      </h2>

      {/* ── Resume Audio Banner ── shows when there's a paused position saved */}
      {audioPos && audioPos.time > 3 && (() => {
        const rs = SURAHS.find(s => s.n === audioPos.n)
        return rs ? (
          <button onClick={() => openSurah(rs)}
            style={{ width: '100%', background: 'rgba(45,155,111,.08)', border: '1px solid rgba(45,155,111,.28)', borderRadius: 11, padding: '12px 16px', cursor: 'pointer', textAlign: 'left', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, transition: 'all .2s' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#2d9b6f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, color: '#fff', flexShrink: 0 }}>▶</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#2d9b6f', fontSize: 9, letterSpacing: 2, fontFamily: 'system-ui', marginBottom: 3 }}>
                {rtl ? '⏱ استأنف من حيث توقفت' : '⏱ RESUME WHERE YOU LEFT OFF'}
              </div>
              <div style={{ color: '#f0e8d8', fontSize: 15 }}>{rs.ar}</div>
              <div style={{ color: '#7a9082', fontSize: 11, fontFamily: 'system-ui' }}>
                {rs.en} · {rtl ? `من الدقيقة ${fmtTime(audioPos.time)}` : `from ${fmtTime(audioPos.time)}`}
              </div>
            </div>
            <div style={{ color: '#2d9b6f', fontSize: 22, flexShrink: 0 }}>›</div>
          </button>
        ) : null
      })()}

      {/* Top cards — last read + khatma */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }} className="g2">
        {/* Last Read */}
        {lastRead ? (
          <button onClick={() => openSurah(SURAHS.find(s => s.n === lastRead.n) || SURAHS[0])}
            style={{ background: 'rgba(212,168,67,.07)', border: '1px solid rgba(212,168,67,.22)', borderRadius: 10, padding: 14, cursor: 'pointer', textAlign: rtl ? 'right' : 'left' }}>
            <div style={{ color: '#d4a843', fontSize: 9, letterSpacing: 2, fontFamily: 'system-ui', marginBottom: 5 }}>{rtl ? '📖 آخر قراءة' : '📖 LAST READ'}</div>
            <div style={{ color: '#f0e8d8', fontSize: 15 }}>{lastRead.ar}</div>
            <div style={{ color: '#7a9082', fontSize: 11, fontFamily: 'system-ui' }}>{lastRead.en}</div>
            {audioPos && audioPos.n === lastRead.n && audioPos.time > 3 && (
              <div style={{ color: '#2d9b6f', fontSize: 10, fontFamily: 'system-ui', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>⏱</span>
                <span>{rtl ? `يستأنف عند ${fmtTime(audioPos.time)}` : `Resumes at ${fmtTime(audioPos.time)}`}</span>
              </div>
            )}
          </button>
        ) : (
          <div style={{ background: 'rgba(212,168,67,.04)', border: '1px solid #1a2e1f', borderRadius: 10, padding: 14, textAlign: rtl ? 'right' : 'left' }}>
            <div style={{ color: '#d4a843', fontSize: 9, letterSpacing: 2, fontFamily: 'system-ui', marginBottom: 5 }}>{rtl ? '📖 آخر قراءة' : '📖 LAST READ'}</div>
            <div style={{ color: '#3a5045', fontSize: 13, fontFamily: 'system-ui' }}>{rtl ? 'ابدأ القراءة الآن' : 'Start reading below'}</div>
          </div>
        )}

        {/* Khatma progress or start */}
        <button onClick={() => khatma ? setView('khatma') : setShowKhatmaPrompt(p => !p)}
          style={{ background: 'rgba(45,155,111,.07)', border: '1px solid rgba(45,155,111,.22)', borderRadius: 10, padding: 14, cursor: 'pointer', textAlign: rtl ? 'right' : 'left' }}>
          <div style={{ color: '#2d9b6f', fontSize: 9, letterSpacing: 2, fontFamily: 'system-ui', marginBottom: 5 }}>{rtl ? '📿 الختمة' : '📿 KHATMA'}</div>
          {khatma ? (
            <>
              <div style={{ color: '#f0e8d8', fontSize: 15 }}>{completedSurahs.length}/114 {rtl ? 'سورة' : 'surahs'}</div>
              <div style={{ marginTop: 6 }}><ProgBar pct={khatmaPct} color="#2d9b6f" h={4} /></div>
            </>
          ) : (
            <>
              <div style={{ color: '#f0e8d8', fontSize: 14 }}>{rtl ? 'ابدأ ختمة' : 'Start Khatma'}</div>
              <div style={{ color: '#7a9082', fontSize: 11, fontFamily: 'system-ui', marginTop: 2 }}>{rtl ? 'تتبع قراءتك سورة بسورة' : 'Track surah by surah'}</div>
            </>
          )}
        </button>
      </div>

      {/* Khatma start prompt */}
      {showKhatmaPrompt && !khatma && (
        <div style={{ background: 'rgba(45,155,111,.07)', border: '1px solid rgba(45,155,111,.25)', borderRadius: 10, padding: 16, marginBottom: 14 }}>
          <div style={{ color: '#f0e8d8', fontSize: 14, marginBottom: 8 }}>{rtl ? 'هل تريد بدء ختمة جديدة؟' : 'Start a new Khatma?'}</div>
          <div style={{ color: '#7a9082', fontSize: 12, fontFamily: 'system-ui', marginBottom: 14 }}>
            {rtl ? 'ستتتبع قراءتك سورة بسورة حتى تتم القرآن كاملاً.' : 'Track your reading surah by surah until you complete the full Quran.'}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={startKhatma} style={{ flex: 1, background: '#2d9b6f', color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: 14, fontFamily: 'Georgia, serif', cursor: 'pointer', fontWeight: 600 }}>
              {rtl ? 'ابدأ الختمة ←' : 'Start Khatma →'}
            </button>
            <button onClick={() => setShowKhatmaPrompt(false)} style={{ background: 'transparent', border: '1px solid #1a2e1f', color: '#7a9082', borderRadius: 8, padding: '11px 16px', fontSize: 13, fontFamily: 'system-ui', cursor: 'pointer' }}>
              {rtl ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder={rtl ? 'ابحث باسم السورة أو رقمها...' : 'Search by name or number...'}
        dir={rtl ? 'rtl' : 'ltr'}
        style={{ width: '100%', background: 'rgba(255,255,255,.05)', border: '1px solid #1a2e1f', color: '#f0e8d8', padding: '11px 14px', borderRadius: 8, fontSize: 14, fontFamily: 'system-ui', outline: 'none', marginBottom: 12, transition: 'border .2s' }}
      />

      {/* Count */}
      <div style={{ color: '#3a5045', fontSize: 11, fontFamily: 'system-ui', marginBottom: 10 }}>
        {rtl ? `${filtered.length} سورة` : `${filtered.length} surahs`}
      </div>

      {/* Surah list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map(s => {
          const done = completedSurahs.includes(s.n)
          const isLastRead = lastRead?.n === s.n
          return (
            <button key={s.n} onClick={() => openSurah(s)}
              style={{ background: isLastRead ? 'rgba(212,168,67,.08)' : done ? 'rgba(45,155,111,.05)' : '#0c1a0f', border: `1px solid ${isLastRead ? 'rgba(212,168,67,.28)' : done ? 'rgba(45,155,111,.2)' : '#1a2e1f'}`, borderRadius: 9, padding: '12px 14px', cursor: 'pointer', textAlign: 'left', transition: 'all .2s', display: 'flex', alignItems: 'center', gap: 12, direction: 'ltr' }}>
              {/* Number */}
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(212,168,67,.07)', border: '1px solid rgba(212,168,67,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d4a843', fontSize: 13, fontFamily: 'system-ui', fontWeight: 600, flexShrink: 0 }}>
                {s.n}
              </div>
              {/* Names */}
              <div style={{ flex: 1, minWidth: 0, textAlign: rtl ? 'right' : 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: done ? 'rgba(240,232,216,.6)' : '#f0e8d8', fontSize: 15 }}>{s.ar}</span>
                  {isLastRead && <span style={{ background: 'rgba(212,168,67,.15)', color: '#d4a843', fontSize: 9, borderRadius: 4, padding: '2px 6px', fontFamily: 'system-ui', letterSpacing: 1, flexShrink: 0 }}>LAST READ</span>}
                  {audioPos && audioPos.n === s.n && audioPos.time > 3 && (
                    <span style={{ background: 'rgba(45,155,111,.14)', color: '#2d9b6f', fontSize: 9, borderRadius: 4, padding: '2px 6px', fontFamily: 'system-ui', flexShrink: 0 }}>
                      ⏱ {fmtTime(audioPos.time)}
                    </span>
                  )}
                  {done && !isLastRead && <span style={{ color: '#2d9b6f', fontSize: 12 }}>✓</span>}
                </div>
                <div style={{ color: '#7a9082', fontSize: 11, fontFamily: 'system-ui', marginTop: 2 }}>
                  {s.en} · {s.ayahs} {rtl ? 'آية' : 'ayahs'} · {rtl ? (s.type === 'Meccan' ? 'مكية' : 'مدنية') : s.type}
                </div>
              </div>
              {/* Juz + play icon */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                <div style={{ color: '#3a5045', fontSize: 10, fontFamily: 'system-ui' }}>{rtl ? `ج${s.juz}` : `J${s.juz}`}</div>
                <div style={{ color: '#7a9082', fontSize: 14 }}>▶</div>
              </div>
            </button>
          )
        })}
      </div>
      <div style={{ height: 24 }} />
    </div>
  )
}

// ── ADHKAR TAB ────────────────────────────────────────────────────────────────
function AdhkarTab({lang,user,setUser,showNotif}) {
  const rtl=lang==='ar'
  const [catId,setCatId]=useState(null)
  const [counts,setCounts]=useState({})
  const [doneSessions,setDoneSessions]=useState({})

  const todayKey=todayStr()

  function isCatDone(id) { return !!doneSessions[`${todayKey}_${id}`] }

  function tap(adhkarId, required) {
    const key=`${catId}_${adhkarId}`
    const cur=(counts[key]||0)+1
    setCounts(p=>({...p,[key]:cur}))
    if(cur>=required) {
      // XP for completing each dhikr
      setUser(u=>({...u,xp:u.xp+5}))
    }
  }

  function resetSession() { setCounts({}); }

  function markSessionDone(id) {
    setDoneSessions(p=>({...p,[`${todayKey}_${id}`]:true}))
    setUser(u=>({...u,xp:u.xp+40,adhkarSessions:(u.adhkarSessions||0)+1}))
    showNotif(t(lang,'a_done'))
    setCatId(null); setCounts({})
  }

  if(catId) {
    const list=ADHKAR[catId]||[]
    const cat=ADHKAR_CATEGORIES.find(c=>c.id===catId)
    const allDone=list.every(a=>(counts[`${catId}_${a.id}`]||0)>=a.count)

    return (
      <div dir={rtl?'rtl':'ltr'} style={{display:'flex',flexDirection:'column',height:'calc(100vh - 70px)'}}>
        {/* Header */}
        <div style={{background:'#0c1a0f',borderBottom:'1px solid #1a2e1f',padding:'52px 20px 14px',flexShrink:0,position:'relative',overflow:'hidden'}}>
          <GeomBg/>
          <div style={{position:'relative',display:'flex',alignItems:'center',gap:12}}>
            <button onClick={()=>{setCatId(null);setCounts({})}} style={{background:'rgba(212,168,67,.1)',border:'1px solid rgba(212,168,67,.2)',color:'#d4a843',borderRadius:8,padding:'8px 12px',fontSize:13,cursor:'pointer',fontFamily:'system-ui',display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
              {rtl?<IcArrow s={16}/>:<IcArrow s={16} left/>}
            </button>
            <div>
              <div style={{color:'#d4a843',fontSize:13}}>{cat?.emoji} {rtl?cat?.labelAr:cat?.label}</div>
              <div style={{color:'#7a9082',fontSize:11,fontFamily:'system-ui'}}>{list.length} {rtl?'ذكر':'adhkar'}</div>
            </div>
            <button onClick={resetSession} style={{marginLeft:'auto',background:'none',border:'none',color:'#3a5045',cursor:'pointer',display:'flex',alignItems:'center',gap:4,fontSize:12,fontFamily:'system-ui'}}>
              <IcReset s={14}/> {t(lang,'a_reset')}
            </button>
          </div>
          {/* Overall progress */}
          <div style={{marginTop:12,position:'relative'}}>
            <ProgBar pct={(list.filter(a=>(counts[`${catId}_${a.id}`]||0)>=a.count).length/list.length)*100} color={cat?.color||'#d4a843'} h={4}/>
          </div>
        </div>

        {/* Adhkar list */}
        <div className="scrl" style={{flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:12}}>
          {list.map((a,i)=>{
            const cur=counts[`${catId}_${a.id}`]||0
            const done=cur>=a.count
            return (
              <div key={a.id} style={{background:done?'rgba(45,155,111,.07)':'#0c1a0f',border:`1px solid ${done?'rgba(45,155,111,.3)':'#1a2e1f'}`,borderRadius:12,padding:16,transition:'all .3s'}}>
                {/* Counter badge */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                  <div style={{background:'#1a2e1f',borderRadius:20,padding:'3px 10px',fontSize:11,fontFamily:'system-ui',color:'#7a9082'}}>
                    {i+1}/{list.length}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    {done?
                      <div style={{background:'rgba(45,155,111,.15)',color:'#2d9b6f',borderRadius:20,padding:'4px 12px',fontSize:12,fontFamily:'system-ui'}}>✓</div>
                    :
                      <button onClick={()=>tap(a.id,a.count)} style={{
                        background: cur>0?'rgba(212,168,67,.12)':'rgba(212,168,67,.07)',
                        border:`1px solid ${cur>0?'rgba(212,168,67,.4)':'rgba(212,168,67,.15)'}`,
                        color:'#d4a843',borderRadius:8,padding:'6px 14px',fontSize:13,fontFamily:'system-ui',cursor:'pointer',
                        transition:'all .15s',minWidth:64,textAlign:'center',
                      }}>
                        {a.count===1?t(lang,'a_tap'):`${cur}/${a.count}`}
                      </button>
                    }
                  </div>
                </div>

                {/* Arabic text */}
                <div style={{color:done?'rgba(240,232,216,.6)':'#f0e8d8',fontSize:17,lineHeight:1.9,marginBottom:10,direction:'rtl',textAlign:'right',whiteSpace:'pre-line'}}>
                  {a.arabic}
                </div>

                {/* Translation */}
                <div style={{color:'#7a9082',fontSize:12,fontFamily:'system-ui',lineHeight:1.6,marginBottom:8,fontStyle:'italic'}}>
                  {rtl?a.translationAr:a.translation}
                </div>

                {/* Benefit */}
                <div style={{background:'rgba(212,168,67,.06)',borderRadius:6,padding:'8px 10px',border:'1px solid rgba(212,168,67,.1)'}}>
                  <span style={{color:'#d4a843',fontSize:10,letterSpacing:1,fontFamily:'system-ui'}}>{t(lang,'a_benefit')}: </span>
                  <span style={{color:'#7a9082',fontSize:12,fontFamily:'system-ui'}}>{a.benefit}</span>
                </div>
                <div style={{color:'#3a5045',fontSize:11,fontFamily:'system-ui',marginTop:6}}>
                  {t(lang,'a_source')}: {a.source}
                </div>
              </div>
            )
          })}
          <div style={{height:20}}/>
        </div>

        {/* Complete session button */}
        {allDone&&(
          <div style={{padding:'12px 14px',background:'#060e09',borderTop:'1px solid #1a2e1f',flexShrink:0}}>
            <button onClick={()=>markSessionDone(catId)} style={{width:'100%',padding:16,background:'#2d9b6f',color:'#fff',border:'none',borderRadius:10,fontSize:15,fontFamily:'Georgia,serif',cursor:'pointer',fontWeight:600}}>
              {t(lang,'a_done')} +40 XP
            </button>
          </div>
        )}
      </div>
    )
  }

  // Category list view
  return (
    <div dir={rtl?'rtl':'ltr'} className="zk-page" style={{paddingTop:52}}>
      <div style={{color:'#d4a843',fontSize:10,letterSpacing:4,fontFamily:'system-ui',marginBottom:4}}>{t(lang,'a_title').toUpperCase()}</div>
      <h2 style={{color:'#f0e8d8',fontSize:24,marginBottom:6}}>{t(lang,'a_title')}</h2>
      <p style={{color:'#7a9082',fontSize:13,fontFamily:'system-ui',lineHeight:1.65,marginBottom:22}}>{t(lang,'a_sub')}</p>

      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {ADHKAR_CATEGORIES.map(cat=>{
          const done=isCatDone(cat.id)
          const list=ADHKAR[cat.id]||[]
          return (
            <button key={cat.id} onClick={()=>setCatId(cat.id)}
              style={{background:done?'rgba(45,155,111,.06)':'#0c1a0f',border:`1px solid ${done?'rgba(45,155,111,.3)':'rgba(212,168,67,.15)'}`,borderRadius:12,padding:18,cursor:'pointer',textAlign:rtl?'right':'left',transition:'all .2s'}}>
              <div style={{display:'flex',alignItems:'center',gap:14}}>
                <div style={{width:46,height:46,borderRadius:10,background:`${cat.color}18`,border:`1px solid ${cat.color}30`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>
                  {cat.emoji}
                </div>
                <div style={{flex:1}}>
                  <div style={{color:done?'#2d9b6f':'#f0e8d8',fontSize:15,marginBottom:3}}>
                    {rtl?cat.labelAr:cat.label}
                    {done&&<span style={{marginLeft:8,fontSize:12}}> ✓</span>}
                  </div>
                  <div style={{color:'#3a5045',fontSize:12,fontFamily:'system-ui'}}>{list.length} {rtl?'ذكر':'adhkar'}</div>
                </div>
                {done?
                  <div style={{color:'#2d9b6f',fontSize:12,fontFamily:'system-ui'}}>{t(lang,'a_session_done')}</div>
                :
                  rtl?<IcChev s={16} left/>:<IcChev s={16}/>
                }
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── CHALLENGES TAB ────────────────────────────────────────────────────────────
function ChallengesTab({lang,challenges,setChallenge}) {
  const rtl=lang==='ar'
  return (
    <div dir={rtl?'rtl':'ltr'} className="zk-page" style={{paddingTop:52}}>
      <div style={{color:'#d4a843',fontSize:10,letterSpacing:4,fontFamily:'system-ui',marginBottom:4}}>{t(lang,'ch_title').toUpperCase()}</div>
      <h2 style={{color:'#f0e8d8',fontSize:24,marginBottom:6}}>{t(lang,'ch_sub')}</h2>
      <p style={{color:'#7a9082',fontSize:13,fontFamily:'system-ui',lineHeight:1.65,marginBottom:22}}>
        {rtl?'كل تحدٍّ هو عهد مع نفسك. تسجيل الدخول اليومي يُحسب في جميع التحديات النشطة.':'Each challenge is a covenant with yourself. Daily check-in counts toward every active challenge.'}
      </p>

      {challenges.length>0&&(
        <div style={{marginBottom:24}}>
          <div style={{color:'#7a9082',fontSize:9,letterSpacing:3,fontFamily:'system-ui',marginBottom:12}}>{t(lang,'ch_your')}</div>
          {challenges.map(c=>{
            const ch=CHALLENGES_DATA.find(x=>x.id===c.id); if(!ch) return null
            const pct=Math.min((c.daysDone/ch.days)*100,100), done=c.daysDone>=ch.days
            return (
              <Card key={c.id} style={{marginBottom:10,borderColor:done?'rgba(45,155,111,.35)':'rgba(212,168,67,.15)'}}>
                <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:10}}>
                  <span style={{fontSize:24}}>{ch.emoji}</span>
                  <div style={{flex:1}}>
                    <div style={{color:done?'#2d9b6f':'#f0e8d8',fontSize:14,marginBottom:2}}>{rtl?ch.nameAr:ch.name}</div>
                    <div style={{color:'#3a5045',fontSize:11,fontFamily:'system-ui'}}>{done?t(lang,'done_badge'):t(lang,'day_of',{d:c.daysDone,t:ch.days})}</div>
                  </div>
                  <div style={{color:'#d4a843',fontSize:12,fontFamily:'system-ui'}}>{Math.round(pct)}%</div>
                </div>
                <ProgBar pct={pct} color={done?'#2d9b6f':'linear-gradient(90deg,#2d9b6f,#d4a843)'}/>
              </Card>
            )
          })}
        </div>
      )}

      <div style={{color:'#7a9082',fontSize:9,letterSpacing:3,fontFamily:'system-ui',marginBottom:12}}>{t(lang,'ch_available')}</div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {CHALLENGES_DATA.filter(ch=>!challenges.some(c=>c.id===ch.id)).map(ch=>(
          <button key={ch.id} onClick={()=>setChallenge(ch)} style={{background:'#0c1a0f',border:'1px solid #1a2e1f',borderRadius:12,padding:16,cursor:'pointer',textAlign:rtl?'right':'left',transition:'all .2s'}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <span style={{fontSize:24}}>{ch.emoji}</span>
              <div style={{flex:1}}>
                <div style={{color:'#f0e8d8',fontSize:14,marginBottom:3}}>{rtl?ch.nameAr:ch.name}</div>
                <div style={{color:'#7a9082',fontSize:12,fontFamily:'system-ui',marginBottom:4}}>{rtl?ch.descAr:ch.desc}</div>
                <div style={{color:'#d4a843',fontSize:11,fontFamily:'system-ui'}}>{ch.days} {rtl?'يوماً':'days'} · {ch.xp} {t(lang,'xp')}</div>
              </div>
              {rtl?<IcChev s={16} left/>:<IcChev s={16}/>}
            </div>
          </button>
        ))}
        {!CHALLENGES_DATA.some(ch=>!challenges.some(c=>c.id===ch.id))&&(
          <div style={{textAlign:'center',color:'#7a9082',fontSize:14,fontFamily:'system-ui',padding:24}}>{t(lang,'ch_all_done')}</div>
        )}
      </div>
    </div>
  )
}

// ── MENTOR TAB ────────────────────────────────────────────────────────────────
function MentorTab({user,lang,msgs,setMsgs,loading,setLoading,setMentorCount,setUser,showNotif}) {
  const [input,setInput]=useState('')
  const endRef=useRef(null)
  const rtl=lang==='ar'
  const fa=FOCUS_AREAS.find(f=>f.id===user.focusArea)||FOCUS_AREAS[0]
  const lv=getLevelInfo(user.xp)

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:'smooth'}) },[msgs])

  async function send() {
    if(!input.trim()||loading) return
    const txt=input.trim(); setInput('')
    const updated=[...msgs,{role:'user',content:txt}]
    setMsgs(updated); setLoading(true)
    try {
      const sys=rtl
        ?`أنت الأستاذ زكّاها، مرشد روحاني إسلامي دافئ وحكيم متخصص في تزكية النفس وتطوير الأخلاق الإسلامية.\n\nالمستخدم: ${user.name} | التركيز: ${fa.arabic} | الاستمرارية: ${user.streak} يوماً | المستوى: ${lv.name}\n\nأسلوبك: دافئ كأب، حكيم كعالم، عملي كمدرب. استشهد بالقرآن والسنة بشكل طبيعي. اعترف بمشاعرهم قبل النصيحة. ابدأ بحل عملي واحد يطبقه اليوم.`
        :`You are Ustadh Zakkaha, a warm and wise Islamic spiritual mentor specializing in tazkiyah al-nafs.\n\nUser: ${user.name} | Focus: ${fa.label} (${fa.arabic}) | Streak: ${user.streak} days | Level: ${lv.name}\n\nTone: warm as a father, wise as a scholar, practical as a coach. Reference Quran/Hadith naturally. Acknowledge emotion before advice. End with ONE practical action for today. 2-4 paragraphs.`

      const res=await fetch('/api/mentor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:updated.slice(-20),system:sys})})
      const data=await res.json()
      if(!res.ok||data.error) { setMsgs(p=>[...p,{role:'assistant',content:`⚠️ ${data.error||'Server error'}`}]); setLoading(false); return }
      const reply=data.content?.[0]?.text
      if(!reply) { setMsgs(p=>[...p,{role:'assistant',content:'⚠️ Empty response. Please try again.'}]); setLoading(false); return }
      setMsgs(p=>[...p,{role:'assistant',content:reply}])
      setMentorCount(p=>p+1)
      setUser(p=>({...p,xp:p.xp+10}))
    } catch(e) {
      setMsgs(p=>[...p,{role:'assistant',content:`⚠️ ${e.message||'Network error'}`}])
    }
    setLoading(false)
  }

  const starters=rtl
    ?['كيف أتغلب على الكسل وأبني روتيناً يومياً؟','أعاني من كثرة التفكير والقلق، كيف أتعامل مع ذلك؟','ما الخطوة العملية الأولى لتطوير أخلاقي؟']
    :['How do I build a consistent daily routine with ibadah?','I struggle with anxiety and overthinking. What does Islam say?','What is the first practical step to improve my character?']

  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 70px)'}} className="zk-mentor-h" dir={rtl?'rtl':'ltr'}>
      <div style={{background:'#0c1a0f',borderBottom:'1px solid #1a2e1f',padding:'52px 20px 14px',flexShrink:0,position:'relative',overflow:'hidden'}}>
        <GeomBg/>
        <div style={{position:'relative',display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:44,height:44,borderRadius:'50%',background:'rgba(212,168,67,.1)',border:'1px solid rgba(212,168,67,.3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🔮</div>
          <div>
            <div style={{color:'#f0e8d8',fontSize:15}}>{t(lang,'m_name')}</div>
            <div style={{color:'#d4a843',fontSize:11,fontFamily:'system-ui'}}>{t(lang,'m_sub')}</div>
          </div>
        </div>
      </div>

      <div className="scrl" style={{flex:1,overflowY:'auto',padding:'16px 14px',display:'flex',flexDirection:'column',gap:12}}>
        {msgs.length===0&&(
          <div style={{textAlign:'center',padding:'28px 14px'}}>
            <div style={{fontSize:36,marginBottom:12}}>🌿</div>
            <div style={{color:'#f0e8d8',fontSize:16,marginBottom:6}}>{t(lang,'m_greeting')}, {user.name}</div>
            <div style={{color:'#7a9082',fontSize:13,fontFamily:'system-ui',lineHeight:1.7,marginBottom:20}}>{t(lang,'m_intro')}</div>
            {starters.map(q=>(
              <button key={q} onClick={()=>setInput(q)} style={{display:'block',width:'100%',background:'rgba(212,168,67,.06)',border:'1px solid rgba(212,168,67,.14)',borderRadius:8,padding:'11px 14px',color:'#7a9082',fontSize:13,fontFamily:'system-ui',cursor:'pointer',marginBottom:8,textAlign:rtl?'right':'left',lineHeight:1.5,transition:'all .2s'}}>
                {q}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m,i)=>(
          <div key={i} style={{
            maxWidth:'86%',padding:'12px 15px',fontSize:14,lineHeight:1.8,
            fontFamily:m.role==='assistant'?'Georgia,serif':'system-ui',
            alignSelf:m.role==='user'?'flex-end':'flex-start',
            background:m.role==='user'?'rgba(212,168,67,.1)':'#0f1f12',
            border:`1px solid ${m.role==='user'?'rgba(212,168,67,.2)':'#1a2e1f'}`,
            borderRadius:m.role==='user'?'16px 16px 4px 16px':'16px 16px 16px 4px',
            color:m.role==='user'?'#f0e8d8':'#e8dfc8',
            whiteSpace:'pre-wrap',direction:rtl?'rtl':'ltr',
          }}>{m.content}</div>
        ))}
        {loading&&(
          <div style={{background:'#0f1f12',border:'1px solid #1a2e1f',borderRadius:'16px 16px 16px 4px',padding:'14px 16px',maxWidth:'55%',alignSelf:'flex-start',display:'flex',gap:6}}>
            {[0,.2,.4].map(d=><div key={d} style={{width:8,height:8,background:'#2d9b6f',borderRadius:'50%',animation:`pulse 1.2s ease-in-out ${d}s infinite`}}/>)}
          </div>
        )}
        <div ref={endRef}/>
      </div>

      <div style={{flexShrink:0,background:'#0c1a0f',borderTop:'1px solid #1a2e1f',padding:'10px 12px',display:'flex',gap:9,alignItems:'flex-end'}}>
        <textarea value={input} onChange={e=>setInput(e.target.value)} placeholder={t(lang,'m_ph')} rows={1}
          style={{flex:1,background:'rgba(255,255,255,.05)',border:'1px solid #1a2e1f',color:'#f0e8d8',padding:'12px 14px',borderRadius:22,fontSize:14,fontFamily:'system-ui',resize:'none',outline:'none',minHeight:44,maxHeight:110,lineHeight:1.5,direction:rtl?'rtl':'ltr'}}
          onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()} }}
          onInput={e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,110)+'px'}}
        />
        <button onClick={send} disabled={!input.trim()||loading} style={{width:44,height:44,borderRadius:'50%',border:'none',flexShrink:0,background:input.trim()&&!loading?'#d4a843':'#1a2e1f',color:input.trim()&&!loading?'#060e09':'#3a5045',cursor:input.trim()&&!loading?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',transition:'all .2s'}}>
          <IcSend s={17}/>
        </button>
      </div>
    </div>
  )
}

// ── JOURNAL TAB ───────────────────────────────────────────────────────────────
function JournalTab({lang,journals,view,setView,prompt,setPrompt,setJournals,setUser,showNotif}) {
  const [text,setText]=useState('')
  const [reading,setReading]=useState(null)
  const rtl=lang==='ar'

  function save() {
    if(!text.trim()) return
    setJournals(p=>[{id:Date.now(),date:todayStr(),prompt,content:text.trim()},...p])
    setUser(u=>({...u,xp:u.xp+30}))
    setText(''); setView('list'); setPrompt('')
    showNotif(rtl?'تم الحفظ ✨ +٣٠ نقطة':'Saved ✨ +30 XP')
  }

  if(reading) return (
    <div style={{padding:'24px',minHeight:'100vh'}} dir={rtl?'rtl':'ltr'}>
      <button onClick={()=>setReading(null)} style={{background:'none',border:'none',color:'#7a9082',cursor:'pointer',display:'flex',alignItems:'center',gap:8,fontSize:14,fontFamily:'system-ui',marginBottom:22,padding:0}}>
        {rtl?<IcArrow s={16}/>:<IcArrow s={16} left/>} {t(lang,'j_back')}
      </button>
      <div style={{color:'#d4a843',fontSize:10,letterSpacing:3,fontFamily:'system-ui',marginBottom:6}}>{fmtDate(reading.date,lang)}</div>
      <div style={{color:'#7a9082',fontSize:13,fontStyle:'italic',lineHeight:1.6,marginBottom:16,paddingBottom:14,borderBottom:'1px solid #1a2e1f'}}>{reading.prompt}</div>
      <div style={{color:'#f0e8d8',fontSize:16,lineHeight:1.85,whiteSpace:'pre-wrap'}}>{reading.content}</div>
    </div>
  )

  if(view==='write') return (
    <div style={{padding:'24px',display:'flex',flexDirection:'column',minHeight:'100vh'}} dir={rtl?'rtl':'ltr'}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:22}}>
        <button onClick={()=>setView('list')} style={{background:'none',border:'none',color:'#7a9082',cursor:'pointer',padding:0,display:'flex',alignItems:'center',gap:6,fontSize:14,fontFamily:'system-ui'}}>
          {rtl?<IcArrow s={16}/>:<IcArrow s={16} left/>} {t(lang,'j_cancel')}
        </button>
        <div style={{color:'#d4a843',fontSize:10,letterSpacing:3,fontFamily:'system-ui'}}>{fmtDate(todayStr(),lang)}</div>
      </div>
      <div style={{background:'rgba(212,168,67,.06)',border:'1px solid rgba(212,168,67,.18)',borderRadius:8,padding:'13px 15px',marginBottom:18}}>
        <div style={{color:'#d4a843',fontSize:9,letterSpacing:2,fontFamily:'system-ui',marginBottom:5}}>{t(lang,'j_prompt')}</div>
        <div style={{color:'#f0e8d8',fontSize:15,fontStyle:'italic',lineHeight:1.65}}>{prompt}</div>
      </div>
      <textarea value={text} onChange={e=>setText(e.target.value)} placeholder={t(lang,'j_ph')} autoFocus
        style={{flex:1,minHeight:240,background:'rgba(255,255,255,.04)',border:'1px solid #1a2e1f',color:'#f0e8d8',padding:14,borderRadius:8,fontSize:15,fontFamily:'Georgia,serif',resize:'none',outline:'none',lineHeight:1.75,direction:rtl?'rtl':'ltr'}}/>
      <div style={{marginTop:16,display:'grid',gridTemplateColumns:'1fr 2fr',gap:12}}>
        <button onClick={()=>{const p=JOURNAL_PROMPTS[lang]||JOURNAL_PROMPTS.en;setPrompt(p[Math.floor(Math.random()*p.length)])}}
          style={{background:'rgba(212,168,67,.08)',border:'1px solid rgba(212,168,67,.2)',color:'#d4a843',borderRadius:8,padding:13,fontSize:13,fontFamily:'system-ui',cursor:'pointer'}}>
          {t(lang,'j_new_prompt')}
        </button>
        <button onClick={save} disabled={!text.trim()} style={{background:text.trim()?'#d4a843':'#1a2e1f',color:text.trim()?'#060e09':'#3a5045',border:'none',borderRadius:8,padding:13,fontSize:14,fontFamily:'Georgia,serif',cursor:text.trim()?'pointer':'default',fontWeight:600}}>
          {t(lang,'j_save')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="zk-page" style={{paddingTop:52}} dir={rtl?'rtl':'ltr'}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20}}>
        <div>
          <div style={{color:'#d4a843',fontSize:10,letterSpacing:4,fontFamily:'system-ui',marginBottom:4}}>{t(lang,'j_title').toUpperCase()}</div>
          <h2 style={{color:'#f0e8d8',fontSize:24,marginBottom:4}}>{t(lang,'j_sub')}</h2>
          <div style={{color:'#7a9082',fontSize:12,fontFamily:'system-ui'}}>{journals.length} {rtl?'مقالة':'entries'}</div>
        </div>
        <button onClick={()=>{const p=JOURNAL_PROMPTS[lang]||JOURNAL_PROMPTS.en;setPrompt(p[Math.floor(Math.random()*p.length)]);setView('write')}}
          style={{background:'#d4a843',color:'#060e09',border:'none',borderRadius:8,padding:'11px 16px',fontSize:13,fontFamily:'Georgia,serif',cursor:'pointer',fontWeight:600,whiteSpace:'nowrap'}}>
          {t(lang,'j_new')}
        </button>
      </div>

      {!journals.some(j=>j.date===todayStr())&&(
        <div onClick={()=>{const p=JOURNAL_PROMPTS[lang]||JOURNAL_PROMPTS.en;setPrompt(p[Math.floor(Math.random()*p.length)]);setView('write')}}
          style={{background:'rgba(212,168,67,.06)',border:'1px solid rgba(212,168,67,.2)',borderRadius:12,padding:16,marginBottom:16,cursor:'pointer'}}>
          <div style={{color:'#d4a843',fontSize:9,letterSpacing:3,fontFamily:'system-ui',marginBottom:6}}>{t(lang,'j_today_cta')}</div>
          <div style={{color:'#f0e8d8',fontSize:14,fontStyle:'italic',lineHeight:1.6,marginBottom:8}}>{(JOURNAL_PROMPTS[lang]||JOURNAL_PROMPTS.en)[new Date().getDay()%10]}</div>
          <div style={{color:'#3a5045',fontSize:12,fontFamily:'system-ui'}}>{t(lang,'j_tap')}</div>
        </div>
      )}

      {journals.length===0?(
        <div style={{textAlign:'center',padding:'44px 20px'}}>
          <div style={{fontSize:42,marginBottom:12}}>📜</div>
          <div style={{color:'#7a9082',fontSize:14,fontFamily:'system-ui',lineHeight:1.7,whiteSpace:'pre-line'}}>{t(lang,'j_empty')}</div>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {journals.map(j=>(
            <button key={j.id} onClick={()=>setReading(j)} style={{background:'#0c1a0f',border:'1px solid #1a2e1f',borderRadius:12,padding:16,cursor:'pointer',textAlign:rtl?'right':'left',transition:'all .2s'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
                <div style={{color:'#d4a843',fontSize:10,letterSpacing:2,fontFamily:'system-ui'}}>{fmtDate(j.date,lang)}</div>
                {rtl?<IcChev s={14} left/>:<IcChev s={14}/>}
              </div>
              <div style={{color:'#7a9082',fontSize:12,fontStyle:'italic',marginBottom:6,lineHeight:1.4}}>{j.prompt}</div>
              <div style={{color:'#f0e8d8',fontSize:13,lineHeight:1.6,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{j.content}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── REFERRAL MODAL ────────────────────────────────────────────────────────────
function ReferralModal({user,lang,onClose,showNotif}) {
  const rtl=lang==='ar'
  const code=(user.name?.slice(0,4).toUpperCase().replace(/\s/g,'')||'ZAKK')+(user.refCode||'1234')
  const link=`${SITE_URL}?ref=${code}`
  const [copied,setCopied]=useState(false)

  function copy() {
    navigator.clipboard.writeText(link).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000)}).catch(()=>showNotif(link))
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{textAlign:'center',marginBottom:22}} dir={rtl?'rtl':'ltr'}>
        <div style={{fontSize:38,marginBottom:10}}>🔗</div>
        <h3 style={{color:'#f0e8d8',fontSize:21,marginBottom:6}}>{t(lang,'ref_title')}</h3>
        <p style={{color:'#7a9082',fontSize:13,fontFamily:'system-ui',lineHeight:1.65}}>{t(lang,'ref_desc')}</p>
      </div>
      <div style={{background:'rgba(212,168,67,.06)',border:'1px solid rgba(212,168,67,.18)',borderRadius:8,padding:14,marginBottom:14,textAlign:'center'}}>
        <div style={{color:'#7a9082',fontSize:9,letterSpacing:3,fontFamily:'system-ui',marginBottom:6}}>{t(lang,'ref_code')}</div>
        <div style={{color:'#d4a843',fontSize:20,fontFamily:'Georgia,serif',letterSpacing:4,marginBottom:6}}>{code}</div>
        <div style={{color:'#3a5045',fontSize:11,fontFamily:'system-ui',wordBreak:'break-all'}}>{link}</div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <button onClick={copy} style={{width:'100%',padding:15,background:copied?'#2d9b6f':'#d4a843',color:'#060e09',border:'none',borderRadius:8,fontSize:14,fontFamily:'Georgia,serif',cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:8,transition:'all .2s'}}>
          {copied?<><IcCheck s={16}/> {t(lang,'ref_copied')}</>:<><IcCopy/> {t(lang,'ref_copy')}</>}
        </button>
        <button onClick={()=>window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(t(lang,'ref_msg',{link}))}`)+'_blank'}
          style={{width:'100%',padding:14,background:'rgba(37,211,102,.85)',color:'#fff',border:'none',borderRadius:8,fontSize:14,fontFamily:'system-ui',cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          <span style={{fontSize:16}}>📱</span> {t(lang,'ref_wa')}
        </button>
        <button onClick={onClose} style={{width:'100%',padding:12,background:'transparent',color:'#7a9082',border:'1px solid #1a2e1f',borderRadius:8,fontSize:14,fontFamily:'system-ui',cursor:'pointer'}}>
          {t(lang,'ref_close')}
        </button>
      </div>
    </Overlay>
  )
}

// ── SUPPORT MODAL ─────────────────────────────────────────────────────────────
function SupportModal({lang,onClose}) {
  const rtl=lang==='ar'
  const [mode,setMode]=useState('once')
  const [amount,setAmount]=useState(10)
  const [paying,setPaying]=useState(false)
  const [err,setErr]=useState(null)

  useEffect(()=>{
    const url=process.env.NEXT_PUBLIC_PAYSKY_LIGHTBOX_URL||'https://pgw.paysky.io/PaymentPage/js/lightbox.js'
    if(!document.querySelector(`script[src="${url}"]`)){const s=document.createElement('script');s.src=url;s.async=true;document.head.appendChild(s)}
  },[])

  async function donate() {
    setPaying(true); setErr(null)
    try {
      const ref='ZK'+Date.now()
      const now=new Date(), pad=n=>String(n).padStart(2,'0')
      const dt=String(now.getFullYear()).slice(2)+pad(now.getMonth()+1)+pad(now.getDate())+pad(now.getHours())+pad(now.getMinutes())+pad(now.getSeconds())
      const res=await fetch('/api/payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:amount*100,merchantReference:ref,dateTime:dt})})
      const data=await res.json()
      if(data.error){throw new Error(data.error)}
      const LB=window.Lightbox
      if(!LB?.Checkout){window.open(`https://pgw.paysky.io/PaymentPage?MerchantId=${data.merchantId}&TerminalId=${data.terminalId}&Amount=${amount*100}&MerchantReference=${ref}&DateTimeLocalTrxn=${dt}&SecureHash=${data.secureHash}`,'_blank');onClose();return}
      LB.Checkout.configure({MerchantId:data.merchantId,TerminalId:data.terminalId,Amount:amount*100,MerchantReference:ref,DateTimeLocalTrxn:dt,SecureHash:data.secureHash,
        completeCallback:()=>onClose(),errorCallback:()=>{setErr(rtl?'فشل الدفع. حاول مرة أخرى.':'Payment failed. Please try again.');setPaying(false)},cancelCallback:()=>setPaying(false)})
      LB.Checkout.showLightbox()
    } catch(e){setErr(e.message);setPaying(false)}
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{textAlign:'center',marginBottom:18}} dir={rtl?'rtl':'ltr'}>
        <div style={{fontSize:36,marginBottom:8}}>❤️</div>
        <h3 style={{color:'#f0e8d8',fontSize:20,marginBottom:4}}>{t(lang,'sup_title')}</h3>
        <p style={{color:'#7a9082',fontSize:13,fontFamily:'system-ui',lineHeight:1.6}}>{t(lang,'sup_sub')}</p>
      </div>

      <div style={{marginBottom:16}} dir={rtl?'rtl':'ltr'}>
        <div style={{color:'#7a9082',fontSize:10,letterSpacing:2,fontFamily:'system-ui',marginBottom:10,textAlign:'center'}}>{t(lang,'sup_split')}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div style={{background:'rgba(212,168,67,.06)',border:'1px solid rgba(212,168,67,.2)',borderRadius:10,padding:14,textAlign:'center'}}>
            <div style={{fontSize:24,marginBottom:4}}>💻</div>
            <div style={{color:'#d4a843',fontSize:26,fontFamily:'Georgia,serif',fontWeight:'bold'}}>20%</div>
            <div style={{color:'#f0e8d8',fontSize:12,fontFamily:'system-ui',marginTop:4,marginBottom:4,fontWeight:600}}>{t(lang,'sup_dev')}</div>
            <div style={{color:'#3a5045',fontSize:10,fontFamily:'system-ui',lineHeight:1.4}}>{t(lang,'sup_dev_d')}</div>
          </div>
          <div style={{background:'rgba(45,155,111,.06)',border:'1px solid rgba(45,155,111,.22)',borderRadius:10,padding:14,textAlign:'center'}}>
            <div style={{fontSize:24,marginBottom:4}}>🕌</div>
            <div style={{color:'#2d9b6f',fontSize:26,fontFamily:'Georgia,serif',fontWeight:'bold'}}>80%</div>
            <div style={{color:'#f0e8d8',fontSize:12,fontFamily:'system-ui',marginTop:4,marginBottom:4,fontWeight:600}}>{t(lang,'sup_charity')}</div>
            <div style={{color:'#3a5045',fontSize:10,fontFamily:'system-ui',lineHeight:1.4}}>{t(lang,'sup_charity_d')}</div>
          </div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}} dir={rtl?'rtl':'ltr'}>
        {['once','monthly'].map(m=>(
          <button key={m} onClick={()=>setMode(m)} style={{padding:10,borderRadius:6,border:`1px solid ${mode===m?'#d4a843':'#1a2e1f'}`,background:mode===m?'rgba(212,168,67,.1)':'transparent',color:mode===m?'#d4a843':'#7a9082',fontSize:13,fontFamily:'system-ui',cursor:'pointer',transition:'all .2s'}}>
            {t(lang,`sup_${m}`)}
          </button>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:16}} dir={rtl?'rtl':'ltr'}>
        {[5,10,20,50].map(a=>(
          <button key={a} onClick={()=>setAmount(a)} style={{padding:'11px 0',borderRadius:6,border:`1px solid ${amount===a?'#d4a843':'#1a2e1f'}`,background:amount===a?'rgba(212,168,67,.1)':'#0c1a0f',color:amount===a?'#d4a843':'#7a9082',fontSize:14,fontFamily:'Georgia,serif',cursor:'pointer',transition:'all .2s'}}>
            ${a}
          </button>
        ))}
      </div>

      {err&&<div style={{background:'rgba(181,69,27,.1)',border:'1px solid rgba(181,69,27,.25)',borderRadius:8,padding:'9px 12px',marginBottom:12,color:'#e07050',fontSize:13,fontFamily:'system-ui',textAlign:'center'}}>{err}</div>}

      <button onClick={donate} disabled={paying} style={{width:'100%',padding:15,background:paying?'#1a2e1f':'#d4a843',color:paying?'#3a5045':'#060e09',border:'none',borderRadius:8,fontSize:14,fontFamily:'Georgia,serif',cursor:paying?'default':'pointer',fontWeight:600,transition:'all .2s'}}>
        {paying?(rtl?'...جارٍ المعالجة':'Processing...'):t(lang,'sup_donate',{a:`$${amount}${mode==='monthly'?'/mo':''}`})}
      </button>
      <div style={{color:'#3a5045',fontSize:11,fontFamily:'system-ui',textAlign:'center',margin:'10px 0',lineHeight:1.5}}>{t(lang,'sup_secure')}</div>
      <button onClick={onClose} style={{width:'100%',padding:11,background:'transparent',color:'#7a9082',border:'1px solid #1a2e1f',borderRadius:8,fontSize:13,fontFamily:'system-ui',cursor:'pointer'}}>{t(lang,'sup_close')}</button>
    </Overlay>
  )
}

// ── CHALLENGE MODAL ───────────────────────────────────────────────────────────
function ChallengeModal({ch,lang,active,onStart,onClose}) {
  const rtl=lang==='ar'
  return (
    <Overlay onClose={onClose}>
      <div style={{textAlign:'center',marginBottom:18}} dir={rtl?'rtl':'ltr'}>
        <div style={{fontSize:46,marginBottom:7}}>{ch.emoji}</div>
        <h3 style={{color:'#f0e8d8',fontSize:21,marginBottom:4}}>{rtl?ch.nameAr:ch.name}</h3>
        <div style={{color:'#7a9082',fontSize:12,fontFamily:'system-ui',marginBottom:14}}>{ch.days} {rtl?'يوماً':'days'} · {ch.xp} {t(lang,'xp')}</div>
        <div style={{background:'rgba(212,168,67,.07)',border:'1px solid rgba(212,168,67,.15)',borderRadius:8,padding:'11px 14px',marginBottom:14}}>
          <div style={{color:'#d4a843',fontSize:14,fontStyle:'italic',lineHeight:1.6}}>{ch.verse}</div>
        </div>
        <p style={{color:'#7a9082',fontSize:13,fontFamily:'system-ui',lineHeight:1.6}}>{rtl?ch.descAr:ch.desc}</p>
      </div>
      {active?
        <div style={{textAlign:'center',color:'#2d9b6f',fontSize:14,fontFamily:'system-ui',padding:10}}>{t(lang,'ch_already')}</div>
      :
        <button onClick={()=>onStart(ch.id)} style={{width:'100%',padding:15,background:'#d4a843',color:'#060e09',border:'none',borderRadius:8,fontSize:14,fontFamily:'Georgia,serif',cursor:'pointer',fontWeight:600}}>
          {t(lang,'ch_accept')}
        </button>
      }
      <button onClick={onClose} style={{width:'100%',padding:11,background:'transparent',color:'#7a9082',border:'1px solid #1a2e1f',borderRadius:8,fontSize:13,fontFamily:'system-ui',cursor:'pointer',marginTop:8}}>{t(lang,'ch_cancel')}</button>
    </Overlay>
  )
}

// ── PROFILE TAB ───────────────────────────────────────────────────────────────
function ProfileTab({user,lang,journals,challenges,badges,mentorCount,khatma,openSupport,openReferral,notifPerm,requestNotifs,quranDL,downloadQuran,hijriToday}) {
  const rtl=lang==='ar'
  const lv=getLevelInfo(user.xp), xpPct=Math.min((user.xp/lv.next)*100,100)
  const fa=FOCUS_AREAS.find(f=>f.id===user.focusArea)||FOCUS_AREAS[0]
  return (
    <div dir={rtl?'rtl':'ltr'} className="zk-page" style={{paddingTop:52}}>
      {/* Profile card */}
      <div style={{background:'linear-gradient(135deg,#0f1f12,#0a1a0c)',border:'1px solid rgba(212,168,67,.18)',borderRadius:16,padding:22,marginBottom:16,position:'relative',overflow:'hidden',textAlign:'center'}}>
        <GeomBg/>
        <div style={{position:'relative'}}>
          <div style={{width:64,height:64,borderRadius:'50%',background:'rgba(212,168,67,.1)',border:`2px solid ${lv.color}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,margin:'0 auto 10px'}}>{fa.emoji}</div>
          <div style={{color:'#f0e8d8',fontSize:20,marginBottom:3}}>{user.name}</div>
          <div style={{color:'#d4a843',fontSize:13,marginBottom:1}}>{lv.name}</div>
          <div style={{color:'#7a9082',fontSize:12,fontStyle:'italic',marginBottom:14}}>{lv.arabic}</div>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
            <div style={{color:'#3a5045',fontSize:10,fontFamily:'system-ui'}}>{t(lang,'level')} {lv.level}</div>
            <div style={{color:'#3a5045',fontSize:10,fontFamily:'system-ui'}}>{user.xp}/{lv.next} {t(lang,'xp')}</div>
          </div>
          <ProgBar pct={xpPct} color={`linear-gradient(90deg,${lv.color},#d4a843)`}/>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}} className="g3">
        {[
          {label:t(lang,'invite_btn'),icon:<IcShare s={17}/>,onClick:openReferral,bg:'rgba(212,168,67,.08)',bc:'rgba(212,168,67,.2)',c:'#d4a843'},
          {label:t(lang,'sup_btn'),  icon:<IcHeart s={17}/>,onClick:openSupport,  bg:'rgba(181,69,27,.08)', bc:'rgba(181,69,27,.2)', c:'#e07050'},
          {label:'Baytzaki', icon:<IcGlobe s={17}/>,onClick:()=>window.open('https://baytzaki.com','_blank'),bg:'rgba(45,155,111,.08)',bc:'rgba(45,155,111,.2)',c:'#2d9b6f'},
        ].map(b=>(
          <button key={b.label} onClick={b.onClick} style={{background:b.bg,border:`1px solid ${b.bc}`,color:b.c,borderRadius:10,padding:'12px 6px',fontSize:11,fontFamily:'system-ui',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:5}}>
            {b.icon}{b.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}} className="g3">
        {[
          {l:t(lang,'best_streak'),    v:`${user.streak} ${t(lang,'days')}`,e:'🔥'},
          {l:t(lang,'total_checkins'), v:user.totalCheckIns,          e:'📅'},
          {l:t(lang,'j_written'),      v:journals.length,             e:'📜'},
          {l:t(lang,'ch_active'),      v:challenges.length,           e:'⚡'},
          {l:t(lang,'m_convos'),       v:mentorCount,                 e:'🔮'},
          {l:t(lang,'member_since'),   v:fmtDate(user.joinDate,lang), e:'🌿'},
        ].map(s=>(
          <Card key={s.l} style={{display:'flex',alignItems:'center',gap:12,padding:14}}>
            <span style={{fontSize:20}}>{s.e}</span>
            <div>
              <div style={{color:'#d4a843',fontSize:17,fontFamily:'Georgia,serif'}}>{s.v}</div>
              <div style={{color:'#7a9082',fontSize:10,fontFamily:'system-ui'}}>{s.l}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Badges */}
      <div style={{color:'#7a9082',fontSize:9,letterSpacing:3,fontFamily:'system-ui',marginBottom:12}}>{t(lang,'badges_title')} ({badges.length}/{BADGES_DATA.length})</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:9,marginBottom:18}} className="g4">
        {BADGES_DATA.map(b=>{
          const earned=badges.includes(b.id)
          return (
            <div key={b.id} style={{background:'#0c1a0f',border:`1px solid ${earned?'rgba(212,168,67,.28)':'#1a2e1f'}`,borderRadius:10,padding:'12px 8px',textAlign:'center',opacity:earned?1:.38}}>
              <div style={{fontSize:24,marginBottom:6,filter:earned?'none':'grayscale(1)'}}>{b.emoji}</div>
              <div style={{color:earned?'#f0e8d8':'#7a9082',fontSize:11,marginBottom:2,lineHeight:1.3}}>{rtl?b.nameAr:b.name}</div>
              {!earned&&<div style={{color:'#3a5045',fontSize:9,fontFamily:'system-ui',marginTop:2}}>{b.desc}</div>}
            </div>
          )
        })}
      </div>

      {/* ── HIJRI DATE ── */}
      {hijriToday&&(
        <Card style={{textAlign:'center',border:'1px solid rgba(212,168,67,.12)',marginBottom:12}}>
          <div style={{color:'#7a9082',fontSize:9,letterSpacing:3,fontFamily:'system-ui',marginBottom:6}}>
            {rtl?'التاريخ الهجري':'HIJRI DATE'}
          </div>
          <div style={{color:'#d4a843',fontSize:20,fontFamily:'Georgia,serif',marginBottom:2}}>
            {hijriToday.day} {rtl?IslamicCal.HIJRI_MONTHS_AR[hijriToday.month-1]:IslamicCal.HIJRI_MONTHS_EN[hijriToday.month-1]} {hijriToday.year} هـ
          </div>
          {IslamicCal.daysUntilRamadan()>0&&IslamicCal.daysUntilRamadan()<=60&&(
            <div style={{color:'#7a9082',fontSize:12,fontFamily:'system-ui'}}>
              🌙 {rtl?`رمضان بعد ~${IslamicCal.daysUntilRamadan()} يوم`:`~${IslamicCal.daysUntilRamadan()} days until Ramadan`}
            </div>
          )}
          {IslamicCal.isFastingDay()&&(
            <div style={{color:'#2d9b6f',fontSize:12,fontFamily:'system-ui',marginTop:4}}>
              🤲 {rtl?'اليوم يوم صيام سنة':'Today is a Sunnah fasting day'}
            </div>
          )}
        </Card>
      )}

      {/* ── NOTIFICATIONS ── */}
      <Card style={{marginBottom:12,border:`1px solid ${notifPerm==='granted'?'rgba(45,155,111,.25)':'rgba(212,168,67,.15)'}`}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:24}}>🔔</span>
          <div style={{flex:1}}>
            <div style={{color:'#f0e8d8',fontSize:14,marginBottom:2}}>{rtl?'تذكيرات إسلامية':'Islamic Reminders'}</div>
            <div style={{color:'#7a9082',fontSize:11,fontFamily:'system-ui',lineHeight:1.5}}>
              {notifPerm==='granted'
                ?(rtl?'مفعّلة — فجر، أذكار، صيام، رمضان، ذو الحجة':'Active — Fajr, adhkar, fasting, Ramadan, Dhul Hijjah')
                :notifPerm==='denied'
                  ?(rtl?'محظورة — فعّلها من إعدادات المتصفح':'Blocked — enable in browser settings')
                  :(rtl?'غير مفعّلة':'Not enabled')}
            </div>
          </div>
          {notifPerm!=='granted'&&notifPerm!=='denied'&&(
            <button onClick={requestNotifs} style={{background:'#2d9b6f',color:'#fff',border:'none',borderRadius:8,padding:'9px 14px',fontSize:12,fontFamily:'system-ui',cursor:'pointer',fontWeight:600,flexShrink:0}}>
              {rtl?'تفعيل':'Enable'}
            </button>
          )}
          {notifPerm==='granted'&&<span style={{color:'#2d9b6f',fontSize:18,flexShrink:0}}>✓</span>}
          {notifPerm==='denied'&&<span style={{color:'#e07050',fontSize:18,flexShrink:0}}>✗</span>}
        </div>
      </Card>

      {/* ── OFFLINE QURAN DOWNLOAD ── */}
      <Card style={{marginBottom:12,border:`1px solid ${quranDL==='complete'?'rgba(45,155,111,.25)':'rgba(45,155,111,.12)'}`}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:quranDL&&quranDL!=='complete'?10:0}}>
          <span style={{fontSize:24}}>📖</span>
          <div style={{flex:1}}>
            <div style={{color:'#f0e8d8',fontSize:14,marginBottom:2}}>{rtl?'القرآن بدون إنترنت':'Quran Offline'}</div>
            <div style={{color:'#7a9082',fontSize:11,fontFamily:'system-ui'}}>
              {quranDL==='complete'
                ?(rtl?'تم التحميل — القرآن متاح بدون إنترنت ✓':'Downloaded — Full Quran available offline ✓')
                :quranDL
                  ?(rtl?`جارٍ التحميل ${quranDL.done}/114 سورة...`:`Downloading ${quranDL.done}/114 surahs...`)
                  :(rtl?'حمّل القرآن كاملاً للقراءة بدون إنترنت (114 سورة)':'Download full Quran for offline reading (114 surahs)')}
            </div>
          </div>
          {!quranDL&&(
            <button onClick={downloadQuran} style={{background:'rgba(45,155,111,.15)',color:'#2d9b6f',border:'1px solid rgba(45,155,111,.3)',borderRadius:8,padding:'9px 14px',fontSize:12,fontFamily:'system-ui',cursor:'pointer',fontWeight:600,flexShrink:0}}>
              {rtl?'تحميل':'Download'}
            </button>
          )}
          {quranDL==='complete'&&<span style={{color:'#2d9b6f',fontSize:18,flexShrink:0}}>✓</span>}
        </div>
        {quranDL&&quranDL!=='complete'&&(
          <ProgBar pct={(quranDL.done/114)*100} color="linear-gradient(90deg,#2d9b6f,#d4a843)" h={5}/>
        )}
      </Card>

    </div>
  )
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function Page() {
  const [ready,setReady]=useState(false)
  const [phase,setPhase]=useState('loading')
  const [swReg,setSwReg]=useState(null)
  const [notifPerm,setNotifPerm]=useState('default')
  const [quranDL,setQuranDL]=useState(null) // null|{done,total}|'complete'
  const [showInstall,setShowInstall]=useState(false)
  const [installPrompt,setInstallPrompt]=useState(null)
  const [showNotifBanner,setShowNotifBanner]=useState(false)
  const hijriToday=typeof window!=='undefined'?IslamicCal.today():null
  const [lang,setLang]=useState('en')
  const [tab,setTab]=useState('home')
  const [user,setUser]=useState(null)
  const [logs,setLogs]=useState([])
  const [journals,setJournals]=useState([])
  const [challenges,setChallenges]=useState([])
  const [badges,setBadges]=useState([])
  const [khatma,setKhatma]=useState(null)
  const [mentorMsgs,setMentorMsgs]=useState([])
  const [mentorCount,setMentorCount]=useState(0)
  const [mentorLoading,setMentorLoading]=useState(false)
  const [notif,setNotif]=useState(null)
  const [journalView,setJournalView]=useState('list')
  const [journalPrompt,setJournalPrompt]=useState('')
  const [chModal,setChModal]=useState(null)
  const [showRef,setShowRef]=useState(false)
  const [showSup,setShowSup]=useState(false)
  const checkInDone=logs.some(l=>l.date===todayStr())

  // ── PWA INIT ──
  useEffect(()=>{
    if(typeof window==='undefined') return
    // Register service worker
    PWA.registerSW().then(reg=>{ if(reg) setSwReg(reg) })
    // Check notification permission
    if('Notification' in window) setNotifPerm(Notification.permission)
    // Listen for SW messages (Quran download progress)
    if('serviceWorker' in navigator){
      navigator.serviceWorker.addEventListener('message',e=>{
        if(e.data?.type==='QURAN_PROGRESS') setQuranDL({done:e.data.done,total:e.data.total})
        if(e.data?.type==='QURAN_COMPLETE')  setQuranDL('complete')
      })
    }
    // PWA install prompt
    window.addEventListener('beforeinstallprompt',e=>{
      e.preventDefault(); setInstallPrompt(e); setShowInstall(true)
    })
    window.addEventListener('appinstalled',()=>setShowInstall(false))
  },[])

  // ── SCHEDULE NOTIFICATIONS when user grants permission ──
  useEffect(()=>{
    if(notifPerm!=='granted') return
    const lastScheduled=S.get('zk:notif-scheduled')
    if(lastScheduled!==new Date().toDateString()){
      scheduleAllNotifications(lang, user)
    }
  },[notifPerm,lang])

  // ── SHOW NOTIFICATION BANNER after onboarding ──
  useEffect(()=>{
    if(phase==='app'&&notifPerm==='default'&&!S.get('zk:notif-dismissed')){
      setTimeout(()=>setShowNotifBanner(true),3000)
    }
  },[phase,notifPerm])

  async function requestNotifications(){
    const perm=await PWA.requestNotifications()
    setNotifPerm(perm)
    setShowNotifBanner(false)
    if(perm==='granted') scheduleAllNotifications(lang, user)
  }

  async function installPWA(){
    if(!installPrompt) return
    installPrompt.prompt()
    const {outcome}=await installPrompt.userChoice
    if(outcome==='accepted') setShowInstall(false)
  }

  async function downloadQuranOffline(){
    setQuranDL({done:0,total:114})
    await PWA.prefetchQuran((done,total)=>setQuranDL({done,total}))
  }

  // ── LOAD ──
  useEffect(()=>{
    const u=S.get('zk:user')
    if(u){setUser(u);setPhase('app')}else{setPhase('onboard')}
    setLogs(S.get('zk:logs')||[])
    setJournals(S.get('zk:journals')||[])
    setChallenges(S.get('zk:challenges')||[])
    setBadges(S.get('zk:badges')||[])
    setKhatma(S.get('zk:khatma')||null)
    setMentorMsgs(S.get('zk:mentor')||[])
    setMentorCount(S.get('zk:mcount')||0)
    setLang(S.get('zk:lang')||'en')
    setReady(true)
  },[])

  // ── SAVE ──
  useEffect(()=>{if(!ready||!user)return;S.set('zk:user',user)},[user,ready])
  useEffect(()=>{if(!ready)return;S.set('zk:logs',logs)},[logs,ready])
  useEffect(()=>{if(!ready)return;S.set('zk:journals',journals)},[journals,ready])
  useEffect(()=>{if(!ready)return;S.set('zk:challenges',challenges)},[challenges,ready])
  useEffect(()=>{if(!ready)return;S.set('zk:badges',badges)},[badges,ready])
  useEffect(()=>{if(!ready)return;S.set('zk:khatma',khatma)},[khatma,ready])
  useEffect(()=>{if(!ready)return;S.set('zk:mentor',mentorMsgs.slice(-40))},[mentorMsgs,ready])
  useEffect(()=>{if(!ready)return;S.set('zk:mcount',mentorCount)},[mentorCount,ready])
  useEffect(()=>{if(!ready)return;S.set('zk:lang',lang)},[lang,ready])

  // ── BADGE CHECK ──
  useEffect(()=>{
    if(!user||!ready)return
    const newB=BADGES_DATA.filter(b=>!badges.includes(b.id)&&b.req(user,logs,journals,mentorCount,challenges,khatma)).map(b=>b.id)
    if(newB.length){setBadges(p=>[...p,...newB]);const b=BADGES_DATA.find(x=>x.id===newB[0]);showNotif(`${b.emoji} ${lang==='ar'?'وسام جديد: '+b.nameAr:'Badge: '+b.name}!`)}
  },[user,logs,journals,mentorCount,challenges,khatma,ready])

  function showNotif(msg,ms=3500){setNotif(msg);setTimeout(()=>setNotif(null),ms)}

  function handleSetLang(l){setLang(l)}

  function completeOnboarding(name,focus) {
    const u={name,focusArea:focus,joinDate:todayStr(),streak:0,lastCheckIn:null,xp:10,totalCheckIns:0,refCode:String(Math.floor(1000+Math.random()*9000)),adhkarSessions:0}
    setUser(u);setPhase('app')
    showNotif(l==='ar'?`أهلاً، ${name}! رحلتك تبدأ الآن 🌿`:`Welcome, ${name}! Your journey begins now 🌿`)
  }

  function doCheckIn() {
    if(checkInDone)return
    const today=todayStr(),yesterday=yesterdayStr()
    setLogs(p=>[...p,{date:today,ts:Date.now()}])
    setUser(p=>{const ns=p.lastCheckIn===yesterday?p.streak+1:1;return{...p,streak:ns,lastCheckIn:today,xp:p.xp+50,totalCheckIns:p.totalCheckIns+1}})
    setChallenges(p=>p.map(c=>({...c,daysDone:Math.min(c.daysDone+1,(CHALLENGES_DATA.find(x=>x.id===c.id)?.days||30))})))
    S.set('zk:checkin-' + new Date().toDateString(), true)
    showNotif(lang==='ar'?'✅ تم التسجيل +٥٠ نقطة':'✅ Checked in! +50 XP')
  }

  function startChallenge(id){
    setChallenges(p=>[...p,{id,startDate:todayStr(),daysDone:0}])
    setUser(p=>({...p,xp:p.xp+25}))
    setChModal(null)
    const ch=CHALLENGES_DATA.find(c=>c.id===id)
    showNotif(`${ch.emoji} ${lang==='ar'?'بدأت التحدي! +٢٥ نقطة':'Challenge started! +25 XP'}`)
  }

  if(!ready||phase==='loading') return (
    <div style={{background:'#060e09',minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14}}>
      <div style={{fontSize:48,color:'#d4a843',letterSpacing:4,fontFamily:'Georgia,serif'}}>زكّاها</div>
      <div style={{color:'#7a9082',fontSize:11,letterSpacing:4,fontFamily:'system-ui'}}>{t(lang,'loading')}</div>
      <div style={{width:40,height:2,background:'#d4a843',borderRadius:1,animation:'pulse 1.5s ease-in-out infinite'}}/>
    </div>
  )

  if(phase==='onboard') return <Onboarding lang={lang} setLang={handleSetLang} onComplete={completeOnboarding}/>
  if(!user) return null

  const rtl=lang==='ar'
  const activeChIds=challenges.map(c=>c.id)

  const navItems=[
    {id:'home',     icon:<IcHome s={22}/>,  iconLg:<IcHome s={26}/>,  label:t(lang,'home')},
    {id:'quran',    icon:<IcBook s={22}/>,  iconLg:<IcBook s={26}/>,  label:t(lang,'quran')},
    {id:'adhkar',   icon:<IcStar s={22}/>,  iconLg:<IcStar s={26}/>,  label:t(lang,'adhkar')},
    {id:'challenges',icon:<IcZap s={22}/>, iconLg:<IcZap s={26}/>,   label:t(lang,'challenges')},
    {id:'mentor',   icon:<IcMsg s={22}/>,   iconLg:<IcMsg s={26}/>,   label:t(lang,'mentor')},
    {id:'profile',  icon:<IcUser s={22}/>,  iconLg:<IcUser s={26}/>,  label:t(lang,'profile')},
  ]

  function navClick(id){setTab(id);if(id==='journal'&&journalView!=='list')setJournalView('list')}

  const lv=getLevelInfo(user.xp)

  return (
    <div className="zk-shell" dir={rtl?'rtl':'ltr'}>
      {notif&&<Toast msg={notif}/>}

      {/* ── PWA INSTALL BANNER ── */}
      {showInstall&&(
        <div style={{position:'fixed',bottom:80,left:12,right:12,zIndex:800,background:'#0f1f12',border:'1px solid rgba(212,168,67,.35)',borderRadius:12,padding:'14px 16px',boxShadow:'0 8px 32px rgba(0,0,0,.7)',display:'flex',alignItems:'center',gap:12}} dir={rtl?'rtl':'ltr'}>
          <span style={{fontSize:24,flexShrink:0}}>📲</span>
          <div style={{flex:1}}>
            <div style={{color:'#f0e8d8',fontSize:14,marginBottom:2}}>{rtl?'تثبيت زكّاها':'Install Zakkaha'}</div>
            <div style={{color:'#7a9082',fontSize:12,fontFamily:'system-ui'}}>{rtl?'أضفه إلى شاشتك الرئيسية للوصول السريع':'Add to home screen for quick offline access'}</div>
          </div>
          <div style={{display:'flex',gap:8,flexShrink:0}}>
            <button onClick={installPWA} style={{background:'#d4a843',color:'#060e09',border:'none',borderRadius:8,padding:'8px 14px',fontSize:13,fontFamily:'Georgia,serif',cursor:'pointer',fontWeight:600}}>{rtl?'تثبيت':'Install'}</button>
            <button onClick={()=>setShowInstall(false)} style={{background:'none',border:'none',color:'#3a5045',cursor:'pointer',fontSize:18,padding:'4px 8px'}}>✕</button>
          </div>
        </div>
      )}

      {/* ── NOTIFICATION PERMISSION BANNER ── */}
      {showNotifBanner&&notifPerm==='default'&&(
        <div style={{position:'fixed',bottom:80,left:12,right:12,zIndex:800,background:'#0f1f12',border:'1px solid rgba(45,155,111,.35)',borderRadius:12,padding:'14px 16px',boxShadow:'0 8px 32px rgba(0,0,0,.7)'}} dir={rtl?'rtl':'ltr'}>
          <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
            <span style={{fontSize:24,flexShrink:0}}>🔔</span>
            <div style={{flex:1}}>
              <div style={{color:'#f0e8d8',fontSize:14,marginBottom:4,fontWeight:600}}>{rtl?'تذكيرات إسلامية':'Islamic Reminders'}</div>
              <div style={{color:'#7a9082',fontSize:12,fontFamily:'system-ui',lineHeight:1.5,marginBottom:12}}>
                {rtl?'فجر · أذكار الصباح والمساء · صيام الإثنين والخميس · رمضان · ذو الحجة':'Fajr · Morning/Evening adhkar · Monday/Thursday fast · Ramadan · Dhul Hijjah'}
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={requestNotifications} style={{background:'#2d9b6f',color:'#fff',border:'none',borderRadius:8,padding:'9px 16px',fontSize:13,fontFamily:'system-ui',cursor:'pointer',fontWeight:600}}>
                  {rtl?'تفعيل التذكيرات ✓':'Enable Reminders ✓'}
                </button>
                <button onClick={()=>{setShowNotifBanner(false);S.set('zk:notif-dismissed',true)}} style={{background:'none',border:'1px solid #1a2e1f',color:'#7a9082',borderRadius:8,padding:'9px 14px',fontSize:12,fontFamily:'system-ui',cursor:'pointer'}}>
                  {rtl?'لاحقاً':'Later'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {chModal&&<ChallengeModal ch={chModal} lang={lang} active={activeChIds.includes(chModal.id)} onStart={startChallenge} onClose={()=>setChModal(null)}/>}
      {showRef&&<ReferralModal user={user} lang={lang} onClose={()=>setShowRef(false)} showNotif={showNotif}/>}
      {showSup&&<SupportModal lang={lang} onClose={()=>setShowSup(false)}/>}

      {/* ── SIDEBAR (desktop) ── */}
      <aside className="zk-sidebar">
        <div style={{padding:'32px 20px 22px',borderBottom:'1px solid #1a2e1f',textAlign:'center',position:'relative',overflow:'hidden'}}>
          <GeomBg/>
          <div style={{fontSize:36,color:'#d4a843',letterSpacing:2,position:'relative'}}>زكّاها</div>
          <div style={{fontSize:9,letterSpacing:5,color:'#3a5045',fontFamily:'system-ui',marginTop:3,position:'relative'}}>ZAKKAHA</div>
        </div>

        {/* User mini */}
        <div style={{padding:'16px 18px 14px',borderBottom:'1px solid #1a2e1f'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:40,height:40,borderRadius:'50%',background:'rgba(212,168,67,.1)',border:'1px solid rgba(212,168,67,.22)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>
              {(FOCUS_AREAS.find(f=>f.id===user.focusArea)||FOCUS_AREAS[0]).emoji}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{color:'#f0e8d8',fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user.name}</div>
              <div style={{color:'#d4a843',fontSize:11,fontFamily:'system-ui'}}>{lv.name}</div>
            </div>
          </div>
          <div style={{marginTop:10}}>
            <ProgBar pct={Math.min((user.xp/lv.next)*100,100)} color={`linear-gradient(90deg,${lv.color},#d4a843)`} h={4}/>
            <div style={{color:'#3a5045',fontSize:9,fontFamily:'system-ui',marginTop:4,textAlign:'center'}}>{user.xp}/{lv.next} {t(lang,'xp')}</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{padding:'10px',flex:1}}>
          {navItems.map(n=>(
            <button key={n.id} onClick={()=>navClick(n.id)} style={{display:'flex',alignItems:'center',gap:12,width:'100%',padding:'12px 12px',borderRadius:9,border:'none',cursor:'pointer',transition:'all .2s',marginBottom:3,background:tab===n.id?'rgba(212,168,67,.1)':'transparent',color:tab===n.id?'#d4a843':'#7a9082'}}>
              {n.iconLg}
              <span style={{fontSize:13,fontFamily:'system-ui',fontWeight:tab===n.id?600:400}}>{n.label}</span>
              {tab===n.id&&<div style={{marginLeft:'auto',width:3,height:18,background:'#d4a843',borderRadius:2}}/>}
            </button>
          ))}
        </nav>

        {/* Streak + checkin */}
        <div style={{padding:'14px 16px',borderTop:'1px solid #1a2e1f',display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:22}}>🔥</span>
          <div><div style={{color:'#d4a843',fontSize:18,fontFamily:'Georgia,serif',lineHeight:1}}>{user.streak}</div><div style={{color:'#3a5045',fontSize:9,fontFamily:'system-ui'}}>{t(lang,'days')}</div></div>
          <button onClick={()=>{if(!checkInDone)doCheckIn()}} style={{marginLeft:'auto',background:checkInDone?'rgba(45,155,111,.1)':'#d4a843',color:checkInDone?'#2d9b6f':'#060e09',border:checkInDone?'1px solid rgba(45,155,111,.22)':'none',borderRadius:7,padding:'7px 12px',fontSize:11,fontFamily:'system-ui',cursor:checkInDone?'default':'pointer',fontWeight:600,transition:'all .3s',whiteSpace:'nowrap'}}>
            {checkInDone?'✓ Done':'Check In'}
          </button>
        </div>

        {/* Lang + support */}
        <div style={{padding:'10px 12px 24px',borderTop:'1px solid #1a2e1f',display:'flex',gap:8}}>
          <button onClick={()=>handleSetLang(lang==='en'?'ar':'en')} style={{flex:1,background:'rgba(212,168,67,.08)',border:'1px solid rgba(212,168,67,.15)',color:'#d4a843',borderRadius:7,padding:8,fontSize:11,cursor:'pointer',fontFamily:'system-ui',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
            <IcGlobe s={12}/> {t(lang,'lang_btn')}
          </button>
          <button onClick={()=>setShowSup(true)} style={{flex:1,background:'rgba(181,69,27,.08)',border:'1px solid rgba(181,69,27,.18)',color:'#e07050',borderRadius:7,padding:8,fontSize:11,cursor:'pointer',fontFamily:'system-ui',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
            <IcHeart s={12}/> {rtl?'دعم':'Support'}
          </button>
        </div>
      </aside>

      {/* ── CONTENT ── */}
      <div className="zk-content scrl" dir={rtl?'rtl':'ltr'}>
        {/* Mobile lang toggle */}
        <button className="zk-mob-only" onClick={()=>handleSetLang(lang==='en'?'ar':'en')} style={{position:'fixed',top:14,right:14,zIndex:200,background:'rgba(15,31,18,.92)',border:'1px solid rgba(212,168,67,.3)',color:'#d4a843',borderRadius:20,padding:'5px 11px',fontSize:11,cursor:'pointer',fontFamily:'system-ui',backdropFilter:'blur(10px)',display:'flex',alignItems:'center',gap:5}}>
          <IcGlobe s={11}/> {t(lang,'lang_btn')}
        </button>

        {tab==='home'       &&<div className="zu"><HomeTab user={user} lang={lang} logs={logs} journals={journals} challenges={challenges} badges={badges} checkInDone={checkInDone} doCheckIn={doCheckIn} setTab={setTab} setJournalView={setJournalView} setJournalPrompt={setJournalPrompt} khatma={khatma} hijriToday={hijriToday}/></div>}
        {tab==='quran'      &&<div className="zu"><QuranTab lang={lang} khatma={khatma} setKhatma={setKhatma} setUser={setUser} showNotif={showNotif}/></div>}
        {tab==='adhkar'     &&<div className="zu"><AdhkarTab lang={lang} user={user} setUser={setUser} showNotif={showNotif}/></div>}
        {tab==='challenges' &&<div className="zu"><ChallengesTab lang={lang} challenges={challenges} setChallenge={setChModal}/></div>}
        {tab==='mentor'     &&<MentorTab user={user} lang={lang} msgs={mentorMsgs} setMsgs={setMentorMsgs} loading={mentorLoading} setLoading={setMentorLoading} setMentorCount={setMentorCount} setUser={setUser} showNotif={showNotif}/>}
        {tab==='journal'    &&<div className="zu"><JournalTab lang={lang} journals={journals} view={journalView} setView={setJournalView} prompt={journalPrompt} setPrompt={setJournalPrompt} setJournals={setJournals} setUser={setUser} showNotif={showNotif}/></div>}
        {tab==='profile'    &&<div className="zu"><ProfileTab user={user} lang={lang} journals={journals} challenges={challenges} badges={badges} mentorCount={mentorCount} khatma={khatma} openSupport={()=>setShowSup(true)} openReferral={()=>setShowRef(true)} notifPerm={notifPerm} requestNotifs={requestNotifications} quranDL={quranDL} downloadQuran={downloadQuranOffline} hijriToday={hijriToday}/></div>}
      </div>

      {/* ── BOTTOM NAV (mobile) ── */}
      <nav className="zk-bottom-nav">
        {navItems.map(n=>(
          <button key={n.id} onClick={()=>navClick(n.id)} style={{background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'6px 8px',color:tab===n.id?'#d4a843':'#3a5045',transition:'color .2s',position:'relative',minWidth:0}}>
            {n.icon}
            <span style={{fontSize:8,letterSpacing:.3,fontFamily:'system-ui',lineHeight:1}}>{n.label}</span>
            {tab===n.id&&<div style={{position:'absolute',bottom:-1,left:'50%',transform:'translateX(-50%)',width:20,height:2,background:'#d4a843',borderRadius:1}}/>}
          </button>
        ))}
      </nav>
    </div>
  )
}
