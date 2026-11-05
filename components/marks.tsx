// Driver identity never rests on color alone: slot A is a violet circle, slot B a bronze diamond,
// and both always sit next to a 3-letter code (plan section 5). In the charts A's line is solid and
// B's is dashed.

export type Slot = "a" | "b";

/** Inline circle (A) or diamond (B), 12 px, for legends and labels. */
export function DriverMark({ slot, size = 12 }: { slot: Slot; size?: number }) {
  const c = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="inline-block shrink-0 align-[-1px]"
    >
      {slot === "a" ? (
        <circle cx={c} cy={c} r={c - 1} style={{ fill: "var(--color-driver-a)" }} />
      ) : (
        <polygon
          points={`${c},0.5 ${size - 0.5},${c} ${c},${size - 0.5} 0.5,${c}`}
          style={{ fill: "var(--color-driver-b)" }}
        />
      )}
    </svg>
  );
}

/** Chart line pattern per slot: A solid, B dashed, so the two lines differ in grayscale too. */
export const LINE_DASH: Record<Slot, number[]> = { a: [], b: [6, 3] };

/** A short line key in the driver's color and pattern, for chart legends. */
export function LineKey({ slot }: { slot: Slot }) {
  return (
    <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true" className="inline-block">
      <line
        x1="1"
        y1="6"
        x2="24"
        y2="6"
        strokeWidth="2"
        strokeDasharray={LINE_DASH[slot].join(" ") || undefined}
        style={{ stroke: slot === "a" ? "var(--color-driver-a)" : "var(--color-driver-b)" }}
      />
    </svg>
  );
}

/** Driver mark plus code: "(o) AAA". */
export function DriverTag({ slot, code }: { slot: Slot; code: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <DriverMark slot={slot} />
      <span className="font-bold">{code}</span>
    </span>
  );
}
