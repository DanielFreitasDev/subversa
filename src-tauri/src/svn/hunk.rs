//! Reversão de um **trecho** (change-block) byte a byte.
//!
//! O patch de reversão de um trecho era montado no frontend a partir do diff já
//! exibido — mas esse diff é decodificado como UTF-8 *lossy* (ver `runner.rs`),
//! então em arquivos que não são UTF-8 (ex.: Latin-1, comuns no projeto: veja o
//! `Configura<ç><õ>es` virar `Configura\u{FFFD}\u{FFFD}es`) os bytes acentuados
//! das linhas de contexto viravam U+FFFD e o `svn patch` rejeitava o trecho com
//! "o trecho não casou".
//!
//! A correção: reconstruir o patch **aqui no backend**, a partir do `svn diff`
//! **bruto** (bytes), de modo que o corpo do patch tenha exatamente os mesmos
//! bytes que o `svn patch` vai conferir contra o arquivo — independente da
//! codificação. O frontend só indica *qual* trecho reverter (índice + uma
//! assinatura leve para detectar que o arquivo mudou desde a exibição).
//!
//! O parsing espelha `parseUnifiedDiff` + `changeBlocks` de `src/lib/diff.ts`
//! linha a linha (para o N-ésimo trecho daqui ser o mesmo N-ésimo trecho de lá),
//! e a montagem do patch é a antiga `buildHunkPatch` do frontend, agora aqui e
//! sobre os bytes crus.

/// Linhas de contexto incluídas de cada lado ao isolar um trecho — igual ao
/// `HUNK_CONTEXT` do frontend.
const CONTEXT: usize = 3;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Ctx,
    Add,
    Del,
}

struct Line {
    kind: Kind,
    bytes: Vec<u8>,
    /// Número da linha na base (0 = não se aplica, p.ex. linha adicionada).
    old_no: u32,
    /// Número da linha no trabalho (0 = não se aplica, p.ex. linha removida).
    new_no: u32,
    /// Seguida de "\ No newline at end of file" no diff.
    no_newline: bool,
}

struct Hunk {
    /// Primeiros números do cabeçalho `@@ -old +new @@` (fallback de posição).
    hdr_old: u32,
    hdr_new: u32,
    lines: Vec<Line>,
}

/// Um trecho pronto para reverter: o patch mínimo (sentido direto) e uma
/// assinatura para o frontend confirmar que é o mesmo trecho que ele exibia.
pub struct BlockPatch {
    /// Número da 1ª linha do trecho na base (0 se for adição pura).
    pub first_old: u32,
    /// Número da 1ª linha do trecho no trabalho (0 se for remoção pura).
    pub first_new: u32,
    pub add_count: u32,
    pub del_count: u32,
    /// Patch unificado mínimo (cabeçalho + um hunk) no sentido base→trabalho.
    pub patch: Vec<u8>,
}

/// `@@ -o[,oc] +n[,nc] @@…` → `(o, n)`. O cabeçalho é sempre ASCII.
fn parse_hunk_header(raw: &[u8]) -> Option<(u32, u32)> {
    let s = std::str::from_utf8(raw).ok()?;
    let rest = s.strip_prefix("@@ -")?;
    let (old_part, new_part) = rest.split_once(" +")?;
    let old_start = old_part.split(',').next()?.trim().parse().ok()?;
    let new_start = new_part.split([',', ' ']).next()?.trim().parse().ok()?;
    Some((old_start, new_start))
}

/// Converte o `svn diff` bruto nos hunks de texto do (único) arquivo alvo.
/// Espelha `parseUnifiedDiff`: ignora cabeçalhos de arquivo/propriedade e a
/// linha totalmente vazia (artefato do split), trata `\` como marca de
/// "sem quebra final" e numera contexto/adições/remoções como o front.
fn parse_hunks(diff: &[u8]) -> Vec<Hunk> {
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut cur: Option<Hunk> = None;
    let mut old_no = 0u32;
    let mut new_no = 0u32;

    for raw in diff.split(|&b| b == b'\n') {
        // Linha totalmente vazia: artefato do split final ou separador antes de
        // "Index:"/"Property changes" — NÃO é contexto (este vem como " ").
        if raw.is_empty() {
            continue;
        }
        if raw.starts_with(b"Index: ") || raw.starts_with(b"Property changes on:") {
            if let Some(h) = cur.take() {
                hunks.push(h);
            }
            continue;
        }
        if raw.starts_with(b"===")
            || raw.starts_with(b"--- ")
            || raw.starts_with(b"+++ ")
            || raw.starts_with(b"___")
        {
            continue;
        }
        if raw.starts_with(b"@@") {
            if let Some(h) = cur.take() {
                hunks.push(h);
            }
            if let Some((o, n)) = parse_hunk_header(raw) {
                old_no = o;
                new_no = n;
                cur = Some(Hunk {
                    hdr_old: o,
                    hdr_new: n,
                    lines: Vec::new(),
                });
            }
            continue;
        }
        let h = match cur.as_mut() {
            Some(h) => h,
            None => continue,
        };
        let (tag, content) = (raw[0], raw[1..].to_vec());
        match tag {
            b'+' => {
                h.lines.push(Line {
                    kind: Kind::Add,
                    bytes: content,
                    old_no: 0,
                    new_no,
                    no_newline: false,
                });
                new_no += 1;
            }
            b'-' => {
                h.lines.push(Line {
                    kind: Kind::Del,
                    bytes: content,
                    old_no,
                    new_no: 0,
                    no_newline: false,
                });
                old_no += 1;
            }
            b'\\' => {
                if let Some(last) = h.lines.last_mut() {
                    last.no_newline = true;
                }
            }
            b' ' => {
                h.lines.push(Line {
                    kind: Kind::Ctx,
                    bytes: content,
                    old_no,
                    new_no,
                    no_newline: false,
                });
                old_no += 1;
                new_no += 1;
            }
            _ => {}
        }
    }
    if let Some(h) = cur.take() {
        hunks.push(h);
    }
    hunks
}

