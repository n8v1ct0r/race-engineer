import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CompareFallback, CompareView } from "@/components/compare-view";
import { SiteFooter } from "@/components/site-footer";
import { eventTitle } from "@/lib/data.ts";
import { defaultHeaderNote, findF1Session, readCatalog } from "../../../../_data/manifests";

type Params = { season: string; location: string; session: string };

// Sessions come from public/data/manifest.json at build time. Anything else is a 404, and with
// no exported data (the public repo) there are no F1 pages at all.
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Params[]> {
  const { f1 } = await readCatalog();
  return f1
    .filter((s) => s.season !== null)
    .map((s) => ({
      season: String(s.season),
      location: s.location_slug,
      session: s.session_code.toLowerCase(),
    }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const s = await findF1Session(p.season, p.location, p.session);
  if (s === null) return { title: "Session not found" };
  return {
    title: `${eventTitle(s)} ${s.session_name.toLowerCase()}`,
    description: `Formula 1™ qualifying laps from the ${s.event_name}, compared corner by corner.`,
  };
}

export default async function F1SessionPage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const session = await findF1Session(p.season, p.location, p.session);
  if (session === null) notFound();
  const [{ choices }, defaultNote] = await Promise.all([
    readCatalog(),
    defaultHeaderNote("data", session),
  ]);
  return (
    <>
      <Suspense
        fallback={<CompareFallback session={session} choices={choices} defaultNote={defaultNote} />}
      >
        <CompareView
          key={session.session_id}
          root="data"
          session={session}
          choices={choices}
          defaultNote={defaultNote}
        />
      </Suspense>
      <SiteFooter />
    </>
  );
}
