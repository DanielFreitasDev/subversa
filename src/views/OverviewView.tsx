import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  CloudDownload,
  Download,
  FolderGit2,
  GitBranch,
  Loader2,
  RefreshCw,
  TreePine,
} from "lucide-react";

import * as api from "@/lib/api";
import { BranchBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Loading } from "@/components/ui/Spinner";
import { useActions } from "@/hooks/useActions";
import type { WorkingCopy } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";
import { useConfigStore } from "@/store/config";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";

interface ServerInfo {
  incoming: number;
  loading: boolean;
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className={cn("text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      <div className="text-[11px] text-faint">{label}</div>
    </div>
  );
}

function WcCard({
  wc,
  server,
  index,
  onOpen,
  onUpdate,
}: {
  wc: WorkingCopy;
  server?: ServerInfo;
  index: number;
  onOpen: () => void;
  onUpdate: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.2 }}
      className="group flex flex-col rounded-xl border border-line bg-panel p-4 transition-colors hover:border-line-strong"
    >
      <button onClick={onOpen} className="flex items-start gap-3 text-left">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            wc.kind === "trunk" ? "bg-trunk/12 text-trunk" : "bg-branch/12 text-branch",
          )}
        >
          {wc.kind === "trunk" ? <TreePine className="size-5" /> : <GitBranch className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-ink">{wc.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-faint">r{wc.revision}</span>
          </div>
          <div className="mt-1.5">
            <BranchBadge kind={wc.kind} label={wc.branchLabel} />
          </div>
        </div>
      </button>

      <div className="mt-3 flex items-center gap-3 text-[12px]">
        {wc.hasConflicts ? (
          <span className="flex items-center gap-1 text-conflict">
            <AlertTriangle className="size-3.5" /> conflitos
          </span>
        ) : wc.modifiedCount > 0 ? (
          <span className="flex items-center gap-1 text-mod">
            <span className="size-2 rounded-full bg-mod" /> {wc.modifiedCount} alteração(ões)
          </span>
        ) : (
          <span className="flex items-center gap-1 text-success">
            <CheckCircle2 className="size-3.5" /> limpo
          </span>
        )}
        {server?.loading ? (
          <span className="flex items-center gap-1 text-faint">
            <Loader2 className="size-3 animate-spin" /> servidor…
          </span>
        ) : server && server.incoming > 0 ? (
          <span className="flex items-center gap-1 text-info">
            <ArrowDownToLine className="size-3.5" /> {server.incoming} no servidor
          </span>
        ) : server ? (
          <span className="text-faint">em dia</span>
        ) : null}
      </div>

      {wc.lastChangedAuthor && (
        <div className="mt-2 truncate text-[11px] text-faint">
          último: {wc.lastChangedAuthor} · {formatRelative(wc.lastChangedDate)}
        </div>
      )}

      <div className="mt-3 flex gap-2 border-t border-line/60 pt-3">
        <Button variant="ghost" size="sm" className="flex-1" onClick={onOpen}>
          Abrir
        </Button>
        <Button variant="outline" size="sm" onClick={onUpdate}>
          <ArrowDownToLine className="size-3.5" />
          Atualizar
        </Button>
      </div>
    </motion.div>
  );
}

export function OverviewView() {
  const { workingCopies, loading, baseDir, select, refresh } = useWorkspaceStore();
  const setView = useUiStore((s) => s.setView);
  const setCheckout = useUiStore((s) => s.setCheckout);
  const projects = useConfigStore((s) => s.config?.projects ?? []);
  const { update } = useActions();
  const [servers, setServers] = useState<Record<string, ServerInfo>>({});
  const [checking, setChecking] = useState(false);

  const open = (wc: WorkingCopy) => {
    select(wc.path);
    setView("changes");
  };

  const checkAll = async () => {
    setChecking(true);
    setServers(Object.fromEntries(workingCopies.map((w) => [w.path, { incoming: 0, loading: true }])));
    await Promise.all(
      workingCopies.map(async (w) => {
        try {
          const r = await api.getStatus(w.path, true);
          setServers((s) => ({ ...s, [w.path]: { incoming: r.incomingCount, loading: false } }));
        } catch {
          setServers((s) => ({ ...s, [w.path]: { incoming: 0, loading: false } }));
        }
      }),
    );
    setChecking(false);
  };

  const withChanges = workingCopies.filter((w) => w.modifiedCount > 0).length;
  const withConflicts = workingCopies.filter((w) => w.hasConflicts).length;
  const missing = projects.filter((p) => !workingCopies.some((w) => w.name === p.key || w.projectKey === p.key));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-ink">Visão geral</h1>
            <p className="truncate text-[12px] text-faint" title={baseDir}>
              {baseDir}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={checkAll} disabled={checking || !workingCopies.length}>
              {checking ? <Loader2 className="size-4 animate-spin" /> : <CloudDownload className="size-4" />}
              Conferir servidor
            </Button>
            <Button variant="ghost" size="sm" onClick={() => refresh()}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCheckout(true)}>
              <Download className="size-4" />
              Baixar
            </Button>
          </div>
        </div>

        {workingCopies.length > 0 && (
          <div className="mb-5 grid grid-cols-3 gap-3">
            <StatCard label="working copies" value={workingCopies.length} tone="text-ink" />
            <StatCard label="com alterações" value={withChanges} tone="text-mod" />
            <StatCard label="com conflitos" value={withConflicts} tone={withConflicts ? "text-conflict" : "text-ink"} />
          </div>
        )}

        {loading && workingCopies.length === 0 ? (
          <Loading label="Detectando working copies…" />
        ) : workingCopies.length === 0 ? (
          <Empty
            icon={<FolderGit2 className="size-7" />}
            title="Nenhuma working copy aqui"
            description="Troque a pasta de trabalho na barra lateral ou baixe um dos seus projetos."
            action={
              <Button variant="primary" onClick={() => setCheckout(true)}>
                <Download className="size-4" /> Baixar projeto
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workingCopies.map((wc, i) => (
              <WcCard
                key={wc.path}
                wc={wc}
                index={i}
                server={servers[wc.path]}
                onOpen={() => open(wc)}
                onUpdate={() => update(wc)}
              />
            ))}
          </div>
        )}

        {missing.length > 0 && (
          <div className="mt-8">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              Disponíveis para baixar
            </div>
            <div className="flex flex-wrap gap-2">
              {missing.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setCheckout(true)}
                  className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-[12px] text-muted transition-colors hover:border-brand/40 hover:text-ink"
                  title={p.description}
                >
                  <Download className="size-3.5 text-brand" />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
