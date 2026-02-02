/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#FF6B35",
          hover: "#FF8555",
          muted: "rgba(255, 107, 53, 0.15)",
        },
        glass: {
          primary: "rgba(18, 18, 18, 0.85)",
          sidebar: "rgba(28, 28, 30, 0.7)",
          card: "rgba(44, 44, 46, 0.9)",
          "card-hover": "rgba(58, 58, 60, 0.9)",
          input: "rgba(38, 38, 40, 0.8)",
          border: "rgba(255, 255, 255, 0.08)",
          "border-strong": "rgba(255, 255, 255, 0.15)",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["SF Mono", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
