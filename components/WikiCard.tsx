'use client'

import { LikeButton } from './LikeButton'

export interface CardData {
  id: string
  hookText: string
  wikiTitle: string
  wikiUrl: string
  categories: string[]
  gradientId: number
  tier: number
}

// Page-background gradients — applied by the Feed, not the card
export const GRADIENTS: Record<number, string> = {
  1: 'linear-gradient(180deg, #f5f3ef 0%, #e8e0e5 45%, #f0c8e0 100%)',  // pink/lavender
  2: 'linear-gradient(180deg, #f5f3ef 0%, #ffe8d0 50%, #ffc89a 100%)',  // peach
  3: 'linear-gradient(180deg, #f5f3ef 0%, #e8f0d8 50%, #c8e89a 100%)',  // lime
  4: 'linear-gradient(180deg, #f5f3ef 0%, #e0e8f0 50%, #b8d0e8 100%)',  // soft blue
  5: 'linear-gradient(180deg, #f5f3ef 0%, #f0d8e8 50%, #e0a8c8 100%)',  // dusty rose
  6: 'linear-gradient(180deg, #f5f3ef 0%, #d8f0e0 50%, #a8d8c0 100%)',  // mint
}

interface CardPanelProps {
  card: CardData
  saved?: boolean
  onSave?: () => void
  threadLabel?: string   // e.g. "Hellenistic Greece" — shown when rabbit hole active
}

/** Pure presentational white card — Base44-style panel sitting on the gradient */
export function CardPanel({ card, saved = false, onSave, threadLabel }: CardPanelProps) {
  return (
    <div className="relative w-full max-w-[920px]">
      <div
        className="relative bg-white flex flex-col"
        style={{
          borderRadius: '20px',
          padding: '56px 64px 48px',
          minHeight: '520px',
          boxShadow: 'rgba(34, 40, 42, 0.06) 0px 4px 24px 0px',
        }}
      >
        {/* Thread label — appears when rabbit hole is active */}
        {threadLabel && (
          <div
            className="flex items-center gap-1.5 mb-5"
            style={{
              opacity: 1,
              animation: 'fadeIn 0.3s ease-out',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="#696f7b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="text-[11px] text-[#696f7b] font-medium tracking-[0.04em]">
              following · {threadLabel}
            </span>
          </div>
        )}

        {/* Category tags */}
        {card.categories.length > 0 && (
          <div className="flex gap-3 flex-wrap mb-8">
            {card.categories.slice(0, 2).map((cat) => (
              <span
                key={cat}
                className="text-[11px] font-semibold text-[#696f7b] tracking-[0.08em] uppercase"
              >
                {cat}
              </span>
            ))}
          </div>
        )}

        {/* Hook text */}
        <p
          className="flex-1 text-[#000000] font-[500]"
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 'clamp(26px, 3.2vw, 38px)',
            lineHeight: '1.25',
            letterSpacing: '-0.02em',
          }}
        >
          {card.hookText}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between mt-12 pt-6 border-t border-[#f0eee9]">
          <a
            href={card.wikiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[13px] text-[#696f7b] hover:text-[#000000] transition-colors group"
          >
            <svg
              width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              className="opacity-60 group-hover:opacity-100 transition-opacity"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            <span>Read on Wikipedia</span>
          </a>

          <div className="flex items-center gap-3">
            <LikeButton cardId={card.id} />

            {/* Save pill
                Unsaved → ghost button  (transparent bg, grey border)
                Saved   → primary action (#ebffb1 bg, lime border)
                Both states use #000000 text — no dark/inverted treatment */}
            <button
              onClick={(e) => { e.stopPropagation(); onSave?.() }}
              aria-label={saved ? 'Saved' : 'Save this card'}
              className={[
                'flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium',
                'transition-all duration-200 select-none cursor-pointer text-[#000000]',
                saved
                  ? 'bg-[#ebffb1] border border-[#ade900]'
                  : 'bg-transparent border border-[#cfcfcf] hover:border-[#ade900]',
              ].join(' ')}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24"
                fill={saved ? '#000000' : 'none'}
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                className="transition-all duration-200"
              >
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              <span>{saved ? 'Saved' : 'Save'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
