# LEARNING.md — base de conhecimento do projeto

Leia as entradas relacionadas à tarefa. Os detalhes ficam em `docs/learning/`.

## Bugs e soluções
- [AppImage contamina o ambiente de programas externos](docs/learning/bug-appimage-ambiente-processo-filho.md) — meld/editor/xdg-open morriam em silêncio; dispare por `spawn_detached` (limpa vars sob `$APPDIR`).
- [Fundo inline prendia o tema claro no escuro](docs/learning/bug-tema-claro-fundo-inline.md) — estilo inline vence a variável do tema; canvas usa `var(--color-canvas)`.

## Pegadinhas de ambiente, dependências e bibliotecas
- [Servidor SVN sem mergeinfo (E200007)](docs/learning/gotcha-servidor-sem-mergeinfo-e200007.md) — merge automático e `log -g` falham; fallback para merge clássico com `--ignore-ancestry`.
- [Working copy de revisão mista](docs/learning/gotcha-wc-revisao-mista.md) — raiz fica na revisão antiga após commit; use `svnversion` e `--allow-mixed-revisions`.
- [Arquivos ISO-8859-1 no repositório](docs/learning/gotcha-codificacao-latino-1.md) — decodificar por arquivo e regravar na codificação original; nada de `from_utf8_lossy` em conteúdo.

## Decisões de arquitetura
- [Dependências de runtime no .deb](docs/learning/decision-deb-dependencias-runtime.md) — bundler só vê libs linkadas; `subversion`/`openssh-client` em depends, `sshpass` em recommends.
- [Imagens do README geradas do mock](docs/learning/decision-imagens-readme-geradas-do-mock.md) — `npm run docs:screenshots` com dados fictícios; nunca prints do servidor real.

## Abordagens que NÃO funcionaram

## Notas de performance

## Referências externas
