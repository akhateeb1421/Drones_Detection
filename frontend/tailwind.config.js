/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#050a14",
        panel: "#0a0f1e",
        accent: "#38bdf8",
        accent2: "#0369a1",
        warning: "#f5a623",
        danger: "#e94560",
        success: "#22c55e",
        muted: "#94a3b8",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Tajawal", "Arial"],
      },
    },
  },
  plugins: [],
};
