import { useMemo, useRef, useState } from "react";
import { Columns2, FoldVertical, Highlighter, Maximize2, Rows3, UnfoldVertical, WrapText } from "lucide-react";

import { parseUnifiedDiff, type DiffFile } from "@/lib/diff";
import type { HunkRef } from "@/lib/types";
import { HELP } from "@/lib/help";
import { cn } from "@/lib/utils";
import { Dropdown, type DropdownOption } from "@/components/ui/Dropdown";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import {
  useUiStore,
  type DiffKind,
  type DiffMode,
  type HighlightMode,
  type WsMode,
} from "@/store/ui";

import { FileBlock, type ContentRef } from "./FileBlock";

/** Itens do menu "Espaços em branco" (estilo IntelliJ, em pt-BR). */
const WS_OPTIONS: DropdownOption<WsMode>[] = [
  { value: "none", label: "Não ignorar" },
  { value: "trim", label: "Aparar espaços em branco" },
  { value: "ignore", label: "Ignorar espaços em branco" },
  { value: "ignoreEmpty", label: "Ignorar espaços e linhas vazias" },
  { value: "ignoreFormat", label: "Ignorar formatação" },
];

/** Itens do menu "Destaque" (estilo IntelliJ, em pt-BR). */
const HIGHLIGHT_OPTIONS: DropdownOption<HighlightMode>[] = [
  { value: "lines", label: "Destacar linhas" },
  { value: "words", label: "Destacar palavras" },
  { value: "split", label: "Destacar alterações divididas" },
  { value: "chars", label: "Destacar caracteres" },
  { value: "none", label: "Não destacar" },
];

export interface DiffViewerProps {
  /** Texto do diff unificado (saída de `svn diff`). */
  text: string;
  className?: string;
  /** Força um modo; por padrão usa a preferência compartilhada do store `ui`. */
  mode?: DiffMode;
  /** Ferramenta externa (ex.: meld) — usada no aviso de arquivo grande. */
  externalTool?: string;
  onOpenExternal?: () => void;
  /** Resolve o conteúdo de referência de um arquivo p/ expandir contexto. */
  onExpandContext?: (file: DiffFile) => Promise<ContentRef | null>;
  /**
   * Habilita reverter um trecho (change-block) — a setinha ">>" estilo IntelliJ.
   * Recebe o caminho do arquivo e a referência do trecho (o backend remonta o
   * patch). Só faz sentido para alterações locais (aba Alterações); omitir nos
   * diffs históricos.
   */
  onRevertHunk?: (target: string, hunk: HunkRef) => void;
  /** Mostra o botão de abrir em janela ampliada (off na cópia já ampliada). */
  expandable?: boolean;
  /** Título/subtítulo da janela ampliada (padrão: "Diferenças" + caminho). */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
}

/** Acha o ancestral rolável mais próximo (a área de scroll que contém o diff). */
function scrollParent(el: HTMLElement): HTMLElement {
  let p: HTMLElement | null = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.body;
}

function flash(el: HTMLElement) {
  el.animate?.(
    [
      { boxShadow: "inset 0 0 0 9999px rgba(74,168,255,0.16)" },
      { boxShadow: "inset 0 0 0 9999px rgba(74,168,255,0)" },
    ],
    { duration: 680, easing: "ease-out" },
  );
}

