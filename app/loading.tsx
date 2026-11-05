import { LoadingLabel } from "@/components/states";

// Any route while its server part loads. Plain on purpose: this shows for every route, and the
// compare pages bring their own page-shaped placeholder (CompareFallback).
export default function Loading() {
  return (
    <main id="main" className="mx-auto min-h-dvh max-w-[1600px] px-gutter py-12" aria-busy="true">
      <LoadingLabel>Loading the page</LoadingLabel>
    </main>
  );
}
