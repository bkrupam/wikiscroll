'use client'

import { useRef } from 'react'
import { Feed, type FeedHandle } from '@/components/Feed'

export default function Home() {
  const feedRef = useRef<FeedHandle>(null)

  return (
    <div className="h-screen overflow-hidden">

      {/* Floating pill nav — centered, glass, doesn't stretch full width.
          pointer-events-none on the wrapper so the transparent area around
          the pill never blocks taps/clicks on the feed beneath it. */}
      <header className="fixed top-0 left-0 right-0 z-40 flex justify-center pointer-events-none"
        style={{ paddingTop: '16px' }}>

        <nav
          className="pointer-events-auto flex items-center gap-1 px-2 py-2"
          style={{
            borderRadius:        '999px',
            background:          'rgba(250, 249, 247, 0.78)',
            backdropFilter:      'blur(20px)',
            WebkitBackdropFilter:'blur(20px)',
            border:              '1px solid rgba(255, 255, 255, 0.6)',
            boxShadow:           'rgba(34, 40, 42, 0.1) 0px 4px 24px 0px, inset 0px 1px 0px rgba(255,255,255,0.8)',
          }}
        >
          {/* Logo */}
          <div className="flex items-center gap-2 pl-2 pr-3">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-[#232529] flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #e5ff94 0%, #ade900 100%)' }}
            >
              W
            </div>
            <span className="text-[14px] font-semibold text-[#232529] tracking-tight whitespace-nowrap">
              WikiScroll
            </span>
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-black/10 mx-1 flex-shrink-0" />

          {/* Taste / preferences */}
          <button
            onClick={() => feedRef.current?.openTaste()}
            aria-label="Taste profile"
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-black/6"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="#696f7b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4"  y1="6"  x2="20" y2="6"  />
              <line x1="4"  y1="12" x2="20" y2="12" />
              <line x1="4"  y1="18" x2="20" y2="18" />
              <circle cx="8"  cy="6"  r="2" fill="rgba(250,249,247,0.9)" stroke="#696f7b" strokeWidth="2" />
              <circle cx="16" cy="12" r="2" fill="rgba(250,249,247,0.9)" stroke="#696f7b" strokeWidth="2" />
              <circle cx="10" cy="18" r="2" fill="rgba(250,249,247,0.9)" stroke="#696f7b" strokeWidth="2" />
            </svg>
          </button>

          {/* Saves */}
          <button
            onClick={() => feedRef.current?.openSaves()}
            aria-label="Saved cards"
            className="relative w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-black/6"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="#696f7b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            {/* Count badge injected by Feed */}
            <span id="save-count-badge" />
          </button>

        </nav>
      </header>

      <main className="w-full">
        <Feed ref={feedRef} />
      </main>
    </div>
  )
}
