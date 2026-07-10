/**
 * Reformatador de código por linguagem — o "Reformat Code" (Ctrl+Alt+L) do
 * IntelliJ. Usa o Prettier standalone com o plugin certo por extensão (Java,
 * XML, JS/TS, CSS/SCSS/LESS, HTML/Vue, JSON, Markdown) e o sql-formatter para
 * SQL. Cada motor é `import()` dinâmico: o peso só é baixado no primeiro uso
 * daquela linguagem e o Vite o separa em chunks próprios.
 *
 * A indentação do arquivo (detectada/ajustada na barra de status) é respeitada
 * via `tabWidth`/`useTabs`; a largura segue o padrão do IntelliJ (120 colunas).
 */

import type { Plugin } from "prettier";

import type { IndentInfo } from "@/lib/indent";
import { fileExt } from "@/lib/utils";

type Kind =
  | "babel"
  | "typescript"
  | "css"
  | "scss"
  | "less"
  | "html"
  | "vue"
  | "markdown"
  | "json"
  | "xml"
  | "java"
  | "sql";

const EXT_TO_FORMATTER: Record<string, Kind> = {
  js: "babel", jsx: "babel", mjs: "babel", cjs: "babel",
  ts: "typescript", tsx: "typescript",
  css: "css", scss: "scss", less: "less",
  html: "html", htm: "html", xhtml: "html", vue: "vue",
  md: "markdown", markdown: "markdown",
  json: "json",
  xml: "xml", svg: "xml",
  java: "java",
  sql: "sql",
};

/** Há formatador para este arquivo? (decide o estado do botão/menu) */
export function canFormat(path: string): boolean {
  return fileExt(path) in EXT_TO_FORMATTER;
}

const PRINT_WIDTH = 120;

/** Carrega os plugins Prettier de cada linguagem sob demanda. */
async function pluginsFor(kind: Kind): Promise<{ parser: string; plugins: Plugin[] }> {
  switch (kind) {
    case "babel":
    case "json": {
      const [babel, estree] = await Promise.all([
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
      ]);
      return { parser: kind === "json" ? "json" : "babel", plugins: [babel, estree as Plugin] };
    }
    case "typescript": {
      const [ts, estree] = await Promise.all([
        import("prettier/plugins/typescript"),
        import("prettier/plugins/estree"),
      ]);
      return { parser: "typescript", plugins: [ts, estree as Plugin] };
    }
    case "css":
    case "scss":
    case "less": {
      const postcss = await import("prettier/plugins/postcss");
      return { parser: kind, plugins: [postcss] };
    }
    case "html":
    case "vue": {
      // O parser HTML precisa dos parsers embutidos para <script>/<style>.
      const [html, babel, estree, postcss] = await Promise.all([
        import("prettier/plugins/html"),
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
        import("prettier/plugins/postcss"),
      ]);
      return { parser: kind, plugins: [html, babel, estree as Plugin, postcss] };
    }
    case "markdown": {
      const md = await import("prettier/plugins/markdown");
      return { parser: "markdown", plugins: [md] };
    }
    case "xml": {
      const xml = await import("@prettier/plugin-xml");
      return { parser: "xml", plugins: [(xml.default ?? xml) as Plugin] };
    }
    case "java": {
      const java = await import("prettier-plugin-java");
      return { parser: "java", plugins: [java.default] };
    }
    case "sql":
      throw new Error("sql usa o sql-formatter, não o Prettier");
  }
}

/** Primeira linha útil do erro do Prettier (sem o code-frame gigante). */
function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n").find((l) => l.trim()) ?? "erro desconhecido";
}

/**
 * Reformata `text` de acordo com a linguagem do arquivo. Erro de sintaxe (ou
 * linguagem sem formatador) vira `{ error }` amigável — nunca exceção.
 */
export async function formatText(
  path: string,
  text: string,
  indent: IndentInfo,
): Promise<{ ok: string } | { error: string }> {
  const kind = EXT_TO_FORMATTER[fileExt(path)];
  if (!kind) return { error: "sem formatador para esta linguagem." };
  try {
    if (kind === "sql") {
      const { format } = await import("sql-formatter");
      return {
        ok: format(text, {
          language: "sql",
          tabWidth: indent.size,
          useTabs: indent.useTabs,
          keywordCase: "preserve",
        }),
      };
    }
    const [{ format }, { parser, plugins }] = await Promise.all([
      import("prettier/standalone"),
      pluginsFor(kind),
    ]);
    const ok = await format(text, {
      parser,
      plugins,
      tabWidth: indent.size,
      useTabs: indent.useTabs,
      printWidth: PRINT_WIDTH,
      // Só o plugin XML lê esta opção; reformatar de verdade exige ignorar
      // o whitespace original (como o reformat do IntelliJ).
      ...(kind === "xml" ? { xmlWhitespaceSensitivity: "ignore" } : null),
    });
    return { ok };
  } catch (e) {
    return { error: firstLine(e) };
  }
}

/**
 * Menor substituição que transforma `oldText` em `newText` (apara o prefixo e
 * o sufixo comuns). Trocar só o miolo preserva cursor, dobras e scroll do que
 * não mudou — em vez de reescrever o documento inteiro.
 */
export function minimalReplace(
  oldText: string,
  newText: string,
): { from: number; to: number; insert: string } {
  let start = 0;
  const max = Math.min(oldText.length, newText.length);
  while (start < max && oldText[start] === newText[start]) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--;
    endNew--;
  }
  return { from: start, to: endOld, insert: newText.slice(start, endNew) };
}
