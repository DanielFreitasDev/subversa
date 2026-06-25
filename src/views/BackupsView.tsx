/**
 * Backups (pontos de restauração) — lista as cópias completas feitas antes de
 * operações destrutivas e permite **restaurar** (reescreve a working copy com a
 * cópia salva) ou **excluir** uma cópia. A restauração exige digitar o nome da
 * working copy (operação que sobrescreve a pasta inteira).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Archive,
  Clock,
  FolderOpen,
  GitBranch,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Trash2,
  TreePine,
} from "lucide-react";

import * as api from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { HELP } from "@/lib/help";
import { reportOutput, tryRun } from "@/lib/op";
import type { BackupEntry, OpProgress } from "@/lib/types";
import { cn, formatAbsolute, formatBytes, formatRelative } from "@/lib/utils";
import { confirm } from "@/store/confirm";
import { toast } from "@/store/toast";
import { useWorkspaceStore } from "@/store/workspace";
import { ViewHeader } from "@/views/_shared";

/** Cartão de um ponto de restauração. */
function BackupCard({
  b,
  onRestore,
  onDelete,
  busy,
}: {
  b: BackupEntry;
  onRestore: (b: BackupEntry) => void;
  onDelete: (b: BackupEntry) => void;
  busy: boolean;
}) {
  const isTrunk = b.branchLabel === "trunk";
  const created = new Date(b.createdMs).toISOString();
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            isTrunk ? "bg-trunk/12 text-trunk" : "bg-branch/12 text-branch",
          )}
        >
          {isTrunk ? <TreePine className="size-4" /> : <GitBranch className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-semibold text-ink">{b.wcName}</span>
            <span className="truncate text-[12px] text-muted">
              {isTrunk ? "trunk" : b.branchLabel}
            </span>
            {b.revision && (
              <span className="rounded-md bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-faint">
                r{b.revision}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              <span title={formatAbsolute(created)}>{formatRelative(created)}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <HardDrive className="size-3" />
              {formatBytes(b.sizeBytes)} • {b.fileCount} arquivo(s)
            </span>
            <span className="rounded bg-brand/10 px-1.5 py-0.5 text-brand">antes de: {b.op}</span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-faint" title={b.wcPath}>
            {b.wcPath}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => onRestore(b)} disabled={busy}>
            <RotateCcw className="size-4" />
            Restaurar
          </Button>
          <IconButton label="Excluir backup" onClick={() => onDelete(b)} disabled={busy} className="size-8">
            <Trash2 className="size-4 text-faint" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

export function BackupsView() {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const refreshOne = useWorkspaceStore((s) => s.refreshOne);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await tryRun(() => api.listBackups(), "Falha ao listar backups");
    setBackups(list ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Recarrega quando um backup termina de ser criado em outra tela.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<OpProgress>("op-progress", (e) => {
      if (alive && e.payload.done && e.payload.op === "backup") load();
    }).then((un) => {
      if (alive) unlisten = un;
      else un();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [load]);

  const totalBytes = useMemo(() => backups.reduce((s, b) => s + b.sizeBytes, 0), [backups]);

  const onRestore = async (b: BackupEntry) => {
    const ok = await confirm({
      title: `Restaurar o backup de ${b.wcName}?`,
      message:
        `A working copy em ${b.wcPath} será SOBRESCRITA com o conteúdo deste ponto de restauração ` +
        `(${formatRelative(new Date(b.createdMs).toISOString())}). ` +
        "Tudo o que você fez depois será perdido — inclusive merges, updates e alterações locais.",
      confirmLabel: "Restaurar",
      danger: true,
      requireText: b.wcName,
    });
    if (!ok) return;
    setBusy(true);
    const out = await tryRun(() => api.restoreBackup(b.id), "Falha ao restaurar");
    if (out && reportOutput(out, "Working copy restaurada", "Voltou ao estado do backup.")) {
      await refreshOne(b.wcPath);
    }
    setBusy(false);
  };

  const onDelete = async (b: BackupEntry) => {
    const ok = await confirm({
      title: "Excluir este backup?",
      message: `O ponto de restauração de ${b.wcName} (${formatBytes(b.sizeBytes)}) será apagado do disco. Não dá para desfazer.`,
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const done = await tryRun(() => api.deleteBackup(b.id), "Falha ao excluir");
    if (done !== null) {
      toast.success("Backup excluído");
      setBackups((cur) => cur.filter((x) => x.id !== b.id));
    }
    setBusy(false);
  };

  const openFolder = async () => {
    const dir = await tryRun(() => api.backupsDir(), "Falha ao abrir a pasta");
    if (dir) await api.revealInFileManager(dir);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line">
        <ViewHeader
          title="Backups"
          subtitle={
            backups.length
              ? `${backups.length} ponto(s) de restauração • ${formatBytes(totalBytes)}`
              : "pontos de restauração das working copies"
          }
        >
          <HelpPopover content={HELP.backups} />
          <Button size="sm" variant="ghost" onClick={openFolder}>
            <FolderOpen className="size-4" />
            Abrir pasta
          </Button>
          <IconButton label="Recarregar" onClick={load} className={cn("size-8", loading && "text-brand")}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </IconButton>
        </ViewHeader>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {backups.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Empty
              icon={<Archive className="size-7" />}
              title={loading ? "Carregando…" : "Nenhum backup ainda"}
              description="Antes de merge, update, switch ou reverter, o app oferece criar um ponto de restauração. Eles aparecem aqui para restaurar quando precisar."
            />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-3">
            {backups.map((b) => (
              <BackupCard key={b.id} b={b} onRestore={onRestore} onDelete={onDelete} busy={busy} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
