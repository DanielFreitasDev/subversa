/**
 * Detecção da indentação de um arquivo (tabs × espaços e largura), para o editor
 * embutido abrir cada arquivo já no estilo dele — como o "Detect indent" do
 * IntelliJ. Heurística: olha o começo das primeiras linhas indentadas; maioria
 * com tab → tabs; senão, a largura é o passo (diferença entre níveis vizinhos)
 * mais votado entre 2, 4 e 8.
 */

export interface IndentInfo {
  useTabs: boolean;
  /** Largura em espaços (também usada como largura visual do tab). */
  size: number;
}

export const DEFAULT_INDENT: IndentInfo = { useTabs: false, size: 4 };

const MAX_LINES = 1000;

export function detectIndent(text: string): IndentInfo {
  const lines = text.split("\n", MAX_LINES);
  let tabLines = 0;
  let spaceLines = 0;
  const stepVotes = new Map<number, number>([[2, 0], [4, 0], [8, 0]]);
  let prevWidth = 0;

  for (const line of lines) {
    if (!line || line === "\r") continue;
    const ch = line[0];
    if (ch === "\t") {
      tabLines++;
      continue;
    }
    if (ch !== " ") {
      prevWidth = 0;
      continue;
    }
    spaceLines++;
    let width = 0;
    while (line[width] === " ") width++;
    const step = Math.abs(width - prevWidth);
    if (step > 0 && stepVotes.has(step)) stepVotes.set(step, (stepVotes.get(step) ?? 0) + 1);
    prevWidth = width;
  }

  if (tabLines > spaceLines) return { useTabs: true, size: DEFAULT_INDENT.size };
  if (spaceLines === 0) return DEFAULT_INDENT;

  let best = DEFAULT_INDENT.size;
  let bestVotes = 0;
  for (const [step, votes] of stepVotes) {
    if (votes > bestVotes) {
      best = step;
      bestVotes = votes;
    }
  }
  return { useTabs: false, size: bestVotes > 0 ? best : DEFAULT_INDENT.size };
}
