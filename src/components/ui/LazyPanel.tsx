import React, { Suspense } from 'react';
import { Skeleton, SkeletonCard } from './Skeleton';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Suspense boundary for a screen that is downloaded on demand.
 *
 * The fallback is not a spinner in the middle of an empty page — it repeats the
 * shape of the screen about to appear (header bar, then cards or rows), so the
 * layout does not jump when the chunk lands. On a phone that is the difference
 * between "the app is thinking" and "the app is broken".
 */

export type PanelShape = 'cards' | 'rows' | 'board' | 'wizard';

function PanelSkeleton({ shape, label }: { shape: PanelShape; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label ?? 'Loading…'}</span>

      {shape === 'board' && (
        <>
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <div className="xl:col-span-2 space-y-2">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
            <div className="xl:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
            </div>
          </div>
        </>
      )}

      {shape === 'wizard' && (
        <>
          <Skeleton className="h-12 w-full rounded-2xl" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3">
              <Skeleton className="h-56 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
            </div>
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        </>
      )}

      {shape === 'rows' && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {shape === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <SkeletonCard key={index} lines={4} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LazyPanel({
  children,
  shape = 'rows',
  label,
}: {
  children: React.ReactNode;
  shape?: PanelShape;
  label?: string;
}) {
  return (
    <ErrorBoundary label={label} compact>
      <Suspense fallback={<PanelSkeleton shape={shape} label={label} />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
