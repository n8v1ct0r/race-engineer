// Loading and error states. Loading uses static Rule blocks with a text label: no spinner, no
// shimmer (plan section 5, motion). Errors use Ink text and an authored icon, never red.

import type { ReactNode, Ref } from "react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

/** A status line. tabIndex -1 lets a retry move focus here while the data loads again. */
export function LoadingLabel({
  children,
  ref,
}: {
  children: ReactNode;
  ref?: Ref<HTMLParagraphElement>;
}) {
  return (
    <p ref={ref} role="status" tabIndex={-1} className="text-meta text-graphite">
      {children}
    </p>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 shrink-0">
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="10" y1="5.5" x2="10" y2="11" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="10" cy="14" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** A problem, what it means, and what to do next. */
export function ErrorPanel({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className="flex max-w-[70ch] gap-3 text-ink">
      <AlertIcon />
      <div className="flex flex-col gap-2">
        <p className="text-panel">{title}</p>
        {children ? <div className="text-body">{children}</div> : null}
        {action ? <div className="mt-1 flex flex-wrap gap-3">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * The page-shaped placeholder shown while a session's laps load. At least a viewport tall, so the
 * footer stays below the fold and does not jump when the laps arrive.
 */
export function CompareSkeleton({
  label = "Loading laps",
  labelRef,
}: {
  label?: string;
  labelRef?: Ref<HTMLParagraphElement>;
}) {
  return (
    <div className="flex min-h-dvh flex-col gap-6 py-6" aria-busy="true">
      <LoadingLabel ref={labelRef}>{label}</LoadingLabel>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-44" />
          <Skeleton className="h-20" />
          <Skeleton className="h-12" />
          <Skeleton className="h-20" />
          <Skeleton className="h-28" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-10" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}
