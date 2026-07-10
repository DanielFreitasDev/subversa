/**
 * Barra de ferramentas do editor embutido: desfazer/refazer, busca e
 * navegação, dobras, reformatar por linguagem, menu de operações de linhas e
 * divisão do editor. Tudo age sobre a view focada (`view`); os popups abrem
 * via callbacks do modal. Os atalhos correspondentes aparecem nos tooltips e
 * as mesmas ações existem no botão direito sobre o código (`menus.tsx`).
 */

import { redo, undo } from "@codemirror/commands";
import { foldAll, unfoldAll } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import {
  AlignLeft,
  Columns2,
  FileSearch,
  FoldVertical,
  Keyboard,
  ListOrdered,
  Redo2,
  Replace,
  Search,
  TextCursorInput,
  UnfoldVertical,
  Undo2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import { ContextMenu, useContextMenu } from "@/components/ui/ContextMenu";
import { lineOpsItems } from "./menus";

function ToolButton({
  label,
  disabled,
  active,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn(
          "flex size-7 items-center justify-center rounded-md transition-colors",
          active ? "bg-brand/20 text-brand" : "text-muted hover:bg-panel-3 hover:text-ink",
          "disabled:pointer-events-none disabled:opacity-35",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const Divider = () => <span className="mx-1 h-4 w-px bg-line" />;

export function EditorToolbar({
  view,
  canUndo,
  canRedo,
  split,
  canSplit,
  canFormat,
  onOpenSearch,
  onGotoLine,
  onQuickOpen,
  onFormat,
  onToggleSplit,
  onShortcuts,
}: {
  view: EditorView | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Editor dividido em dois grupos? */
  split: boolean;
  canSplit: boolean;
  /** A linguagem do arquivo ativo tem formatador? */
  canFormat: boolean;
  onOpenSearch: (replace: boolean) => void;
  onGotoLine: () => void;
  onQuickOpen: () => void;
  onFormat: () => void;
  onToggleSplit: () => void;
  onShortcuts: () => void;
}) {
  const ctx = useContextMenu();
  const run = (cmd: (v: EditorView) => boolean) => {
    if (!view) return;
    cmd(view);
    view.focus();
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line bg-panel-2 px-1.5">
      <ToolButton label="Desfazer (Ctrl+Z)" disabled={!canUndo} onClick={() => run(undo)}>
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton label="Refazer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => run(redo)}>
        <Redo2 className="size-4" />
      </ToolButton>

      <Divider />

      <ToolButton label="Localizar (Ctrl+F)" disabled={!view} onClick={() => onOpenSearch(false)}>
        <Search className="size-4" />
      </ToolButton>
      <ToolButton label="Substituir (Ctrl+R)" disabled={!view} onClick={() => onOpenSearch(true)}>
        <Replace className="size-4" />
      </ToolButton>
      <ToolButton label="Ir para linha:coluna (Ctrl+G)" disabled={!view} onClick={onGotoLine}>
        <TextCursorInput className="size-4" />
      </ToolButton>
      <ToolButton label="Ir para arquivo (Ctrl+Shift+N)" onClick={onQuickOpen}>
        <FileSearch className="size-4" />
      </ToolButton>

      <Divider />

      <ToolButton label="Dobrar tudo (Ctrl+Shift+-)" disabled={!view} onClick={() => run(foldAll)}>
        <FoldVertical className="size-4" />
      </ToolButton>
      <ToolButton label="Expandir tudo (Ctrl+Shift+=)" disabled={!view} onClick={() => run(unfoldAll)}>
        <UnfoldVertical className="size-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        label={
          canFormat
            ? "Reformatar código (Ctrl+Alt+L · Ctrl+Alt+Shift+L)"
            : "Reformatar código — sem formatador para esta linguagem"
        }
        disabled={!view || !canFormat}
        onClick={onFormat}
      >
        <AlignLeft className="size-4" />
      </ToolButton>

      <Tooltip label="Operações de linhas">
        <button
          type="button"
          aria-label="Operações de linhas"
          disabled={!view}
          onClick={(e) => ctx.open(e, lineOpsItems(run))}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted transition-colors hover:bg-panel-3 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
        >
          <ListOrdered className="size-4" />
          Linhas
        </button>
      </Tooltip>

      <div className="ml-auto flex items-center gap-0.5">
        <ToolButton
          label={split ? "Juntar grupos (desfazer divisão)" : "Dividir à direita"}
          active={split}
          disabled={!split && !canSplit}
          onClick={onToggleSplit}
        >
          <Columns2 className="size-4" />
        </ToolButton>
        <ToolButton label="Atalhos do editor" onClick={onShortcuts}>
          <Keyboard className="size-4" />
        </ToolButton>
      </div>

      <ContextMenu menu={ctx.menu} onClose={ctx.close} />
    </div>
  );
}
