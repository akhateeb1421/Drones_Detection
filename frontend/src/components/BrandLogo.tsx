/**
 * رقيب brand mark, inlined as SVG so its colors come from the CSS theme
 * tokens — the gradient follows --primary → --primary-glow and therefore
 * matches both the light and dark palettes automatically (a static
 * /logo.svg file can't read page CSS variables). Background is empty:
 * the mark sits directly on whatever surface hosts it.
 */
export function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 140 140"
      role="img"
      aria-label="رقيب"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="brandGradTheme" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "var(--primary)" }} />
          <stop offset="100%" style={{ stopColor: "var(--primary-glow)" }} />
        </linearGradient>
      </defs>
      {/* Eye outline */}
      <path
        d="M14 70 Q70 14 126 70 Q70 126 14 70 Z"
        fill="none"
        stroke="url(#brandGradTheme)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* Iris */}
      <circle cx="70" cy="70" r="30" fill="url(#brandGradTheme)" />
      {/* Drone glyph — --primary-foreground is dark on the bright accent
          in dark mode and light on it in light mode, so contrast holds
          in both themes. */}
      <g
        style={{ fill: "var(--primary-foreground)", stroke: "var(--primary-foreground)" }}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <polygon points="70,55 86,82 70,79 54,82" strokeWidth="0.6" />
        <rect x="68.5" y="56" width="3" height="24" rx="0.8" />
        <line x1="70" y1="80" x2="76" y2="86" strokeWidth="2.2" />
        <line x1="70" y1="80" x2="64" y2="86" strokeWidth="2.2" />
        <line x1="62" y1="84" x2="78" y2="84" strokeWidth="1.6" />
      </g>
      <circle cx="60" cy="60" r="3" fill="#ffffff" opacity="0.85" />
    </svg>
  );
}
