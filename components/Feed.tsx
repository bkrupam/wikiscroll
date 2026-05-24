'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { CardPanel, GRADIENTS, type CardData } from './WikiCard'
import { SkeletonPanel } from './SkeletonCard'

/**
 * Feed — on-demand 1-card lookahead.
 *
 * As soon as the user lands on card N, we fire a background request to generate
 * card N+1. By the time they swipe, the next card is almost always ready.
 * If they swipe before it's ready they see a skeleton at the next slot — never
 * a full-page loading screen.
 *
 * The page never scrolls; we drive activeIndex directly from wheel / key / touch
 * and translate cards in/out with CSS transforms.
 */

const TRANSITION_MS  = 650
const WHEEL_THRESHOLD = 40
const TOUCH_THRESHOLD = 50
const GRADIENT_COUNT  = 6

// Sky Dream Gradient (design system) — background for the generating slot
const SKELETON_GRADIENT =
  'linear-gradient(180deg, rgb(242, 241, 237) 0%, rgb(213, 223, 224) 70%, rgb(229, 255, 148) 100%)'

/** Pick a gradient ID that differs from the previous card's.
 *  The DB stores a gradient per card, but cards are served in algorithm-ranked
 *  order, so the stored gradient can collide with an adjacent served card.
 *  We override at serve-time on the client to guarantee no two adjacent
 *  cards share a gradient — the user perception is what matters. */
function pickNextGradient(lastId: number | undefined): number {
  if (lastId === undefined) {
    return Math.floor(Math.random() * GRADIENT_COUNT) + 1
  }
  let id: number
  do {
    id = Math.floor(Math.random() * GRADIENT_COUNT) + 1
  } while (id === lastId)
  return id
}

