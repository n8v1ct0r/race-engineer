import Link from "next/link";

/** F1's own fan-site disclaimer, verbatim (plan section 1). It keeps F1's capitals on purpose. */
export const F1_DISCLAIMER =
  "This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.";

/** Page footer. `full` adds F1's full disclaimer (home and about pages). */
export function SiteFooter({ full = false }: { full?: boolean }) {
  return (
    <footer className="mt-12 border-t border-rule">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-gutter py-6 text-meta text-graphite">
        {full ? <p className="max-w-[70ch]">{F1_DISCLAIMER}</p> : null}
        <p>
          Code computes every number on this site.{" "}
          <Link href="/about">Method, data sources and terms</Link>
        </p>
      </div>
    </footer>
  );
}
