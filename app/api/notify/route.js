// /api/notify — AI-powered courageous Islamic push notification messages

import OpenAI from 'openai'

const getClient = () => {
  if (process.env.OPENAI_API_KEY) return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  if (process.env.GROQ_API_KEY)   return new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  return null
}
const getModel = () => process.env.OPENAI_API_KEY ? 'gpt-4o' : 'llama-3.3-70b-versatile'

export async function POST(request) {
  try {
    const body = await request.json()
    const { type = 'general', lang = 'en', userName = '', streak = 0, extra = '' } = body
    const client = getClient()
    if (!client) return Response.json({ message: fallback(type, lang, userName) })

    const ar = lang === 'ar'
    const name = userName || (ar ? 'أخي' : 'dear')

    // Bold, soul-stirring system prompt — not a generic reminder bot
    const system = ar
      ? `أنت مرشد روحاني إسلامي شجاع وملهم. مهمتك: كتابة رسالة إشعار هاتف قصيرة (جملة واحدة أو جملتان، أقل من 130 حرف) تُشعل في القلب الشوق لله وتدفع للعمل فوراً.
الأسلوب: قوي، مباشر، يمس الروح — مثل صديق حكيم يهز كتفك بمحبة. استخدم كلمة من القرآن أو الحديث أحياناً. لا تكن رسمياً أو مملاً. الرد بالرسالة فقط، بدون أي مقدمة أو كلام آخر.`
      : `You are a bold, soul-stirring Islamic spiritual guide. Your mission: write a SHORT push notification (1-2 sentences, under 130 chars) that ignites the heart and compels immediate action.
Style: powerful, direct, emotionally resonant — like a wise friend shaking your shoulder with love. Occasionally weave in a Quranic or hadith phrase. Never robotic or generic. Reply with the message ONLY, nothing else.`

    const prompts = {
      fajr: ar
        ? `رسالة فجر شجاعة لـ${name}. استمراريته ${streak} يوم. الفجر باب بين العبد وربه يُفتح كل صباح — أيقظ فيه رغبة اغتنام هذه اللحظة قبل أن تغلق.`
        : `Courageous Fajr message for ${name}. Streak: ${streak}d. Fajr is a door between the servant and Allah that opens every dawn — awaken the urgency to seize it before it closes.`,

      dhuhr: ar
        ? `رسالة ظهر جريئة لـ${name}. المشغول بالدنيا ينسى خالق الدنيا — أوقف كل شيء وصلِّ. الله أولى بدقيقتين من كل الخلق.`
        : `Bold Dhuhr message for ${name}. The world drowns out its own Creator — give ${name} a powerful reason to stop everything and pray. Allah deserves two minutes more than anyone.`,

      asr: ar
        ? `رسالة عصر ملتهبة لـ${name}. الله أقسم بالعصر — يمر في لمح البصر — حرّك فيه خوف التفريط وشوق اكتساب الملائكة شاهدة.`
        : `Urgent Asr message for ${name}. Allah swore by Al-Asr — it slips by in a blink. Stir both the fear of missing it and the yearning for the angels to witness this prayer.`,

      maghrib: ar
        ? `رسالة مغرب روحية لـ${name}. الشمس تودّع ربها وتستأذن في الغروب كل يوم — ما الذي يفعله${name} في لحظة الوداع هذه؟`
        : `Spiritual Maghrib message for ${name}. Every day the sun bows and seeks Allah's permission before it sets — what will ${name} be doing in this moment of farewell?`,

      isha: ar
        ? `رسالة عشاء دافئة وشجاعة لـ${name}. اختم يومك بكلام مع الله — لا تنم وبينك وبينه صمت. عشاؤك يُضيء ليلك.`
        : `Warm and courageous Isha message for ${name}. End this day speaking to Allah — don't sleep with silence between you and Him. Your Isha illuminates the night.`,

      fasting: ar
        ? `رسالة صيام سنة ملهمة لـ${name}. ${extra} — الصيام جنة وسر خاص بين العبد وربه. الله يجزي عليه بنفسه — نِعم الزاد.`
        : `Inspiring Sunnah fast reminder for ${name}. ${extra} — fasting is a secret shield between the servant and Allah. He rewards it Himself. What a provision.`,

      adhkar_m: ar
        ? `رسالة أذكار صباح لـ${name}. استمراريته ${streak} يوم. لسانك رطب بذكر الله يحرسك هذا اليوم — ابدأه بالأذكار قبل أن يبدأك بالغفلة.`
        : `Morning adhkar message for ${name}. Streak: ${streak}d. A tongue moist with dhikr is your armor for the day — begin with adhkar before the day begins with heedlessness.`,

      adhkar_e: ar
        ? `رسالة أذكار مساء لـ${name}. المساء يُغلق باب النهار — اختمه بما يُرضي الله قبل أن يُطوى إلى الأبد.`
        : `Evening adhkar message for ${name}. The evening closes the door on your day — seal it with what pleases Allah before it folds shut forever.`,

      streak: ar
        ? `${name}، ${streak} يوم من الثبات 🔥 الشيطان يريدك تكسر اليوم بالضبط. لا تُعطه هذه النقطة. استمر.`
        : `${name}, ${streak} days of consistency 🔥 Shaytan is counting on you to break today. Don't give him that point. Keep going.`,

      ramadan: ar
        ? `رسالة رمضان مشتاقة لـ${name}. ${extra}. رمضان ضيف كريم يطرق الباب — هيّئ قلبك قبل أن يحل ويكشف ما فيه.`
        : `Anticipatory Ramadan message for ${name}. ${extra}. Ramadan is a noble guest knocking at your door — prepare your heart before it arrives and reveals what's inside it.`,

      jummah: ar
        ? `رسالة جمعة مبهجة لـ${name}. غداً أشرف أيام الأسبوع — فيه ساعة إجابة تمر دون أن يعلم أحد متى. هيّئ قلبك ولسانك.`
        : `Joyful Jummah message for ${name}. Tomorrow holds the most honoured hour of the week — a moment of answered prayer that passes silently. Ready your heart and tongue.`,

      general: ar
        ? `رسالة تشجيع روحاني شجاعة لـ${name}. كل خطوة صغيرة نحو الله تُقرّبك منه خطوات — لا تستهن بالقليل فالله يُضاعف.`
        : `Courageous spiritual encouragement for ${name}. Every small step toward Allah closes the distance by miles — never underestimate the little acts, for Allah multiplies them.`,
    }

    const res = await client.chat.completions.create({
      model: getModel(), max_tokens: 90, temperature: 0.92,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: prompts[type] || prompts.general },
      ],
    })
    const message = res.choices?.[0]?.message?.content?.trim() || fallback(type, lang, userName)
    return Response.json({ message })
  } catch (e) {
    console.error('[Notify]', e.message)
    return Response.json({ message: fallback('general', 'en', '') })
  }
}

