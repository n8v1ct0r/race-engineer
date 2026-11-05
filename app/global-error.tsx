"use client";

// Replaces the root layout when it fails, so it brings its own document, styles, fonts and the
// disclaimer line (plan section 5: the line must be on every route, including this one).

import { AppBar } from "@/components/app-bar";
import { fontVariables } from "./fonts";
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">
        <title>Something broke · AI Race Engineer</title>
        <AppBar />
        <main id="main" className="mx-auto max-w-[1600px] px-gutter py-12">
          <h1 className="text-title">Something broke</h1>
          <p className="mt-3 max-w-[70ch] text-body">
            The app hit an error before this page could load. Try again, or reload the page.
          </p>
          {error.digest ? (
            <p className="mt-2 text-meta text-graphite">
              Error id <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
          <p className="mt-6">
            <button type="button" className="btn btn-primary" onClick={() => retry()}>
              Try again
            </button>
          </p>
        </main>
      </body>
    </html>
  );
}
