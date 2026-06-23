import { useMemo, useRef, useState } from "react";
import { Columns2, FoldVertical, Rows3, UnfoldVertical, WrapText } from "lucide-react";

import { parseUnifiedDiff, type DiffFile } from "@/lib/diff";
import { cn } from "@/lib/utils";
import { Segmented } from "@/components/ui/Segmented";
import { useUiStore, type DiffMode } from "@/store/ui";

import { FileBlock, type ContentRef } from "./FileBlock";

export interface DiffViewerProps {
  /** Texto do diff unificado (saída de `svn diff`). */
  text: string;
  className?: string;
  /** Força um modo; por padrão usa a preferência compartilhada do store `ui`. */
  mode?: DiffMode;
  ignoreWs?: boolean;
  onToggleIgnoreWs?: (v: boolean) => void;
  /** Ferramenta externa (ex.: meld) — usada no aviso de arquivo grande. */
  externalTool?: string;
  onOpenExternal?: () => void;
  /** Resolve o conteúdo de referência de um arquivo p/ expandir contexto. */
  onExpandContext?: (file: DiffFile) => Promise<ContentRef | null>;
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
  ignoreWs,
  onToggleIgnoreWs,
  externalTool,
  onOpenExternal,
  onExpandContext,
}: DiffViewerProps) {
  const files = useMemo(() => parseUnifiedDiff(text), [text]);
  const storeMode = useUiStore((s) => s.diffMode);
  const setDiffMode = useUiStore((s) => s.setDiffMode);
  const mode = forcedMode ?? storeMode;

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
          onChange={setDiffMode}
          options={[
            { value: "unified", label: "Unificado", icon: <Rows3 className="size-3.5" /> },
            { value: "split", label: "Lado a lado", icon: <Columns2 className="size-3.5" /> },
          ]}
        />
        {onToggleIgnoreWs && (
          <button
            onClick={() => onToggleIgnoreWs(!ignoreWs)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
              ignoreWs
                ? "border-brand/40 bg-brand/10 text-brand"
                : "border-line text-muted hover:text-ink",
            )}
            title="Ignorar diferenças de espaço em branco"
          >
            <WrapText className="size-3.5" />
            Ignorar espaços
          </button>
        )}

        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="hidden text-faint sm:inline" title="Atalhos: n/p alterações · [ / ] arquivos">
            {files.length} arquivo(s)
          </span>
          {totals.add > 0 && <span className="font-medium text-add">+{totals.add}</span>}
          {totals.del > 0 && <span className="font-medium text-del">−{totals.del}</span>}
          {files.length > 1 && (
            <button
              onClick={toggleCollapseAll}
              className="flex size-7 items-center justify-center rounded-md border border-line text-faint transition-colors hover:text-ink"
              title={allCollapsed ? "Expandir todos" : "Recolher todos"}
            >
              {allCollapsed ? <UnfoldVertical className="size-3.5" /> : <FoldVertical className="size-3.5" />}
            </button>
          )}
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
            collapsed={collapsed.has(k)}
            onToggleCollapse={() => toggleOne(k)}
            externalTool={externalTool}
            onOpenExternal={onOpenExternal}
            onExpandContext={onExpandContext}
          />
        );
      })}
    </div>
  );
}
