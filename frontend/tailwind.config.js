/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#FAFAFA",
        foreground: "#0F172A",
        muted: "#F1F5F9",
        "muted-foreground": "#64748B",
        accent: "#0052FF",
        "accent-secondary": "#4D7CFF",
        border: "#E2E8F0",
        card: "#FFFFFF",
      },
      fontFamily: {
        display: ["Calistoga", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      boxShadow: {
        accent: "0 4px 14px rgba(0, 82, 255, 0.25)",
        "accent-lg": "0 8px 24px rgba(0, 82, 255, 0.35)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "float": "float 5s ease-in-out infinite",
        "rotate-slow": "rotate 60s linear infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        rotate: {
          "from": { transform: "rotate(0deg)" },
          "to": { transform: "rotate(360deg)" },
        }
      }
    },
  },
  plugins: [],
}
