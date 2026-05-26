import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

const MODEL = 'llama-3.1-8b-instant'

async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const retryable =
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('rate_limit') ||
        msg.includes('Service Unavailable') ||
        msg.includes('overloaded')
      if (!retryable || i === retries - 1) throw err
      const delay = 1500 * Math.pow(2, i)
      console.log(`[Groq] Retrying in ${delay}ms (attempt ${i + 1}/${retries})…`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error('Max retries exceeded')
}

function stripFences(text: string): string {
  return text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
}

/* ──────────────────────────────────────────────────────────────────────────
 *  1.  Hook + taxonomy path extraction
 *  Returns the hook itself plus a path through the 3-level taxonomy.
 *  The depth-0 (root) name MUST be one of the provided roots; depths 1 and 2
 *  may either reuse existing names under that root or propose new ones.
 * ────────────────────────────────────────────────────────────────────────── */

export interface PathResult {
  hook:    string
  score:   number
  /** [rootName, subName, subSubName] — all strings, trimmed. */
  path:    [string, string, string]
}

const HOOK_AND_PATH_PROMPT = `You are a hook writer and topic classifier for a Wikipedia-driven scroll feed.

TASK A — write a hook:
- Find the single most surprising, counterintuitive, or mind-blowing fact buried in the article.
- 1–3 sentences MAX. No title. No "Did you know". No "According to Wikipedia". No "In fact,".
- Lead with the surprising fact first.
- Score how hook-worthy this is 1–10. Be strict; only genuine hooks > 6.

TASK B — classify into a 3-level taxonomy:
- Pick ONE root topic from this fixed list: {ROOTS}
- Pick ONE subtopic under that root. Examples: under "Psychology" → "Brain Health", "Cognitive Biases", "Memory"; under "Space" → "Cosmology", "Black Holes". Use 2–4 words.
- Pick ONE sub-subtopic that is a specific named field inside the subtopic. Examples: under "Brain Health" → "Neuroplasticity"; under "Black Holes" → "Event Horizons". Use 2–4 words.
- All three must describe the article accurately. Be specific at the leaf; don't repeat the parent.

Wikipedia title (context only, do not put in hook): {TITLE}

Wikipedia extract:
"""
{EXTRACT}
"""

Return ONLY valid JSON, no markdown, no commentary:
{"hook":"string","score":number,"root":"string","subtopic":"string","subsubtopic":"string"}`

export async function extractHookAndPath(
  title: string,
  extract: string,
  roots: readonly string[],
): Promise<PathResult | null> {
  try {
    const prompt = HOOK_AND_PATH_PROMPT
      .replace('{ROOTS}',   roots.join(', '))
      .replace('{TITLE}',   title)
      .replace('{EXTRACT}', extract.slice(0, 3000))

    const completion = await withRetry(() =>
      groq.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        max_tokens: 400,
      }),
    )

    const text = stripFences(completion.choices[0]?.message?.content ?? '')
    const parsed = JSON.parse(text) as {
      hook?:        string | null
      score?:       number
      root?:        string
      subtopic?:    string
      subsubtopic?: string
    }

    if (!parsed.hook || (parsed.score ?? 0) < 4) return null
    if (!parsed.root || !parsed.subtopic || !parsed.subsubtopic) return null

    // Normalise — model sometimes echoes the prompt list verbatim, fix casing
    const normalisedRoot = roots.find(
      (r) => r.toLowerCase() === parsed.root!.trim().toLowerCase(),
    )
    if (!normalisedRoot) return null

    return {
      hook:  parsed.hook,
      score: parsed.score!,
      path:  [normalisedRoot, parsed.subtopic.trim(), parsed.subsubtopic.trim()],
    }
  } catch (err) {
    console.error('[Groq] extractHookAndPath failed:', err)
    return null
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 *  2.  Taxonomy expansion — used by the settings UI to lazy-fill a branch.
 *  Given a parent name + depth, returns suggested children.
 * ────────────────────────────────────────────────────────────────────────── */

const EXPAND_PROMPT = `You are building a hierarchical topic taxonomy for a Wikipedia-driven knowledge app.

Parent topic: "{PARENT}"
Parent depth: {DEPTH}   (0 = root, 1 = subtopic, 2 = sub-subtopic)
Existing children (do NOT repeat these): {EXISTING}

Return 6 children that:
- Belong directly under the parent (one level deeper).
- Are concrete, well-known fields a curious reader would recognise.
- Are 2–4 words each. No definitions, no parentheticals.
- If parent depth is 0, children are broad subtopics. If parent depth is 1, children are specific named fields/phenomena.
- Avoid overlap with the existing children list.

Return ONLY valid JSON, no markdown:
{"children":["...","...","...","...","...","..."]}`

export async function expandChildren(
  parentName: string,
  parentDepth: number,
  existingNames: string[] = [],
): Promise<string[]> {
  try {
    const prompt = EXPAND_PROMPT
      .replace('{PARENT}',   parentName)
      .replace('{DEPTH}',    String(parentDepth))
      .replace('{EXISTING}', existingNames.length ? existingNames.join(', ') : '(none)')

    const completion = await withRetry(() =>
      groq.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 250,
      }),
    )

    const text = stripFences(completion.choices[0]?.message?.content ?? '')
    const parsed = JSON.parse(text) as { children?: string[] }
    const existingLower = new Set(existingNames.map((n) => n.toLowerCase()))

    return (parsed.children ?? [])
      .map((c) => c.trim())
      .filter((c) => c.length > 0 && c.length < 60)
      .filter((c) => !existingLower.has(c.toLowerCase()))
      .slice(0, 6)
  } catch (err) {
    console.error('[Groq] expandChildren failed:', err)
    return []
  }
}
