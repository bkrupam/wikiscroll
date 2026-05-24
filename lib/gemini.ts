import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

export interface HookResult {
  hook: string
  score: number
  categories: string[]
}

const HOOK_PROMPT = `You are a hook writer for a social media app. Your job is to find the single most surprising, counterintuitive, or mind-blowing fact buried inside a Wikipedia article and rewrite it in a way that stops someone mid-scroll.

Rules:
- Write 1–3 sentences MAXIMUM.
- NO title. NO "Did you know". NO "According to Wikipedia". NO "In fact,".
- Lead with the most surprising or counterintuitive thing FIRST — do not build up to it.
- Use simple, conversational language. Write like a tweet, not an encyclopedia.
- After writing, score how hook-worthy this is from 1–10. Be strict: only genuinely surprising, counterintuitive, or mind-blowing facts score above 6.
- If there is no genuinely interesting hook in the article, return null for the hook.
- The categories should be 2–5 short topic tags (e.g. "Psychology", "Space", "History", "Biology") — not Wikipedia category names.

Wikipedia article extract:
"""
{EXTRACT}
"""

Article title (DO NOT use this in the hook text — just for context): {TITLE}

Return ONLY valid JSON with no markdown, no code fences, no explanation:
{"hook": "string or null", "score": number, "categories": ["tag1", "tag2"]}`

/** Retry a Groq call with exponential backoff on 503 / 429 / rate limit */
async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const isRetryable =
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('rate_limit') ||
        msg.includes('Service Unavailable') ||
        msg.includes('overloaded')

      if (!isRetryable || i === retries - 1) throw err

      const delay = 1500 * Math.pow(2, i) // 1.5s → 3s → 6s → 12s
      console.log(`[Groq] Retrying in ${delay}ms (attempt ${i + 1}/${retries})…`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error('Max retries exceeded')
}

/** Extract a hook from a Wikipedia article extract using Groq / Llama */
export async function extractHook(
  title: string,
  extract: string
): Promise<HookResult | null> {
  try {
    const prompt = HOOK_PROMPT
      .replace('{EXTRACT}', extract.slice(0, 3000))
      .replace('{TITLE}', title)

    const completion = await withRetry(() =>
      groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 300,
      })
    )

    const text = completion.choices[0]?.message?.content?.trim() ?? ''

    // Strip any accidental markdown fences
    const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned) as { hook: string | null; score: number; categories: string[] }

    // Accept score ≥ 4. The 8B model tends to score conservatively — genuine
    // hooks often land at 4, and raising the bar to 5 causes most articles
    // to fail even when the content is interesting.
    if (!parsed.hook || parsed.score < 4) return null

    return {
      hook: parsed.hook,
      score: parsed.score,
      categories: Array.isArray(parsed.categories) ? parsed.categories.slice(0, 5) : [],
    }
  } catch (err) {
    console.error('[Groq] extractHook failed:', err)
    return null
  }
}
