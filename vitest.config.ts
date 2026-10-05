import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";
config();
process.env.STORAGE_DIR = require("node:path").resolve(__dirname, ".test-uploads");
export default defineConfig({
  esbuild: { jsx: "automatic" },
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts") } },
  test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx"], fileParallelism: false },
});
