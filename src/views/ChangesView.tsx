import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CloudDownload,
  ExternalLink,
  FolderOpen,
  GitMerge,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Upload,
} from "lucide-react";

import * as api from "@/lib/api";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { ConflictDialog } from "@/components/dialogs/ConflictDialog";
import { StatusLetter } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Loading } from "@/components/ui/Spinner";
import { Textarea } from "@/components/ui/Field";
import { Tooltip } from "@/components/ui/Tooltip";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { useStatus } from "@/hooks/useStatus";
import { extractRevision, reportOutput, tryRun } from "@/lib/op";
import type { StatusEntry, WorkingCopy } from "@/lib/types";
import { baseName, cn, dirName, statusMeta } from "@/lib/utils";
import { confirm } from "@/store/confirm";
import { useConfigStore } from "@/store/config";
import { toast } from "@/store/toast";
import { useWorkspaceStore } from "@/store/workspace";
import { NeedWorkingCopy } from "./_shared";

const COMMITTABLE = ["modified", "added", "deleted", "replaced", "missing", "conflicted"];

function StatusRow({
  entry,
  checked,
  highlighted,
  onToggle,
  onHighlight,
  onRevert,
  onReveal,
  onResolve,
}: {
  entry: StatusEntry;
  checked: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onHighlight: () => void;
  onRevert: () => void;
  onReveal: () => void;
  onResolve: () => void;
}) {
  const isConflict = entry.item === "conflicted" || entry.treeConflicted;
  const dir = dirName(entry.relPath);
  const name = baseName(entry.relPath);
  return (
    <div
      onClick={onHighlight}
      className={cn(
        "group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors",
        highlighted ? "bg-panel-3" : "hover:bg-panel-2",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
        className="size-3.5 shrink-0 accent-brand"
      />
      <StatusLetter item={entry.item} props={entry.props} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] text-ink">{name}</span>
          {entry.props === "modified" && entry.item !== "modified" && (
            <span className="rounded bg-mod/12 px-1 text-[9px] font-semibold text-mod">props</span>
          )}
          {entry.remoteModified && (
            <span title="novidade no servidor" className="size-1.5 rounded-full bg-info" />
          )}
        </div>
        {dir && <div className="truncate text-[11px] text-faint">{dir}</div>}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {isConflict && (
          <Tooltip label="Resolver conflito">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              className="flex size-6 items-center justify-center rounded text-conflict hover:bg-conflict/15"
            >
              <GitMerge className="size-3.5" />
            </button>
          </Tooltip>
        )}
        {entry.item !== "unversioned" && (
          <Tooltip label="Reverter este arquivo">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRevert();
              }}
              className="flex size-6 items-center justify-center rounded text-faint hover:bg-panel-3 hover:text-ink"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </Tooltip>
        )}
        <Tooltip label="Abrir no sistema">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReveal();
            }}
            className="flex size-6 items-center justify-center rounded text-faint hover:bg-panel-3 hover:text-ink"
          >
            <FolderOpen className="size-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function Changes({ wc }: { wc: WorkingCopy }) {
  const { data, loading, reload } = useStatus(wc.path);
  const refreshOne = useWorkspaceStore((s) => s.refreshOne);
  const config = useConfigStore((s) => s.config);
  const confirmServerOps = config?.confirmServerOps ?? true;
  const tool = config?.externalDiffTool ?? "meld";

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [checkingServer, setCheckingServer] = useState(false);
  const [conflictPath, setConflictPath] = useState<string | null>(null);

  const entries = data?.entries ?? [];

  // Marca por padrão tudo que é "committável".
  useEffect(() => {
    if (!data) return;
    const def = new Set<string>();
    for (const e of data.entries) {
      if (COMMITTABLE.includes(e.item) || e.props === "modified" || e.props === "conflicted") {
        def.add(e.path);
      }
    }
    setChecked(def);
    setHighlight((h) => h ?? data.entries.find((e) => def.has(e.path))?.path ?? data.entries[0]?.path ?? null);
  }, [data]);

  // Carrega o diff do arquivo destacado.
  useEffect(() => {
    if (!highlight) {
      setDiff("");
      return;
    }
    let alive = true;
    setDiffLoading(true);
    api
      .getDiff(wc.path, [highlight])
      .then((d) => alive && setDiff(d))
      .catch(() => alive && setDiff(""))
      .finally(() => alive && setDiffLoading(false));
    return () => {
      alive = false;
    };
  }, [highlight, wc.path]);

  const selectedEntries = entries.filter((e) => checked.has(e.path));
  const selectableEntries = entries.filter(
    (e) => COMMITTABLE.includes(e.item) || e.item === "unversioned" || e.props === "modified",
  );
  const allSelected = selectableEntries.length > 0 && selectableEntries.every((e) => checked.has(e.path));
  const hasConflicts = entries.some((e) => e.item === "conflicted" || e.treeConflicted);

  const toggle = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const toggleAll = () =>
    setChecked(allSelected ? new Set() : new Set(selectableEntries.map((e) => e.path)));

  const revertPaths = async (paths: string[]) => {
    if (!paths.length) return;
    const ok = await confirm({
      title: paths.length === 1 ? "Reverter este arquivo?" : `Reverter ${paths.length} itens?`,
      message: "As alterações locais selecionadas serão descartadas. Não dá para desfazer.",
      danger: true,
      confirmLabel: "Reverter",
    });
    if (!ok) return;
    const out = await tryRun(() => api.revert(paths, false), "Falha no revert");
    if (out && reportOutput(out, "Alterações revertidas")) {
      await reload(false);
      await refreshOne(wc.path);
    }
  };

  const checkServer = async () => {
    setCheckingServer(true);
    const r = await tryRun(() => api.getStatus(wc.path, true), "Falha ao consultar o servidor");
    setCheckingServer(false);
    if (!r) return;
    if (r.incomingCount > 0)
      toast.info(`${r.incomingCount} novidade(s) no servidor`, "Atualize para receber antes de commitar");
    else toast.success("Em dia com o servidor", "Nada novo para receber");
    await reload(true);
  };

  const doCommit = async () => {
    const toCommit = entries.filter((e) => checked.has(e.path));
    if (!toCommit.length) return toast.warn("Selecione ao menos um arquivo");
    if (!message.trim()) return toast.warn("Escreva uma mensagem de commit");
    if (toCommit.some((e) => e.item === "conflicted")) {
      return toast.error("Há conflitos pendentes", "Resolva os conflitos antes de commitar");
    }

    const summary = `${toCommit.length} item(ns) → ${wc.isMainline ? "linha principal (trunk)" : wc.branchLabel}`;
    if (confirmServerOps) {
      const ok = await confirm({
        title: "Enviar ao servidor?",
        message: wc.isMainline
          ? `ATENÇÃO: você está commitando DIRETO na linha principal (trunk).\nIsso publica para todos imediatamente.\n\n${summary}`
          : summary,
        confirmLabel: "Commitar",
        danger: wc.isMainline,
      });
      if (!ok) return;
    }

    setCommitting(true);
    try {
      const toAdd = toCommit.filter((e) => e.item === "unversioned").map((e) => e.path);
      const toDel = toCommit.filter((e) => e.item === "missing").map((e) => e.path);
      if (toAdd.length) {
        const o = await api.svnAdd(toAdd);
        if (!o.success) return reportOutput(o, "");
      }
      if (toDel.length) {
        const o = await api.remove(toDel, false);
        if (!o.success) return reportOutput(o, "");
      }
      const out = await api.commit(
        toCommit.map((e) => e.path),
        message.trim(),
      );
      if (out.success) {
        const rev = extractRevision(out.stdout);
        toast.success("Commit enviado", rev ? `Revisão r${rev}` : undefined);
        setMessage("");
        await reload(false);
        await refreshOne(wc.path);
      } else {
        reportOutput(out, "");
      }
    } catch (e) {
      toast.error("Falha no commit", String(e));
    } finally {
      setCommitting(false);
    }
  };

  const highlightEntry = entries.find((e) => e.path === highlight);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Coluna esquerda: lista + compositor */}
      <div className="flex w-[440px] shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="size-3.5 accent-brand"
            />
            {selectedEntries.length}/{selectableEntries.length} selecionados
          </label>
          <div className="flex items-center gap-1">
            <Tooltip label="Conferir novidades no servidor">
              <Button variant="ghost" size="icon" onClick={checkServer} disabled={checkingServer}>
                {checkingServer ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CloudDownload className="size-4" />
                )}
              </Button>
            </Tooltip>
            <Tooltip label="Abrir no diff externo">
              <Button variant="ghost" size="icon" onClick={() => api.openExternalDiff(wc.path, tool)}>
                <ExternalLink className="size-4" />
              </Button>
            </Tooltip>
          </div>
        </div>

        {hasConflicts && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-conflict/30 bg-conflict/10 px-3 py-2 text-[12px] text-conflict">
            <AlertTriangle className="size-4 shrink-0" />
            Há conflitos — resolva antes de commitar.
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading && !data ? (
            <Loading label="Lendo alterações…" />
          ) : entries.length === 0 ? (
            <div className="px-3 py-12 text-center">
              <div className="text-sm font-medium text-ink">Tudo limpo ✨</div>
              <div className="mt-1 text-[12px] text-faint">Sem modificações locais nesta working copy.</div>
            </div>
          ) : (
            entries.map((e) => (
              <StatusRow
                key={e.path}
                entry={e}
                checked={checked.has(e.path)}
                highlighted={highlight === e.path}
                onToggle={() => toggle(e.path)}
                onHighlight={() => setHighlight(e.path)}
                onRevert={() => revertPaths([e.path])}
                onReveal={() => api.revealInFileManager(e.path)}
                onResolve={() => setConflictPath(e.path)}
              />
            ))
          )}
        </div>

        {/* Compositor de commit */}
        <div className="border-t border-line p-3">
          {wc.isMainline && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] leading-snug text-warn">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Você está na <b>linha principal (trunk)</b>. O commit publica para todos. Para isolar,
                crie uma branch.
              </span>
            </div>
          )}
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Mensagem do commit…  (Ctrl+Enter para enviar)"
            rows={3}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doCommit();
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              onClick={() => revertPaths(selectedEntries.filter((e) => e.item !== "unversioned").map((e) => e.path))}
              disabled={!selectedEntries.some((e) => e.item !== "unversioned")}
              className="text-[12px] text-faint transition-colors hover:text-danger disabled:opacity-40"
            >
              Reverter selecionados
            </button>
            <Button variant="primary" onClick={doCommit} loading={committing} disabled={!selectedEntries.length}>
              {!committing && <Upload className="size-4" />}
              Commitar {selectedEntries.length > 0 && `(${selectedEntries.length})`}
            </Button>
          </div>
        </div>
      </div>

      {/* Coluna direita: diff */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {highlightEntry ? (
              <div className="flex items-center gap-2">
                <StatusLetter item={highlightEntry.item} props={highlightEntry.props} />
                <span className="truncate text-[13px] font-medium text-ink">
                  {highlightEntry.relPath}
                </span>
                <span className="text-[11px] text-faint">
                  {statusMeta(highlightEntry.item, highlightEntry.props).label}
                </span>
              </div>
            ) : (
              <span className="text-[13px] text-faint">Selecione um arquivo para ver o diff</span>
            )}
          </div>
          {highlightEntry && (
            <Button variant="ghost" size="sm" onClick={() => api.openExternalDiff(wc.path, tool)}>
              <ExternalLink className="size-3.5" />
              {tool}
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {diffLoading ? (
            <Loading label="Gerando diff…" />
          ) : highlightEntry?.item === "unversioned" ? (
            <div className="px-3 py-10 text-center text-sm text-faint">
              Arquivo novo (fora do SVN). Será adicionado no commit.
            </div>
          ) : (
            <DiffViewer text={diff} />
          )}
        </div>
      </div>

      <ConflictDialog
        open={!!conflictPath}
        path={conflictPath}
        wcPath={wc.path}
        onClose={() => setConflictPath(null)}
        onResolved={async () => {
          await reload(false);
          await refreshOne(wc.path);
        }}
      />
    </div>
  );
}

export function ChangesView() {
  const wc = useSelectedWc();
  if (!wc) return <NeedWorkingCopy />;
  return <Changes key={wc.path} wc={wc} />;
}
