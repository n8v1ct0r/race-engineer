import Link from "next/link";
import { SessionPicker } from "@/components/session-picker";
import { SiteFooter } from "@/components/site-footer";
import { formatDate } from "@/lib/data.ts";
import config from "@/analysis-config.json";
import type { Metadata } from "next";
import { readCatalog } from "../_data/manifests";

export const metadata: Metadata = {
  title: "Sessions",
  description: "Every session on this site, and the synthetic demo.",
};

export default async function SessionsPage() {
  const { f1, demo, choices, hasF1Data } = await readCatalog();
  const demoLaps = demo ? demo.drivers.reduce((n, d) => n + d.laps.length, 0) : 0;

  return (
    <>
      <main id="main" className="mx-auto max-w-[1600px] px-gutter">
        <section aria-labelledby="home-title" className="border-b border-rule pb-8 pt-10 md:pt-12">
          <h1 id="home-title" className="text-title">
            Compare two qualifying laps
          </h1>
          <p className="mt-3 max-w-[70ch] text-body">
            Formula 1™ qualifying laps, compared corner by corner.
          </p>
          <p className="mt-2 max-w-[70ch] text-body text-graphite">
            Pick a session and 2 laps. Code computes every number: the time won or lost at each
            corner, braking points, minimum and exit speeds, and {config.minisectors.count}{" "}
            mini-sectors.
          </p>
        </section>

        <section aria-labelledby="pick-title" className="border-b border-rule py-8">
          <h2 id="pick-title" className="text-panel">
            Pick a session
          </h2>
          <div className="mt-4">
            {choices.length > 0 ? (
              <SessionPicker choices={choices} />
            ) : (
              <p className="text-body">
                No sessions found. The demo files in <code>public/demo/</code> are missing too. Run{" "}
                <code>pnpm synthetic</code> to make them.
              </p>
            )}
          </div>

          {f1.length > 0 ? (
            <div className="mt-8">
              <h3 className="text-control text-graphite">
                {f1.length === 1 ? "1 session" : `${String(f1.length)} sessions`} on this machine
              </h3>
              <ul className="mt-2 border-t border-rule">
                {f1.map((s) => {
                  const choice = choices.find((c) => c.session_id === s.session_id);
                  if (!choice) return null;
                  const date = formatDate(s.date);
                  return (
                    <li
                      key={s.session_id}
                      className="grid grid-cols-1 gap-1 border-b border-rule pb-3 pt-1 md:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] md:items-baseline md:gap-6 md:py-3"
                    >
                      {/* 44 px tall on a phone, like every other phone control. */}
                      <Link
                        href={choice.href}
                        className="block py-[11px] text-control font-bold md:inline md:py-0"
                      >
                        {choice.event}
                      </Link>
                      <span className="text-control">{s.session_name}</span>
                      <span className="text-meta text-graphite">{date ?? ""}</span>
                      <span className="text-meta text-graphite">
                        Default pair{" "}
                        <span className="font-mono text-data text-ink">{s.default_pair.a}</span> and{" "}
                        <span className="font-mono text-data text-ink">{s.default_pair.b}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>

        {!hasF1Data ? (
          <section aria-labelledby="empty-title" className="border-b border-rule py-8">
            <h2 id="empty-title" className="text-panel">
              No real sessions on this machine
            </h2>
            <p className="mt-2 max-w-[70ch] text-body">
              Real sessions are exported on your own machine with <code>pnpm export</code> and never
              committed. This copy has 0 of them, so the picker offers the synthetic demo only.
            </p>
          </section>
        ) : null}

        {demo ? (
          <section aria-labelledby="demo-title" className="py-8">
            <h2 id="demo-title" className="text-panel">
              Synthetic demo
            </h2>
            <p className="mt-2 max-w-[70ch] text-body">
              {demoLaps} made-up laps on a made-up track. No real timing data. This is the only
              session where Claude can write the race engineer notes.
            </p>
            <p className="mt-4">
              <Link href="/demo" className="btn">
                Open the demo
              </Link>
            </p>
          </section>
        ) : null}
      </main>
      <SiteFooter full />
    </>
  );
}
