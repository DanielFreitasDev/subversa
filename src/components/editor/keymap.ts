/**
 * Keymap do editor embutido no estilo IntelliJ (o time vem de lá): Ctrl+D
 * duplica, Ctrl+Y apaga a linha (refazer é Ctrl+Shift+Z), Ctrl+W expande a
 * seleção, Alt+J adiciona a próxima ocorrência, Ctrl+G vai para linha etc.
 * Registrado com `Prec.high` para vencer os atalhos padrão do CodeMirror
 * (ex.: Mod-d de "próxima ocorrência" vira duplicar linha, como no IntelliJ).
 *
 * Ações que abrem UI (busca, ir para linha, ir para arquivo, salvar) chegam
 * por `EditorUiHandlers` — quem fornece é o `CodeEditorModal`.
 *
 * `EDITOR_SHORTCUTS` é o catálogo exibido no popover "Atalhos" — mantenha os
 * dois em sincronia ao mexer aqui.
 */

import { deleteLine, moveLineDown, moveLineUp, toggleBlockComment, toggleComment } from "@codemirror/commands";
import { foldAll, foldCode, unfoldAll, unfoldCode } from "@codemirror/language";
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

import {
  duplicateLineOrSelection,
  expandSelection,
  insertLineAbove,
  insertLineBelow,
  joinLines,
  removeLastSelection,
  shrinkSelection,
  toggleCase,
} from "./commands";

/** Ações do editor que abrem UI do modal (painéis/diálogos) ou salvam. */
export interface EditorUiHandlers {
  openSearch: (withReplace: boolean) => boolean;
  findNext: () => boolean;
  findPrevious: () => boolean;
  gotoLine: () => boolean;
  quickOpen: () => boolean;
  save: () => boolean;
  nextTab: () => boolean;
  prevTab: () => boolean;
}

