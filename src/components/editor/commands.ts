/**
 * Comandos de edição no estilo IntelliJ que o CodeMirror não traz prontos:
 * duplicar linha/seleção (Ctrl+D), juntar linhas (Ctrl+Shift+J), alternar
 * caixa (Ctrl+Shift+U), expandir/encolher seleção (Ctrl+W / Ctrl+Shift+W),
 * nova linha abaixo/acima sem quebrar a atual, ir para linha:coluna e as
 * transformações de linhas do menu (ordenar, inverter, remover duplicadas).
 *
 * Todos operam em múltiplos cursores (um resultado por range da seleção),
 * como os equivalentes do IntelliJ.
 */

import { insertNewlineAndIndent } from "@codemirror/commands";
import { indentRange, syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type SelectionRange } from "@codemirror/state";
import { EditorView, type Command } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** Ctrl+D — duplica a linha do cursor (ou o trecho selecionado, logo após). */
export const duplicateLineOrSelection: Command = (view) => {
  const { state } = view;
  const spec = state.changeByRange((range) => {
    if (range.empty) {
      const line = state.doc.lineAt(range.head);
      const col = range.head - line.from;
      return {
        changes: { from: line.to, insert: state.lineBreak + line.text },
        range: EditorSelection.cursor(line.to + state.lineBreak.length + col),
      };
    }
    const text = state.sliceDoc(range.from, range.to);
    return {
      changes: { from: range.to, insert: text },
      range: EditorSelection.range(range.to, range.to + text.length),
    };
  });
  view.dispatch({ ...spec, scrollIntoView: true, userEvent: "input.duplicate" });
  return true;
};

/** Ctrl+Shift+J — junta a linha seguinte na atual (ou todas as da seleção),
 *  aparando a indentação e deixando um espaço, como no IntelliJ. */
export const joinLines: Command = (view) => {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from);
    let last = state.doc.lineAt(range.to);
    if (last.number === first.number) {
      if (first.number === state.doc.lines) continue;
      last = state.doc.line(first.number + 1);
    }
    for (let n = first.number; n < last.number; n++) {
      const line = state.doc.line(n);
      const next = state.doc.line(n + 1);
      const trailing = /[ \t]*$/.exec(line.text)![0].length;
      const leading = /^[ \t]*/.exec(next.text)![0].length;
      const space = line.text.trim() && next.text.trim() ? " " : "";
      changes.push({ from: line.to - trailing, to: next.from + leading, insert: space });
    }
  }
  // Cursores em linhas vizinhas podem gerar trechos sobrepostos; descarta os repetidos.
  changes.sort((a, b) => a.from - b.from);
  const clean: typeof changes = [];
  let end = -1;
  for (const c of changes) {
    if (c.from >= end) {
      clean.push(c);
      end = c.to;
    }
  }
  if (!clean.length) return false;
  view.dispatch({ changes: clean, scrollIntoView: true, userEvent: "delete.join" });
  return true;
};

/** Ctrl+Shift+U — alterna a caixa da seleção (ou da palavra sob o cursor):
 *  tendo alguma minúscula vira MAIÚSCULA; senão, minúscula. */
export const toggleCase: Command = (view) => {
  const { state } = view;
  const spec = state.changeByRange((range) => {
    let { from, to } = range;
    if (range.empty) {
      const word = state.wordAt(range.head);
      if (!word) return { range };
      ({ from, to } = word);
    }
    const text = state.sliceDoc(from, to);
    const out = /\p{Ll}/u.test(text) ? text.toLocaleUpperCase() : text.toLocaleLowerCase();
    if (out === text) return { range };
    return { changes: { from, to, insert: out }, range: EditorSelection.range(from, from + out.length) };
  });
  view.dispatch({ ...spec, userEvent: "input.case" });
  return true;
};

// ---------------------------------------------------------------------------
// Transformações de linhas (menu "Linhas" da barra do editor)
// ---------------------------------------------------------------------------

/** Aplica `fn` às linhas de cada seleção (ou do arquivo todo, sem seleção). */
function transformLines(view: EditorView, fn: (lines: string[]) => string[]): boolean {
  const { state } = view;
  const allEmpty = state.selection.ranges.every((r) => r.empty);
  const regions = allEmpty
    ? [{ from: 0, to: state.doc.length }]
    : state.selection.ranges
        .filter((r) => !r.empty)
        .map((r) => {
          const first = state.doc.lineAt(r.from);
          let last = state.doc.lineAt(r.to);
          // Seleção que termina no comecinho de uma linha não conta essa linha.
          if (last.from === r.to && last.number > first.number) last = state.doc.line(last.number - 1);
          return { from: first.from, to: last.to };
        });

  const changes: { from: number; to: number; insert: string }[] = [];
  for (const reg of regions) {
    const text = state.sliceDoc(reg.from, reg.to);
    const out = fn(text.split("\n")).join("\n");
    if (out !== text) changes.push({ ...reg, insert: out });
  }
  if (!changes.length) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent: "input.lines" });
  return true;
}

export const sortLines: Command = (view) => transformLines(view, (ls) => [...ls].sort());
export const reverseLines: Command = (view) => transformLines(view, (ls) => [...ls].reverse());
export const dedupeLines: Command = (view) =>
  transformLines(view, (ls) => {
    const seen = new Set<string>();
    return ls.filter((l) => !seen.has(l) && (seen.add(l), true));
  });

