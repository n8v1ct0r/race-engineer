"use client";

// A route that throws while it renders. Production shows fixed copy: React's own message there is
// a minified developer string, and a client error is raw JavaScript text. Development adds the
// message for whoever is fixing it.

import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { ErrorPanel } from "@/components/states";

export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <>
      <main id="main" className="mx-auto max-w-[1600px] px-gutter py-12">
        <ErrorPanel
          title="This page broke"
          action={
            <>
              <button type="button" className="btn btn-primary" onClick={() => retry()}>
                Try again
              </button>
              <Link href="/" className="btn">
                Go to the session picker
              </Link>
            </>
          }
        >
          <p>The page hit an error while it rendered. Try again, or pick another session.</p>
          {process.env.NODE_ENV !== "production" && error.message ? (
            <p className="mt-1 font-mono text-data break-words">{error.message}</p>
          ) : null}
          {error.digest ? (
            <p className="mt-1 text-meta text-graphite">
              Error id <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
        </ErrorPanel>
      </main>
      <SiteFooter />
    </>
  );
}
