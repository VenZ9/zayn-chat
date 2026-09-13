import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0d10",
          900: "#101317",
          850: "#161a1f",
          800: "#1c2127",
          700: "#2a313a",
          600: "#3a434e",
        },
      },
    },
  },
  plugins: [],
};

export default config;
