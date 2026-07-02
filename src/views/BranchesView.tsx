import { useCallback, useEffect, useRef, useState } from "react";
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
import { ContextMenu, useContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { Empty } from "@/components/ui/Empty";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { Loading } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { useActions } from "@/hooks/useActions";
import { HELP } from "@/lib/help";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { extractRevision, reportOutput, tryRun } from "@/lib/op";
import type { ListEntry, WorkingCopy } from "@/lib/types";
import { cn, decodeUrl, decodeUrlSafe, formatRelative } from "@/lib/utils";
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
  const [busy, setBusy] = useState(false);
  const { switchTo } = useActions();
  const setCreateBranch = useUiStore((s) => s.setCreateBranch);
  const refresh = useWorkspaceStore((s) => s.refresh);
  const ctx = useContextMenu();

  const reqRef = useRef(0);
  const load = useCallback(
    async (target: string) => {
      const req = ++reqRef.current;
      setLoading(true);
      setError(null);
      try {
        const list = await api.listDir(target);
        if (req !== reqRef.current) return; // navegação mais recente assumiu
        setEntries(list);
      } catch (e) {
        if (req !== reqRef.current) return;
        // Repositório sem layout padrão: se /branches não existe, cai para a raiz.
        if (target === `${repoRoot}/branches`) {
          setUrl(repoRoot);
          return;
        }
        setError(String(e));
        setEntries([]);
      } finally {
        if (req === reqRef.current) setLoading(false);
      }
    },
    [repoRoot],
  );

  useEffect(() => {
    load(url);
  }, [url, load]);

  const rel = decodeUrl(url.startsWith(repoRoot) ? url.slice(repoRoot.length) : url).replace(/^\//, "");
  const crumbs = rel ? rel.split("/") : [];

  const goTo = (idx: number) => {
    const path = crumbs.slice(0, idx + 1).join("/");
    setUrl(`${repoRoot}/${path}`);
  };

  // Uma operação de servidor por vez: sem isso, um duplo clique dispararia
  // switch/apagar duas vezes (a trava cobre inclusive o tempo do confirm).
  const guardado = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const deleteBranch = async (entry: ListEntry) => {
    const target = `${url}/${entry.name}`;
    // Compara as URLs cruas (mesmo encoding do backend), só normalizando a barra
    // final — decodeUrlSafe é para exibição e poderia divergir e esconder o aviso.
    const norm = (u: string) => u.replace(/\/+$/, "");
    const isCurrent = norm(target) === norm(wc.url);
    const ok = await confirm({
      title: "Apagar do servidor?",
      message:
        (isCurrent
          ? "⚠️ Esta é a linha onde a SUA working copy está apontando — apagá-la deixa a WC órfã (update/commit passarão a falhar).\n\n"
          : "") + `Isso remove permanentemente:\n\n${decodeUrlSafe(target)}`,
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

  // Mesmas ações dos ícones de hover, agora também via botão direito na pasta.
  const itemsFor = (entry: ListEntry): MenuItem[] => {
    if (entry.kind !== "dir") return [];
    const childUrl = `${url}/${entry.name}`;
    return [
      {
        id: "open",
        label: "Abrir",
        icon: <Folder className="size-3.5" />,
        onSelect: () => setUrl(childUrl),
      },
      {
        id: "switch",
        label: "Apontar minha WC para cá (switch)",
        icon: <ArrowRightLeft className="size-3.5" />,
        disabled: busy,
        onSelect: () =>
          guardado(() => switchTo(wc, childUrl, decodeUrlSafe(childUrl.slice(repoRoot.length)))),
      },
      {
        id: "delete",
        label: "Apagar do servidor",
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        separatorBefore: true,
        disabled: busy,
        onSelect: () => guardado(() => deleteBranch(entry)),
      },
    ];
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
          <HelpPopover content={HELP.branches} />
          {!wc.isMainline && mainlineUrl && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                guardado(async () => {
                  if (await switchTo(wc, mainlineUrl, "trunk")) refresh();
                })
              }
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
              {decodeUrlSafe(c)}
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
                onContextMenu={(ev) => ctx.open(ev, itemsFor(e))}
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
                        onClick={() =>
                          guardado(() => switchTo(wc, childUrl, decodeUrlSafe(childUrl.slice(repoRoot.length))))
                        }
                        disabled={busy}
                        className="flex size-7 items-center justify-center rounded text-faint hover:bg-panel-3 hover:text-brand disabled:opacity-50"
                      >
                        <ArrowRightLeft className="size-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip label="Apagar do servidor">
                      <button
                        onClick={() => guardado(() => deleteBranch(e))}
                        disabled={busy}
                        className="flex size-7 items-center justify-center rounded text-faint hover:bg-conflict/15 hover:text-conflict disabled:opacity-50"
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

      <ContextMenu menu={ctx.menu} onClose={ctx.close} />
    </div>
  );
}

export function BranchesView() {
  const wc = useSelectedWc();
  if (!wc) return <NeedWorkingCopy />;
  return <Browser key={wc.path} wc={wc} />;
}
