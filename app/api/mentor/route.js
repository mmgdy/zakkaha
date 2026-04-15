// ── AI MENTOR — Fallback Chain: OpenAI → Groq ────────────────────────────────
// Tries OpenAI GPT-4o first. If rate-limited or quota exceeded, falls back to
// Groq (Llama 3.3 70B) automatically. Both use the OpenAI-compatible API format.

import OpenAI from 'openai'

// ── OpenAI (GPT-4o) ───────────────────────────────────────────────────────────
async function callOpenAI(messages, system) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const res = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1000,
    messages: [{ role: 'system', content: system }, ...messages],
  })
  return res.choices?.[0]?.message?.content || null
}

// ── Groq (Llama 3.3 70B) — free, very fast ───────────────────────────────────
async function callGroq(messages, system) {
  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  })
  const res = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1000,
    messages: [{ role: 'system', content: system }, ...messages],
  })
  return res.choices?.[0]?.message?.content || null
}

// ── Rate-limit detector ───────────────────────────────────────────────────────
function isRateLimit(err) {
  const status = err?.status || err?.statusCode || 0
  const msg    = (err?.message || '').toLowerCase()
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('quota') ||
    msg.includes('too many requests') ||
    msg.includes('overloaded') ||
    msg.includes('capacity')
  )
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const { messages, system } = await request.json()
    if (!messages?.length) {
      return Response.json({ error: 'No messages provided' }, { status: 400 })
    }

    const providers = [
      {
        name: 'OpenAI',
        key: process.env.OPENAI_API_KEY,
        fn: () => callOpenAI(messages, system),
      },
      {
        name: 'Groq',
        key: process.env.GROQ_API_KEY,
        fn: () => callGroq(messages, system),
      },
    ].filter(p => !!p.key)

    if (!providers.length) {
      return Response.json({
        error: 'No AI key configured. Add OPENAI_API_KEY or GROQ_API_KEY in Vercel → Settings → Environment Variables, then redeploy.',
      }, { status: 500 })
    }

    for (const provider of providers) {
      try {
        console.log(`[Mentor] Trying ${provider.name}...`)
        const reply = await provider.fn()
        if (reply) {
          console.log(`[Mentor] ✓ ${provider.name}`)
          return Response.json({
            content: [{ type: 'text', text: reply }],
            provider: provider.name,
          })
        }
      } catch (err) {
        console.warn(`[Mentor] ${provider.name} failed:`, err?.message)
        // Only fall through on rate-limit / quota — hard errors stop immediately
        if (!isRateLimit(err)) {
          return Response.json(
            { error: `${provider.name} error: ${err?.message || 'Unknown error'}` },
            { status: 500 }
          )
        }
        console.log(`[Mentor] ${provider.name} rate-limited, trying next...`)
      }
    }

    return Response.json({
      error: 'All AI providers are currently rate-limited. Please wait a moment and try again. 🕐',
    }, { status: 429 })

  } catch (err) {
    console.error('[Mentor] Unexpected error:', err)
    return Response.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
