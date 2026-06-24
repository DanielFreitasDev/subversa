/**
 * Testes visuais das views do Subversa.
 *
 * Cada teste faz asserts no conteúdo (falha sozinho se a UI quebrar) E captura
 * um snapshot pra regressão visual (`toHaveScreenshot`). Pra (re)gerar os
 * baselines: `npm run e2e:update`.
 */
import { test, expect, gotoApp, openFirstWc, openTab } from "./fixtures";

test.describe("tema escuro", () => {
  test("visão geral", async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
    await expect(page.getByText("working copies")).toBeVisible();
    await expect(page.getByText("Disponíveis para baixar")).toBeVisible();
    // sna está com conflito → o card mostra o aviso.
    await expect(page.getByText("conflitos", { exact: true })).toBeVisible();

    await expect(page).toHaveScreenshot("overview.png");
  });

  test("alterações + diff + avisos", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);

    // Lista de arquivos com seus status. ("ProcessoService.java" também aparece
    // no cabeçalho do diff quando carregado → .first() pega o item da lista.)
    await expect(page.getByText("ProcessoService.java").first()).toBeVisible();
    await expect(page.getByText("Conciliador.java")).toBeVisible();
    // Aviso de conflito e aviso de commit direto na linha principal.
    await expect(page.getByText("Há conflitos — resolva antes de commitar.")).toBeVisible();
    await expect(page.getByText(/Você está na/)).toBeVisible();
    // Painel de diff à direita.
    await expect(page.getByText("Unificado")).toBeVisible();

    await expect(page).toHaveScreenshot("changes.png");
  });

  test("histórico (log + diff da revisão)", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Histórico");

    // A mensagem do commit selecionado aparece na lista E no detalhe → .first().
    await expect(page.getByText("Corrige cálculo de prazo no ProcessoService").first()).toBeVisible();
    await expect(page.getByText("Refatora camada de persistência")).toBeVisible();

    await expect(page).toHaveScreenshot("history.png");
  });

  test("entrada (a receber do servidor)", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Entrada");

    // Cabeçalho-resumo + botão de atualizar + revisões a receber.
    await expect(page.getByText(/a receber/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Atualizar agora/ })).toBeVisible();
    await expect(
      page.getByText("Corrige cálculo de prazo no ProcessoService").first(),
    ).toBeVisible();

    await expect(page).toHaveScreenshot("entrada.png");
  });

  test("branches (listagem por URL)", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Branches");

    // "issue_1234" também é o branchLabel do getran na sidebar; uso os únicos.
    await expect(page.getByText("issue_1255")).toBeVisible();
    await expect(page.getByText("issue_1198_hotfix")).toBeVisible();

    await expect(page).toHaveScreenshot("branches.png");
  });

  test("integração", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Integração");

    await expect(page.getByText(/Reintegrar uma branch/)).toBeVisible();

    await expect(page).toHaveScreenshot("merge.png");
  });

  test("repositórios", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Repositórios", exact: true }).click();
    await page.waitForTimeout(400);

    await expect(page.getByRole("button", { name: /Nova localização/ }).first()).toBeVisible();

    await expect(page).toHaveScreenshot("repos.png");
  });

  test("repositórios mostra bloqueio de arquivo grande", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Repositórios", exact: true }).click();
    await page.waitForTimeout(400);

    await page.getByText("README.md", { exact: true }).click();

    await expect(page.getByText(/Arquivo grande demais/)).toBeVisible();
  });

  test("repositórios mostra bloqueio de URL fora de escopo", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Repositórios", exact: true }).click();
    await page.waitForTimeout(400);

    await page.getByTitle("svn+ssh://svn.tjsc.local/usr/svn/getran").click();

    await expect(page.getByText(/URL fora das localizações configuradas/)).toBeVisible();
  });

  test("configurações", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.waitForTimeout(400);

    await expect(page.getByText("Servidor & autenticação")).toBeVisible();
    await expect(page.getByText("Localizações de repositório")).toBeVisible();

    await expect(page).toHaveScreenshot("settings.png");
  });

  test("paleta de comandos (Ctrl+K)", async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(300);

    await expect(page.getByPlaceholder(/Buscar comando/)).toBeVisible();

    await expect(page).toHaveScreenshot("palette.png");
  });
});

