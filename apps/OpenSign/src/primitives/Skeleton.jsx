import React from "react";

// Base shimmer block - a plain pulsing bar/box that every other skeleton
// shape composes from. bg-base-300 tracks the active DaisyUI theme, so it
// looks right in both light and dark mode without extra work here.
export const Skeleton = ({ className = "" }) => (
  <div className={`animate-pulse rounded bg-base-300 ${className}`} />
);

// A single list/table row: an optional leading circle (avatar/icon) plus a
// handful of text bars whose widths vary slightly so a stack of rows doesn't
// look like a repeated, obviously-fake pattern.
export const SkeletonRow = ({ withAvatar = false, columns = 3 }) => (
  <div className="flex items-center gap-4 w-full py-3">
    {withAvatar && <Skeleton className="h-9 w-9 shrink-0 rounded-full" />}
    {Array.from({ length: columns }).map((_, i) => (
      <Skeleton
        key={i}
        className={`h-3 flex-1 ${i === 0 ? "max-w-[220px]" : "max-w-[120px]"}`}
      />
    ))}
  </div>
);

// A table's worth of SkeletonRow, standing in for "the list hasn't loaded
// yet" wherever a report/table is fetched.
export const SkeletonTable = ({ rows = 6, columns = 4, withAvatar = true }) => (
  <div className="w-full divide-y divide-base-300">
    {Array.from({ length: rows }).map((_, i) => (
      <SkeletonRow key={i} withAvatar={withAvatar} columns={columns} />
    ))}
  </div>
);

// Stands in for a DashboardCard/DashboardReport tile while its data loads -
// matches their common h-[140px] card shape.
export const SkeletonCard = ({ className = "" }) => (
  <div className={`op-card w-full h-[140px] p-4 shadow-md ${className}`}>
    <div className="flex items-center gap-5">
      <Skeleton className="h-[60px] w-[60px] shrink-0 rounded-full" />
      <div className="flex-1 space-y-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-6 w-1/4" />
      </div>
    </div>
  </div>
);

export default Skeleton;
