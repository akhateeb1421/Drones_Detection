/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // New ZeBeyond palette.
        // Background: #182724 — dark teal-near-black.
        // Accent: triadic gradient cyan #01F2CF -> mint #03DA9A -> sky #03B3DA.
        // For elements that can't carry a gradient (chart bars, axis labels,
        // semantic flags), use the gradient's middle stop as the flat token.
        bg: "#182724",
        panel: "#1f3530",
        "panel-2": "#274540",
        accent: "#03DA9A",
        accent2: "#02b07a",
        warning: "#f5a623",
        danger: "#ff4757",
        success: "#03DA9A",
        muted: "#a8b3a9",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Tajawal", "Arial"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        mount:     { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        pulseRing: { "0%": { transform: "scale(0.6)", opacity: "0.6" }, "100%": { transform: "scale(2.4)", opacity: "0" } },
        shimmer:   { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        slideIn:   { "0%": { transform: "scaleY(0)" }, "100%": { transform: "scaleY(1)" } },
        aurora:    { "0%, 100%": { transform: "translateX(-8%)" }, "50%": { transform: "translateX(8%)" } },
        skel:      { "0%": { backgroundPosition: "-150% 0" }, "100%": { backgroundPosition: "150% 0" } },
        // Slow gradient drift for the accent — same triadic colors, drifting
        // along the surface so buttons/rails feel alive without throbbing.
        gradientDrift: { "0%, 100%": { backgroundPosition: "0% 50%" }, "50%": { backgroundPosition: "100% 50%" } },
      },
      animation: {
        mount:        "mount 360ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-ring": "pulseRing 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite",
        shimmer:      "shimmer 2.4s linear infinite",
        "slide-in":   "slideIn 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
        aurora:       "aurora 18s ease-in-out infinite",
        skel:         "skel 1.6s linear infinite",
        "gradient-drift": "gradientDrift 8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
