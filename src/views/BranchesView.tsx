import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightLeft,
  ChevronRight,
  File as FileIcon,
  Folder,
  GitBranch,
  Home,
  Plus,
  RefreshCw,
  ServerCrash,
  Trash2,
  TreePine,
} from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Loading } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { useActions } from "@/hooks/useActions";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { extractRevision, reportOutput, tryRun } from "@/lib/op";
import type { ListEntry, WorkingCopy } from "@/lib/types";
import { cn, decodeUrl, formatRelative } from "@/lib/utils";
import { confirm } from "@/store/confirm";
import { useConfigStore } from "@/store/config";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";
import { NeedWorkingCopy } from "./_shared";

function Browser({ wc }: { wc: WorkingCopy }) {
  const repoRoot = wc.repoRoot;
  const projects = useConfigStore((s) => s.config?.projects ?? []);
  const mainlineUrl = wc.projectKey
    ? projects.find((p) => p.key === wc.projectKey)?.url ?? null
    : null;
  const [url, setUrl] = useState(`${repoRoot}/branches`);
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { switchTo } = useActions();
  const setCreateBranch = useUiStore((s) => s.setCreateBranch);
  const refresh = useWorkspaceStore((s) => s.refresh);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listDir(target);
      setEntries(list);
    } catch (e) {
      setError(String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(url);
  }, [url, load]);

  const rel = decodeUrl(url.startsWith(repoRoot) ? url.slice(repoRoot.length) : url).replace(/^\//, "");
  const crumbs = rel ? rel.split("/") : [];

  const goTo = (idx: number) => {
    const path = crumbs.slice(0, idx + 1).join("/");
    setUrl(`${repoRoot}/${path}`);
  };

  const deleteBranch = async (entry: ListEntry) => {
    const target = `${url}/${entry.name}`;
    const ok = await confirm({
      title: "Apagar do servidor?",
      message: `Isso remove permanentemente:\n\n${decodeUrl(target)}`,
      danger: true,
      confirmLabel: "Apagar",
      requireText: entry.name,
    });
    if (!ok) return;
    const out = await tryRun(
      () => api.deleteRemote(target, `removendo ${entry.name}`),
      "Falha ao apagar",
    );
    if (out && reportOutput(out, "Apagado", extractRevision(out.stdout) ? `r${extractRevision(out.stdout)}` : undefined)) {
      load(url);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho com contexto + ações */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md",
              wc.kind === "trunk" ? "bg-trunk/12 text-trunk" : "bg-branch/12 text-branch",
            )}
          >
            {wc.kind === "trunk" ? <TreePine className="size-4" /> : <GitBranch className="size-4" />}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-ink">{wc.name}</div>
            <div className="truncate text-[11px] text-faint">
              está em: {wc.kind === "trunk" ? "trunk" : wc.branchLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!wc.isMainline && mainlineUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (await switchTo(wc, mainlineUrl, "trunk")) refresh();
              }}
            >
              <TreePine className="size-3.5" />
              Voltar ao trunk
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => setCreateBranch(true)}>
            <Plus className="size-4" />
            Criar branch
          </Button>
        </div>
      </div>

      {/* Breadcrumb + atalhos */}
      <div className="flex items-center gap-1 border-b border-line px-5 py-2 text-[12px]">
        <button
          onClick={() => setUrl(repoRoot)}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-faint hover:bg-panel-2 hover:text-ink"
        >
          <Home className="size-3.5" />
        </button>
        {crumbs.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <ChevronRight className="size-3 text-faint" />
            <button
              onClick={() => goTo(i)}
              className="max-w-[180px] truncate rounded px-1.5 py-1 text-muted hover:bg-panel-2 hover:text-ink"
            >
              {c}
            </button>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {["trunk", "branches", "tags"].map((q) => (
            <button
              key={q}
              onClick={() => setUrl(`${repoRoot}/${q}`)}
              className="rounded px-2 py-1 text-[11px] text-faint hover:bg-panel-2 hover:text-ink"
            >
              {q}
            </button>
          ))}
          <Button variant="ghost" size="icon" onClick={() => load(url)}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Listagem */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <Loading label="Listando…" />
        ) : error ? (
          <Empty
            icon={<ServerCrash className="size-7" />}
            title="Não consegui acessar o repositório"
            description={error}
            action={
              <Button variant="outline" onClick={() => load(url)}>
                Tentar de novo
              </Button>
            }
          />
        ) : entries.length === 0 ? (
          <Empty icon={<Folder className="size-7" />} title="Pasta vazia" />
        ) : (
          entries.map((e) => {
            const isDir = e.kind === "dir";
            const childUrl = `${url}/${e.name}`;
            return (
              <div
                key={e.name}
                className="group flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-panel-2"
              >
                <button
                  onClick={() => isDir && setUrl(childUrl)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  disabled={!isDir}
                >
                  {isDir ? (
                    <Folder className="size-4 shrink-0 text-info" />
                  ) : (
                    <FileIcon className="size-4 shrink-0 text-faint" />
                  )}
                  <span className="truncate text-[13px] text-ink">{e.name}</span>
                  {e.revision && (
                    <span className="shrink-0 font-mono text-[10px] text-faint">r{e.revision}</span>
                  )}
                  {e.author && (
                    <span className="hidden shrink-0 text-[11px] text-faint md:inline">
                      {e.author} · {formatRelative(e.date)}
                    </span>
                  )}
                </button>

                {isDir && (
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Tooltip label="Apontar minha WC para cá (switch)">
                      <button
                        onClick={() => switchTo(wc, childUrl, decodeUrl(childUrl.slice(repoRoot.length)))}
                        className="flex size-7 items-center justify-center rounded text-faint hover:bg-panel-3 hover:text-brand"
                      >
                        <ArrowRightLeft className="size-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip label="Apagar do servidor">
                      <button
                        onClick={() => deleteBranch(e)}
                        className="flex size-7 items-center justify-center rounded text-faint hover:bg-conflict/15 hover:text-conflict"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function BranchesView() {
  const wc = useSelectedWc();
  if (!wc) return <NeedWorkingCopy />;
  return <Browser key={wc.path} wc={wc} />;
}
