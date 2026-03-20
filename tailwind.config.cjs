/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./index.html"],
  theme: {
    extend: {
      colors: {
        teams: "#8B5CF6",
        outlook: "#3B82F6",
      },
      borderRadius: {
        squircle: "2.5rem",
      },
      boxShadow: {
        glass:
          "0 8px 32px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.25)",
        "glass-hover":
          "0 16px 48px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.35)",
        "inner-glow": "inset 0 0 30px rgba(255,255,255,0.06)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.8s infinite linear",
      },
    },
  },
  plugins: [],
};