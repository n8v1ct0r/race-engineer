// The one shared cursor (plan section 3b item 7). Hover, the scrub bar, corner links and keyboard
// use distance: an index into the shared 2 m grid. The ghost replay uses time, because at one
// moment the two cars sit at different distances. No dependencies; React reads it through
// useSyncExternalStore, and the charts and map subscribe directly for per-frame updates.

import { createContext, useContext, useSyncExternalStore } from "react";

export type Cursor = { mode: "distance"; i: number } | { mode: "time"; tMs: number };

/** Who moved the cursor. Charts skip "pointer" updates because uPlot's own sync already drew them. */
export type CursorSource =
  "init" | "pointer" | "touch" | "scrub" | "keyboard" | "corner" | "replay";

export type CursorSnapshot = Cursor & { source: CursorSource };

export type CursorStore = {
  get(): CursorSnapshot;
  set(next: Cursor, source: CursorSource): void;
  subscribe(listener: () => void): () => void;
};

function same(a: CursorSnapshot, b: Cursor, source: CursorSource): boolean {
  if (a.source !== source || a.mode !== b.mode) return false;
  if (a.mode === "distance" && b.mode === "distance") return a.i === b.i;
  if (a.mode === "time" && b.mode === "time") return a.tMs === b.tMs;
  return false;
}

export function createCursorStore(initial: Cursor = { mode: "distance", i: 0 }): CursorStore {
  let snapshot: CursorSnapshot = { ...initial, source: "init" };
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    set(next, source) {
      if (same(snapshot, next, source)) return;
      snapshot = { ...next, source };
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** True when a person moved the cursor (not the replay loop or the initial state). */
export function isUserSource(source: CursorSource): boolean {
  return source !== "replay" && source !== "init";
}

export const CursorContext = createContext<CursorStore | null>(null);

export function useCursorStore(): CursorStore {
  const store = useContext(CursorContext);
  if (store === null) throw new Error("useCursorStore needs a CursorContext provider");
  return store;
}

/** The current cursor. Re-renders the caller on every change. */
export function useCursor(store: CursorStore): CursorSnapshot {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