test.describe("tema claro", () => {
  test.use({ theme: "light" });

  test("aplica o tema claro", async ({ page }) => {
    await gotoApp(page);
    const isLight = await page.evaluate(() =>
      document.documentElement.classList.contains("theme-light"),
    );
    expect(isLight).toBe(true);

    await expect(page).toHaveScreenshot("overview-light.png");
  });

  test("configurações (claro)", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.waitForTimeout(400);

    await expect(page).toHaveScreenshot("settings-light.png");
  });
});

test.describe("registro de comandos", () => {
  // Fuso fixo (UTC-3) → os horários renderizados ficam determinísticos no screenshot.
  test.use({ timezoneId: "America/Sao_Paulo" });

  test("registro lista os comandos svn executados", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Registro", exact: true }).click();
    await page.waitForTimeout(400);

    await expect(page.getByRole("heading", { name: "Registro" })).toBeVisible();
    await expect(page.getByText("6 comandos svn nesta sessão")).toBeVisible();
    // Mensagem do commit (substring única) + o erro destacado.
    await expect(page.getByText("Corrige cálculo de prazo no ProcessoService")).toBeVisible();
    await expect(page.getByText("ERRO 1")).toBeVisible();
    // Horário determinístico (14:58 UTC → 11:58 em UTC-3).
    await expect(page.getByText("11:58:12.100")).toBeVisible();

    await expect(page).toHaveScreenshot("log.png");
  });
});

// Fluxos de escrita (sem screenshot): exercitam confirmações e safety rails.
test.describe("interações", () => {
  test("commit direto na trunk pede confirmação e envia", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page); // sna = trunk (linha principal)

    // Marca um arquivo modificado (o índice 0 é o "selecionar todos", que
    // incluiria o conflito e bloquearia o commit) e escreve a mensagem.
    await page.getByRole("checkbox").nth(1).check();
    await page.getByPlaceholder(/Mensagem do commit/).fill("Ajusta cálculo de prazo");
    await page.getByRole("button", { name: /Commitar/ }).first().click();

    // Safety rail: aviso de commit direto na linha principal.
    await expect(page.getByText(/commitando DIRETO/i)).toBeVisible();

    // Confirma no diálogo → toast de sucesso (o mock devolve "Revisão 4821").
    await page.getByRole("button", { name: "Commitar", exact: true }).click();
    await expect(page.getByText("Commit enviado")).toBeVisible();
  });

  test("apagar branch do servidor exige digitar o nome (safety rail)", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Branches");

    // Revela as ações da linha da branch e clica em apagar.
    const row = page.locator(".group").filter({ hasText: "issue_1255" });
    await row.hover();
    await row.getByRole("button", { name: "Apagar do servidor" }).click();

    // O diálogo trava o botão até o nome ser digitado exatamente.
    await expect(page.getByText(/Digite/)).toBeVisible();
    const confirmBtn = page.getByRole("button", { name: "Apagar", exact: true });
    await expect(confirmBtn).toBeDisabled();

    await page.getByPlaceholder("issue_1255").fill("issue_1255");
    await expect(confirmBtn).toBeEnabled();
  });

  test("histórico: botão direito na revisão revela as três ações", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Histórico");

    await page.getByText("Refatora camada de persistência").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Reverter alterações" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Editar comentário" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Copiar número da revisão" })).toBeVisible();
  });

  test("histórico: editar comentário da revisão envia o revprop", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Histórico");

    // Ícone no detalhe abre o diálogo com o aviso e a mensagem atual.
    await page.getByRole("button", { name: "Editar comentário da revisão" }).first().click();
    await expect(page.getByText(/altera o comentário no servidor/)).toBeVisible();

    await page.getByPlaceholder("Mensagem da revisão").fill("Mensagem corrigida");
    await page.getByRole("button", { name: "Salvar comentário" }).click();
    await expect(page.getByText("Comentário atualizado")).toBeVisible();
  });
});
