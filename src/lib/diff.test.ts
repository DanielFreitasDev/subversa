import { describe, expect, it } from "vitest";

import { buildAddedFileDiff, changeBlocks, hunkRef, parseUnifiedDiff } from "@/lib/diff";

const DIFF_DOIS_ARQUIVOS = `Index: src/app.ts
===================================================================
--- src/app.ts	(revisão 100)
+++ src/app.ts	(cópia de trabalho)
@@ -1,4 +1,5 @@
 linha1
-linha2
+linha2 nova
+linha extra
 linha3
 linha4
Index: docs/leia.txt
===================================================================
--- docs/leia.txt	(revisão 100)
+++ docs/leia.txt	(cópia de trabalho)
@@ -10,2 +11,2 @@
 contexto
-velho
+novo
`;

describe("parseUnifiedDiff", () => {
  it("separa arquivos e conta adições/remoções", () => {
    const files = parseUnifiedDiff(DIFF_DOIS_ARQUIVOS);
    expect(files.map((f) => f.path)).toEqual(["src/app.ts", "docs/leia.txt"]);
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    expect(files[1].additions).toBe(1);
    expect(files[1].deletions).toBe(1);
    expect(files[0].added).toBe(false);
  });

  it("numera as linhas old/new corretamente", () => {
    const [f] = parseUnifiedDiff(DIFF_DOIS_ARQUIVOS);
    const h = f.hunks[0];
    expect(h.oldStart).toBe(1);
    expect(h.newStart).toBe(1);
    // contexto, del, add, add, contexto, contexto
    expect(h.lines.map((l) => [l.type, l.oldNumber, l.newNumber])).toEqual([
      ["context", 1, 1],
      ["del", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["context", 3, 4],
      ["context", 4, 5],
    ]);
  });

  it("reinicia a numeração a cada hunk a partir do cabeçalho", () => {
    const text =
      "Index: a.txt\n" +
      "===================================================================\n" +
      "--- a.txt\t(revisão 1)\n" +
      "+++ a.txt\t(cópia de trabalho)\n" +
      "@@ -1,2 +1,2 @@\n linha\n-x\n+y\n" +
      "@@ -20,2 +21,2 @@\n outra\n-w\n+z\n";
    const [f] = parseUnifiedDiff(text);
    expect(f.hunks).toHaveLength(2);
    expect(f.hunks[1].lines[0]).toMatchObject({ type: "context", oldNumber: 20, newNumber: 21 });
  });

  it("reconhece arquivos binários", () => {
    const text =
      "Index: logo.png\n" +
      "===================================================================\n" +
      "Cannot display: file marked as a binary type.\n" +
      "svn:mime-type = application/octet-stream\n";
    const [f] = parseUnifiedDiff(text);
    expect(f.binary).toBe(true);
    expect(f.hunks).toHaveLength(0);
    expect(f.added).toBe(false);
  });

  it("trata mudança só de propriedade como nota, sem hunks", () => {
    const text =
      "Index: pasta\n" +
      "===================================================================\n" +
      "--- pasta\t(revisão 100)\n" +
      "+++ pasta\t(cópia de trabalho)\n" +
      "\n" +
      "Property changes on: pasta\n" +
      "___________________________________________________________________\n" +
      "Added: svn:ignore\n" +
      "## -0,0 +1 ##\n" +
      "+dist\n";
    const [f] = parseUnifiedDiff(text);
    expect(f.hunks).toHaveLength(0);
    expect(f.added).toBe(false);
    expect(f.notes.some((n) => n.startsWith("Property changes on:"))).toBe(true);
  });

  it("detecta arquivo adicionado pela forma @@ -0,0", () => {
    const text =
      "Index: novo.ts\n" +
      "===================================================================\n" +
      "--- novo.ts\t(nonexistent)\n" +
      "+++ novo.ts\t(cópia de trabalho)\n" +
      "@@ -0,0 +1,2 @@\n+a\n+b\n";
    const [f] = parseUnifiedDiff(text);
    expect(f.added).toBe(true);
    expect(f.additions).toBe(2);
    expect(f.deletions).toBe(0);
  });

  it("marca a última linha antes de '\\ No newline at end of file'", () => {
    const text =
      "Index: a.txt\n" +
      "===================================================================\n" +
      "--- a.txt\t(revisão 1)\n" +
      "+++ a.txt\t(cópia de trabalho)\n" +
      "@@ -1 +1 @@\n-velha\n+nova\n\\ No newline at end of file\n";
    const [f] = parseUnifiedDiff(text);
    const lines = f.hunks[0].lines;
    expect(lines[lines.length - 1].noNewline).toBe(true);
    expect(lines[0].noNewline).toBeUndefined();
  });

  it("preserva o \\r de conteúdo CRLF (comportamento atual)", () => {
    const text =
      "Index: a.txt\n" +
      "===================================================================\n" +
      "--- a.txt\t(revisão 1)\n" +
      "+++ a.txt\t(cópia de trabalho)\n" +
      "@@ -1 +1 @@\n-velha\r\n+nova\r\n";
    const [f] = parseUnifiedDiff(text);
    expect(f.hunks[0].lines[1].content).toBe("nova\r");
  });

  it("não cria contexto fantasma com a linha vazia final (regressão)", () => {
    // O `split("\n")` produz um "" final; ele NÃO é linha de contexto — uma
    // linha em branco de verdade viria como " " (espaço).
    const text =
      "Index: a.txt\n" +
      "===================================================================\n" +
      "--- a.txt\t(revisão 1)\n" +
      "+++ a.txt\t(cópia de trabalho)\n" +
      "@@ -5 +5 @@\n-fim velho\n+fim novo\n";
    const [f] = parseUnifiedDiff(text);
    expect(f.hunks[0].lines).toHaveLength(2);
  });

  it("nomeia pelo '+++' quando o diff não tem cabeçalho Index", () => {
    const text = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n";
    const [f] = parseUnifiedDiff(text);
    expect(f.path).toBe("x.ts");
    expect(f.additions).toBe(1);
    expect(f.deletions).toBe(1);
  });
});

describe("buildAddedFileDiff", () => {
  it("gera um diff que o parser lê como arquivo novo (roundtrip)", () => {
    const diff = buildAddedFileDiff("dir/novo.ts", "a\nb\n", "123");
    const [f] = parseUnifiedDiff(diff);
    expect(f.path).toBe("novo.ts");
    expect(f.added).toBe(true);
    expect(f.additions).toBe(2);
  });

  it("emite a nota de binário para conteúdo não-texto", () => {
    const diff = buildAddedFileDiff("logo.png", "�PNG", "123");
    const [f] = parseUnifiedDiff(diff);
    expect(f.binary).toBe(true);
  });

  it("arquivo vazio vira cabeçalho sem hunk", () => {
    const diff = buildAddedFileDiff("vazio.txt", "", "123");
    const [f] = parseUnifiedDiff(diff);
    expect(f.hunks).toHaveLength(0);
    expect(f.added).toBe(false);
  });
});

describe("changeBlocks + hunkRef", () => {
  it("divide um hunk em trechos contíguos e assina cada um", () => {
    const text =
      "Index: a.txt\n" +
      "===================================================================\n" +
      "--- a.txt\t(revisão 1)\n" +
      "+++ a.txt\t(cópia de trabalho)\n" +
      "@@ -1,6 +1,6 @@\n ctx1\n-x\n+y\n ctx2\n+extra\n ctx3\n";
    const [f] = parseUnifiedDiff(text);
    const h = f.hunks[0];
    const blocks = changeBlocks(h);
    expect(blocks).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 5 },
    ]);

    const ref = hunkRef(h, blocks[0], 0, 2);
    expect(ref).toMatchObject({ blockIndex: 0, totalBlocks: 2, addCount: 1, delCount: 1 });
    expect(ref.firstOld).toBe(2); // a linha removida era a 2ª na base
    const ref2 = hunkRef(h, blocks[1], 1, 2);
    expect(ref2).toMatchObject({ addCount: 1, delCount: 0, firstOld: 0 });
  });
});
