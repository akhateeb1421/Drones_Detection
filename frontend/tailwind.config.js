/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#110c08",
        panel: "#1a130d",
        "panel-2": "#221a13",
        accent: "#c89968",
        accent2: "#a17b4f",
        warning: "#d9a05c",
        danger: "#c5443c",
        success: "#6ea892",
        muted: "#a89c8c",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Tajawal", "Arial"],
        serif: ["\"EB Garamond\"", "\"Cormorant Garamond\"", "ui-serif", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        mount: { "0%": { opacity: "0", transform: "translateY(6px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        pulseRing: { "0%": { transform: "scale(0.6)", opacity: "0.6" }, "100%": { transform: "scale(2.2)", opacity: "0" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        slideIn: { "0%": { transform: "scaleY(0)" }, "100%": { transform: "scaleY(1)" } },
      },
      animation: {
        mount: "mount 360ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-ring": "pulseRing 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite",
        shimmer: "shimmer 2.4s linear infinite",
        "slide-in": "slideIn 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};
