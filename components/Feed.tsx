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
 * Feed — on-demand 1-card lookahead with save + rabbit hole mode.
 *
 * Navigation:    ↑ / ↓  |  scroll wheel  |  touch swipe up/down
 * Save card:     →       |  touch swipe right
 * Skip (signal): ←       |  touch swipe left
 *
 * Rabbit hole: after 2 consecutive dwells ≥ 15 s the next fetch passes
 * relatedTo=wikiTitle so the server follows that article's links instead of
 * the Thompson-ranked buffer. Two fast swipes (< 2 s each) exit the thread.
 */

const TRANSITION_MS   = 650
const WHEEL_THRESHOLD = 40
const TOUCH_THRESHOLD = 50
const GRADIENT_COUNT  = 6

// Rabbit hole thresholds
const RABBIT_HOLE_DWELL_S = 15   // seconds that count as a "deep read"
const RABBIT_HOLE_TRIGGER = 2    // consecutive deep reads before activating
const RABBIT_HOLE_EXIT    = 2    // consecutive fast swipes (< 2 s) to exit

const SKELETON_GRADIENT =
  'linear-gradient(180deg, rgb(242, 241, 237) 0%, rgb(213, 223, 224) 70%, rgb(229, 255, 148) 100%)'

function pickNextGradient(lastId: number | undefined): number {
  if (lastId === undefined) return Math.floor(Math.random() * GRADIENT_COUNT) + 1
  let id: number
  do { id = Math.floor(Math.random() * GRADIENT_COUNT) + 1 } while (id === lastId)
  return id
}

function loadSavedIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem('wikiscroll-saved')
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}

function persistSavedIds(ids: Set<string>) {
  try { localStorage.setItem('wikiscroll-saved', JSON.stringify([...ids])) } catch { /* noop */ }
}

