'use client'

import { useState, useCallback } from 'react'

interface LikeButtonProps {
  cardId: string
  initialLiked?: boolean
}

export function LikeButton({ cardId, initialLiked = false }: LikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked)
  const [animating, setAnimating] = useState(false)

  const handleLike = useCallback(async () => {
    if (liked) return
    setLiked(true)
    setAnimating(true)
    setTimeout(() => setAnimating(false), 400)

    fetch('/api/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId }),
    }).catch(console.error)
  }, [liked, cardId])

  return (
    <button
      onClick={handleLike}
      aria-label={liked ? 'Liked' : 'Like this card'}
      className={[
        'flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium',
        'transition-all duration-200 select-none cursor-pointer',
        animating ? 'like-pulse' : '',
        liked
          ? 'bg-[#ebffb1] border border-[#ade900] text-[#000000]'
          : 'bg-[#000000] text-white hover:bg-[#1a1a1a]',
      ].join(' ')}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill={liked ? '#000000' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-200"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      <span>{liked ? 'Liked' : 'Like'}</span>
    </button>
  )
}
