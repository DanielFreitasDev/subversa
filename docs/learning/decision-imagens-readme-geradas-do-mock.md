---
name: Imagens do README geradas do mock do e2e
description: capturas em docs/img/screens vêm de npm run docs:screenshots (dados fictícios); nunca usar prints do servidor real
type: feedback
category: decision
date: 2026-11-17
---
As capturas do README são geradas por `npm run docs:screenshots` (`e2e/readme.shots.ts` + `playwright.readme.config.ts`) a partir do mock do IPC, com dados fictícios.

**Problema/Contexto:** o README antigo usava prints de junho/2026 que, segundo o próprio README, mostravam **dados reais do servidor de produção**, e estavam desatualizados em relação às telas novas (Gráfico, Entrada, editores, Registro, Backups). O usuário pediu um README moderno e completo, com imagens.
**Por que importa:** prints manuais envelhecem e podem vazar nomes de projetos, autores e caminhos reais num repositório publicado.
**Como aplicar:** depois de mudar uma tela que aparece no README, rode `npm run docs:screenshots` e revise as imagens. Telas carregadas sob demanda precisam esperar um texto da própria tela antes do `shot()`, senão a captura sai vazia (aconteceu na primeira versão do script). O arquivo não é `*.spec.ts` de propósito, para não entrar no `npm run e2e`.
**Evidência:** pedido do usuário em 2026-11-17; `e2e/readme.shots.ts`; primeira execução gerou Histórico/Entrada/Branches vazios até adicionar as esperas.