/// Divide as linhas de um hunk em trechos contíguos de alteração (igual a
/// `changeBlocks`): retorna pares `(início, fim-exclusivo)`.
fn change_blocks(h: &Hunk) -> Vec<(usize, usize)> {
    let mut blocks = Vec::new();
    let mut start: Option<usize> = None;
    for (i, l) in h.lines.iter().enumerate() {
        if l.kind != Kind::Ctx {
            if start.is_none() {
                start = Some(i);
            }
        } else if let Some(s) = start.take() {
            blocks.push((s, i));
        }
    }
    if let Some(s) = start {
        blocks.push((s, h.lines.len()));
    }
    blocks
}

/// Monta o patch mínimo de um trecho `[s, e)` de `h`, cercado por até [`CONTEXT`]
/// linhas de contexto (sem invadir um trecho vizinho). É a lógica que antes vivia
/// no `buildHunkPatch` do frontend, mas com o corpo saindo dos bytes crus do
/// `svn diff` — fiel à codificação do arquivo.
fn build_block_patch(h: &Hunk, s: usize, e: usize, target: &str) -> BlockPatch {
    let mut from = s;
    let mut c = 0;
    while c < CONTEXT && from > 0 && h.lines[from - 1].kind == Kind::Ctx {
        from -= 1;
        c += 1;
    }
    let mut to = e;
    let mut c = 0;
    while c < CONTEXT && to < h.lines.len() && h.lines[to].kind == Kind::Ctx {
        to += 1;
        c += 1;
    }

    let slice = &h.lines[from..to];
    let mut old_start = 0u32;
    let mut new_start = 0u32;
    let mut old_count = 0u32;
    let mut new_count = 0u32;
    for l in slice {
        if l.old_no != 0 {
            if old_count == 0 {
                old_start = l.old_no;
            }
            old_count += 1;
        }
        if l.new_no != 0 {
            if new_count == 0 {
                new_start = l.new_no;
            }
            new_count += 1;
        }
    }
    // Trecho sem contexto de um dos lados (ex.: começo do arquivo): cai para o
    // início do hunk — o `svn patch` ainda casa pelas linhas restantes.
    if old_start == 0 {
        old_start = h.hdr_old;
    }
    if new_start == 0 {
        new_start = h.hdr_new;
    }

    let header = format!(
        "Index: {t}\n\
         ===================================================================\n\
         --- {t}\n\
         +++ {t}\n\
         @@ -{old_start},{old_count} +{new_start},{new_count} @@\n",
        t = target,
    );
    let mut patch = header.into_bytes();
    for l in slice {
        patch.push(match l.kind {
            Kind::Add => b'+',
            Kind::Del => b'-',
            Kind::Ctx => b' ',
        });
        patch.extend_from_slice(&l.bytes);
        if l.no_newline {
            patch.extend_from_slice(b"\n\\ No newline at end of file");
        }
        patch.push(b'\n');
    }

    // Assinatura: posição/contagem do trecho SEM contexto (igual ao que o front
    // calcula em `hunkRef`), para detectar que o diff mudou desde a exibição.
    let block = &h.lines[s..e];
    let first_old = block.iter().find(|l| l.old_no != 0).map(|l| l.old_no).unwrap_or(0);
    let first_new = block.iter().find(|l| l.new_no != 0).map(|l| l.new_no).unwrap_or(0);
    let add_count = block.iter().filter(|l| l.kind == Kind::Add).count() as u32;
    let del_count = block.iter().filter(|l| l.kind == Kind::Del).count() as u32;

    BlockPatch {
        first_old,
        first_new,
        add_count,
        del_count,
        patch,
    }
}

