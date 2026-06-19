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
    current = { path, binary: false, hunks: [], notes: [], additions: 0, deletions: 0 };
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
      // diff sem cabeçalho "Index:" — cria um arquivo genérico.
      if (line.startsWith("--- ") || line.startsWith("@@")) pushFile("(alterações)");
      else continue;
    }
    const file = current!;

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

  return files;
}
