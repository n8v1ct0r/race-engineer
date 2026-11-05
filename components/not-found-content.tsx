import Link from "next/link";
import { SiteFooter } from "./site-footer";

/** The 404 page body. Shared by app/not-found.tsx and pages/404.tsx, so both say the same. */
export function NotFoundContent() {
  return (
    <>
      <main id="main" className="mx-auto max-w-[1600px] px-gutter py-12">
        <h1 className="text-title">No page at this address</h1>
        <p className="mt-3 max-w-[70ch] text-body">
          Session pages exist only for sessions exported on this machine. Pick one from the list, or
          open the synthetic demo.
        </p>
        <p className="mt-6 flex flex-wrap gap-3">
          <Link href="/sessions" className="btn btn-primary">
            Go to the session picker
          </Link>
          <Link href="/demo" className="btn">
            Open the demo
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
