'use client'

/**
 * SkeletonPanel — shown at the "next" slot while a card is being generated.
 *
 * Geometry matches WikiCard exactly (same borderRadius / padding / minHeight / shadow)
 * so the transition from skeleton → real card has zero layout shift.
 *
 * Colors are drawn from the design-system tokens:
 *   base shimmer : #e6e6e6  (design token — decorative element backgrounds)
 *   shimmer peak : #f0eeea  (warm off-white, between Canvas Pearl and the base)
 *   label text   : #696f7b  (Stone Whisper — muted supportive captions)
 */

function Bone({ width, height, radius = 6 }: { width: string; height: number; radius?: number }) {
  return (
    <div
      className="skeleton-shimmer"
      style={{ width, height, borderRadius: radius }}
    />
  )
}

export function SkeletonPanel() {
  return (
    <div className="relative w-full max-w-[920px]">
      {/* Card shell — identical dimensions to WikiCard */}
      <div
        className="relative bg-white flex flex-col"
        style={{
          borderRadius: '20px',
          padding: '56px 64px 48px',
          minHeight: '520px',
          boxShadow: 'rgba(34, 40, 42, 0.06) 0px 4px 24px 0px',
        }}
      >
        {/* Category tag placeholders — pill-shaped, matching the uppercase 11px tags */}
        <div className="flex gap-3 flex-wrap mb-8">
          <Bone width="68px"  height={13} radius={999} />
          <Bone width="52px"  height={13} radius={999} />
        </div>

        {/* Hook text placeholder — 4 lines at the same scale as the clamp(26px, 3.2vw, 38px) text */}
        <div className="flex-1 flex flex-col" style={{ gap: '16px' }}>
          <Bone width="100%" height={38} />
          <Bone width="91%"  height={38} />
          <Bone width="83%"  height={38} />
          <Bone width="57%"  height={38} />
        </div>

        {/* Footer — mirrors the border-t divider + link + like button */}
        <div
          className="flex items-center justify-between mt-12 pt-6"
          style={{ borderTop: '1px solid #f0eee9' }}
        >
          <Bone width="138px" height={13} radius={999} />
          <Bone width="88px"  height={34} radius={999} />
        </div>
      </div>

      {/* "Generating" label — sits below the card, same position as the scroll hint */}
      <div className="flex items-center justify-center gap-[7px] mt-5">
        <span className="generating-dot" />
        <span className="generating-dot" style={{ animationDelay: '0.2s' }} />
        <span className="generating-dot" style={{ animationDelay: '0.4s' }} />
        <span
          style={{
            fontSize: '12px',
            lineHeight: 1.2,
            color: '#696f7b',
            fontFamily: 'Inter, system-ui, sans-serif',
            letterSpacing: '0.06em',
          }}
        >
          Generating
        </span>
      </div>
    </div>
  )
}
