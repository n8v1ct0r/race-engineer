import Link from "next/link";

/** The exact line the brief pins to every page (CLAUDE.md hard rule 4). */
export const DISCLAIMER_LINE = "Unofficial. Not affiliated with Formula 1.";

/**
 * Shared app bar. The disclaimer sits here, not in a footer, so it lands in every first viewport.
 * Desktop: one 48 px row, disclaimer on the right. Phone: the disclaimer gets its own line.
 */
export function AppBar() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-1 px-gutter py-2 md:min-h-12 md:flex-row md:items-center md:justify-between md:gap-6 md:py-0">
        <div className="flex items-center justify-between gap-6">
          {/* Both links get a 44 px hit area on a phone; the negative margin keeps the row its own
              height. */}
          <Link
            href="/"
            className="-my-2.5 inline-flex min-h-11 items-center text-panel font-bold text-ink no-underline hover:underline md:my-0 md:min-h-0"
            aria-label="AI Race Engineer, home"
          >
            AI Race Engineer
          </Link>
          <nav aria-label="Site" className="flex gap-4 md:hidden">
            <Link
              href="/sessions"
              className="-my-2.5 inline-flex min-h-11 min-w-11 items-center justify-end text-meta"
            >
              Sessions
            </Link>
            <Link
              href="/about"
              className="-my-2.5 inline-flex min-h-11 min-w-11 items-center justify-end text-meta"
            >
              About
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <p className="text-meta text-graphite">{DISCLAIMER_LINE}</p>
          <nav aria-label="Site" className="hidden gap-6 md:flex">
            <Link href="/sessions" className="text-meta">
              Sessions
            </Link>
            <Link href="/about" className="text-meta">
              About
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
