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
}

/** Pure presentational white card — Base44-style panel sitting on the gradient */
export function CardPanel({ card }: CardPanelProps) {
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
          <LikeButton cardId={card.id} />
        </div>
      </div>
    </div>
  )
}
