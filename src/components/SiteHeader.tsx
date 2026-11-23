import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0a0d13]/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f5b942] text-[#1a1304]">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              <path d="M11 2h2v2h2v2h-2v2.1c2.3.6 4 2.7 4 5.2 0 1.3-.5 2.5-1.3 3.4L17 19v3H7v-3l1.3-2.3A5.1 5.1 0 0 1 7 13.3c0-2.5 1.7-4.6 4-5.2V6H9V4h2V2Z" />
            </svg>
          </span>
          <span className="text-[15px]">
            Gambit<span className="text-[#f5b942]"> Arena</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm text-[#aeb6c8]">
          <Link href="/" className="rounded-lg px-3 py-1.5 transition hover:bg-white/5 hover:text-white">
            Play
          </Link>
          <Link href="/practice" className="rounded-lg px-3 py-1.5 transition hover:bg-white/5 hover:text-white">
            Practice
          </Link>
          <Link href="/guide" className="rounded-lg px-3 py-1.5 transition hover:bg-white/5 hover:text-white">
            Piece guide
          </Link>
        </nav>
      </div>
    </header>
  );
}
