import { useEffect, useRef, useState } from "react";

interface Props {
  // Accept either prop name — call sites in different generations of
  // the codebase have used `value` and `end`. Coalescing avoids the
  // NaN-on-undefined issue we hit when a caller passed `end` to a
  // component that only read `value`.
  value?: number;
  end?: number;
  durationMs?: number;
  className?: string;
}

export function CountUp({ value, end, durationMs = 900, className }: Props) {
  // Coalesce + NaN guard. Anything not a finite number becomes 0 so the
  // animation never renders "NaN" in a KPI card.
  const target = Number.isFinite(value as number)
    ? (value as number)
    : Number.isFinite(end as number)
      ? (end as number)
      : 0;
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const step = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (target - fromRef.current) * eased;
      setDisplay(t < 1 ? next : target);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  const shown = Number.isFinite(display) ? Math.round(display) : 0;
  return <span className={className}>{shown.toLocaleString("en-US")}</span>;
}
