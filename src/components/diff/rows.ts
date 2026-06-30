/**
 * Constrói as linhas renderizáveis de um hunk, aplicando o tratamento de
 * espaços em branco (estilo IntelliJ) e o realce intra-linha nos pares -/+.
 * Lógica pura (sem JSX) reutilizada pelos modos unificado e split.
 */

import { diffChars, diffWords, diffWordsWithSpace } from "diff";

import type { DiffHunk, DiffLine } from "@/lib/diff";
import type { HighlightMode, WsMode } from "@/store/ui";

/** Trecho de uma linha; `changed` marca a parte alterada (fundo translúcido). */
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

/** Granularidade do realce intra-linha (resolvida de `HighlightMode`). */
export type Granularity = "none" | "word" | "char" | "split";

/** Opções de construção: tratamento de espaços + granularidade do realce. */
export interface RowOpts {
  wsMode: WsMode;
  granularity: Granularity;
}

/** Traduz o modo de realce para `{ fundo da linha, granularidade intra-linha }`. */
export function resolveHighlight(mode: HighlightMode): { lineBg: boolean; granularity: Granularity } {
  switch (mode) {
    case "lines":
      return { lineBg: true, granularity: "none" };
    case "words":
      return { lineBg: true, granularity: "word" };
    case "split":
      return { lineBg: true, granularity: "split" };
    case "chars":
      return { lineBg: true, granularity: "char" };
    case "none":
      return { lineBg: false, granularity: "none" };
  }
}

/** Acima disto, pular o diff intra-linha (evita travar em linhas gigantes). */
const MAX_INLINE = 2000;
/** Linhas de import/uso — ignoradas no modo "Ignorar formatação" (heurística). */
const IMPORT_RE = /^\s*(import|from|using|use|uses|#include|require|require_once|package)\b/;

const plainText = (text: string): Segment[] => [{ text, changed: false }];
const plain = (line: DiffLine): Segment[] => plainText(line.content);
const asContext = (line: DiffLine): DiffLine => ({ ...line, type: "context" });

/** Normaliza uma linha para comparação, conforme o modo de espaços. */
function normalizeWs(s: string, mode: WsMode): string {
  switch (mode) {
    case "trim":
      return s.trim();
    case "ignore":
    case "ignoreEmpty":
    case "ignoreFormat":
      return s.replace(/\s/g, "");
    default:
      return s;
  }
}

/** Um par removido/adicionado conta como inalterado sob o modo de espaços? */
function wsEqual(d: DiffLine, a: DiffLine, mode: WsMode): boolean {
  if (mode === "none") return false;
  if (normalizeWs(d.content, mode) === normalizeWs(a.content, mode)) return true;
  // "Ignorar formatação": mudanças entre linhas de import também são ignoradas.
  if (mode === "ignoreFormat" && IMPORT_RE.test(d.content) && IMPORT_RE.test(a.content)) return true;
  return false;
}

/** Uma linha avulsa (sem par) deve ser suprimida (mostrada como contexto)? */
function suppressible(line: DiffLine, mode: WsMode): boolean {
  if (mode === "ignoreEmpty") return normalizeWs(line.content, mode) === "";
  if (mode === "ignoreFormat")
    return normalizeWs(line.content, mode) === "" || IMPORT_RE.test(line.content);
  return false;
}

/** Realce intra-linha entre uma linha removida e uma adicionada pareadas. */
function pairSegments(
  d: DiffLine,
  a: DiffLine,
  granularity: Granularity,
): { left: Segment[]; right: Segment[] } {
  if (granularity === "none" || d.content.length > MAX_INLINE || a.content.length > MAX_INLINE) {
    return { left: plain(d), right: plain(a) };
  }
  const parts =
    granularity === "char"
      ? diffChars(d.content, a.content)
      : granularity === "split"
        ? diffWords(d.content, a.content)
        : diffWordsWithSpace(d.content, a.content);
  return {
    left: parts.filter((p) => !p.added).map((p) => ({ text: p.value, changed: !!p.removed })),
    right: parts.filter((p) => !p.removed).map((p) => ({ text: p.value, changed: !!p.added })),
  };
}

/** Linhas do hunk em modo unificado (del antes de add, com realce nos pares). */
export function buildRows(hunk: DiffHunk, opts: RowOpts): Row[] {
  const { wsMode, granularity } = opts;
  const rows: Row[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];

  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i];
      const a = adds[i];
      if (d && a) {
        if (wsEqual(d, a, wsMode)) {
          // Só difere em espaços/imports → colapsa numa linha de contexto (lado novo).
          rows.push({
            line: { type: "context", content: a.content, oldNumber: d.oldNumber, newNumber: a.newNumber, noNewline: a.noNewline },
            segments: plain(a),
          });
        } else {
          const { left, right } = pairSegments(d, a, granularity);
          rows.push({ line: d, segments: left });
          rows.push({ line: a, segments: right });
        }
      } else if (d) {
        rows.push({ line: suppressible(d, wsMode) ? asContext(d) : d, segments: plain(d) });
      } else if (a) {
        rows.push({ line: suppressible(a, wsMode) ? asContext(a) : a, segments: plain(a) });
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
export function buildSplitRows(hunk: DiffHunk, opts: RowOpts): SplitRow[] {
  const { wsMode, granularity } = opts;
  const rows: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];

  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i];
      const a = adds[i];
      if (d && a) {
        if (wsEqual(d, a, wsMode)) {
          // Mantém os dois lados, mas renderizados como contexto (sem cor).
          rows.push({
            left: { line: asContext(d), segments: plain(d) },
            right: { line: asContext(a), segments: plain(a) },
          });
        } else {
          const { left, right } = pairSegments(d, a, granularity);
          rows.push({ left: { line: d, segments: left }, right: { line: a, segments: right } });
        }
      } else if (d) {
        rows.push({ left: { line: suppressible(d, wsMode) ? asContext(d) : d, segments: plain(d) }, right: null });
      } else if (a) {
        rows.push({ left: null, right: { line: suppressible(a, wsMode) ? asContext(a) : a, segments: plain(a) } });
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
