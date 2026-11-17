---
name: Working copy de revisão mista
description: após commitar arquivos fundos a raiz da WC fica na revisão antiga; use a maior revisão (svnversion) e --allow-mixed-revisions no merge
type: project
category: gotcha
date: 2026-07-02
updated: 2026-11-17
---
Depois de um commit, o `svn` só sobe a revisão dos itens commitados; a raiz da working copy continua na revisão anterior. A "revisão da WC" precisa ser a **maior presente** (`svnversion`), e o merge precisa aceitar WC mista.

**Problema/Contexto:** lendo a revisão por `svn info` na raiz, logo após um commit rN o cabeçalho mostrava a revisão antiga, a aba Entrada listava o próprio commit como "a receber" e o Histórico (log da WC assume `BASE:1`) escondia rN. Desde o svn 1.7 o merge recusa WC mista com **E195020** ("try updating first").
**Por que importa:** o fluxo normal da equipe (commitar arquivos fundos e depois integrar) cai nesse estado o tempo todo.
**Como aplicar:**
- Revisão exibida/base de comparação: `wc_highest_rev` (maior revisão do `svnversion`, com fallback para `svn info`).
- Histórico: logar pela URL (`HEAD:1`), não pelo caminho da WC (`BASE:1`).
- Merges (automático, clássico e `reverse_merge`) levam `--allow-mixed-revisions`, como o TortoiseSVN. O sync/reintegração real continua atualizando antes.
**Evidência:** commits dc91413 e 8b37c3c (validado contra repositório `file://`: WC mista `3:4` dá E195020 sem o flag e aplica limpo com ele); `wc_highest_rev` em `src-tauri/src/svn/commands.rs`.
