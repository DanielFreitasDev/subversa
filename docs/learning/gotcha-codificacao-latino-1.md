---
name: Arquivos ISO-8859-1 no repositório da equipe
description: parte dos arquivos (.java, build.properties) é latino-1; decodificar por arquivo e regravar na codificação original, nunca from_utf8_lossy global
type: project
category: gotcha
date: 2026-07-01
---
O repositório mistura arquivos UTF-8 e ISO-8859-1. Diff, `cat` e o editor decodificam **por arquivo** (UTF-8 estrito, senão latino-1) e o editor regrava na codificação original.

**Problema/Contexto:** um `String::from_utf8_lossy` global trocava todo byte acentuado latino-1 por U+FFFD (o "�" no diff), e o editor embutido recusava arquivos que não fossem UTF-8.
**Por que importa:** salvar um arquivo latino-1 como UTF-8 gera diffs enormes e pode quebrar o build; um changeset pode misturar as duas codificações.
**Como aplicar:**
- Ler saída de diff/cat em bytes crus (`run_raw_checked_limited`) e fatiar nas linhas `Index:` antes de decodificar (`decode_diff`).
- Editor: `decode_text` detecta; a gravação recusa caracteres fora do latino-1 (€, emoji, aspas curvas) em vez de corromper.
- `from_utf8_lossy` só é aceitável para stderr/mensagens, não para conteúdo de arquivo.
**Evidência:** commits 149dfe0 e e48bb6c; `decode_text`/`decode_diff` e testes `latino1_*`/`decode_diff_respeita_encoding_por_arquivo` em `src-tauri/src/svn/commands.rs`; `hunk.rs` (`rebuilds_latin1_context_byte_for_byte`).
