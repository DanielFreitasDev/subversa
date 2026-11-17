---
name: Servidor SVN antigo sem mergeinfo (E200007)
description: merge automático e log -g falham com E200007 em servidor/repo antigo; o app cai para merge clássico com --ignore-ancestry e log sem -g
type: project
category: gotcha
date: 2026-07-23
---
Em servidor ou repositório SVN antigo, tudo que consulta mergeinfo falha com **E200007** ("Retrieval of mergeinfo unsupported"). O Subversa detecta o código e cai para um caminho que não depende de mergeinfo.

**Problema/Contexto:** `svn merge ORIGEM WC` (merge automático, sem intervalo) e `svn log -g` dependem de mergeinfo. No servidor da equipe, "Receber a linha principal", a reintegração e as setas de merge do Gráfico quebravam.
**Por que importa:** qualquer recurso novo que use mergeinfo (merge automático, `-g`, `mergeinfo`) vai quebrar nesse servidor se não tiver o mesmo fallback.
**Como aplicar:**
- Merge: tentar o automático; ao ver E200007, usar o clássico `svn merge --ignore-ancestry ORIGEM@base ORIGEM@HEAD WC`, com o intervalo descoberto pela topologia de cópia (`svn log --stop-on-copy`).
- A base à esquerda precisa ser um peg que **existe na própria origem**: no sync é o copyfrom P (`principal@P`); na reintegração é a criação C da branch (`branch@C`). `branch@P` falha com E160013.
- Sem rastreamento de merge, repetir um sync reaplica as mesmas revisões — o usuário revisa antes de commitar (o app nunca auto-commita a integração).
- Gráfico: refazer o log sem `-g` e avisar que as setas de merge não estão disponíveis.
**Evidência:** commit 4875ae3 (merge clássico, validado contra repositório `file://` real) e 265e8cd (Gráfico); `src-tauri/src/svn/commands.rs` — fallback em `merge` e no log do Gráfico (busca por `E200007`).
