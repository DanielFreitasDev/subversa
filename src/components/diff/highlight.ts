/**
 * Realce de sintaxe do diff. Tokeniza cada LADO inteiro (não linha-a-linha, para
 * não quebrar comentários/strings multi-linha) via lowlight e cruza os tokens de
 * sintaxe com os segmentos de realce de palavra do diff.
 */

import { common, createLowlight } from "lowlight";
import type { RootContent } from "hast";

import type { DiffFile, DiffLine } from "@/lib/diff";
import { fileExt } from "@/lib/utils";

import type { Segment } from "./rows";

const lowlight = createLowlight(common);

/** Token de sintaxe: trecho de texto e sua classe `hljs-*` (vazia = sem cor). */
interface Token {
  text: string;
  className: string;
}

/** Span final renderizável: texto + classe de sintaxe + se é palavra alterada. */
export interface Span {
  text: string;
  className: string;
  changed: boolean;
}

/** Extensão → linguagem do highlight.js. Apenas as do conjunto `common`. */
const EXT_LANG: Record<string, string> = {
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp", hh: "cpp",
  java: "java",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python",
  sql: "sql",
  xml: "xml", html: "xml", htm: "xml", xhtml: "xml", svg: "xml", vue: "xml",
  css: "css", scss: "css", less: "css",
  json: "json",
  sh: "bash", bash: "bash", zsh: "bash",
  rs: "rust",
  md: "markdown", markdown: "markdown",
};

/** Linguagem a partir da extensão do arquivo; `null` = sem realce (texto puro). */
export function langFromPath(path: string): string | null {
  return EXT_LANG[fileExt(path)] ?? null;
}

/** Achata a árvore hast numa lista linear de tokens (classe mais interna vence). */
function flatten(nodes: RootContent[], inherited: string, out: Token[]): void {
  for (const node of nodes) {
    if (node.type === "text") {
      out.push({ text: node.value, className: inherited });
    } else if (node.type === "element") {
      const cls = node.properties?.className;
      const clsStr = Array.isArray(cls) ? cls.join(" ") : "";
      flatten(node.children as RootContent[], clsStr || inherited, out);
    }
  }
}

/** Quebra a sequência linear de tokens numa lista de tokens por linha. */
function tokensToLines(tokens: Token[], expected: number): Token[][] {
  const lines: Token[][] = [[]];
  for (const tok of tokens) {
    const parts = tok.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      if (parts[i]) lines[lines.length - 1].push({ text: parts[i], className: tok.className });
    }
  }
  while (lines.length < expected) lines.push([]);
  return lines;
}

function highlightLines(contents: string[], lang: string): Token[][] {
  const tree = lowlight.highlight(lang, contents.join("\n"));
  const tokens: Token[] = [];
  flatten(tree.children, "", tokens);
  return tokensToLines(tokens, contents.length);
}

/**
 * Tokeniza um arquivo do diff → mapa `DiffLine → tokens`. Tokeniza o lado antigo
 * (context+del) e o novo (context+add) de uma vez cada, preservando estado
 * multi-linha. Retorna `null` se a linguagem é desconhecida ou o highlight falha.
 */
export function tokenizeFile(file: DiffFile): Map<DiffLine, Token[]> | null {
  const lang = langFromPath(file.path);
  if (!lang) return null;

  const oldLines: DiffLine[] = [];
  const newLines: DiffLine[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "del" || line.type === "context") oldLines.push(line);
      if (line.type === "add" || line.type === "context") newLines.push(line);
    }
  }

  try {
    const oldTok = highlightLines(oldLines.map((l) => l.content), lang);
    const newTok = highlightLines(newLines.map((l) => l.content), lang);
    const map = new Map<DiffLine, Token[]>();
    // `del` vem do lado antigo; `context`/`add` do novo (no context o texto é igual).
    oldLines.forEach((l, i) => {
      if (l.type === "del") map.set(l, oldTok[i] ?? []);
    });
    newLines.forEach((l, i) => map.set(l, newTok[i] ?? []));
    return map;
  } catch {
    return null;
  }
}

/** Realça uma única linha (usado nas linhas de contexto reveladas sob demanda). */
export function spansForPlainLine(content: string, path: string): Span[] {
  const lang = langFromPath(path);
  const plain: Span[] = [{ text: content, className: "", changed: false }];
  if (!lang) return plain;
  try {
    const tree = lowlight.highlight(lang, content);
    const tokens: Token[] = [];
    flatten(tree.children, "", tokens);
    return tokens.length
      ? tokens.map((t) => ({ text: t.text, className: t.className, changed: false }))
      : plain;
  } catch {
    return plain;
  }
}

/**
 * Cruza tokens de sintaxe de uma linha com os segmentos de realce de palavra
 * (ambos particionam a MESMA string) → spans finais. Sem tokens, cai para
 * segmentos puros (sem cor de sintaxe).
 */
export function mergeTokensWithSegments(
  tokens: Token[] | undefined,
  segments: Segment[],
): Span[] {
  if (!tokens || tokens.length === 0) {
    return segments.map((s) => ({ text: s.text, className: "", changed: s.changed }));
  }
  const spans: Span[] = [];
  let ti = 0;
  let si = 0;
  let tOff = 0;
  let sOff = 0;
  while (ti < tokens.length && si < segments.length) {
    const t = tokens[ti];
    const s = segments[si];
    const take = Math.min(t.text.length - tOff, s.text.length - sOff);
    if (take > 0) {
      spans.push({
        text: t.text.slice(tOff, tOff + take),
        className: t.className,
        changed: s.changed,
      });
      tOff += take;
      sOff += take;
    }
    if (tOff >= t.text.length) {
      ti++;
      tOff = 0;
    }
    if (sOff >= s.text.length) {
      si++;
      sOff = 0;
    }
  }
  // Sobra de tokens (defensivo; os comprimentos devem casar).
  while (ti < tokens.length) {
    spans.push({ text: tokens[ti].text.slice(tOff), className: tokens[ti].className, changed: false });
    ti++;
    tOff = 0;
  }
  return spans;
}
