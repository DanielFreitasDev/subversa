/** Parser do diff unificado produzido pelo `svn diff`. */

export type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldNumber: number | null;
  newNumber: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  binary: boolean;
  hunks: DiffHunk[];
  /** Linhas de "Property changes" e afins, exibidas como nota. */
  notes: string[];
  additions: number;
  deletions: number;
  /**
   * Arquivo novo (adicionado) — só conteúdo novo, sem base anterior. Detectado
   * pela forma do próprio diff (`@@ -0,0 …`, sem remoções), independente de
   * idioma, para escolher o modo de exibição padrão (novo → "Unificado").
   */
  added: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Converte texto de `svn diff` em arquivos/hunks estruturados. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const pushFile = (path: string) => {
    current = { path, binary: false, hunks: [], notes: [], additions: 0, deletions: 0, added: false };
    files.push(current);
    hunk = null;
  };

  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("Index: ")) {
      pushFile(line.slice("Index: ".length).trim());
      continue;
    }
    if (/^=+$/.test(line)) continue;
    if (!current) {
      // diff sem cabeçalho "Index:" (raro): inicia um arquivo genérico, cujo
      // nome é ajustado quando vier a linha "+++".
      if (line.startsWith("--- ") || line.startsWith("@@")) pushFile("(alterações)");
      else continue;
    }
    const file = current!;

    // Aproveita o "+++" para nomear o arquivo do fallback (sem cabeçalho Index).
    if (line.startsWith("+++ ") && file.path === "(alterações)") {
      const p = line.slice(4).split("\t")[0].replace(/^[ab]\//, "").trim();
      if (p && p !== "/dev/null") file.path = p;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
    if (/Cannot display:|binary type|arquivo marcado como/i.test(line)) {
      file.binary = true;
      continue;
    }
    if (line.startsWith("Property changes on:") || line.startsWith("___")) {
      file.notes.push(line);
      continue;
    }

    const m = HUNK_RE.exec(line);
    if (m) {
      const oldStart = parseInt(m[1], 10);
      const newStart = parseInt(m[3], 10);
      hunk = { header: line, oldStart, newStart, lines: [] };
      file.hunks.push(hunk);
      oldNo = oldStart;
      newNo = newStart;
      continue;
    }

    if (!hunk) {
      if (file.notes.length || file.binary) file.notes.push(line);
      continue;
    }

    const tag = line[0];
    const content = line.slice(1);
    if (tag === "+") {
      hunk.lines.push({ type: "add", content, oldNumber: null, newNumber: newNo++ });
      file.additions++;
    } else if (tag === "-") {
      hunk.lines.push({ type: "del", content, oldNumber: oldNo++, newNumber: null });
      file.deletions++;
    } else if (tag === "\\") {
      // "\ No newline at end of file" — ignorado.
    } else {
      hunk.lines.push({ type: "context", content, oldNumber: oldNo++, newNumber: newNo++ });
    }
  }

  // Marca arquivos novos: sem remoções e com todo hunk começando em -0 (a forma
  // `@@ -0,0 +1,N @@` que o `svn diff` usa para adições, igual à de
  // `buildAddedFileDiff`). Exige ao menos um hunk para não confundir mudanças
  // só de propriedade/binárias com adição de conteúdo.
  for (const f of files) {
    f.added = f.deletions === 0 && f.hunks.length > 0 && f.hunks.every((h) => h.oldStart === 0);
  }

  return files;
}

/**
 * Monta um diff unificado "tudo adicionado" a partir do conteúdo de um arquivo.
 *
 * Necessário porque um arquivo **adicionado por cópia** (`svn copy`) não tem
 * conteúdo visível em `svn diff -c REV <url-do-arquivo>`: o Subversion o compara
 * com a origem da cópia e devolve vazio (ou só os ajustes pós-cópia), o que fazia
 * a UI exibir "Sem diferenças.". Aqui buscamos o conteúdo novo (via `svn cat`) e
 * o formatamos como uma adição, espelhando o formato do próprio `svn diff` para
 * que [`parseUnifiedDiff`] o renderize igual a qualquer outro arquivo novo —
 * como o IntelliJ mostra arquivos novos no histórico.
 *
 * `content` vem de `svn cat` decodificado como UTF-8 (lossy): bytes inválidos
 * viram U+FFFD e o NUL sobrevive como U+0000 — ambos indicam binário, caso em
 * que emitimos a nota que o parser reconhece em vez de despejar bytes crus.
 */
export function buildAddedFileDiff(path: string, content: string, revision: string): string {
  const name = path.split("/").filter(Boolean).pop() || path;
  const head =
    `Index: ${name}\n` +
    "===================================================================\n";

  if (/[\u0000\uFFFD]/.test(content)) {
    return `${head}Cannot display: file marked as a binary type.\n`;
  }

  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // descarta a quebra final
  const header = `${head}--- ${name}\t(nonexistent)\n+++ ${name}\t(revisão ${revision})\n`;
  if (lines.length === 0) return header; // arquivo vazio: cabeçalho sem hunk
  return `${header}@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
}
