import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { brand: { 50: "#eef4ff", 100: "#dbe7ff", 500: "#3b64e0", 600: "#2d4fc0", 700: "#243f9c", 900: "#142156" } } } },
  plugins: [],
} satisfies Config;
