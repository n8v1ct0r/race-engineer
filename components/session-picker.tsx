"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import type { SessionChoice } from "@/lib/data.ts";

const DEMO_KEY = "demo";

function seasonKey(c: SessionChoice): string {
  return c.root === "demo" ? DEMO_KEY : String(c.season);
}

type Props = {
  choices: SessionChoice[];
  /** session_id of the page this picker sits on, if any. */
  current?: string;
  /** Tighter layout for the compare view's control bar. */
  compact?: boolean;
};

/**
 * Season, event and session selects. Choosing does not navigate by itself (a select that changes
 * the page on input fails WCAG 3.2.2); the button opens the chosen session. On a session page the
 * button shows only once another session is chosen. While the next page loads, the button says so
 * and keeps focus (aria-disabled, not disabled, which would drop focus to the page).
 */
export function SessionPicker({ choices, current, compact = false }: Props) {
  const router = useRouter();
  const id = useId();
  const [opening, startOpening] = useTransition();
  const initial = choices.find((c) => c.session_id === current) ?? choices[0] ?? null;

  const [season, setSeason] = useState<string>(initial ? seasonKey(initial) : "");
  const [event, setEvent] = useState<string>(initial?.event ?? "");
  const [sessionId, setSessionId] = useState<string>(initial?.session_id ?? "");

  const seasons = useMemo(() => {
    const keys: string[] = [];
    for (const c of choices) {
      const k = seasonKey(c);
      if (!keys.includes(k)) keys.push(k);
    }
    return keys;
  }, [choices]);

  const inSeason = useMemo(
    () =>
      choices
        .filter((c) => seasonKey(c) === season)
        .sort((x, y) => (x.round ?? 0) - (y.round ?? 0)),
    [choices, season],
  );
  const events = useMemo(() => {
    const names: string[] = [];
    for (const c of inSeason) if (!names.includes(c.event)) names.push(c.event);
    return names;
  }, [inSeason]);
  const sessions = useMemo(() => inSeason.filter((c) => c.event === event), [inSeason, event]);
  const chosen = sessions.find((c) => c.session_id === sessionId) ?? sessions[0] ?? null;

  if (choices.length === 0) return null;

  const onSeason = (k: string) => {
    setSeason(k);
    const first = choices
      .filter((c) => seasonKey(c) === k)
      .sort((x, y) => (x.round ?? 0) - (y.round ?? 0))[0];
    setEvent(first?.event ?? "");
    setSessionId(first?.session_id ?? "");
  };

  const onEvent = (name: string) => {
    setEvent(name);
    setSessionId(inSeason.find((c) => c.event === name)?.session_id ?? "");
  };

  const isCurrent = chosen !== null && chosen.session_id === current;
  const labelClass = compact ? "text-meta text-graphite" : "text-control text-ink";

  return (
    <form
      className={
        compact
          ? "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
          : "flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end"
      }
      onSubmit={(e) => {
        e.preventDefault();
        if (opening || chosen === null || isCurrent) return;
        const href = chosen.href;
        startOpening(() => router.push(href));
      }}
      aria-label="Choose a session"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-season`} className={labelClass}>
          Season
        </label>
        <select
          id={`${id}-season`}
          className="select"
          value={season}
          onChange={(e) => onSeason(e.target.value)}
        >
          {seasons.map((k) => (
            <option key={k} value={k}>
              {k === DEMO_KEY ? "Demo" : k}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-event`} className={labelClass}>
          Event
        </label>
        <select
          id={`${id}-event`}
          className="select"
          value={event}
          onChange={(e) => onEvent(e.target.value)}
        >
          {events.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-session`} className={labelClass}>
          Session
        </label>
        <select
          id={`${id}-session`}
          className="select"
          value={chosen?.session_id ?? ""}
          onChange={(e) => setSessionId(e.target.value)}
        >
          {sessions.map((c) => (
            <option key={c.session_id} value={c.session_id}>
              {c.session_name}
            </option>
          ))}
        </select>
      </div>
      {compact && isCurrent ? null : (
        <button
          type="submit"
          className={compact ? "btn" : "btn btn-primary"}
          aria-disabled={opening || chosen === null}
          aria-busy={opening}
        >
          {opening ? "Opening session" : compact ? "Open session" : "Compare laps"}
        </button>
      )}
    </form>
  );
}
