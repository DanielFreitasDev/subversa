/**
 * Configuração do CodeMirror 6 usada pelo editor embutido (`CodeEditorModal`).
 * Centraliza a escolha de linguagem por extensão, o tema (cores do VSCode,
 * conforme claro/escuro do app) e os ajustes fixos (fonte mono, Tab que indenta).
 */

import { EditorView, keymap, type Extension } from "@uiw/react-codemirror";
import { indentWithTab } from "@codemirror/commands";
import { loadLanguage, type LanguageName } from "@uiw/codemirror-extensions-langs";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";

import { fileExt } from "@/lib/utils";

/** Extensão de arquivo → linguagem do CodeMirror. Espelha o conjunto realçado
 *  no resto do app (ver `components/diff/highlight.ts`). */
const EXT_TO_LANG: Record<string, LanguageName> = {
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp", hh: "cpp",
  java: "java",
  js: "js", jsx: "jsx", mjs: "mjs", cjs: "cjs",
  ts: "ts", tsx: "tsx",
  py: "py",
  sql: "sql",
  xml: "xml", svg: "svg", vue: "vue",
  html: "html", htm: "html", xhtml: "html",
  css: "css", scss: "scss", less: "less",
  json: "json",
  sh: "sh", bash: "bash", zsh: "bash",
  rs: "rs",
  md: "md", markdown: "markdown",
};

/** Suporte de linguagem do CodeMirror para o arquivo, ou `null` (texto puro). */
export function cmLanguageFor(path: string): Extension | null {
  const name = EXT_TO_LANG[fileExt(path)];
  if (!name) return null;
  return (loadLanguage(name) as Extension | null) ?? null;
}

/** Fonte mono do app + entrelinha — comum aos dois modos (cheio e inline). */
const SCROLLER = {
  fontFamily: "var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace)",
  lineHeight: "1.55",
};

/** Modal: ocupa toda a altura do container. */
const fullHeight = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px" },
  ".cm-scroller": SCROLLER,
});

/** Inline (trecho do editor de conflito): cresce com o conteúdo até `maxHeight`. */
const autoHeight = (maxHeight: string): Extension =>
  EditorView.theme({
    "&": { fontSize: "12.5px" },
    "&.cm-editor": { maxHeight },
    ".cm-scroller": { ...SCROLLER, overflow: "auto" },
  });

/** Tema base do editor (paleta do VSCode) conforme o modo claro/escuro do app. */
export function cmTheme(isDark: boolean): Extension {
  return isDark ? vscodeDark : vscodeLight;
}

/** Extensões do editor de altura cheia (modal): fonte/altura + Tab que indenta. */
export function cmExtras(): Extension[] {
  return [fullHeight, keymap.of([indentWithTab])];
}

/** Extensões do editor inline: auto-altura (até `maxHeight`) + Tab que indenta. */
export function cmInlineExtras(maxHeight = "40vh"): Extension[] {
  return [autoHeight(maxHeight), keymap.of([indentWithTab])];
}
