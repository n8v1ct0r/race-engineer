// The static 500.html. Without this file Next.js builds it from its own component, which has no
// app bar and no disclaimer line.
//
// Check these pages with `pnpm build && pnpm start`, not `pnpm dev`. Under Next 16.3.6
// Turbopack dev, once any App Router page has compiled, the Pages Router error pages crash with
// "Invalid hook call" and answer 500 with the dev overlay. Production and `next dev --webpack`
// render them.

import Head from "next/head";
import { ServerErrorPage } from "../components/server-error";

export default function ServerError() {
  return (
    <>
      <Head>
        <title>Something broke · AI Race Engineer</title>
      </Head>
      <ServerErrorPage status={500} />
    </>
  );
}
