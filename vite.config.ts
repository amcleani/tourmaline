import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and serves the built files from dist/.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  // pdf.js alone is about 500 kB; the bundle loads from disk, so size warnings are noise.
  // MathJax's TeX packages and font ranges load from node_modules on demand
  // (src/math/engine.ts); pre-bundling would give them a second copy of MathJax.
  optimizeDeps: { exclude: ["@mathjax/src", "@mathjax/mathjax-tex-font", "@mathjax/mathjax-newcm-font"] },
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 2000 },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});
