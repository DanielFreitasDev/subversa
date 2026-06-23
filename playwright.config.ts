import { defineConfig } from "@playwright/test";

/**
 * Testes visuais E2E do frontend (sem backend — o IPC do Tauri é mockado em
 * `e2e/fixtures.ts`). Sobe o Vite dev e dirige o Chrome do sistema.
 *
 *   npm run e2e          # roda os testes (compara com os baselines)
 *   npm run e2e:update   # (re)gera os screenshots-baseline
 *   npm run e2e:report   # abre o último relatório HTML
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],

  // Tolera diferenças mínimas de antialiasing entre execuções.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" },
  },

  use: {
    baseURL: "http://localhost:1420",
    channel: "chrome", // usa o Google Chrome do sistema (sem download de browser)
    viewport: { width: 1440, height: 900 },
    trace: "on-first-retry",
  },

  // Sobe o Vite dev automaticamente (ou reaproveita um já rodando em :1420).
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
