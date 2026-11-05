import Link from "next/link";
import { AppBar } from "./app-bar";
import { SiteFooter } from "./site-footer";

/**
 * The page for errors Next.js handles outside the App Router: its static 500.html, and a 400 for
 * a URL it cannot decode. Rendered by pages/500.tsx and pages/_error.tsx, so these carry the app
 * bar, the disclaimer line and the footer too (CLAUDE.md hard rule 4).
 */
export function ServerErrorPage({ status }: { status: number }) {
  const badAddress = status === 400;
  return (
    <>
      <AppBar />
      <main id="main" className="mx-auto max-w-[1600px] px-gutter py-12">
        <h1 className="text-title">
          {badAddress ? "This address is not valid" : "Something broke"}
        </h1>
        <p className="mt-3 max-w-[70ch] text-body">
          {badAddress
            ? "The server could not read this address. Check it, or pick a session from the list."
            : "The server hit an error before this page could load. Reload the page, or pick a session from the list."}
        </p>
        <p className="mt-6 flex flex-wrap gap-3">
          {badAddress ? null : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
          )}
          <Link href="/sessions" className={badAddress ? "btn btn-primary" : "btn"}>
            Go to the session picker
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