/** Ctrl+Alt+I — reindenta a seleção (ou o arquivo todo, sem seleção) pelas
 *  regras de indentação da linguagem. Só ajusta o recuo das linhas — quem
 *  reflui o código de verdade é o Reformatar (Ctrl+Alt+L). */
export const reindentSelectionOrDoc: Command = (view) => {
  const { state } = view;
  const sel = state.selection.ranges.filter((r) => !r.empty);
  const from = sel.length ? Math.min(...sel.map((r) => r.from)) : 0;
  const to = sel.length ? Math.max(...sel.map((r) => r.to)) : state.doc.length;
  const changes = indentRange(state, from, to);
  if (changes.empty) return true;
  view.dispatch({ changes, userEvent: "indent", scrollIntoView: true });
  return true;
};

// ---------------------------------------------------------------------------
// Expandir/encolher seleção (Ctrl+W / Ctrl+Shift+W)
// ---------------------------------------------------------------------------

interface GrowEntry {
  before: EditorSelection;
  after: EditorSelection;
}
/** Pilha de expansões por editor — o encolher desfaz o último expandir. */
const growStacks = new WeakMap<EditorView, GrowEntry[]>();

function grow(state: EditorState, range: SelectionRange): SelectionRange {
  // 1) cursor → palavra sob ele
  if (range.empty) {
    const word = state.wordAt(range.head);
    if (word) return word;
  }
  // 2) menor nó sintático estritamente maior que a seleção
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.from, 1);
  while (
    node &&
    !(node.from <= range.from && node.to >= range.to && (node.from < range.from || node.to > range.to))
  ) {
    node = node.parent;
  }
  const wholeDoc = node && node.from === 0 && node.to === state.doc.length;
  if (node && !wholeDoc) return EditorSelection.range(node.from, node.to);
  // 3) linha(s) inteira(s), antes de saltar para o documento
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);
  if (range.from > first.from || range.to < last.to) return EditorSelection.range(first.from, last.to);
  // 4) documento inteiro
  return EditorSelection.range(0, state.doc.length);
}

export const expandSelection: Command = (view) => {
  const sel = view.state.selection;
  const next = EditorSelection.create(
    sel.ranges.map((r) => grow(view.state, r)),
    sel.mainIndex,
  );
  if (next.eq(sel)) return true;
  const stack = growStacks.get(view) ?? [];
  stack.push({ before: sel, after: next });
  growStacks.set(view, stack);
  view.dispatch({ selection: next, scrollIntoView: true, userEvent: "select.expand" });
  return true;
};

export const shrinkSelection: Command = (view) => {
  const stack = growStacks.get(view) ?? [];
  const sel = view.state.selection;
  // O histórico só vale enquanto a seleção atual for o resultado do último
  // expandir (editar ou clicar em outro lugar invalida a pilha).
  while (stack.length && !stack[stack.length - 1].after.eq(sel)) stack.pop();
  const top = stack.pop();
  if (!top || top.before.main.to > view.state.doc.length) return true;
  view.dispatch({ selection: top.before, scrollIntoView: true, userEvent: "select.shrink" });
  return true;
};

/** Alt+Shift+J — descarta o último cursor/seleção adicionado (multi-cursor). */
export const removeLastSelection: Command = (view) => {
  const sel = view.state.selection;
  if (sel.ranges.length < 2) return false;
  const ranges = sel.ranges.filter((_, i) => i !== sel.mainIndex);
  view.dispatch({
    selection: EditorSelection.create(ranges, Math.min(sel.mainIndex, ranges.length - 1)),
    userEvent: "select.remove",
  });
  return true;
};

// ---------------------------------------------------------------------------
// Nova linha sem quebrar a atual
// ---------------------------------------------------------------------------

/** Shift+Enter — abre uma linha ABAIXO e vai para ela (indentada). */
export const insertLineBelow: Command = (view) => {
  const { state } = view;
  view.dispatch({
    selection: EditorSelection.create(
      state.selection.ranges.map((r) => EditorSelection.cursor(state.doc.lineAt(r.head).to)),
      state.selection.mainIndex,
    ),
  });
  return insertNewlineAndIndent(view);
};

/** Ctrl+Alt+Enter — abre uma linha ACIMA e vai para ela (mesma indentação). */
export const insertLineAbove: Command = (view) => {
  const { state } = view;
  const spec = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    const ws = /^[ \t]*/.exec(line.text)![0];
    return {
      changes: { from: line.from, insert: ws + state.lineBreak },
      range: EditorSelection.cursor(line.from + ws.length),
    };
  });
  view.dispatch({ ...spec, scrollIntoView: true, userEvent: "input" });
  return true;
};

// ---------------------------------------------------------------------------
// Ir para linha:coluna (Ctrl+G)
// ---------------------------------------------------------------------------

/** Aceita "12", "12:34", ":34" (linha atual) — como o Go to Line do IntelliJ. */
export function gotoLineCol(view: EditorView, input: string): boolean {
  const m = /^\s*(\d+)?\s*(?:[:,.]\s*(\d+))?\s*$/.exec(input);
  if (!m || (!m[1] && !m[2])) return false;
  const { doc } = view.state;
  const lineNo = m[1]
    ? Math.max(1, Math.min(doc.lines, Number(m[1])))
    : doc.lineAt(view.state.selection.main.head).number;
  const line = doc.line(lineNo);
  const col = m[2] ? Math.min(line.length, Math.max(1, Number(m[2])) - 1) : 0;
  const pos = line.from + col;
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
    userEvent: "select.goto",
  });
  view.focus();
  return true;
}
