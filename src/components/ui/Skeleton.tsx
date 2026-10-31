import React from 'react';
import { cx } from './cx';

/**
 * Loading placeholders that match the shape of the thing being loaded, so the
 * page does not jump when the data arrives.
 *
 * Decorative by contract: `aria-hidden`, with one polite live region on the
 * container, so a screen reader hears "loading" once instead of every bar.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('animate-pulse rounded-lg bg-slate-200/80', className)} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-6 w-16 mb-3" />
      {Array.from({ length: lines - 1 }).map((_, index) => (
        <Skeleton key={index} className="h-2.5 w-full mt-2" />
      ))}
    </div>
  );
}

export function SkeletonList({
  rows = 3,
  label,
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-2">
      <span className="sr-only">{label ?? 'Loading…'}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}
