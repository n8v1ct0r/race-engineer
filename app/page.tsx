import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CompareFallback, CompareView } from "@/components/compare-view";
import { SiteFooter } from "@/components/site-footer";
import { defaultHeaderNote, featuredSession, readCatalog } from "./_data/manifests";

// Home lands straight in a comparison with the ghost replay running: the featured Formula 1
// session when one was exported here, the synthetic demo otherwise (the public repo case).
// Every other session is one pick away in the control bar or on /sessions.
export default async function Home() {
  const { f1, demo, choices } = await readCatalog();
  const featured = featuredSession(f1);
  const root = featured ? "data" : "demo";
  const session = featured ?? demo;
  if (session === null) notFound();
  const defaultNote = await defaultHeaderNote(root, session);
  return (
    <>
      <Suspense
        fallback={<CompareFallback session={session} choices={choices} defaultNote={defaultNote} />}
      >
        <CompareView
          key={session.session_id}
          root={root}
          session={session}
          choices={choices}
          defaultNote={defaultNote}
        />
      </Suspense>
      <SiteFooter full />
    </>
  );
}