export const Feed = forwardRef<FeedHandle>(function Feed(_, ref) {
  const [cards, setCards]                   = useState<CardData[]>([])
  const [activeIndex, setActiveIndex]       = useState(0)
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState<string | null>(null)
  const [isPrefetching, setIsPrefetching]   = useState(false)
  const [enteringCardId, setEnteringCardId] = useState<string | null>(null)

  // Save feature
  const [savedIds, setSavedIds]   = useState<Set<string>>(loadSavedIds)
  const [showSaves, setShowSaves] = useState(false)
  const [toastVisible, setToastVisible] = useState(false)

  // Taste modal
  const [showTaste, setShowTaste] = useState(false)

  // Expose openTaste / openSaves to the nav bar via ref
  useImperativeHandle(ref, () => ({
    openTaste: () => setShowTaste(true),
    openSaves: () => setShowSaves(true),
  }))

  // Rabbit hole
  const [isRabbitHole, setIsRabbitHole]         = useState(false)
  const [rabbitHoleTitle, setRabbitHoleTitle]   = useState<string | null>(null)

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

  // Rabbit hole refs (readable inside event handlers / async callbacks)
  const consecutiveLongDwellsRef = useRef(0)
  const fastSwipeCountRef        = useRef(0)
  const isRabbitHoleRef          = useRef(false)
  const rabbitHoleTitleRef       = useRef<string | null>(null)

  // Keep refs in sync with state
  useEffect(() => { activeIndexRef.current   = activeIndex },   [activeIndex])
  useEffect(() => { cardsLengthRef.current   = cards.length },  [cards.length])
  useEffect(() => { cardsRef.current         = cards },         [cards])
  useEffect(() => { isRabbitHoleRef.current  = isRabbitHole },  [isRabbitHole])
  useEffect(() => { rabbitHoleTitleRef.current = rabbitHoleTitle }, [rabbitHoleTitle])

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
  const fetchOneCard = useCallback(async (relatedTo?: string): Promise<CardData | null> => {
    const params = new URLSearchParams()
    const excludeParam = [...loadedIdsRef.current].join(',')
    if (excludeParam) params.set('exclude', excludeParam)
    if (relatedTo)    params.set('relatedTo', relatedTo)
    const qs  = params.size ? '?' + params.toString() : ''
    const url = `/api/card/next${qs}`
    try {
      const res = await fetch(url)
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

    const relatedTo = isRabbitHoleRef.current
      ? (rabbitHoleTitleRef.current ?? undefined)
      : undefined

    let card: CardData | null = null
    const MAX_ATTEMPTS = 6

    for (let attempt = 0; attempt < MAX_ATTEMPTS && !card; attempt++) {
      card = await fetchOneCard(relatedTo)
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
  const saveCard = useCallback((cardId: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (next.has(cardId)) {
        next.delete(cardId)
        // No toast on unsave — just silently remove
      } else {
        next.add(cardId)
        // Show toast
        setToastVisible(true)
        if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
        toastTimerRef.current = window.setTimeout(() => setToastVisible(false), 2000)
        // Signal to algorithm
        fetch('/api/behavior', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ cardId, action: 'SAVE' }),
        }).catch(console.error)
      }
      persistSavedIds(next)
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

    // ── Rabbit hole counter ────────────────────────────────────────────────
    if (dwellSeconds >= RABBIT_HOLE_DWELL_S) {
      consecutiveLongDwellsRef.current += 1
      fastSwipeCountRef.current = 0

      if (!isRabbitHoleRef.current && consecutiveLongDwellsRef.current >= RABBIT_HOLE_TRIGGER) {
        // Activate — follow links from the article the user just left
        const src = cards[prev]?.wikiTitle ?? null
        setIsRabbitHole(true)
        setRabbitHoleTitle(src)
        isRabbitHoleRef.current    = true
        rabbitHoleTitleRef.current = src
      } else if (isRabbitHoleRef.current && cards[activeIndex]) {
        // Already in rabbit hole — advance the source so thread keeps moving forward
        const nxt = cards[activeIndex].wikiTitle
        setRabbitHoleTitle(nxt)
        rabbitHoleTitleRef.current = nxt
      }
    } else if (dwellSeconds < 2) {
      consecutiveLongDwellsRef.current = 0
      if (isRabbitHoleRef.current) {
        fastSwipeCountRef.current += 1
        if (fastSwipeCountRef.current >= RABBIT_HOLE_EXIT) {
          setIsRabbitHole(false)
          setRabbitHoleTitle(null)
          isRabbitHoleRef.current    = false
          rabbitHoleTitleRef.current = null
          fastSwipeCountRef.current  = 0
        }
      } else {
        fastSwipeCountRef.current = 0
      }
    } else {
      // Medium dwell (2–15 s) — doesn't push either counter
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

  const savedCardsList = cards.filter((c) => savedIds.has(c.id))

  // ── Main feed ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 overflow-hidden">

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
          const threadLabel = (isRabbitHole && i === activeIndex && rabbitHoleTitle)
            ? rabbitHoleTitle
            : undefined
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
                  threadLabel={threadLabel}
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

      {/* Saves panel */}
      {showSaves && (
        <SavesPanel
          cards={savedCardsList}
          savedIds={savedIds}
          onSave={saveCard}
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
  onSave,
  onClose,
}: {
  cards: CardData[]
  savedIds: Set<string>
  onSave: (id: string) => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
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
                className="flex items-start gap-4 px-7 py-4 border-b border-[#f0eee9] last:border-0"
              >
                <div className="flex-1 min-w-0">
                  {card.categories[0] && (
                    <span className="text-[10px] font-semibold text-[#696f7b] tracking-[0.08em] uppercase">
                      {card.categories[0]}
                    </span>
                  )}
                  <p className="text-[14px] text-[#22282a] font-[500] leading-snug mt-1 line-clamp-3">
                    {card.hookText}
                  </p>
                  <a
                    href={card.wikiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-[#696f7b] hover:text-[#22282a] transition-colors mt-1.5 inline-block"
                  >
                    {card.wikiTitle} ↗
                  </a>
                </div>
                <button
                  onClick={() => onSave(card.id)}
                  className="flex-shrink-0 mt-1 opacity-40 hover:opacity-100 transition-opacity"
                  aria-label="Remove from saved"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                    stroke="#696f7b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
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
