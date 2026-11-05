// Mechanical copy rules from docs/contracts.md section 7, shared by the note validator and
// scripts/copy-lint.ts. Pure and browser-safe.

/** Figure dash, en dash, em dash, horizontal bar (U+2012 to U+2015). */
export const DASH_RE = /[‒-―]/;

/**
 * Banned words, whole word, case-insensitive, with their inflections. "leverage" is banned only
 * as a verb, which a regex cannot tell apart, so every occurrence is flagged.
 */
export const BANNED_WORD_RE =
  /\b(leverag(?:e|es|ed|ing)|delv(?:e|es|ed|ing)|landscapes?|showcas(?:e|es|ed|ing)|pivotal|seamless(?:ly)?|robust(?:ly|ness)?|empower(?:s|ed|ing|ment)?|unlock(?:s|ed|ing)?|transform(?:s|ed|ing)?)\b/i;

export type CopyFinding = { rule: "dash" | "banned_word"; match: string; index: number };

/** Every dash and banned word in one piece of user-facing text, in order of position. */
export function copyFindings(text: string): CopyFinding[] {
  const out: CopyFinding[] = [];
  const dash = new RegExp(DASH_RE.source, "g");
  for (const m of text.matchAll(dash)) out.push({ rule: "dash", match: m[0], index: m.index });
  const banned = new RegExp(BANNED_WORD_RE.source, "gi");
  for (const m of text.matchAll(banned)) {
    out.push({ rule: "banned_word", match: m[0], index: m.index });
  }
  return out.sort((x, y) => x.index - y.index);
}
