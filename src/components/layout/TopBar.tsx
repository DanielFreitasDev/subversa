import {
  ArrowDownToLine,
  FileDiff,
  GitMerge,
  GitBranch,
  History,
  Search,
  TreePine,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Kbd } from "@/components/ui/Kbd";
import { useActions } from "@/hooks/useActions";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { cn } from "@/lib/utils";
import { useUiStore, type ViewId } from "@/store/ui";

const TABS: { value: ViewId; label: string; icon: React.ReactNode }[] = [
  { value: "changes", label: "Alterações", icon: <FileDiff className="size-4" /> },
  { value: "history", label: "Histórico", icon: <History className="size-4" /> },
  { value: "branches", label: "Branches", icon: <GitBranch className="size-4" /> },
  { value: "merge", label: "Integração", icon: <GitMerge className="size-4" /> },
];

export function TopBar() {
  const { view, setView, togglePalette } = useUiStore();
  const wc = useSelectedWc();
  const { update } = useActions();

  const isContextual = view !== "overview" && view !== "settings" && view !== "repos";

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel/60 px-4"
      data-tauri-drag-region
    >
      {/* Lado esquerdo: contexto da working copy */}
      <div className="flex min-w-0 items-center gap-2.5">
        {isContextual && wc && (
          <>
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg",
                wc.kind === "trunk" ? "bg-trunk/12 text-trunk" : "bg-branch/12 text-branch",
              )}
            >
              {wc.kind === "trunk" ? (
                <TreePine className="size-4" />
              ) : (
                <GitBranch className="size-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[14px] font-semibold text-ink">{wc.name}</span>
                <span className="shrink-0 rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  r{wc.revision}
                </span>
              </div>
              <div className="truncate text-[11px] text-faint">
                {wc.kind === "trunk" ? "linha principal" : wc.branchLabel}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="min-w-3 flex-1" data-tauri-drag-region />

      {/* Abas contextuais */}
      {isContextual && wc && (
        <Segmented
          options={TABS}
          value={view as ViewId}
          onChange={(v) => setView(v)}
          className="no-drag"
        />
      )}

      {/* Ações */}
      <div className="flex items-center gap-2 no-drag">
        {isContextual && wc && (
          <>
            <Button variant="outline" size="sm" onClick={() => update(wc)}>
              <ArrowDownToLine className="size-4" />
              Atualizar
            </Button>
            <Button variant="primary" size="sm" onClick={() => setView("changes")}>
              <Upload className="size-4" />
              Commit
              {wc.modifiedCount > 0 && (
                <span className="ml-0.5 rounded-full bg-white/20 px-1.5 text-[11px]">
                  {wc.modifiedCount}
                </span>
              )}
            </Button>
            <div className="mx-0.5 h-6 w-px bg-line" />
          </>
        )}
        <button
          onClick={togglePalette}
          aria-label="Abrir paleta de comandos (Ctrl+K)"
          className="flex h-8 items-center gap-2 rounded-lg border border-line bg-panel-2 pl-2.5 pr-2 text-[13px] text-muted transition-colors hover:text-ink"
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">Comandos</span>
          <Kbd className="ml-1 gap-0.5">
            <span>⌘</span>
            <span>K</span>
          </Kbd>
        </button>
      </div>
    </header>
  );
}
