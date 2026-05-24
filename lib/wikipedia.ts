const WIKI_BASE = 'https://en.wikipedia.org/api/rest_v1'
const WIKI_API  = 'https://en.wikipedia.org/w/api.php'

export interface WikiSummary {
  title: string
  extract: string
  url: string
  categories: string[]
}

/** Minimum extract length to be considered a real article (not a stub) */
const MIN_EXTRACT_LENGTH = 600

/** Titles that indicate list/index pages we want to skip */
const SKIP_PREFIXES = ['List of', 'Index of', 'Outline of', 'Template:', 'Wikipedia:']

/** Fetch a specific article by title using the REST summary endpoint */
export async function fetchArticleByTitle(title: string): Promise<WikiSummary | null> {
  try {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'))
    const res = await fetch(`${WIKI_BASE}/page/summary/${encoded}`, {
      headers: { 'User-Agent': 'WikiScroll/1.0 (educational project)' },
      next: { revalidate: 0 },
    })
    if (!res.ok) return null
    const data = await res.json()
    return parseSummary(data)
  } catch {
    return null
  }
}

/** Fetch a truly random Wikipedia article */
export async function fetchRandomArticle(): Promise<WikiSummary | null> {
  try {
    const res = await fetch(`${WIKI_BASE}/page/random/summary`, {
      headers: { 'User-Agent': 'WikiScroll/1.0 (educational project)' },
      next: { revalidate: 0 },
    })
    if (!res.ok) return null
    const data = await res.json()
    return parseSummary(data)
  } catch {
    return null
  }
}

/** Fetch a random article from a specific Wikipedia category */
export async function fetchRandomFromCategory(category: string): Promise<WikiSummary | null> {
  try {
    // Get a random page from the category
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmtype: 'page',
      cmlimit: '50',
      format: 'json',
      origin: '*',
    })
    const res = await fetch(`${WIKI_API}?${params}`, {
      headers: { 'User-Agent': 'WikiScroll/1.0 (educational project)' },
      next: { revalidate: 0 },
    })
    if (!res.ok) return null
    const data = await res.json()
    const members: Array<{ title: string }> = data?.query?.categorymembers ?? []
    if (!members.length) return null

    // Pick a random one from the results
    const randomMember = members[Math.floor(Math.random() * members.length)]
    return fetchArticleByTitle(randomMember.title)
  } catch {
    return null
  }
}

/** Get Wikipedia categories for an article title */
export async function fetchArticleCategories(title: string): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'categories',
      cllimit: '20',
      format: 'json',
      origin: '*',
    })
    const res = await fetch(`${WIKI_API}?${params}`, {
      headers: { 'User-Agent': 'WikiScroll/1.0 (educational project)' },
      next: { revalidate: 0 },
    })
    if (!res.ok) return []
    const data = await res.json()
    const pages = data?.query?.pages ?? {}
    const page = Object.values(pages)[0] as { categories?: Array<{ title: string }> }
    if (!page?.categories) return []
    return page.categories
      .map((c) => c.title.replace('Category:', '').trim())
      .filter((c) => !c.startsWith('Articles') && !c.startsWith('CS1') && !c.startsWith('Webarchive'))
      .slice(0, 5)
  } catch {
    return []
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

function parseSummary(data: Record<string, unknown>): WikiSummary | null {
  const title   = data.title as string
  const type    = data.type as string
  const extract = data.extract as string
  const url     = (data.content_urls as { desktop?: { page?: string } })?.desktop?.page
               ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`

  if (!extract || extract.length < MIN_EXTRACT_LENGTH) return null
  if (type === 'disambiguation') return null
  if (SKIP_PREFIXES.some((p) => title.startsWith(p))) return null

  return { title, extract, url, categories: [] }
}
