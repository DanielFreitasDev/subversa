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

  test("alterações: pastas têm ícone de pasta para diferenciar de arquivos", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);

    // A linha de uma pasta exibe o ícone de pasta…
    const dirRow = page.locator(".group").filter({ hasText: "relatorio" }).first();
    await expect(dirRow.locator(".lucide-folder")).toBeVisible();
    // …e um arquivo comum, não.
    const fileRow = page.locator(".group").filter({ hasText: "ProcessoService.java" }).first();
    await expect(fileRow.locator(".lucide-folder")).toHaveCount(0);
  });

  test("alterações: arquivo novo (fora do SVN) pode ser adicionado ou excluído", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);

    // A linha do arquivo não versionado revela ações de adicionar/excluir.
    const row = page.locator(".group").filter({ hasText: "local.properties" }).first();
    await row.hover();
    await expect(row.getByRole("button", { name: "Adicionar ao SVN" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Excluir do disco" })).toBeVisible();

    // Adicionar ao SVN dispara o svn add e confirma por toast.
    await row.getByRole("button", { name: "Adicionar ao SVN" }).click();
    await expect(page.getByText("Adicionado ao SVN")).toBeVisible();
  });

  test("alterações: reverter tem botão e menu de contexto (botão direito)", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);

    // Botão "Reverter tudo" no rodapé, ao lado de "Reverter selecionados".
    await expect(page.getByRole("button", { name: "Reverter tudo" })).toBeVisible();

    // Botão direito num arquivo versionado: revert do arquivo + revert global.
    const fileRow = page.locator(".group").filter({ hasText: "ProcessoService.java" }).first();
    await fileRow.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Reverter este arquivo" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Abrir no sistema" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Reverter tudo" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Botão direito num arquivo fora do SVN: adicionar/excluir, sem "reverter arquivo".
    const newRow = page.locator(".group").filter({ hasText: "local.properties" }).first();
    await newRow.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Adicionar ao SVN" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Excluir do disco" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Reverter este arquivo" })).toHaveCount(0);
  });

  test("editor de conflitos em 3 painéis", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);

    // Abre o editor visual no arquivo em conflito (ação revelada no hover).
    const row = page.locator(".group").filter({ hasText: "Conciliador.java" }).first();
    await row.hover();
    await row.getByRole("button", { name: "Resolver conflito" }).click();
    await page.mouse.move(720, 760);
    await page.waitForTimeout(450);

    // Três painéis + contador de conflito pendente.
    await expect(page.getByText("LOCAL (meu)")).toBeVisible();
    await expect(page.getByText("RESULTADO (editável)")).toBeVisible();
    await expect(page.getByText("SERVIDOR (deles)")).toBeVisible();
    await expect(page.getByText("1 conflito restante")).toBeVisible();
    await expect(page.getByText(/Conflito — escolha um lado/)).toBeVisible();
    // Salvar trava enquanto houver conflito pendente.
    await expect(page.getByRole("button", { name: /Salvar resolução/ })).toBeDisabled();

    // O gatilho "Resolver conflito" fica coberto pelo modal e nunca recebe
    // mouseleave; no StrictMode (dev) o foco-trap o re-foca ao montar, reabrindo
    // seu tooltip de forma racy. É puramente visual (não acontece em produção) —
    // um MutationObserver remove o nó assim que ele aparece, p/ baseline limpo.
    await page.evaluate(() => {
      const kill = () =>
        document.querySelectorAll("div.pointer-events-none.max-w-xs").forEach((n) => n.remove());
      kill();
      new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
    });
    await page.waitForTimeout(150);
    await expect(page).toHaveScreenshot("merge-editor.png");
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

  test("histórico: pastas alteradas têm ícone de pasta", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Histórico");

    // A revisão que criou a branch alterou um diretório (kind "dir").
    await page.getByText("Branch para issue_1234").first().click();
    // O caminho da pasta exibe o ícone de pasta (o trecho "JUNHO" só aparece no
    // caminho, não na mensagem — isola o botão do caminho).
    const dirPath = page.locator("button").filter({ hasText: "JUNHO" }).first();
    await expect(dirPath.locator(".lucide-folder")).toBeVisible();
  });

  test("histórico: arquivo novo (adicionado por cópia) mostra o conteúdo", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Histórico");

    // Seleciona a revisão que adicionou um arquivo por cópia.
    await page.getByText("Refatora camada de persistência").first().click();
    // Clica no arquivo adicionado por cópia (ação A com origem).
    await page.locator("button").filter({ hasText: "ProcessoServiceLegado.java" }).click();

    // Antes mostrava "Sem diferenças."; agora o DiffViewer renderiza 1 arquivo
    // (o conteúdo novo como adição) em vez do vazio.
    await expect(page.getByText("Sem diferenças.")).toHaveCount(0);
    await expect(page.getByText("1 arquivo(s)")).toBeVisible();

    await expect(page).toHaveScreenshot("history-arquivo-novo-por-copia.png");
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

  test("repositórios: expandir tudo abre a árvore inteira", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Repositórios", exact: true }).click();
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: "Expandir tudo" }).first().click();

    // Um arquivo aninhado (trunk/src/…) só aparece com a árvore toda expandida.
    await expect(page.getByText("ProcessoService.java", { exact: true }).first()).toBeVisible();
  });

  test("repositórios: busca por nome e por conteúdo", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Repositórios", exact: true }).click();
    await page.waitForTimeout(400);

    // Busca por nome (filtro instantâneo, com debounce).
    await page.getByPlaceholder(/Buscar arquivo ou pasta/).fill("Processo");
    await expect(page.getByText("ProcessoService.java", { exact: true }).first()).toBeVisible();

    // Alterna para conteúdo e dispara a busca.
    await page.getByRole("button", { name: "Conteúdo", exact: true }).click();
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(page.getByText(/ocorrência\(s\) em/).first()).toBeVisible();
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

  // Views que o usuário reportou com o fundo travado no escuro. Capturam o
  // compositor de commit (textarea), a lista de entrada, o histórico e as
  // branches no tema claro — garantindo que o canvas acompanha o tema.
  test("alterações (claro)", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);

    await expect(page.getByText("Unificado")).toBeVisible();
    await expect(page.getByText(/Você está na/)).toBeVisible();

    await expect(page).toHaveScreenshot("changes-light.png");
  });

  test("entrada (claro)", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Entrada");

    await expect(page.getByText(/a receber/).first()).toBeVisible();

    await expect(page).toHaveScreenshot("entrada-light.png");
  });

  test("histórico (claro)", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Histórico");

    await expect(page.getByText("Refatora camada de persistência")).toBeVisible();

    await expect(page).toHaveScreenshot("history-light.png");
  });

  test("branches (claro)", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);
    await openTab(page, "Branches");

    await expect(page.getByText("issue_1255")).toBeVisible();

    await expect(page).toHaveScreenshot("branches-light.png");
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

