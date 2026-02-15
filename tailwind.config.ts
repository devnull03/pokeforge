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
        neo: {
          pink: "#ff6b9d",
          yellow: "#ffd93d",
          blue: "#6bcbff",
          green: "#6bff9d",
          purple: "#b06bff",
          orange: "#ff9d6b",
          bg: "#e8e4d9",
          black: "#1a1a2e",
        },
      },
      boxShadow: {
        neo: "4px 4px 0px 0px #1a1a2e",
        "neo-lg": "6px 6px 0px 0px #1a1a2e",
        "neo-xl": "8px 8px 0px 0px #1a1a2e",
        "neo-hover": "6px 6px 0px 0px #1a1a2e",
      },
      fontFamily: {
        mono: ["'Space Mono'", "monospace"],
        display: ["'Space Grotesk'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
