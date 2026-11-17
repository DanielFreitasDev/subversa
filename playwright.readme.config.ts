import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

/**
 * Gera as capturas do README (docs/img/screens/) a partir do mock do IPC.
 *
 *   npm run docs:screenshots
 *
 * Reaproveita o servidor Vite e o navegador da config de e2e; só troca o
 * arquivo executado e desliga o relatório HTML.
 */
export default defineConfig({
  ...base,
  testMatch: "readme.shots.ts",
  reporter: "list",
  fullyParallel: true,
});
