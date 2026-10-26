import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        vexa: {
          dark: "#0b0f17",
          panel: "rgba(15, 23, 42, 0.85)",
          border: "rgba(255, 255, 255, 0.12)",
          cyan: "#00f0ff",
          magenta: "#ff007f",
          accent: "#38bdf8",
        },
      },
      boxShadow: {
        glow: "0 0 25px -5px rgba(0, 240, 255, 0.35)",
        "glow-magenta": "0 0 25px -5px rgba(255, 0, 127, 0.35)",
      },
      animation: {
        "pulse-subtle": "pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
