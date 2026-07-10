/**
 * Itens de menu compartilhados do editor embutido: as operações de linhas
 * (menu "Linhas" da toolbar) e o menu de contexto do botão direito sobre o
 * código — área de transferência, busca, formatação e linhas, no espírito do
 * popup do editor do IntelliJ. Toolbar e botão direito usam a MESMA lista,
 * então uma ação nova aparece nos dois lugares de graça.
 */

import { selectAll, toggleComment } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  AlignLeft,
  ArrowDownAZ,
  ArrowUpDown,
  ClipboardPaste,
  Copy,
  CopyMinus,
  IndentIncrease,
  Replace,
  Scissors,
  Search,
  TextCursorInput,
} from "lucide-react";

import type { MenuItem } from "@/components/ui/ContextMenu";
import { toast } from "@/store/toast";
import {
  dedupeLines,
  duplicateLineOrSelection,
  joinLines,
  reindentSelectionOrDoc,
  reverseLines,
  sortLines,
  toggleCase,
} from "./commands";

/** Executa um comando CodeMirror e devolve o foco ao editor. */
export type RunCommand = (cmd: (v: EditorView) => boolean) => void;

/** Operações de linhas (menu "Linhas" da toolbar e fim do botão direito). */
export function lineOpsItems(run: RunCommand): MenuItem[] {
  return [
    { id: "dup", label: "Duplicar linha/seleção (Ctrl+D)", icon: <CopyMinus className="size-3.5" />, onSelect: () => run(duplicateLineOrSelection) },
    { id: "join", label: "Juntar linhas (Ctrl+Shift+J)", icon: <ArrowUpDown className="size-3.5" />, onSelect: () => run(joinLines) },
    { id: "comment", label: "Comentar/descomentar (Ctrl+/)", onSelect: () => run(toggleComment) },
    { id: "case", label: "Maiúsculas/minúsculas (Ctrl+Shift+U)", onSelect: () => run(toggleCase) },
    { id: "sort", label: "Ordenar linhas (A→Z)", icon: <ArrowDownAZ className="size-3.5" />, separatorBefore: true, onSelect: () => run(sortLines) },
    { id: "rev", label: "Inverter ordem das linhas", onSelect: () => run(reverseLines) },
    { id: "dedupe", label: "Remover linhas duplicadas", onSelect: () => run(dedupeLines) },
  ];
}

const selectionText = (view: EditorView) =>
  view.state.selection.ranges
    .filter((r) => !r.empty)
    .map((r) => view.state.sliceDoc(r.from, r.to))
    .join("\n");

/**
 * Menu de contexto (botão direito) sobre o código. A área de transferência
 * usa `navigator.clipboard`; se o WebView negar a leitura no Colar, cai num
 * aviso para usar Ctrl+V (os atalhos nativos sempre funcionam).
 */
export function editorContextItems(o: {
  view: EditorView;
  /** Existe formatador para a linguagem deste arquivo? */
  formatEnabled: boolean;
  onSearch: (replace: boolean) => void;
  onGotoLine: () => void;
  onFormat: () => void;
}): MenuItem[] {
  const { view } = o;
  const run: RunCommand = (cmd) => {
    cmd(view);
    view.focus();
  };
  const hasSel = view.state.selection.ranges.some((r) => !r.empty);

  const copy = async (): Promise<boolean> => {
    const text = selectionText(view);
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      toast.error("Não consegui copiar para a área de transferência");
      return false;
    }
  };

  return [
    {
      id: "cut",
      label: "Recortar",
      icon: <Scissors className="size-3.5" />,
      disabled: !hasSel,
      onSelect: async () => {
        if (await copy()) view.dispatch(view.state.replaceSelection(""));
        view.focus();
      },
    },
    { id: "copy", label: "Copiar", icon: <Copy className="size-3.5" />, disabled: !hasSel, onSelect: () => void copy() },
    {
      id: "paste",
      label: "Colar",
      icon: <ClipboardPaste className="size-3.5" />,
      onSelect: async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) view.dispatch(view.state.replaceSelection(text));
          view.focus();
        } catch {
          toast.info("Não consegui ler a área de transferência", "Cole com Ctrl+V");
        }
      },
    },
    { id: "select-all", label: "Selecionar tudo (Ctrl+A)", onSelect: () => run(selectAll) },

    { id: "find", label: "Localizar (Ctrl+F)", icon: <Search className="size-3.5" />, separatorBefore: true, onSelect: () => o.onSearch(false) },
    { id: "replace", label: "Substituir (Ctrl+R)", icon: <Replace className="size-3.5" />, onSelect: () => o.onSearch(true) },
    { id: "goto", label: "Ir para linha:coluna (Ctrl+G)", icon: <TextCursorInput className="size-3.5" />, onSelect: o.onGotoLine },

    {
      id: "format",
      label: "Reformatar arquivo (Ctrl+Alt+L)",
      icon: <AlignLeft className="size-3.5" />,
      separatorBefore: true,
      disabled: !o.formatEnabled,
      disabledReason: "Sem formatador para esta linguagem",
      onSelect: o.onFormat,
    },
    { id: "reindent", label: "Reindentar linhas (Ctrl+Alt+I)", icon: <IndentIncrease className="size-3.5" />, onSelect: () => run(reindentSelectionOrDoc) },

    ...lineOpsItems(run).map((it, i) => (i === 0 ? { ...it, separatorBefore: true } : it)),
  ];
}
