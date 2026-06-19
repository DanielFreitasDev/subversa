import {
  ArrowDownToLine,
  FileDiff,
  GitMerge,
  GitBranch,
  History,
  Search,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { BranchBadge } from "@/components/ui/Badge";
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

const TITLES: Partial<Record<ViewId, { title: string; sub: string }>> = {
  overview: { title: "Visão geral", sub: "Todas as working copies detectadas" },
  settings: { title: "Configurações", sub: "Servidor, projetos e preferências" },
};

export function TopBar() {
  const { view, setView, togglePalette } = useUiStore();
  const wc = useSelectedWc();
  const { update } = useActions();

  const isContextual = view !== "overview" && view !== "settings";
  const title = TITLES[view];

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel/60 px-4"
      data-tauri-drag-region
    >
      {/* Lado esquerdo: contexto */}
      <div className="flex min-w-0 items-center gap-3">
        {isContextual && wc ? (
          <>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[15px] font-semibold text-ink">{wc.name}</span>
                <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                  r{wc.revision}
                </span>
              </div>
            </div>
            <BranchBadge kind={wc.kind} label={wc.branchLabel} className="max-w-[260px]" />
          </>
        ) : title ? (
          <div>
            <div className="text-[15px] font-semibold text-ink">{title.title}</div>
            <div className="text-[11px] text-faint">{title.sub}</div>
          </div>
        ) : null}
      </div>

      <div className="flex-1" data-tauri-drag-region />

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
            <Button
              variant="primary"
              size="sm"
              onClick={() => setView("changes")}
              className={cn(wc.modifiedCount === 0 && "opacity-90")}
            >
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
          className="flex h-8 items-center gap-2 rounded-lg border border-line bg-panel-2 pl-2.5 pr-2 text-[13px] text-muted transition-colors hover:text-ink"
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">Comandos</span>
          <Kbd className="ml-1">⌘K</Kbd>
        </button>
      </div>
    </header>
  );
}