/// Todos os trechos do arquivo `target` em ordem de documento (hunks → blocos),
/// cada um já com o patch pronto. O índice nesta lista é o que o frontend passa.
pub fn extract_blocks(diff: &[u8], target: &str) -> Vec<BlockPatch> {
    let hunks = parse_hunks(diff);
    let mut out = Vec::new();
    for h in &hunks {
        for (s, e) in change_blocks(h) {
            out.push(build_block_patch(h, s, e, target));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// O caso do bug: um arquivo Latin-1 (bytes 0xE7 = `ç`, 0xF5 = `õ`) numa
    /// linha de contexto. O patch reconstruído precisa carregar esses bytes
    /// **crus** — não o U+FFFD (`EF BF BD`) da decodificação lossy — senão o
    /// `svn patch` rejeita o trecho ("o trecho não casou").
    #[test]
    fn rebuilds_latin1_context_byte_for_byte() {
        let mut diff: Vec<u8> = Vec::new();
        diff.extend_from_slice(b"Index: build.properties\n");
        diff.extend_from_slice(b"===================================================================\n");
        diff.extend_from_slice(b"--- build.properties\t(revision 16334)\n");
        diff.extend_from_slice(b"+++ build.properties\t(working copy)\n");
        diff.extend_from_slice(b"@@ -52,4 +52,4 @@\n");
        diff.extend_from_slice(b" # Configura");
        diff.push(0xE7); // 'ç' em Latin-1 (byte inválido em UTF-8)
        diff.push(0xF5); // 'õ' em Latin-1
        diff.extend_from_slice(b"es do projeto GETRAN\n");
        diff.extend_from_slice(b"-getran.project.name=getran-nota-fiscal-merge\n");
        diff.extend_from_slice(b"+getran.project.name=getran_160_dev\n");
        diff.extend_from_slice(b" getran.project.dist.name=getran\n");
        diff.extend_from_slice(b" getran.project.dir=x\n");

        let blocks = extract_blocks(&diff, "/wc/build.properties");
        assert_eq!(blocks.len(), 1, "um único trecho");
        let b = &blocks[0];
        assert_eq!((b.first_old, b.first_new), (53, 53));
        assert_eq!((b.add_count, b.del_count), (1, 1));

        // Bytes Latin-1 preservados; nenhum U+FFFD introduzido.
        assert!(b.patch.contains(&0xE7), "0xE7 preservado");
        assert!(b.patch.contains(&0xF5), "0xF5 preservado");
        assert!(
            !b.patch.windows(3).any(|w| w == [0xEF, 0xBF, 0xBD]),
            "sem U+FFFD"
        );

        let s = String::from_utf8_lossy(&b.patch);
        assert!(s.starts_with("Index: /wc/build.properties\n"));
        assert!(s.contains("@@ -52,4 +52,4 @@\n"));
        assert!(s.contains("-getran.project.name=getran-nota-fiscal-merge\n"));
        assert!(s.contains("+getran.project.name=getran_160_dev\n"));
    }

    /// Vários trechos num mesmo hunk (como o log4j.xml dos prints): cada um sai
    /// na ordem, com a assinatura certa, e o patch de um trecho isola só ele.
    /// (Literal com quebras reais e alinhado à coluna 0 — para as linhas de
    /// contexto manterem o espaço inicial que as marca.)
    #[test]
    fn splits_multiple_blocks_in_one_hunk() {
        let diff = "Index: log4j.xml
===================================================================
--- log4j.xml\t(revision 16334)
+++ log4j.xml\t(working copy)
@@ -22,7 +22,7 @@
 ctx a
-    error 1
+    debug 1
 ctx b
-    error 2
+    debug 2
 ctx c
-    error 3
+    debug 3
 ctx d
"
        .as_bytes();

        let blocks = extract_blocks(diff, "/wc/log4j.xml");
        assert_eq!(blocks.len(), 3);
        assert_eq!((blocks[0].first_old, blocks[0].first_new), (23, 23));
        assert_eq!((blocks[1].first_old, blocks[1].first_new), (25, 25));
        assert_eq!((blocks[2].first_old, blocks[2].first_new), (27, 27));

        // O 2º trecho isola só `error 2`/`debug 2`, com seu contexto vizinho.
        let s = String::from_utf8_lossy(&blocks[1].patch);
        assert!(s.contains("@@ -24,3 +24,3 @@\n"), "cabeçalho do trecho 2: {s}");
        assert!(s.contains("-    error 2\n"));
        assert!(s.contains("+    debug 2\n"));
        assert!(!s.contains("error 1"), "não vaza o trecho 1");
        assert!(!s.contains("error 3"), "não vaza o trecho 3");
    }

    /// Linha sem quebra final: o marcador `\ No newline at end of file` é
    /// reanexado à linha certa (sem ele, a reversão acrescentaria uma quebra).
    #[test]
    fn preserves_no_newline_marker() {
        let diff = b"Index: f\n\
===================================================================\n\
--- f\t(revision 1)\n\
+++ f\t(working copy)\n\
@@ -1,1 +1,1 @@\n\
-old line\n\
+new line\n\
\\ No newline at end of file\n";

        let blocks = extract_blocks(diff, "/wc/f");
        assert_eq!(blocks.len(), 1);
        let s = String::from_utf8_lossy(&blocks[0].patch);
        assert!(s.contains("+new line\n\\ No newline at end of file\n"), "{s}");
        // A linha removida NÃO ganha o marcador.
        assert!(s.contains("-old line\n"));
    }
}
