/**
 * Fixtures dos testes E2E visuais.
 *
 * Estende o `test` do Playwright para, antes de cada teste:
 *  - fixar o relógio (rótulos relativos como "ontem"/"há 4 dias" determinísticos);
 *  - injetar o mock do IPC do Tauri (`window.__TAURI_INTERNALS__`).
 *
 * O tema é uma opção de fixture: `test.use({ theme: "light" })` num bloco.
 */
import { test as base, expect, type Page } from "@playwright/test";

import { buildFixtures, tauriInit, type Theme } from "./mock/tauri";

export const test = base.extend<{ theme: Theme }>({
  theme: ["dark", { option: true }],
  page: async ({ page, theme }, use) => {
    // Data fixa = mesma "data atual" do CLAUDE.md, pra bater com as fixtures.
    await page.clock.setFixedTime(new Date("2026-06-23T12:00:00"));
    await page.addInitScript(tauriInit, buildFixtures(theme));
    await use(page);
  },
});

export { expect };

/** Abre o app e espera o shell aparecer (sai do Splash) + fontes carregadas. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Visão geral", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400); // assenta a animação de entrada (framer-motion)
  // Garante que nenhum comando ficou sem mock (falha cedo se o backend mudar).
  const unmocked = await page.evaluate(
    () => (window as unknown as { __UNMOCKED: string[] }).__UNMOCKED,
  );
  expect(unmocked, `comandos sem mock: ${unmocked.join(", ")}`).toEqual([]);
}

/** Seleciona a 1ª working copy (card "Abrir" da Visão geral) → vai para Alterações. */
export async function openFirstWc(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Abrir", exact: true }).first().click();
  await page.waitForTimeout(400);
}

/** Clica numa aba contextual da TopBar (Alterações/Histórico/Branches/Integração). */
export async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(400);
}
