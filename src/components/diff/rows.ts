/**
 * Constrói as linhas renderizáveis de um hunk, com realce de palavra (intra-line)
 * nos pares -/+. Lógica pura (sem JSX) reutilizada pelos modos unificado e split.
 */

import { diffWordsWithSpace } from "diff";

import type { DiffHunk, DiffLine } from "@/lib/diff";

/** Trecho de uma linha; `changed` marca a palavra alterada (fundo translúcido). */
export interface Segment {
  text: string;
  changed: boolean;
}

/** Linha do modo unificado. */
export interface Row {
  line: DiffLine;
  segments: Segment[];
}

/** Célula de um lado no modo split. */
export interface SplitCell {
  line: DiffLine;
  segments: Segment[];
}

/** Par esquerda/direita do modo split (lado ausente = `null`). */
export interface SplitRow {
  left: SplitCell | null;
  right: SplitCell | null;
}

/** Acima disto, pular o diff de palavra (evita travar em linhas gigantes). */
const MAX_INLINE = 2000;

const plain = (line: DiffLine): Segment[] => [{ text: line.content, changed: false }];

/** Realce de palavra entre uma linha removida e uma adicionada pareadas. */
function pairSegments(d: DiffLine, a: DiffLine): { left: Segment[]; right: Segment[] } {
  if (d.content.length > MAX_INLINE || a.content.length > MAX_INLINE) {
    return { left: plain(d), right: plain(a) };
  }
  const parts = diffWordsWithSpace(d.content, a.content);
  return {
    left: parts.filter((p) => !p.added).map((p) => ({ text: p.value, changed: !!p.removed })),
    right: parts.filter((p) => !p.removed).map((p) => ({ text: p.value, changed: !!p.added })),
  };
}

/** Linhas do hunk em modo unificado (del antes de add, com realce nos pares). */
export function buildRows(hunk: DiffHunk): Row[] {
  const rows: Row[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];

  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i];
      const a = adds[i];
      if (d && a) {
        const { left, right } = pairSegments(d, a);
        rows.push({ line: d, segments: left });
        rows.push({ line: a, segments: right });
      } else if (d) {
        rows.push({ line: d, segments: plain(d) });
      } else if (a) {
        rows.push({ line: a, segments: plain(a) });
      }
    }
    dels = [];
    adds = [];
  };

  for (const line of hunk.lines) {
    if (line.type === "del") dels.push(line);
    else if (line.type === "add") adds.push(line);
    else {
      flush();
      rows.push({ line, segments: plain(line) });
    }
  }
  flush();
  return rows;
}

/** Linhas do hunk em modo split (esquerda = antigo, direita = novo). */
export function buildSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];

  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i];
      const a = adds[i];
      if (d && a) {
        const { left, right } = pairSegments(d, a);
        rows.push({ left: { line: d, segments: left }, right: { line: a, segments: right } });
      } else if (d) {
        rows.push({ left: { line: d, segments: plain(d) }, right: null });
      } else if (a) {
        rows.push({ left: null, right: { line: a, segments: plain(a) } });
      }
    }
    dels = [];
    adds = [];
  };

  for (const line of hunk.lines) {
    if (line.type === "del") dels.push(line);
    else if (line.type === "add") adds.push(line);
    else {
      flush();
      const seg = plain(line);
      rows.push({ left: { line, segments: seg }, right: { line, segments: seg } });
    }
  }
  flush();
  return rows;
}
