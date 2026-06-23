import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Database,
  Download,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  TreePine,
} from "lucide-react";

import { Tooltip } from "@/components/ui/Tooltip";
import { Wordmark } from "@/components/ui/Logo";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/store/config";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";
import type { WorkingCopy } from "@/lib/types";

function WcRow({ wc, active, onClick }: { wc: WorkingCopy; active: boolean; onClick: () => void }) {
  const isTrunk = wc.kind === "trunk";
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-panel-3" : "hover:bg-panel-2",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-brand" />
      )}
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md",
          isTrunk ? "bg-trunk/12 text-trunk" : "bg-branch/12 text-branch",
        )}
      >
        {isTrunk ? <TreePine className="size-4" /> : <GitBranch className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">{wc.name}</span>
        </div>
        <div className="truncate text-[11px] text-faint">
          {isTrunk ? "linha principal" : wc.branchLabel}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {wc.hasConflicts && <AlertTriangle className="size-3.5 text-conflict" />}
        {wc.modifiedCount > 0 ? (
          <span className="rounded-full bg-mod/15 px-1.5 py-0.5 text-[10px] font-semibold text-mod">
            {wc.modifiedCount}
          </span>
        ) : (
          <span className="size-1.5 rounded-full bg-success/70" title="sem alterações" />
        )}
      </div>
    </button>
  );
}

export function Sidebar() {
  const { workingCopies, baseDir, loading, setBaseDir, refresh, select } = useWorkspaceStore();
  const selected = useSelectedWc();
  const { view, setView, setCheckout } = useUiStore();
  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.save);

  const folderName = baseDir.split("/").filter(Boolean).pop() ?? baseDir;
  const isLight = document.documentElement.classList.contains("theme-light");

  const chooseFolder = async () => {
    const dir = await open({ directory: true, defaultPath: baseDir || undefined });
    if (typeof dir === "string") {
      setBaseDir(dir);
      await saveConfig({ baseDir: dir });
      refresh();
    }
  };

  const toggleTheme = () => {
    const next = isLight ? "dark" : "light";
    saveConfig({ theme: next });
  };

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="px-4 pb-3 pt-4" data-tauri-drag-region>
        <Wordmark size={36} />
      </div>

      <div className="space-y-0.5 px-3">
        <button
          onClick={() => setView("overview")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
            view === "overview" ? "bg-brand/12 text-brand" : "text-muted hover:bg-panel-2 hover:text-ink",
          )}
        >
          <LayoutDashboard className="size-4" />
          Visão geral
        </button>
        <button
          onClick={() => setView("repos")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
            view === "repos" ? "bg-brand/12 text-brand" : "text-muted hover:bg-panel-2 hover:text-ink",
          )}
        >
          <Database className="size-4" />
          Repositórios
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between px-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          Projetos
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip label="Trocar pasta de trabalho">
            <button
              onClick={chooseFolder}
              className="flex size-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-panel-2 hover:text-ink"
            >
              <FolderOpen className="size-3.5" />
            </button>
          </Tooltip>
          <Tooltip label="Recarregar working copies">
            <button
              onClick={() => refresh()}
              className="flex size-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-panel-2 hover:text-ink"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="px-4 pb-2">
        <button
          onClick={chooseFolder}
          className="truncate text-[11px] text-faint hover:text-muted"
          title={baseDir}
        >
          {folderName || "escolher pasta…"}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        {workingCopies.length === 0 && !loading && (
          <div className="px-2 py-8 text-center text-[12px] leading-relaxed text-faint">
            Nenhuma working copy nesta pasta.
            <br />
            Baixe um projeto ou troque a pasta.
          </div>
        )}
        {workingCopies.map((wc) => (
          <WcRow
            key={wc.path}
            wc={wc}
            active={
              selected?.path === wc.path &&
              view !== "overview" &&
              view !== "settings" &&
              view !== "repos"
            }
            onClick={() => {
              select(wc.path);
              if (view === "overview" || view === "settings" || view === "repos") setView("changes");
            }}
          />
        ))}
      </div>

      <div className="border-t border-line p-3">
        <button
          onClick={() => setCheckout(true)}
          className="mb-1 flex w-full items-center gap-2.5 rounded-lg bg-panel-2 px-2.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-panel-3"
        >
          <Download className="size-4 text-brand" />
          Baixar projeto
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView("settings")}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
              view === "settings" ? "bg-panel-3 text-ink" : "text-muted hover:bg-panel-2 hover:text-ink",
            )}
          >
            <Settings className="size-4" />
            Configurações
          </button>
          <Tooltip label={isLight ? "Tema escuro" : "Tema claro"}>
            <button
              onClick={toggleTheme}
              className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-2 hover:text-ink"
            >
              {isLight ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </button>
          </Tooltip>
        </div>
        {config && (
          <div className="mt-2 px-1 text-[10px] text-faint" title={config.host}>
            {config.host}
          </div>
        )}
      </div>
    </aside>
  );
}
