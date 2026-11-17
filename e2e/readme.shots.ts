/**
 * Capturas de tela do README (não é teste de regressão).
 *
 * Usa o mesmo mock do IPC do Tauri da suíte e2e, então as imagens mostram
 * apenas dados fictícios — nada do servidor real vai parar no repositório.
 * O nome do arquivo foge do padrão `*.spec.ts` de propósito: `npm run e2e`
 * não o executa; só `npm run docs:screenshots` (playwright.readme.config.ts).
 *
 * Saída: docs/img/screens/<nome>.png
 */
import type { Page } from "@playwright/test";

import { test, gotoApp, openFirstWc, openTab } from "./fixtures";

const OUT = "docs/img/screens";

async function shot(page: Page, name: string): Promise<void> {
  await page.mouse.move(1430, 890); // tira o cursor de cima de hovers/tooltips
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

async function openSidebar(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(400);
}

test.describe("README — tema escuro", () => {
  test.use({ timezoneId: "America/Sao_Paulo" });

  test("visão geral", async ({ page }) => {
    await gotoApp(page);
    await shot(page, "overview-dark");
  });

  test("alterações", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await page.getByText("Unificado").first().waitFor();
    await shot(page, "changes");
  });

  test("histórico", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Histórico");
    await page.getByText("Refatora camada de persistência").first().waitFor();
    await shot(page, "history");
  });

  test("gráfico", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Gráfico");
    await page.getByText("sync ← r4816").waitFor();
    await shot(page, "graph");
  });

  test("entrada", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Entrada");
    await page.getByRole("button", { name: /Atualizar agora/ }).waitFor();
    await shot(page, "incoming");
  });

  test("branches", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Branches");
    await page.getByText("issue_1198_hotfix").waitFor();
    await shot(page, "branches");
  });

  test("integração", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Integração");
    await page.getByText(/Reintegrar uma branch/).first().waitFor();
    await shot(page, "merge");
  });

  test("editor de conflitos", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    const row = page.locator(".group").filter({ hasText: "Conciliador.java" }).first();
    await row.hover();
    await row.getByRole("button", { name: "Resolver conflito" }).click();
    await page.getByText("RESULTADO (editável)").waitFor();
    // Tooltip do gatilho pode reabrir sob o modal (ver views.spec.ts).
    await page.evaluate(() => {
      const kill = () =>
        document.querySelectorAll("div.pointer-events-none.max-w-xs").forEach((n) => n.remove());
      kill();
      new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
    });
    await shot(page, "merge-editor");
  });

  test("editor de código", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page.locator(".cm-content").first().waitFor();
    await page.keyboard.press("Control+f");
    await page.getByPlaceholder("Localizar…").fill("processo");
    await page.getByText("1/2").waitFor();
    await shot(page, "code-editor");
  });

  test("repositórios", async ({ page }) => {
    await gotoApp(page);
    await openSidebar(page, "Repositórios");
    await page.getByRole("button", { name: /Nova localização/ }).first().waitFor();
    await shot(page, "repos");
  });

  test("registro", async ({ page }) => {
    await gotoApp(page);
    await openSidebar(page, "Registro");
    await page.getByText("6 comandos svn nesta sessão").waitFor();
    await shot(page, "command-log");
  });

  test("backups", async ({ page }) => {
    await gotoApp(page);
    await openSidebar(page, "Backups");
    await page.getByText("antes de: merge").waitFor();
    await shot(page, "backups");
  });

  test("paleta de comandos", async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder(/Buscar comando/).waitFor();
    await shot(page, "palette");
  });

  test("configurações", async ({ page }) => {
    await gotoApp(page);
    await openSidebar(page, "Configurações");
    await page.getByText("Servidor & autenticação").waitFor();
    await shot(page, "settings");
  });
});

test.describe("README — tema claro", () => {
  test.use({ theme: "light", timezoneId: "America/Sao_Paulo" });

  test("visão geral (claro)", async ({ page }) => {
    await gotoApp(page);
    await shot(page, "overview-light");
  });

  test("alterações (claro)", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await page.getByText("Unificado").first().waitFor();
    await shot(page, "changes-light");
  });
});