export function DiffViewer({
  text,
  className,
  mode: forcedMode,
  externalTool,
  onOpenExternal,
  onExpandContext,
  onRevertHunk,
  expandable = true,
  title,
  subtitle,
}: DiffViewerProps) {
  const files = useMemo(() => parseUnifiedDiff(text), [text]);
  const [expanded, setExpanded] = useState(false);
  // Modo padrão pela natureza do diff: novo → "Unificado", alterado → "Lado a
  // lado". Um diff com vários arquivos só conta como novo se todos forem novos.
  const kind: DiffKind = files.length > 0 && files.every((f) => f.added) ? "added" : "modified";
  const storeMode = useUiStore((s) => (kind === "added" ? s.diffModeAdded : s.diffModeModified));
  const setDiffMode = useUiStore((s) => s.setDiffMode);
  const mode = forcedMode ?? storeMode;
  // Espaços/realce: preferências globais (estilo IntelliJ), aplicadas no frontend.
  const wsMode = useUiStore((s) => s.wsMode);
  const highlightMode = useUiStore((s) => s.highlightMode);
  const setWsMode = useUiStore((s) => s.setWsMode);
  const setHighlightMode = useUiStore((s) => s.setHighlightMode);

  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const totals = useMemo(
    () =>
      files.reduce(
        (acc, f) => ({ add: acc.add + f.additions, del: acc.del + f.deletions }),
        { add: 0, del: 0 },
      ),
    [files],
  );

  if (!text.trim()) {
    return <div className="px-3 py-6 text-center text-sm text-faint">Sem diferenças.</div>;
  }

  // Chave por índice+path (igual à key do bloco): dois arquivos de mesmo path no
  // mesmo diff (fallback "(alterações)") não colapsam juntos.
  const keyOf = (path: string, i: number) => `${i}-${path}`;
  const allCollapsed = files.length > 0 && files.every((f, i) => collapsed.has(keyOf(f.path, i)));
  const toggleCollapseAll = () =>
    setCollapsed(allCollapsed ? new Set() : new Set(files.map((f, i) => keyOf(f.path, i))));
  const toggleOne = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const go = (selector: string, dir: 1 | -1) => {
    const root = containerRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (!els.length) return;
    const refTop = scrollParent(root).getBoundingClientRect().top + 8;
    let target: HTMLElement | undefined;
    if (dir === 1) {
      target = els.find((el) => el.getBoundingClientRect().top > refTop + 1) ?? els[0];
    } else {
      const above = els.filter((el) => el.getBoundingClientRect().top < refTop - 1);
      target = above[above.length - 1] ?? els[els.length - 1];
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    flash(target);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case "n":
      case "j":
        e.preventDefault();
        go("[data-change]", 1);
        break;
      case "p":
      case "k":
        e.preventDefault();
        go("[data-change]", -1);
        break;
      case "]":
        e.preventDefault();
        go("[data-file-header]", 1);
        break;
      case "[":
        e.preventDefault();
        go("[data-file-header]", -1);
        break;
    }
  };

  return (
    <>
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn("group space-y-3 outline-none", className)}
    >
      {/* Barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<DiffMode>
          size="sm"
          value={mode}
          onChange={(m) => setDiffMode(kind, m)}
          options={[
            { value: "unified", label: "Unificado", icon: <Rows3 className="size-3.5" /> },
            { value: "split", label: "Lado a lado", icon: <Columns2 className="size-3.5" /> },
          ]}
        />
        <Dropdown<WsMode>
          value={wsMode}
          options={WS_OPTIONS}
          onChange={setWsMode}
          icon={<WrapText className="size-3.5 shrink-0" />}
          title="Espaços em branco"
          ariaLabel="Tratamento de espaços em branco"
        />
        <Dropdown<HighlightMode>
          value={highlightMode}
          options={HIGHLIGHT_OPTIONS}
          onChange={setHighlightMode}
          icon={<Highlighter className="size-3.5 shrink-0" />}
          title="Destaque das alterações"
          ariaLabel="Destaque das alterações"
        />

        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="hidden text-faint sm:inline" title="Atalhos: n/p alterações · [ / ] arquivos">
            {files.length} arquivo(s)
          </span>
          {totals.add > 0 && <span className="font-medium text-add">+{totals.add}</span>}
          {totals.del > 0 && <span className="font-medium text-del">−{totals.del}</span>}
          {files.length > 1 && (
            <button
              onClick={toggleCollapseAll}
              className="flex size-7 items-center justify-center rounded-md border border-line text-faint transition-colors hover:bg-panel-2 hover:text-ink"
              title={allCollapsed ? "Expandir todos" : "Recolher todos"}
            >
              {allCollapsed ? <UnfoldVertical className="size-3.5" /> : <FoldVertical className="size-3.5" />}
            </button>
          )}
          {expandable && (
            <button
              onClick={() => setExpanded(true)}
              className="flex size-7 items-center justify-center rounded-md border border-line text-faint transition-colors hover:bg-panel-2 hover:text-ink"
              title="Abrir em janela ampliada"
            >
              <Maximize2 className="size-3.5" />
            </button>
          )}
          <HelpPopover content={HELP.diff} />
        </div>
      </div>

      {files.map((file, i) => {
        const k = keyOf(file.path, i);
        return (
          <FileBlock
            key={k}
            file={file}
            index={i}
            mode={mode}
            wsMode={wsMode}
            highlightMode={highlightMode}
            collapsed={collapsed.has(k)}
            onToggleCollapse={() => toggleOne(k)}
            externalTool={externalTool}
            onOpenExternal={onOpenExternal}
            onExpandContext={onExpandContext}
            // Reverter trecho só vale sobre o diff exato: com um modo de espaços
            // ativo, o que se vê (linhas colapsadas) não casa com o patch real.
            onRevertHunk={wsMode === "none" ? onRevertHunk : undefined}
          />
        );
      })}
    </div>

      {expandable && (
        <Modal
          open={expanded}
          onClose={() => setExpanded(false)}
          className="max-w-[94vw]"
          icon={<Columns2 className="size-5" />}
          title={title ?? "Diferenças"}
          description={subtitle ?? (files.length === 1 ? files[0].path : `${files.length} arquivos`)}
        >
          <div className="h-[78vh] overflow-auto">
            <DiffViewer
              text={text}
              mode={forcedMode}
              externalTool={externalTool}
              onOpenExternal={onOpenExternal}
              onExpandContext={onExpandContext}
              onRevertHunk={onRevertHunk}
              expandable={false}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
