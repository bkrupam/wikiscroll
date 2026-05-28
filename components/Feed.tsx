'use client'

import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { CardPanel, GRADIENTS, type CardData } from './WikiCard'
import { SkeletonPanel } from './SkeletonCard'
import { TasteModal } from './TasteModal'

/** Imperative handle exposed to the parent page so nav buttons can trigger modals */
export interface FeedHandle {
  openTaste: () => void
  openSaves: () => void
}

/**
 * Feed — on-demand 1-card lookahead with save.
 *
 * Navigation:    ↑ / ↓  |  scroll wheel  |  touch swipe up/down
 * Save card:     →       |  touch swipe right
 * Skip (signal): ←       |  touch swipe left
 */

const TRANSITION_MS   = 650
const WHEEL_THRESHOLD = 40
const TOUCH_THRESHOLD = 50
const GRADIENT_COUNT  = 6

// Rabbit hole — activated after 2 consecutive long dwells, exits after cap or fast swipes
const RABBIT_HOLE_DWELL_S   = 15   // seconds to count as a "long dwell"
const RABBIT_HOLE_TRIGGER   = 2    // consecutive long dwells to activate
const RABBIT_HOLE_MAX_CARDS = 15   // auto-exit after this many rabbit hole cards
const RABBIT_HOLE_EXIT      = 2    // consecutive fast swipes to exit

const SKELETON_GRADIENT =
  'linear-gradient(180deg, rgb(242, 241, 237) 0%, rgb(213, 223, 224) 70%, rgb(229, 255, 148) 100%)'

function pickNextGradient(lastId: number | undefined): number {
  if (lastId === undefined) return Math.floor(Math.random() * GRADIENT_COUNT) + 1
  let id: number
  do { id = Math.floor(Math.random() * GRADIENT_COUNT) + 1 } while (id === lastId)
  return id
}

/** Hydrate from /api/saves (DB-backed). Legacy localStorage migration runs once
 *  on first load so anyone who saved cards in the old build doesn't lose them. */
async function fetchSavedIds(): Promise<Set<string>> {
  try {
    const res = await fetch('/api/saves')
    if (!res.ok) return new Set()
    const data = await res.json() as { ids?: string[] }
    return new Set(data.ids ?? [])
  } catch { return new Set() }
}

async function migrateLegacyLocalSaves(): Promise<void> {
  if (typeof window === 'undefined') return
  const raw = localStorage.getItem('wikiscroll-saved')
  if (!raw) return
  try {
    const ids = JSON.parse(raw) as string[]
    if (ids.length === 0) { localStorage.removeItem('wikiscroll-saved'); return }
    await fetch('/api/saves', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ add: ids }),
    })
    localStorage.removeItem('wikiscroll-saved')
  } catch { /* noop */ }
}

