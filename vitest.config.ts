import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

// Config separada do vite.config.ts (que é async e afinado para o Tauri).
// Os testes unitários cobrem só a lógica pura de `src/lib` — sem DOM, então
// `environment: "node"` basta e mantém a suíte rápida.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
