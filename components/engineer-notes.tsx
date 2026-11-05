"use client";

// Race engineer notes: up to 3 gains and 3 losses, each linked to its corner row
// (docs/contracts.md section 6). Formula 1 laps only ever show notes written by code from the
// display strings (decision D1). The synthetic demo shows those first and offers "Write notes",
// the only action that calls the model route. Every number in a note is set in the mono face.

import { useMemo, useRef, useState, type ReactNode } from "react";
import type { Comparison, Finding } from "@/lib/analysis/index.ts";
import {
  templateNotes,
  type Note,
  type NotesErrorResponse,
  type NotesResponse,
  type TemplateReason,
} from "@/lib/notes/template.ts";
import config from "@/analysis-config.json";
import { ErrorPanel } from "./states";

const TOKEN_RE = /(\b[TC]\d{1,2}[A-Z]?(?:-\d{1,2}[A-Z]?)?\b)|(\d+(?::\d{2})?(?:\.\d+)?)/g;

/** Corner labels first (so "T6-7" stays whole), then numbers in the mono face. */
export function NoteText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    if (m[1]) {
      out.push(
        <span key={at} className="font-bold">
          {m[1]}
        </span>,
      );
    } else if (m[2]) {
      out.push(
        <span key={at} className="font-mono font-medium">
          {m[2]}
        </span>,
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

const REASON_TEXT: Record<Exclude<TemplateReason, null>, string> = {
  no_key: "This server has no model key, so code wrote these notes.",
  disabled: "Model notes are switched off on this server, so code wrote these notes.",
  rate_limited:
    "Too many requests from this address. Code wrote these notes. Try again in 10 minutes.",
  spend_cap: "Today's model spend cap is reached, so code wrote these notes.",
  model_error: "The model call failed, so code wrote these notes.",
};

type Remote =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; res: NotesResponse }
  | { status: "error"; message: string };

type Props = {
  c: Comparison;
  codeA: string;
  sessionId: string;
  pair: { a: string; b: string };
  /** True for synthetic and Photoncar laps. False for Formula 1 laps (code-written notes only). */
  allowModel: boolean;
  onCorner: (index: number) => void;
};

function isNotesResponse(x: unknown): x is NotesResponse {
  return typeof x === "object" && x !== null && Array.isArray((x as { notes?: unknown }).notes);
}

export function EngineerNotes({ c, codeA, sessionId, pair, allowModel, onCorner }: Props) {
  const templates = useMemo(() => templateNotes(c), [c]);
  const [remote, setRemote] = useState<Remote>({ status: "idle" });
  const writeRef = useRef<HTMLButtonElement>(null);

  const byId = new Map<string, Note>();
  for (const t of templates) byId.set(t.finding_id, t);
  if (remote.status === "done") {
    for (const n of remote.res.notes) {
      if (byId.has(n.finding_id)) byId.set(n.finding_id, n);
    }
  }

  const gains = c.findings.filter((f) => f.kind === "gain");
  const losses = c.findings.filter((f) => f.kind === "loss");
  const topN = config.findings.top_n;
  const floor = config.findings.min_abs_ms;

  async function writeNotes() {
    if (remote.status === "loading") return;
    setRemote({ status: "loading" });
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, a: pair.a, b: pair.b }),
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!res.ok) {
        const err = body as Partial<NotesErrorResponse> | null;
        setRemote({
          status: "error",
          message: err?.message ?? `The notes route answered HTTP ${String(res.status)}.`,
        });
        return;
      }
      if (!isNotesResponse(body)) {
        setRemote({
          status: "error",
          message: "The notes route sent an answer in the wrong shape.",
        });
        return;
      }
      setRemote({ status: "done", res: body });
    } catch {
      setRemote({ status: "error", message: "Could not reach the notes route." });
    }
  }

  const showSource = allowModel && remote.status === "done";

  const list = (items: Finding[], kind: "gain" | "loss") => {
    if (items.length === 0) {
      return (
        <p className="text-body text-graphite">
          {kind === "gain"
            ? `No corner where ${codeA} gains ${String(floor)} ms or more.`
            : `No corner where ${codeA} loses ${String(floor)} ms or more.`}
        </p>
      );
    }
    return (
      <ol className="flex flex-col">
        {items.map((f) => {
          const note = byId.get(f.id);
          return (
            <li
              key={f.id}
              className="flex flex-col gap-1 border-b border-rule py-3 last:border-b-0"
            >
              <p className="flex items-baseline gap-3">
                <a
                  href={`#corner-row-${String(f.corner_index)}`}
                  className="-my-3 inline-flex min-h-11 min-w-11 items-center text-control font-bold md:my-0 md:min-h-0 md:min-w-0"
                  onClick={(e) => {
                    e.preventDefault();
                    onCorner(f.corner_index);
                  }}
                >
                  {f.label}
                </a>
                <span className="font-mono text-data">{f.display.delta}</span>
              </p>
              <p className="max-w-[70ch] text-body">
                <NoteText text={note?.text ?? `${f.display.label}, ${f.display.delta}.`} />
              </p>
              {showSource && note ? (
                <p className="text-meta text-graphite">
                  {note.source === "model"
                    ? "Written by Claude from these numbers"
                    : "Written by code"}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    );
  };

  const short =
    c.findings.length < topN * 2
      ? `Only corners that differ by ${String(floor)} ms or more are listed, never padded.`
      : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-meta text-graphite">
        {allowModel
          ? "Notes below are written by code from the numbers on this page until you ask Claude to write them."
          : "Written by code from the numbers on this page. Claude does not write notes for Formula 1 laps."}
      </p>

      {c.findings.length === 0 ? (
        <p className="max-w-[70ch] text-body">
          No corner differs by {floor} ms or more. These laps are too close to call corner by
          corner.
        </p>
      ) : (
        <>
          <section aria-labelledby="notes-gained" className="flex flex-col gap-1">
            <h3 id="notes-gained" className="text-control font-bold">
              Where {codeA} gained
            </h3>
            {list(gains, "gain")}
          </section>
          <section aria-labelledby="notes-lost" className="flex flex-col gap-1">
            <h3 id="notes-lost" className="text-control font-bold">
              Where {codeA} lost
            </h3>
            {list(losses, "loss")}
          </section>
          {short ? <p className="text-meta text-graphite">{short}</p> : null}
        </>
      )}

      {allowModel && c.findings.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-rule pt-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page. */}
            <button
              ref={writeRef}
              type="button"
              className="btn btn-primary"
              onClick={() => void writeNotes()}
              aria-disabled={remote.status === "loading"}
              aria-busy={remote.status === "loading"}
            >
              {remote.status === "loading" ? "Writing notes" : "Write notes"}
            </button>
            <span className="text-meta text-graphite">
              Sends lap ids only. The server rebuilds the numbers.
            </span>
          </div>
          {remote.status === "loading" ? (
            <p role="status" className="text-meta text-graphite">
              Asking the notes route.
            </p>
          ) : null}
          {remote.status === "done" ? (
            <p role="status" className="text-meta text-graphite">
              {remote.res.template_reason
                ? REASON_TEXT[remote.res.template_reason]
                : remote.res.cached
                  ? "Loaded from the notes cache. No new model call."
                  : "Written just now. Each note shows who wrote it."}
            </p>
          ) : null}
          {remote.status === "error" ? (
            <ErrorPanel
              title="Could not write notes"
              action={
                // This panel leaves the page as the retry starts, so focus moves to Write notes,
                // which stays and reports the retry.
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    writeRef.current?.focus();
                    void writeNotes();
                  }}
                >
                  Try again
                </button>
              }
            >
              {remote.message} The notes written by code are still shown.
            </ErrorPanel>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
