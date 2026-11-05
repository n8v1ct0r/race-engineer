import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DISCLAIMER_LINE } from "@/components/app-bar";
import { SiteFooter } from "@/components/site-footer";
import config from "@/analysis-config.json";

export const metadata: Metadata = {
  title: "About",
  description:
    "How AI Race Engineer computes its numbers, where the data comes from, and its limits.",
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-b border-rule py-8">
      <h2 id={id} className="text-panel">
        {title}
      </h2>
      <div className="mt-3 flex max-w-[70ch] flex-col gap-3 text-body">{children}</div>
    </section>
  );
}

type Source = { name: ReactNode; gives: string; terms: ReactNode; limits: string };

const SOURCES: Source[] = [
  {
    name: "Live timing for Formula 1 sessions (livetiming.formula1.com), read by FastF1",
    gives: "Lap times, car telemetry, car position",
    terms: (
      <>
        The Formula 1 companies hold the rights. See the{" "}
        <a href="https://www.formula1.com/en/information/legal-notices.7egvZU48hzrypubGBNcQKt">
          formula1.com legal notices
        </a>{" "}
        and{" "}
        <a href="https://www.formula1.com/en/information/guidelines.4EOKE9RRqevL4niTK9kWyt">
          guidelines
        </a>
        .
      </>
    ),
    limits: "No published limit found",
  },
  {
    name: <a href="https://github.com/theOehrly/Fast-F1">FastF1 3.8.3</a>,
    gives: "Python client for the sources in this table",
    terms: "MIT",
    limits: "Waits 0.25 s between calls and stops at 500 calls per hour",
  },
  {
    name: (
      <>
        <a href="https://github.com/jolpica/jolpica-f1">Jolpica-F1 API</a> (api.jolpi.ca), called by
        FastF1
      </>
    ),
    gives: "Session results and race lap 1 times",
    terms: "Data under CC BY-NC-SA 4.0, for non-commercial use",
    limits: "4 requests per second, 500 requests per hour",
  },
  {
    name: <a href="https://github.com/theOehrly/f1schedule">FastF1 schedule files</a>,
    gives: "Event schedule",
    terms: 'No license file. The repo says "Use as you like."',
    limits: "None published",
  },
  {
    name: (
      <>
        <a href="https://multiviewer.app">MultiViewer</a> circuit data (api.multiviewer.app), called
        by FastF1
      </>
    ),
    gives: "Corner numbers",
    terms: "No published terms found",
    limits: "None published",
  },
];

