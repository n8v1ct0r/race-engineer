// POST /api/notes: race engineer notes for one lap pair (docs/contracts.md section 6).
// Only the "Write notes" action calls this route; page load shows template notes with no call.
// Formula 1 sessions get HTTP 403 (decision D1). Logic and tests live in lib/notes/handler.ts.

import config from "@/analysis-config.json";
import type { AnalysisConfig } from "@/lib/analysis/index.ts";
import { handleNotesRequest, routeNotesDeps } from "@/lib/notes/handler.ts";

export const runtime = "nodejs";

// One per instance: the per-IP limiter, the spend ledger and the in-memory cache live here.
const deps = routeNotesDeps(config as AnalysisConfig, process.env);

export async function POST(request: Request): Promise<Response> {
  return handleNotesRequest(request, deps);
}