export function Feed() {
  const [cards, setCards]               = useState<CardData[]>([])
  const [activeIndex, setActiveIndex]   = useState(0)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [isPrefetching, setIsPrefetching] = useState(false)
  const [enteringCardId, setEnteringCardId] = useState<string | null>(null)

  // Refs so event handlers always see the latest values without closure staleness
  const loadedIdsRef       = useRef<Set<string>>(new Set())
  const isPrefetchingRef   = useRef(false)
  const cardsLengthRef     = useRef(0)
  const activeIndexRef     = useRef(0)
  const transitioningRef   = useRef(false)
  const wheelAccRef        = useRef(0)
  const wheelTimerRef      = useRef<number | null>(null)
  const dwellStartRef      = useRef<number>(Date.now())
  const lastActiveRef      = useRef(0)
  // Guard against React 18 strict-mode firing the initial-load effect twice,
  // which otherwise burns through Groq calls and rate-limits on every page load.
  const initFiredRef       = useRef(false)

  useEffect(() => { activeIndexRef.current = activeIndex },  [activeIndex])
  useEffect(() => { cardsLengthRef.current = cards.length }, [cards.length])

  // ── Single-card fetch ─────────────────────────────────────────────────────
  const fetchOneCard = useCallback(async (): Promise<CardData | null> => {
    const excludeParam = [...loadedIdsRef.current].join(',')
    const url = excludeParam
      ? `/api/card/next?exclude=${excludeParam}`
      : '/api/card/next'
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json() as { card: CardData | null }
      return data.card ?? null
    } catch {
      return null
    }
  }, [])

  // Fire a background prefetch and append the result to cards when it lands.
  // Keeps the skeleton visible throughout all retry attempts — the user always
  // sees "Generating…" rather than a blank screen or sudden disappearing card.
  const startPrefetch = useCallback(async () => {
    if (isPrefetchingRef.current) return
    isPrefetchingRef.current = true
    setIsPrefetching(true)

    let card: CardData | null = null
    const MAX_ATTEMPTS = 6

    for (let attempt = 0; attempt < MAX_ATTEMPTS && !card; attempt++) {
      card = await fetchOneCard()
      if (!card && attempt < MAX_ATTEMPTS - 1) {
        // Exponential backoff: 1s → 1.5s → 2.25s … capped at 4s
        const delay = Math.min(1000 * Math.pow(1.5, attempt), 4000)
        await new Promise<void>((r) => window.setTimeout(r, delay))
      }
    }

    if (card) {
      loadedIdsRef.current.add(card.id)
      setCards((prev) => {
        const lastGradient = prev[prev.length - 1]?.gradientId
        return [...prev, { ...card!, gradientId: pickNextGradient(lastGradient) }]
      })
      // Animate the card in when it replaces the skeleton
      setEnteringCardId(card.id)
      window.setTimeout(() => setEnteringCardId(null), 400)
    }

    isPrefetchingRef.current = false
    setIsPrefetching(false)
  }, [fetchOneCard])

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Strict-mode double-fire guard: useRef persists across the dev-mode
    // setup → cleanup → setup cycle, so the second fire bails out cleanly.
    if (initFiredRef.current) return
    initFiredRef.current = true

    const init = async () => {
      setLoading(true)
      const card = await fetchOneCard()
      if (card) {
        loadedIdsRef.current.add(card.id)
        setCards([{ ...card, gradientId: pickNextGradient(undefined) }])
      } else {
        setError('Could not connect. Check your API keys and try again.')
      }
      setLoading(false)
    }
    init()
  }, [fetchOneCard])

  // ── Prefetch trigger ──────────────────────────────────────────────────────
  // Start generating the next card the moment the user lands on the last one.
  useEffect(() => {
    if (cards.length === 0) return
    if (activeIndex === cards.length - 1 && !isPrefetchingRef.current) {
      startPrefetch()
    }
  }, [activeIndex, cards.length, startPrefetch])

  // ── Safety snap-back ──────────────────────────────────────────────────────
  // If all retries are exhausted and the user is past the last real card
  // (empty slot), silently nudge them back so they don't stare at a blank screen.
  useEffect(() => {
    if (!isPrefetching && cards.length > 0 && activeIndex >= cards.length) {
      setActiveIndex(cards.length - 1)
    }
  }, [isPrefetching, activeIndex, cards.length])

  // ── Input → activeIndex ──────────────────────────────────────────────────
  useEffect(() => {
    if (!cards.length) return

    const advance = (direction: 1 | -1) => {
      if (transitioningRef.current) return
      const current = activeIndexRef.current
      const next    = current + direction
      if (next < 0) return

      // Upper bound: last real card + 1 skeleton slot (if generating)
      const cap = cardsLengthRef.current - 1 + (isPrefetchingRef.current ? 1 : 0)
      if (next > cap) return

      transitioningRef.current = true
      setActiveIndex(next)
      window.setTimeout(() => { transitioningRef.current = false }, TRANSITION_MS)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (transitioningRef.current) { wheelAccRef.current = 0; return }
      wheelAccRef.current += e.deltaY
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = window.setTimeout(() => { wheelAccRef.current = 0 }, 180)
      if      (wheelAccRef.current >  WHEEL_THRESHOLD) { advance(1);  wheelAccRef.current = 0 }
      else if (wheelAccRef.current < -WHEEL_THRESHOLD) { advance(-1); wheelAccRef.current = 0 }
    }

    const onKey = (e: KeyboardEvent) => {
      if      (['ArrowDown', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); advance(1)  }
      else if (['ArrowUp',         'PageUp' ].includes(e.key)) { e.preventDefault(); advance(-1) }
    }

    let touchStartY = 0
    const onTouchStart = (e: TouchEvent) => { touchStartY = e.touches[0].clientY }
    const onTouchMove  = (e: TouchEvent) => { if (e.cancelable) e.preventDefault() }
    const onTouchEnd   = (e: TouchEvent) => {
      const dy = touchStartY - e.changedTouches[0].clientY
      if (Math.abs(dy) >= TOUCH_THRESHOLD) advance(dy > 0 ? 1 : -1)
    }

    window.addEventListener('wheel',      onWheel,      { passive: false })
    window.addEventListener('keydown',    onKey)
    window.addEventListener('touchstart', onTouchStart, { passive: true  })
    window.addEventListener('touchmove',  onTouchMove,  { passive: false })
    window.addEventListener('touchend',   onTouchEnd,   { passive: true  })

    return () => {
      window.removeEventListener('wheel',      onWheel)
      window.removeEventListener('keydown',    onKey)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove',  onTouchMove)
      window.removeEventListener('touchend',   onTouchEnd)
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current)
    }
  }, [cards.length])

  // ── Dwell tracking ────────────────────────────────────────────────────────
  useEffect(() => {
    const prev = lastActiveRef.current
    if (prev === activeIndex || !cards[prev]) {
      lastActiveRef.current = activeIndex
      return
    }

    const dwellSeconds = (Date.now() - dwellStartRef.current) / 1000
    fetch('/api/behavior', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cardId: cards[prev].id, dwellSeconds }),
    }).catch(console.error)

    // Fire skip signal for any jumped-over cards
    const step = activeIndex > prev ? 1 : -1
    for (let i = prev + step; i !== activeIndex; i += step) {
      if (cards[i]) {
        fetch('/api/behavior', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ cardId: cards[i].id, dwellSeconds: 0 }),
        }).catch(console.error)
      }
    }

    dwellStartRef.current = Date.now()
    lastActiveRef.current = activeIndex
  }, [activeIndex, cards])

  // Report dwell on tab close
  useEffect(() => {
    const handleUnload = () => {
      if (!cards[activeIndex]) return
      const dwellSeconds = (Date.now() - dwellStartRef.current) / 1000
      navigator.sendBeacon?.(
        '/api/behavior',
        new Blob(
          [JSON.stringify({ cardId: cards[activeIndex].id, dwellSeconds })],
          { type: 'application/json' }
        )
      )
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [activeIndex, cards])

  // ── States ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <FullViewport>
        <div className="text-center">
          <p className="text-[#696f7b] mb-4 text-[15px]">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true) }}
            className="px-5 py-2 rounded-full bg-[#ebffb1] border border-[#ade900] text-sm font-medium"
          >
            Try again
          </button>
        </div>
      </FullViewport>
    )
  }

  if (loading) {
    return (
      <FullViewport>
        <SkeletonPanel />
      </FullViewport>
    )
  }

  // ── Main feed ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 overflow-hidden">

      {/* Background gradients — one per real card + one for the skeleton slot */}
      {cards.map((card, i) => (
        <div
          key={`bg-${card.id}`}
          className="absolute inset-0 transition-opacity ease-out"
          style={{
            background:          GRADIENTS[card.gradientId] ?? GRADIENTS[1],
            opacity:             i === activeIndex ? 1 : 0,
            transitionDuration:  `${TRANSITION_MS}ms`,
          }}
        />
      ))}
      {isPrefetching && (
        <div
          className="absolute inset-0 transition-opacity ease-out"
          style={{
            background:         SKELETON_GRADIENT,
            opacity:            activeIndex >= cards.length ? 1 : 0,
            transitionDuration: `${TRANSITION_MS}ms`,
          }}
        />
      )}

      {/* Card stack */}
      <div className="relative h-full">
        {cards.map((card, i) => {
          const offset = i - activeIndex
          if (Math.abs(offset) > 1) return null
          return (
            <div
              key={card.id}
              className="absolute inset-0 flex items-center justify-center px-6 sm:px-16 py-8 ease-out"
              style={{
                transform:         `translate3d(0, ${offset * 100}%, 0)`,
                transition:        `transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                willChange:        'transform',
              }}
            >
              {/* Fade-in when this card just replaced the skeleton */}
              <div className={card.id === enteringCardId ? 'card-enter' : ''}>
                <CardPanel card={card} />
              </div>
            </div>
          )
        })}

        {/* Skeleton slot — always exactly one position ahead of the last real card */}
        {isPrefetching && Math.abs(cards.length - activeIndex) <= 1 && (
          <div
            className="absolute inset-0 flex items-center justify-center px-6 sm:px-16 py-8 ease-out"
            style={{
              transform:        `translate3d(0, ${(cards.length - activeIndex) * 100}%, 0)`,
              transition:       `transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
              willChange:       'transform',
            }}
          >
            <SkeletonPanel />
          </div>
        )}
      </div>

      {/* Scroll hint (first card only) */}
      {activeIndex === 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 opacity-50 pointer-events-none z-40">
          <span className="text-[10px] text-[#696f7b] tracking-[0.2em] uppercase font-medium">
            scroll
          </span>
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="#696f7b" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className="animate-bounce"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      )}
    </div>
  )
}

function FullViewport({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-6 sm:px-16"
      style={{ background: 'linear-gradient(180deg, #f5f3ef 0%, #e8e0e5 100%)' }}
    >
      {children}
    </div>
  )
}