export default function AboutPage() {
  return (
    <>
      <main id="main" className="mx-auto max-w-[1600px] px-gutter">
        <header className="border-b border-rule pb-8 pt-10 md:pt-12">
          <h1 className="text-title">About AI Race Engineer</h1>
          <p className="mt-3 max-w-[70ch] text-body">
            Formula 1™ qualifying laps, compared corner by corner. Pick 2 laps from 1 session and
            see where the time was won and lost. Code computes every number on the page.
          </p>
        </header>

        <Section id="how" title="How the numbers are computed">
          <p>
            Both laps sit on one distance axis: the length of the session&apos;s reference lap. Each
            lap is matched to the reference path by car position, so the same point on track lines
            up in both laps. Every chart uses one grid with a point every {config.grid_step_m} m.
          </p>
          <p>
            The time gap at a point is lap B&apos;s elapsed time minus lap A&apos;s. When both laps
            have the 3 official sector times, the gap is anchored to them.
          </p>
          <p>
            Corners come from the official corner markers. Markers closer than{" "}
            {config.corners.group_m} m merge into one row, such as T6-7. A session without markers
            gets corners from speed minima, labeled C1 upward.
          </p>
          <p>
            For each corner the table shows the braking point in meters before the first marker, the
            minimum speed, the exit speed {config.corners.exit_offset_m} m after the last marker,
            and the time gained or lost. The corner rows add up exactly to the lap gap.
          </p>
          <p>
            The map splits the lap into {config.minisectors.count} equal mini-sectors, each drawn in
            the color of the driver who was faster there. Differences under{" "}
            {config.minisectors.faint_below_ms} ms are pale.
          </p>
          <p>
            The notes cover up to {config.findings.top_n} gains and {config.findings.top_n} losses
            of {config.findings.min_abs_ms} ms or more. Code picks the cause of each one: braking,
            minimum speed, exit speed, or time only. A cause is named only when its numbers pass a
            check, so a braking difference counts only when it is larger than both sample gaps.
          </p>
        </Section>

        <Section id="notes" title="Race engineer notes">
          <p>
            For Formula 1 laps, code writes the note text from the numbers on the page. Claude
            writes notes only for synthetic laps and Photoncar laps, and only after you press Write
            notes. No model call happens when a page loads.
          </p>
          <p>
            Every number in a note has to match a number code computed for that corner. A script
            checks this before notes ship.
          </p>
        </Section>

        <Section id="sources" title="Data sources and terms">
          <p>
            The code repository holds 0 files of Formula 1 timing data. Tests and the demo run on 3
            synthetic laps made by <code>pipeline/synthetic.py</code>; they are not real timing
            data. Real sessions are exported on your own machine to <code>public/data/</code>, which
            git ignores.
          </p>
        </Section>
        <div className="border-b border-rule pb-8">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Data sources, their terms and their limits</caption>
            <thead className="hidden text-control text-graphite md:table-header-group">
              <tr className="border-b border-rule">
                <th scope="col" className="py-2 pr-6 font-medium">
                  Source
                </th>
                <th scope="col" className="py-2 pr-6 font-medium">
                  What it gives
                </th>
                <th scope="col" className="py-2 pr-6 font-medium">
                  License or terms
                </th>
                <th scope="col" className="py-2 font-medium">
                  Limits
                </th>
              </tr>
            </thead>
            <tbody className="text-body">
              {SOURCES.map((s, k) => (
                <tr
                  key={k}
                  className="flex flex-col gap-1 border-b border-rule py-3 md:table-row md:py-0"
                >
                  <th scope="row" className="font-bold md:py-3 md:pr-6 md:align-top">
                    {s.name}
                  </th>
                  <td className="md:py-3 md:pr-6 md:align-top">{s.gives}</td>
                  <td className="md:py-3 md:pr-6 md:align-top">{s.terms}</td>
                  <td className="text-graphite md:py-3 md:align-top md:text-ink">{s.limits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Section id="use" title="How this project uses the data">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>It is non-commercial: 0 ads, 0 payments, 0 sign ups.</li>
            <li>
              The site reads static files. It makes 0 calls to these sources when a page loads.
            </li>
            <li>
              The export keeps FastF1&apos;s cache and rate limits unchanged. In a test on 23
              September 2026, 1 fresh session load made 13 requests and a cached rerun made 0.
            </li>
            <li>The export sends a custom user agent to Jolpica-F1, as its docs require.</li>
            <li>Team logos, fonts and livery: 0 used. Each lap gets a neutral color.</li>
          </ul>
          <p>
            Credits: FastF1, by Philipp Schäfer and contributors (MIT). Jolpica-F1, data under{" "}
            <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>; the
            export changes its format to fit the lap schema. MultiViewer, which provides circuit
            data to FastF1.
          </p>
          <p>
            If you hold rights in any of this data and want something removed, open an issue in the
            project&apos;s repository.
          </p>
        </Section>

        <Section id="limits" title="Limits">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              Corner times inside a sector are estimates. Each lap has only 3 official timing lines.
            </li>
            <li>
              Laps without sector times are not anchored. In testing on real laps they were good to
              about 28 ms median.
            </li>
            <li>
              Brake is recorded only as on or off, about 4 times a second. At 300 km/h the samples
              sit 22 to 25 m apart, so a braking difference is named only when it is larger than
              both gaps.
            </li>
            <li>
              Where one corner ends and the next begins changes how time is shared between them.
            </li>
            <li>The method was checked in depth on 1 session.</li>
          </ul>
        </Section>

        <Section id="affiliation" title="Affiliation">
          <p>{DISCLAIMER_LINE}</p>
          <p className="text-graphite">
            Back to the <Link href="/sessions">session picker</Link>.
          </p>
        </Section>
      </main>
      <SiteFooter full />
    </>
  );
}
