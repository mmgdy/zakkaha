# زكّاها — Zakkaha

> *"وَقَدْ أَفْلَحَ مَن زَكَّاهَا"* — Surah Ash-Shams 91:9

A complete Islamic spiritual companion — Quran reader with Sheikh Al-Dosari audio, full Adhkar library, Khatma tracker, AI mentor, challenges, journal, and Paysky donations.

**Built by [Baytzaki.com](https://baytzaki.com)**

---

## Features

| | Feature | Description |
|---|---|---|
| 📖 | Quran Reader | All 114 surahs · Arabic text · Sheikh Yasser Al-Dosari audio |
| 🔖 | Last Read bookmark | Auto-saves where you left off |
| 📿 | Khatma Tracker | 30-juz grid · 4 goal options (1 month → 1 year) |
| 🌅 | Adhkar | Morning · Evening · After Prayer · Sleep · Protection · Ruqyah |
| 🔮 | AI Mentor | Ustadh Zakkaha — OpenAI GPT-4o → Groq fallback |
| 🔥 | Streaks & XP | Daily check-in · 5 character levels |
| ⚡ | Challenges | 7 Islamic 30-day challenges |
| 📜 | Journal | Muhasaba prompts · persistent entries |
| 🔗 | Referrals | Personal invite link · WhatsApp share |
| ❤️ | Donations | Paysky PayForm · 20% dev / 80% charity |
| 🌙 | Bilingual | Full Arabic (RTL) + English |
| 📱💻📺 | Responsive | Mobile · Tablet · Desktop · TV |

---

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Zakkaha launch"
git remote add origin https://github.com/YOUR_USERNAME/zakkaha.git
git push -u origin main
```

### 2. Import in Vercel

[vercel.com](https://vercel.com) → **New Project** → **Import Git Repository** → select `zakkaha`

### 3. Add Environment Variables

Before clicking Deploy, add these in the **Environment Variables** section:

| Variable | Where to get it |
|---|---|
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) — free |
| `PAYSKY_MERCHANT_ID` | Your Paysky merchant portal |
| `PAYSKY_TERMINAL_ID` | Your Paysky merchant portal |
| `PAYSKY_SECRET_KEY` | Paysky integration team |
| `NEXT_PUBLIC_SITE_URL` | Your Vercel URL (add after first deploy) |

Click **Deploy** ✅

Every `git push` to `main` auto-deploys. No manual steps needed.

---

## AI Mentor Fallback

```
User sends message
  → OpenAI GPT-4o  (best quality, paid)
      ↓ rate-limited?
  → Groq Llama 3.3 70B  (free, very fast)
      ↓ both down?
  → "Please try again in a few minutes"
```

Only rate-limit errors trigger a fallback. A bad API key gives an immediate clear error.

---

## Local Development

```bash
npm install
cp .env.local.example .env.local
# Fill in your keys
npm run dev
# → http://localhost:3000
```

---

## Project Structure

```
zakkaha/
├── app/
│   ├── page.js              # All screens (1500+ lines)
│   ├── layout.js            # HTML head + Amiri font
│   ├── globals.css          # Responsive layout system
│   └── api/
│       ├── mentor/route.js  # OpenAI → Groq fallback
│       └── payment/route.js # Paysky HMAC hash generator
├── lib/
│   ├── surahs.js            # 114 surahs + audio/text URLs
│   ├── adhkar.js            # 35+ adhkar (6 categories)
│   ├── quran.js             # 30 juz + khatma goals
│   ├── constants.js         # Challenges, badges, helpers
│   └── i18n.js              # English + Arabic translations
├── .env.local.example       # Copy this to .env.local
└── README.md
```

---

*جزاك الله خيرًا — May Allah reward you with goodness.*
