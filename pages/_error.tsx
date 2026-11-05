// Errors Next.js renders through the Pages Router, such as a 400 for a URL segment it cannot
// decode. App Router errors use app/error.tsx and app/global-error.tsx instead.
//
// Check these pages with `pnpm build && pnpm start`, not `pnpm dev`. Under Next 16.3.6
// Turbopack dev, once any App Router page has compiled, the Pages Router error pages crash with
// "Invalid hook call" and answer 500 with the dev overlay. Production and `next dev --webpack`
// render them.

import type { NextPageContext } from "next";
import Head from "next/head";
import { ServerErrorPage } from "../components/server-error";

type Props = { status: number };

function ErrorPage({ status }: Props) {
  return (
    <>
      <Head>
        <title>
          {status === 400
            ? "Not a valid address · AI Race Engineer"
            : "Something broke · AI Race Engineer"}
        </title>
      </Head>
      <ServerErrorPage status={status} />
    </>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): Props => ({
  status: res?.statusCode ?? err?.statusCode ?? 500,
});

export default ErrorPage;
