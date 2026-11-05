// Import this first in every server-only notes module. It throws when a browser bundle loads the
// module, so the API key path, the cache and the limits can never ship to a client. Next.js also
// has an optional `server-only` package; this guard needs no package and also runs under plain
// node for scripts and tests.

if (typeof window !== "undefined") {
  throw new Error("lib/notes server module imported in a browser. Import lib/notes/template.ts.");
}

export {};
