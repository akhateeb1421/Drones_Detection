interface Props {
  className?: string;
  height?: string;
  width?: string;
}

/**
 * Mint-tinted shimmer placeholder. Use during async data load instead of
 * a "Loading..." string — keeps the layout footprint stable so the page
 * doesn't shift when real data arrives.
 *
 *   <Skeleton className="h-72 w-full" />
 *
 * The animation is the `.skeleton` keyframe defined in index.css.
 */
export function Skeleton({ className = "", height, width }: Props) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ height, width }}
      aria-hidden="true"
    />
  );
}