function fallback(type, lang, name) {
  const ar = lang === 'ar', n = name || (ar ? 'أخي' : 'friend')
  const m = {
    fajr:    ar?`${n}، الفجر ينادي 🌅 الصلاة خير من النوم — أجب النداء`:`${n}, Fajr calls 🌅 Prayer is better than sleep — answer it`,
    dhuhr:   ar?`الدنيا تصمت لحظة يا ${n} 🤲 صلِّ ظهرك الآن`:`The world can wait, ${n} 🤲 Pray your Dhuhr now`,
    asr:     ar?`${n}، العصر يمر كالبرق ⏰ لا تفوّت شهادة الملائكة`:`${n}, Asr passes like lightning ⏰ Don't miss the angels' testimony`,
    maghrib: ar?`${n}، الشمس تودّع بطاعة 🌅 ماذا ستقول لربك الآن؟`:`${n}, the sun bows to its Lord at sunset 🌅 What will you say to Allah?`,
    isha:    ar?`${n}، لا تنم قبل أن تختم يومك مع الله 🌙 صلِّ عشاءك`:`${n}, don't sleep before sealing this day with Allah 🌙 Pray Isha`,
    fasting: ar?`غداً يوم صيام سنة يا ${n} 🤲 نِعم الزاد للآخرة`:`Sunnah fast tomorrow ${n} 🤲 What a provision for the Hereafter`,
    adhkar_m:ar?`${n}، لسانك الرطب بذكر الله حصنك اليوم 📿 الأذكار الآن`:`${n}, your tongue moist with dhikr is your shield today 📿 Morning adhkar now`,
    adhkar_e:ar?`${n}، المساء يطوي النهار 🌙 اختمه بذكر الله`:`${n}, evening folds the day shut 🌙 Seal it with dhikr`,
    streak:  ar?`${n}، ${streak||0} يوم من الثبات 🔥 لا تُعطِ الشيطان ما يريد`:`${n}, ${streak||0} days strong 🔥 Don't let Shaytan win today`,
    ramadan: ar?`رمضان يقترب 🌙 هيّئ قلبك — الموسم لا ينتظر`:`Ramadan draws near 🌙 Prepare your heart — the season waits for no one`,
    jummah:  ar?`${n}، غداً الجمعة 🕌 فيها ساعة لا تُرد الدعوة — استعد`:`Tomorrow is Jummah ${n} 🕌 An hour where no dua is rejected — prepare`,
    general: ar?`${n}، كل خطوة في طريق الله تُكتب ولا تضيع 🌿 استمر`:`${n}, every step toward Allah is written and never wasted 🌿 Keep going`,
  }
  return m[type] || m.general
}
