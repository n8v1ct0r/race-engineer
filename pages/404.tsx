// A custom /_error page needs a custom /404 page too, or Next.js skips static optimization for
// its 404 and warns on every dev run. The App Router's app/not-found.tsx still answers unknown
// addresses; this page carries the same content for any 404 the Pages Router renders.

import Head from "next/head";
import { AppBar } from "../components/app-bar";
import { NotFoundContent } from "../components/not-found-content";

export default function NotFoundPage() {
  return (
    <>
      <Head>
        <title>Page not found · AI Race Engineer</title>
      </Head>
      <AppBar />
      <NotFoundContent />
    </>
  );
}
