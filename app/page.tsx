import { Feed } from '@/components/Feed'

export default function Home() {
  return (
    <div className="h-screen overflow-hidden">
      {/* ── Header — fixed, floats over gradient backgrounds ── */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-white/10 border-b border-white/20">
        <div className="max-w-[720px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold text-[#232529]"
              style={{ background: 'linear-gradient(135deg, #e5ff94 0%, #ade900 100%)' }}
            >
              W
            </div>
            <span className="text-[15px] font-semibold text-[#232529] tracking-tight">
              WikiScroll
            </span>
          </div>
          <p className="text-[12px] text-[#696f7b] hidden sm:block">
            Things you didn&apos;t know you wanted to know.
          </p>
        </div>
      </header>

      {/* ── Feed — full width, cards are full-viewport sections ── */}
      <main className="w-full">
        <Feed />
      </main>
    </div>
  )
}