/** Keymap IntelliJ completo (edição direta + ações de UI via `handlers`). */
export function editorKeymap(h: EditorUiHandlers): Extension {
  return Prec.high(
    keymap.of([
      // Busca e navegação
      { key: "Mod-f", run: () => h.openSearch(false), preventDefault: true },
      { key: "Mod-r", run: () => h.openSearch(true), preventDefault: true },
      { key: "F3", run: () => h.findNext(), preventDefault: true },
      { key: "Shift-F3", run: () => h.findPrevious(), preventDefault: true },
      { key: "Mod-g", run: () => h.gotoLine(), preventDefault: true },
      { key: "Mod-Shift-n", run: () => h.quickOpen(), preventDefault: true },
      { key: "Mod-s", run: () => h.save(), preventDefault: true },
      // Alt+←/→ trocam de aba (IntelliJ); sem isto o CodeMirror usaria as
      // setas com Alt para navegação sintática.
      { key: "Alt-ArrowRight", run: () => h.nextTab(), preventDefault: true },
      { key: "Alt-ArrowLeft", run: () => h.prevTab(), preventDefault: true },

      // Linhas
      { key: "Mod-d", run: duplicateLineOrSelection, preventDefault: true },
      { key: "Mod-y", run: deleteLine, preventDefault: true },
      { key: "Mod-Shift-j", run: joinLines, preventDefault: true },
      { key: "Alt-Shift-ArrowUp", run: moveLineUp, preventDefault: true },
      { key: "Alt-Shift-ArrowDown", run: moveLineDown, preventDefault: true },
      { key: "Shift-Enter", run: insertLineBelow, preventDefault: true },
      { key: "Mod-Alt-Enter", run: insertLineAbove, preventDefault: true },

      // Comentários (linha já vem do padrão; bloco no atalho do IntelliJ)
      { key: "Mod-/", run: toggleComment, preventDefault: true },
      { key: "Mod-Shift-/", run: toggleBlockComment, preventDefault: true },

      // Seleção e cursores
      { key: "Mod-w", run: expandSelection, preventDefault: true },
      { key: "Mod-Shift-w", run: shrinkSelection, preventDefault: true },
      { key: "Alt-j", run: selectNextOccurrence, preventDefault: true },
      { key: "Alt-Shift-j", run: removeLastSelection, preventDefault: true },
      { key: "Mod-Alt-Shift-j", run: selectSelectionMatches, preventDefault: true },
      { key: "Mod-Shift-u", run: toggleCase, preventDefault: true },

      // Dobras (Ctrl+- / Ctrl+= e com Shift para todas, como no IntelliJ)
      { key: "Mod--", run: foldCode, preventDefault: true },
      { key: "Mod-=", run: unfoldCode, preventDefault: true },
      { key: "Mod-Shift--", run: foldAll, preventDefault: true },
      { key: "Mod-Shift-=", run: unfoldAll, preventDefault: true },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Catálogo para o popover "Atalhos" (agrupado, em pt-BR)
// ---------------------------------------------------------------------------

export interface ShortcutGroup {
  group: string;
  items: { keys: string[]; label: string }[];
}

export const EDITOR_SHORTCUTS: ShortcutGroup[] = [
  {
    group: "Busca",
    items: [
      { keys: ["Ctrl", "F"], label: "Localizar" },
      { keys: ["Ctrl", "R"], label: "Localizar e substituir" },
      { keys: ["F3"], label: "Próxima ocorrência" },
      { keys: ["Shift", "F3"], label: "Ocorrência anterior" },
      { keys: ["Ctrl", "G"], label: "Ir para linha:coluna" },
      { keys: ["Ctrl", "Shift", "N"], label: "Ir para arquivo" },
    ],
  },
  {
    group: "Edição",
    items: [
      { keys: ["Ctrl", "Z"], label: "Desfazer" },
      { keys: ["Ctrl", "Shift", "Z"], label: "Refazer" },
      { keys: ["Ctrl", "D"], label: "Duplicar linha/seleção" },
      { keys: ["Ctrl", "Y"], label: "Apagar linha" },
      { keys: ["Ctrl", "Shift", "J"], label: "Juntar linhas" },
      { keys: ["Alt", "Shift", "↑/↓"], label: "Mover linha" },
      { keys: ["Ctrl", "/"], label: "Comentar linha" },
      { keys: ["Ctrl", "Shift", "/"], label: "Comentar bloco" },
      { keys: ["Ctrl", "Shift", "U"], label: "Maiúsculas/minúsculas" },
      { keys: ["Tab"], label: "Indentar (Shift desfaz)" },
      { keys: ["Shift", "Enter"], label: "Nova linha abaixo" },
      { keys: ["Ctrl", "Alt", "Enter"], label: "Nova linha acima" },
      { keys: ["Ctrl", "Espaço"], label: "Autocompletar" },
    ],
  },
  {
    group: "Seleção e cursores",
    items: [
      { keys: ["Ctrl", "W"], label: "Expandir seleção" },
      { keys: ["Ctrl", "Shift", "W"], label: "Encolher seleção" },
      { keys: ["Alt", "J"], label: "Selecionar próxima ocorrência" },
      { keys: ["Alt", "Shift", "J"], label: "Remover último cursor" },
      { keys: ["Ctrl", "Alt", "Shift", "J"], label: "Todas as ocorrências" },
      { keys: ["Alt", "Shift", "Clique"], label: "Adicionar cursor" },
      { keys: ["Alt", "Arrastar"], label: "Seleção retangular" },
      { keys: ["Esc"], label: "Voltar a um cursor só" },
    ],
  },
  {
    group: "Dobras de código",
    items: [
      { keys: ["Ctrl", "-"], label: "Dobrar bloco" },
      { keys: ["Ctrl", "="], label: "Expandir bloco" },
      { keys: ["Ctrl", "Shift", "-"], label: "Dobrar tudo" },
      { keys: ["Ctrl", "Shift", "="], label: "Expandir tudo" },
    ],
  },
  {
    group: "Abas e arquivo",
    items: [
      { keys: ["Ctrl", "S"], label: "Salvar arquivo" },
      { keys: ["Ctrl", "Shift", "S"], label: "Salvar todos" },
      { keys: ["Ctrl", "Tab"], label: "Alternar abas" },
      { keys: ["Alt", "→/←"], label: "Próxima/anterior aba" },
      { keys: ["Ctrl", "F4"], label: "Fechar aba" },
    ],
  },
];
