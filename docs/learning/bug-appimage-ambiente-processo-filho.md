---
name: AppImage contamina o ambiente de programas externos
description: meld/editor externo/xdg-open morriam em silêncio por herdar PYTHONHOME e LD_LIBRARY_PATH do AppImage; limpar vars sob $APPDIR antes do spawn
type: project
category: bug
date: 2026-07-01
---
Empacotado como AppImage, o `AppRun` exporta variáveis (`PYTHONHOME`, `PYTHONPATH`, `LD_LIBRARY_PATH`, `GSETTINGS_SCHEMA_DIR`…) apontando para `$APPDIR`. Programas de sistema abertos pelo app herdavam isso e quebravam.

**Problema/Contexto:** o Python do `meld` procurava a stdlib dentro do AppImage e morria antes de abrir a janela, sem erro visível (stderr ia para `/dev/null`). Sintoma relatado: "o meld parou de abrir".
**Por que importa:** qualquer processo-filho novo disparado pelo app (ferramenta de diff, editor, `xdg-open`) tem o mesmo risco, e o sintoma é silencioso.
**Como aplicar:** dispare programas externos por `spawn_detached`, que chama `strip_appimage_env()` (remove componentes de ambiente sob `$APPDIR`; só age quando `APPDIR` existe). Não vale para o próprio `svn`, que é executado pelo runner.
**Evidência:** commit 2ea7f82; `strip_appimage_env` em `src-tauri/src/svn/commands.rs`.
