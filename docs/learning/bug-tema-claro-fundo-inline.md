---
name: Fundo inline no index.html prendia o tema claro no escuro
description: estilo inline vence a variável do tema; o canvas usa var(--color-canvas) e o index.html só mantém color-scheme:dark contra FOUC
type: project
category: bug
date: 2026-06-26
---
Um `background` cravado inline no `<html>`/`<body>` do `index.html` vencia a variável CSS do tema: no tema claro, painéis ficavam claros mas o fundo das views continuava escuro.

**Problema/Contexto:** o tema troca em runtime pela classe `.theme-light` no `<html>`, que só sobrescreve variáveis. Qualquer cor fixa (inline ou hardcoded) ignora a troca.
**Por que importa:** o bug passou despercebido porque os baselines do e2e claro foram capturados já com ele.
**Como aplicar:** `html`, `body` e `#root` usam `var(--color-canvas)`; o `index.html` mantém apenas `color-scheme:dark` como guarda anti-flash branco no primeiro paint. Ao mexer em cores, use as utilities ligadas a variáveis e confira o screenshot claro.
**Evidência:** commit a1b29c5; `index.html` (comentário sobre `color-scheme`) e `src/styles/index.css`.