test.describe("backups", () => {
  // Fuso fixo (UTC-3) → a data absoluta renderizada fica determinística.
  test.use({ timezoneId: "America/Sao_Paulo" });

  test("backups (pontos de restauração)", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Backups", exact: true }).click();
    await page.waitForTimeout(400);

    await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();
    await expect(page.getByText("antes de: merge")).toBeVisible();
    await expect(page.getByText("antes de: update")).toBeVisible();
    await expect(page.getByRole("button", { name: "Restaurar" }).first()).toBeVisible();

    await expect(page).toHaveScreenshot("backups.png");
  });

  test("operação destrutiva oferece backup", async ({ page }) => {
    await gotoApp(page);
    // "Atualizar" (Visão geral) dispara a guarda: o diálogo oferece o backup.
    await page.getByRole("button", { name: "Atualizar", exact: true }).first().click();
    await page.waitForTimeout(300);

    await expect(page.getByText("Receber alterações do servidor?")).toBeVisible();
    await expect(page.getByText(/Fazer um backup/)).toBeVisible();

    await expect(page).toHaveScreenshot("backup-prompt.png");
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

  test("editor de conflitos: resolver e salvar", async ({ page }) => {
    await gotoApp(page);
    await openFirstWc(page);

    const row = page.locator(".group").filter({ hasText: "Conciliador.java" }).first();
    await row.hover();
    await row.getByRole("button", { name: "Resolver conflito" }).click();
    await page.waitForTimeout(300);

    // Salvar começa travado (1 conflito pendente).
    const save = page.getByRole("button", { name: /Salvar resolução/ });
    await expect(save).toBeDisabled();

    // Resolve o conflito pegando o lado do servidor → libera o salvar.
    await page.getByRole("button", { name: "Servidor", exact: true }).first().click();
    await expect(page.getByText("Sem conflitos pendentes")).toBeVisible();
    await expect(save).toBeEnabled();

    await save.click();
    await expect(page.getByText("Conflito resolvido")).toBeVisible();
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