export const Feed = forwardRef<FeedHandle>(function Feed(_, ref) {
  const [cards, setCards]                   = useState<CardData[]>([])
  const [activeIndex, setActiveIndex]       = useState(0)
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState<string | null>(null)
  const [isPrefetching, setIsPrefetching]   = useState(false)
  const [enteringCardId, setEnteringCardId] = useState<string | null>(null)

  // Save feature — hydrated from /api/saves on mount
  const [savedIds, setSavedIds]   = useState<Set<string>>(new Set())
  const [showSaves, setShowSaves] = useState(false)
  const [toastVisible, setToastVisible] = useState(false)

  // Taste modal
  const [showTaste, setShowTaste] = useState(false)

  // Expose openTaste / openSaves to the nav bar via ref
  useImperativeHandle(ref, () => ({
    openTaste: () => setShowTaste(true),
    openSaves: () => setShowSaves(true),
  }))

  // Hints — visible for first 3 card advances, then gone forever
  const [hintsVisible, setHintsVisible] = useState(true)

  // ── Refs ──────────────────────────────────────────────────────────────────
  const loadedIdsRef       = useRef<Set<string>>(new Set())
  const isPrefetchingRef   = useRef(false)
  const cardsLengthRef     = useRef(0)
  const activeIndexRef     = useRef(0)
  const transitioningRef   = useRef(false)
  const wheelAccRef        = useRef(0)
  const wheelTimerRef      = useRef<number | null>(null)
  const dwellStartRef      = useRef<number>(Date.now())
  const lastActiveRef      = useRef(0)
  const initFiredRef       = useRef(false)
  const advanceCountRef    = useRef(0)
  const cardsRef           = useRef<CardData[]>([])
  const toastTimerRef      = useRef<number | null>(null)

  // Rabbit hole refs — no React state needed (nothing renders from them)
  const isRabbitHoleRef          = useRef(false)
  const rabbitHoleTitleRef       = useRef<string | null>(null)
  const consecutiveLongDwellsRef = useRef(0)
  const fastSwipeCountRef        = useRef(0)
  const rabbitHoleCardsRef       = useRef(0)

  // Keep refs in sync with state
  useEffect(() => { activeIndexRef.current = activeIndex },  [activeIndex])
  useEffect(() => { cardsLengthRef.current = cards.length }, [cards.length])
  useEffect(() => { cardsRef.current       = cards },        [cards])

  // Sync save count into the nav bar badge rendered by page.tsx
  useEffect(() => {
    const badge = document.getElementById('save-count-badge')
    if (!badge) return
    if (savedIds.size > 0) {
      badge.textContent = String(savedIds.size)
      badge.setAttribute('style', [
        'position:absolute',
        'top:-4px',
        'right:-4px',
        'min-width:16px',
        'height:16px',
        'border-radius:999px',
        'background:#ade900',
        'color:#000',
        'font-size:9px',
        'font-weight:700',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:0 3px',
        'line-height:1',
      ].join(';'))
    } else {
      badge.textContent = ''
      badge.setAttribute('style', 'display:none')
    }
  }, [savedIds.size])

  // ── Single-card fetch ─────────────────────────────────────────────────────
  const fetchOneCard = useCallback(async (): Promise<CardData | null> => {
    const excludeParam = [...loadedIdsRef.current].join(',')
    const qs = excludeParam ? `?exclude=${excludeParam}` : ''
    try {
      const res = await fetch(`/api/card/next${qs}`)
      if (!res.ok) return null
      const data = await res.json() as { card: CardData | null }
      return data.card ?? null
    } catch {
      return null
    }
  }, [])

  // ── Prefetch ──────────────────────────────────────────────────────────────
  const startPrefetch = useCallback(async () => {
    if (isPrefetchingRef.current) return
    isPrefetchingRef.current = true
    setIsPrefetching(true)

    let card: CardData | null = null
    const MAX_ATTEMPTS = 6

    // In rabbit hole mode, try to fetch a related card first
    if (isRabbitHoleRef.current && rabbitHoleTitleRef.current) {
      try {
        const fromTitle = encodeURIComponent(rabbitHoleTitleRef.current)
        const res = await fetch(`/api/card/next?relatedTo=${fromTitle}`)
        if (res.ok) {
          const data = await res.json() as { card: CardData | null }
          card = data.card ?? null
        }
      } catch { /* fall through to normal fetch */ }
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS && !card; attempt++) {
      card = await fetchOneCard()
      if (!card && attempt < MAX_ATTEMPTS - 1) {
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
      setEnteringCardId(card.id)
      window.setTimeout(() => setEnteringCardId(null), 400)
    }

    isPrefetchingRef.current = false
    setIsPrefetching(false)
  }, [fetchOneCard])

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (initFiredRef.current) return
    initFiredRef.current = true
    const init = async () => {
      setLoading(true)
      // Hydrate saves in parallel with the first card fetch.
      // Migrate any legacy localStorage saves once, then read from DB.
      await migrateLegacyLocalSaves()
      const [card, ids] = await Promise.all([fetchOneCard(), fetchSavedIds()])
      setSavedIds(ids)
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
  useEffect(() => {
    if (cards.length === 0) return
    if (activeIndex === cards.length - 1 && !isPrefetchingRef.current) {
      startPrefetch()
    }
  }, [activeIndex, cards.length, startPrefetch])

  // ── Safety snap-back ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPrefetching && cards.length > 0 && activeIndex >= cards.length) {
      setActiveIndex(cards.length - 1)
    }
  }, [isPrefetching, activeIndex, cards.length])

  // ── Save a card ───────────────────────────────────────────────────────────
  // Persists through /api/saves (DB, per-user). Optimistic UI + fire-and-forget.
  const saveCard = useCallback((cardId: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev)
      const adding = !next.has(cardId)
      if (adding) {
        next.add(cardId)
        setToastVisible(true)
        if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
        toastTimerRef.current = window.setTimeout(() => setToastVisible(false), 2000)
        fetch('/api/behavior', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ cardId, action: 'SAVE' }),
        }).catch(console.error)
        fetch('/api/saves', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ add: [cardId] }),
        }).catch(console.error)
      } else {
        next.delete(cardId)
        fetch('/api/saves', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ remove: [cardId] }),
        }).catch(console.error)
      }
      return next
    })
  }, [])

  // ── Explicit skip signal ──────────────────────────────────────────────────
  const skipCurrentCard = useCallback(() => {
    const card = cardsRef.current[activeIndexRef.current]
    if (!card) return
    fetch('/api/behavior', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cardId: card.id, action: 'SKIP' }),
    }).catch(console.error)
  }, [])

  // ── Input → activeIndex ───────────────────────────────────────────────────
  useEffect(() => {
    if (!cards.length) return

    const advance = (direction: 1 | -1) => {
      if (transitioningRef.current) return
      const current = activeIndexRef.current
      const next    = current + direction
      if (next < 0) return
      const cap = cardsLengthRef.current - 1 + (isPrefetchingRef.current ? 1 : 0)
      if (next > cap) return

      transitioningRef.current = true
      setActiveIndex(next)
      window.setTimeout(() => { transitioningRef.current = false }, TRANSITION_MS)

      advanceCountRef.current++
      if (advanceCountRef.current >= 3) setHintsVisible(false)
    }

    const saveActive = () => {
      const card = cardsRef.current[activeIndexRef.current]
      if (card) saveCard(card.id)
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
      else if (e.key === 'ArrowRight') { e.preventDefault(); saveActive()         }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); skipCurrentCard()    }
    }

    let touchStartY = 0
    let touchStartX = 0

    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY
      touchStartX = e.touches[0].clientX
    }
    const onTouchMove = (e: TouchEvent) => { if (e.cancelable) e.preventDefault() }
    const onTouchEnd  = (e: TouchEvent) => {
      const dy = touchStartY - e.changedTouches[0].clientY
      const dx = e.changedTouches[0].clientX - touchStartX

      if (Math.abs(dy) >= Math.abs(dx)) {
        // Vertical — navigate
        if (Math.abs(dy) >= TOUCH_THRESHOLD) advance(dy > 0 ? 1 : -1)
      } else {
        // Horizontal — save / skip
        if      (dx >=  TOUCH_THRESHOLD) saveActive()
        else if (dx <= -TOUCH_THRESHOLD) skipCurrentCard()
      }
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
  }, [cards.length, saveCard, skipCurrentCard])

  // ── Dwell tracking + rabbit hole counter ─────────────────────────────────
  useEffect(() => {
    const prev = lastActiveRef.current
    if (prev === activeIndex || !cards[prev]) {
      lastActiveRef.current = activeIndex
      return
    }

    const dwellSeconds = (Date.now() - dwellStartRef.current) / 1000

    // Send dwell signal
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

    // ── Rabbit hole tracking (no UI — purely drives the fetch path) ──────────
    const exitRabbitHole = () => {
      isRabbitHoleRef.current    = false
      rabbitHoleTitleRef.current = null
      fastSwipeCountRef.current  = 0
      rabbitHoleCardsRef.current = 0
    }

    if (isRabbitHoleRef.current) {
      rabbitHoleCardsRef.current += 1
      if (rabbitHoleCardsRef.current >= RABBIT_HOLE_MAX_CARDS) exitRabbitHole()
    }

    if (dwellSeconds >= RABBIT_HOLE_DWELL_S) {
      consecutiveLongDwellsRef.current += 1
      fastSwipeCountRef.current = 0

      if (!isRabbitHoleRef.current && consecutiveLongDwellsRef.current >= RABBIT_HOLE_TRIGGER) {
        isRabbitHoleRef.current    = true
        rabbitHoleTitleRef.current = cards[prev]?.wikiTitle ?? null
        rabbitHoleCardsRef.current = 0
      } else if (isRabbitHoleRef.current && cards[activeIndex]) {
        rabbitHoleTitleRef.current = cards[activeIndex].wikiTitle
      }
    } else if (dwellSeconds < 2) {
      consecutiveLongDwellsRef.current = 0
      if (isRabbitHoleRef.current) {
        fastSwipeCountRef.current += 1
        if (fastSwipeCountRef.current >= RABBIT_HOLE_EXIT) exitRabbitHole()
      } else {
        fastSwipeCountRef.current = 0
      }
    } else {
      fastSwipeCountRef.current = 0
    }

    dwellStartRef.current = Date.now()
    lastActiveRef.current = activeIndex
  }, [activeIndex, cards])

  // ── Report dwell on tab close ─────────────────────────────────────────────
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

  const savedCardsList = cards.filter((c) => savedIds.has(c.id))

  // ── Main feed ─────────────────────────────────────────────────────────────
  // Never early-return — modals must always be reachable from the nav buttons.
  return (
    <div className="fixed inset-0 overflow-hidden">

      {/* Error / loading screens */}
      {error && (
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
      )}
      {loading && !error && (
        <FullViewport>
          <SkeletonPanel />
        </FullViewport>
      )}

      {!error && !loading && (<>

      {/* Background gradients */}
      {cards.map((card, i) => (
        <div
          key={`bg-${card.id}`}
          className="absolute inset-0 transition-opacity ease-out"
          style={{
            background:         GRADIENTS[card.gradientId] ?? GRADIENTS[1],
            opacity:            i === activeIndex ? 1 : 0,
            transitionDuration: `${TRANSITION_MS}ms`,
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

      {/* Save toast — slides up from bottom, auto-dismisses */}
      <div
        className="absolute bottom-24 z-50 flex items-center gap-2.5 px-5 py-3 pointer-events-none"
        style={{
          left: '50%',
          borderRadius: '999px',
          background: '#ffffff',
          boxShadow: 'rgba(34, 40, 42, 0.12) 0px 4px 20px 0px',
          border: '1px solid rgba(173, 233, 0, 0.3)',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
          opacity: toastVisible ? 1 : 0,
          transform: toastVisible
            ? 'translateX(-50%) translateY(0px)'
            : 'translateX(-50%) translateY(8px)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24"
          fill="#000000" stroke="#000000" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{
          fontSize: '13px',
          fontWeight: 500,
          color: '#232529',
          letterSpacing: '0.01em',
        }}>
          Saved
        </span>
      </div>

      {/* Card stack — top padding clears the floating pill nav (16px gap + ~44px pill) */}
      <div className="relative h-full" style={{ paddingTop: '72px' }}>
        {cards.map((card, i) => {
          const offset      = i - activeIndex
          if (Math.abs(offset) > 1) return null
          return (
            <div
              key={card.id}
              className="absolute inset-0 flex items-center justify-center px-6 sm:px-16 py-8 ease-out"
              style={{
                transform:  `translate3d(0, ${offset * 100}%, 0)`,
                transition: `transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                willChange: 'transform',
              }}
            >
              <div className={card.id === enteringCardId ? 'card-enter' : ''}>
                <CardPanel
                  card={card}
                  saved={savedIds.has(card.id)}
                  onSave={() => saveCard(card.id)}
                />
              </div>
            </div>
          )
        })}

        {/* Skeleton slot */}
        {isPrefetching && Math.abs(cards.length - activeIndex) <= 1 && (
          <div
            className="absolute inset-0 flex items-center justify-center px-6 sm:px-16 py-8 ease-out"
            style={{
              transform:  `translate3d(0, ${(cards.length - activeIndex) * 100}%, 0)`,
              transition: `transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
              willChange: 'transform',
            }}
          >
            <SkeletonPanel />
          </div>
        )}
      </div>

      {/* Controls hint — shown on first card, disappears after 3 advances */}
      {hintsVisible && activeIndex === 0 && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none z-40"
          style={{ opacity: 0.5 }}
        >
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-[#696f7b] tracking-[0.15em] uppercase font-medium">
              ↑↓ scroll
            </span>
            <span className="text-[#c8cdd6] text-[10px]">·</span>
            <span className="text-[10px] text-[#696f7b] tracking-[0.15em] uppercase font-medium">
              → save
            </span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="#696f7b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="animate-bounce">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      )}

      </>)}

      {/* Saves panel */}
      {showSaves && (
        <SavesPanel
          cards={savedCardsList}
          onClose={() => setShowSaves(false)}
        />
      )}

      {/* Taste / preferences modal */}
      {showTaste && <TasteModal onClose={() => setShowTaste(false)} />}
    </div>
  )
})

// ── Saves panel ───────────────────────────────────────────────────────────────
function SavesPanel({
  cards,
  onClose,
}: {
  cards: CardData[]
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.15)', backdropFilter: 'blur(4px)' }}
      />

      {/* Sheet */}
      <div
        className="relative w-full sm:max-w-[560px] mx-0 sm:mx-6 rounded-t-[24px] sm:rounded-[24px] overflow-hidden"
        style={{ background: '#faf9f7', maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-6 pb-4 border-b border-[#f0eee9]">
          <div className="flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24"
              fill="#ade900" stroke="#ade900" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-[14px] font-semibold text-[#22282a]">Saved</span>
            <span className="text-[12px] text-[#696f7b] ml-0.5">{cards.length}</span>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[#f0eee9] transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="#696f7b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(80vh - 64px)' }}>
          {cards.length === 0 ? (
            <p className="text-center text-[#696f7b] text-[14px] py-12">Nothing saved yet.</p>
          ) : (
            cards.map((card) => (
              <div
                key={card.id}
                className="flex items-start gap-4 px-7 py-5 border-b border-[#f0eee9] last:border-0"
              >
                <div className="flex-1 min-w-0">
                  {card.categories[0] && (
                    <span className="text-[10px] font-semibold text-[#696f7b] tracking-[0.08em] uppercase block mb-2">
                      {card.categories[0]}
                    </span>
                  )}
                  <p className="text-[14px] text-[#22282a] font-[500] leading-snug line-clamp-3">
                    {card.hookText}
                  </p>
                  <a
                    href={card.wikiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-[#696f7b] hover:text-[#22282a] transition-colors mt-3 inline-block"
                  >
                    {card.wikiTitle} ↗
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
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
