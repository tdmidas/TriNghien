/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Deep gold / amber accent on a white-dominant surface
        gold: {
          50: "#fdf9ec",
          100: "#faf0cf",
          200: "#f4df9c",
          300: "#edc95f",
          400: "#e6b234",
          500: "#d99a1c",
          600: "#bd7811", // primary deep gold
          700: "#985812",
          800: "#7d4615",
          900: "#6a3b16",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(189,120,17,0.4)" },
          "70%": { boxShadow: "0 0 0 8px rgba(189,120,17,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(189,120,17,0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.6s infinite",
      },
    },
  },
  plugins: [],
};
