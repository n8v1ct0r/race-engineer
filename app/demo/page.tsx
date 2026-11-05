import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CompareFallback, CompareView } from "@/components/compare-view";
import { SiteFooter } from "@/components/site-footer";
import { defaultHeaderNote, readCatalog } from "../_data/manifests";

export const metadata: Metadata = {
  title: "Synthetic demo",
  description: "3 made-up qualifying laps on a made-up track, compared corner by corner.",
};

export default async function DemoPage() {
  const { demo, choices } = await readCatalog();
  if (demo === null) notFound();
  const defaultNote = await defaultHeaderNote("demo", demo);
  return (
    <>
      <Suspense
        fallback={
          <CompareFallback
            session={demo}
            choices={choices}
            label="Loading the synthetic demo"
            defaultNote={defaultNote}
          />
        }
      >
        <CompareView
          key={demo.session_id}
          root="demo"
          session={demo}
          choices={choices}
          defaultNote={defaultNote}
        />
      </Suspense>
      <SiteFooter />
    </>
  );
}
