/**
 * Log de revisões reutilizável (lista mestre + detalhe com diff), extraído da
 * `HistoryView` e parametrizado pelo *alvo* — uma working copy (caminho) ou uma
 * URL remota — para servir tanto a Histórico quanto o navegador de repositórios.
 */

import { useCallback, useEffect, useState } from "react";
import { Copy, FileDiff, Folder, History, Pencil, ServerCrash, Undo2 } from "lucide-react";

import * as api from "@/lib/api";
import { DiffViewer } from "@/components/diff/DiffViewer";
import type { ContentRef } from "@/components/diff/FileBlock";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { ContextMenu, useContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { Empty } from "@/components/ui/Empty";
import { Loading } from "@/components/ui/Spinner";
import { buildAddedFileDiff, type DiffFile } from "@/lib/diff";
import type { LogEntry, LogPath } from "@/lib/types";
import { toast } from "@/store/toast";
import { actionMeta, cn, formatAbsolute, formatRelative } from "@/lib/utils";

/** De onde sai o diff: caminho de WC ou URL remota. */
export interface RevisionTarget {
  /** Alvo do "diff da revisão inteira" (`svn diff -c REV` — WC path ou URL). */
  diffTarget: string;
  /** Raiz do repositório, p/ montar URLs por arquivo a partir dos paths do log. */
  repoRoot: string;
  /** URL base p/ expandir contexto na revisão inteira (wc.url ou node.url). */
  baseUrl: string;
}

/** Ações sobre uma revisão (menu de contexto na lista + botões no detalhe). */
export interface RevisionActions {
  /** Reverter as mudanças da revisão na cópia local (merge reverso). */
  onRevert?: (entry: LogEntry) => void;
  /** Editar o comentário (mensagem) da revisão no servidor. */
  onEditMessage?: (entry: LogEntry) => void;
}

/** Copia o número da revisão para a área de transferência. */
function copyRevision(revision: string) {
  navigator.clipboard
    ?.writeText(revision)
    .then(() => toast.success(`Revisão r${revision} copiada`))
    .catch(() => toast.error("Não consegui copiar a revisão"));
}

/** Itens do menu: copiar (sempre) e revert/editar quando houver handler. */
function revisionMenuItems(entry: LogEntry, actions?: RevisionActions): MenuItem[] {
  const items: MenuItem[] = [];
  if (actions?.onRevert) {
    items.push({
      id: "revert",
      label: "Reverter alterações",
      icon: <Undo2 className="size-4" />,
      onSelect: () => actions.onRevert!(entry),
    });
  }
  if (actions?.onEditMessage) {
    items.push({
      id: "edit",
      label: "Editar comentário",
      icon: <Pencil className="size-4" />,
      onSelect: () => actions.onEditMessage!(entry),
    });
  }
  items.push({
    id: "copy",
    label: "Copiar número da revisão",
    icon: <Copy className="size-4" />,
    separatorBefore: items.length > 0,
    onSelect: () => copyRevision(entry.revision),
  });
  return items;
}

export function RevisionItem({
  entry,
  active,
  onClick,
  onContext,
}: {
  entry: LogEntry;
  active: boolean;
  onClick: () => void;
  onContext?: (e: React.MouseEvent) => void;
}) {
  const firstLine = entry.message.split("\n")[0] || "(sem mensagem)";
  return (
    <button
      onClick={onClick}
      onContextMenu={onContext}
      className={cn(
        "flex w-full items-start gap-3 border-b border-line/60 px-4 py-3 text-left transition-colors",
        active ? "bg-panel-3" : "hover:bg-panel-2",
      )}
    >
      <Avatar name={entry.author} size={30} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-ink">{firstLine}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
          <span className="font-mono text-brand">r{entry.revision}</span>
          <span>·</span>
          <span className="truncate">{entry.author}</span>
          <span>·</span>
          <span title={formatAbsolute(entry.date)}>{formatRelative(entry.date)}</span>
        </div>
      </div>
      {entry.paths.length > 0 && (
        <span className="mt-0.5 shrink-0 rounded-full bg-panel-2 px-1.5 py-0.5 text-[10px] text-faint">
          {entry.paths.length}
        </span>
      )}
    </button>
  );
}

export function RevisionDetail({
  entry,
  target,
  actions,
}: {
  entry: LogEntry;
  target: RevisionTarget;
  actions?: RevisionActions;
}) {
  const [sel, setSel] = useState<"all" | LogPath>("all");
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(false);

  // Volta para "revisão inteira" ao trocar de revisão.
  useEffect(() => setSel("all"), [entry.revision]);

  const selectedPath = sel === "all" ? null : sel;
  const diffOn = selectedPath ? `${target.repoRoot}${selectedPath.path}` : target.diffTarget;

  // Arquivo adicionado por cópia (`svn copy`): o `svn diff -c REV <arquivo>` o
  // compara com a origem da cópia e sai vazio (ou só com ajustes pós-cópia), o
  // que mostrava "Sem diferenças.". Como o IntelliJ, exibimos o conteúdo novo
  // inteiro — buscado com `svn cat` e formatado como uma adição. Excluímos só
  // diretórios (`svn cat` não os lê); aceitamos `kind` ausente, com fallback
  // para o diff normal se o `cat` falhar.
  const showAsAdded =
    selectedPath != null &&
    selectedPath.kind !== "dir" &&
    !!selectedPath.copyfromPath &&
    (selectedPath.action === "A" || selectedPath.action === "R");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const fullDiff = () => api.diffRevision(diffOn, entry.revision);
    const job =
      showAsAdded && selectedPath
        ? api
            .catFile(diffOn, entry.revision)
            .then((content) => buildAddedFileDiff(selectedPath.path, content, entry.revision))
            .catch(fullDiff) // ex.: era um diretório — cai para o diff normal
        : fullDiff();
    job
      .then((d) => alive && setDiff(d))
      .catch(() => alive && setDiff(""))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [diffOn, entry.revision, showAsAdded, selectedPath]);

  // Conteúdo de referência (revisão REV) para expandir contexto sob demanda.
  const expandFor = useCallback(
    (file: DiffFile): Promise<ContentRef | null> => {
      const url =
        sel === "all" ? `${target.baseUrl}/${file.path}` : `${target.repoRoot}${sel.path}`;
      return api
        .catFile(url, entry.revision)
        .then((t) => {
          const lines = t.split("\n");
          if (lines[lines.length - 1] === "") lines.pop(); // descarta a "linha" vazia final
          return { side: "new" as const, lines };
        })
        .catch(() => null);
    },
    [sel, target.baseUrl, target.repoRoot, entry.revision],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Topo: cabeçalho, mensagem e arquivos clicáveis. */}
      <div className="flex max-h-[45%] shrink-0 flex-col border-b border-line">
        <div className="px-5 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={entry.author} size={38} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-brand">r{entry.revision}</span>
                  <span className="text-[13px] font-medium text-ink">{entry.author}</span>
                </div>
                <div className="text-[11px] text-faint">{formatAbsolute(entry.date)}</div>
              </div>
            </div>
            <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
              {actions?.onRevert && (
                <IconButton
                  label="Reverter as alterações desta revisão"
                  onClick={() => actions.onRevert!(entry)}
                >
                  <Undo2 className="size-4" />
                </IconButton>
              )}
              {actions?.onEditMessage && (
                <IconButton
                  label="Editar comentário da revisão"
                  onClick={() => actions.onEditMessage!(entry)}
                >
                  <Pencil className="size-4" />
                </IconButton>
              )}
              <IconButton
                label="Copiar número da revisão"
                onClick={() => copyRevision(entry.revision)}
              >
                <Copy className="size-4" />
              </IconButton>
            </div>
          </div>
          <p className="selectable mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
            {entry.message || "(sem mensagem)"}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">
            {entry.paths.length} arquivo(s) alterado(s)
          </div>
          <button
            onClick={() => setSel("all")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              sel === "all" ? "bg-brand/12 text-brand" : "text-faint hover:bg-panel-2 hover:text-ink",
            )}
          >
            <FileDiff className="size-3.5" />
            Diff da revisão inteira
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {entry.paths.map((p, i) => {
            const meta = actionMeta(p.action);
            const active = selectedPath === p;
            return (
              <button
                key={i}
                onClick={() => setSel(p)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                  active ? "bg-panel-3" : "hover:bg-panel-2",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] border font-mono text-[11px] font-bold",
                    meta.text,
                    meta.bg,
                    meta.border,
                  )}
                  title={meta.label}
                >
                  {p.action}
                </span>
                {p.kind === "dir" && (
                  <Folder className="size-3.5 shrink-0 text-muted" aria-label="pasta" />
                )}
                <span className="selectable truncate font-mono text-[12px] text-muted" title={p.path}>
                  {p.path}
                </span>
                {p.copyfromPath && (
                  <span className="ml-auto shrink-0 text-[10px] text-faint">
                    ← {p.copyfromPath}@{p.copyfromRev}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Baixo: diff do arquivo selecionado (ou da revisão inteira). */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <Loading label="Gerando diff…" />
        ) : (
          <DiffViewer text={diff} onExpandContext={expandFor} />
        )}
      </div>
    </div>
  );
}

/**
 * Painel completo mestre-detalhe. O chamador fornece as revisões já carregadas
 * (e cuida de buscar/paginar via `listHeader`/`listFooter`); a seleção é interna.
 */
export function RevisionLog({
  entries,
  target,
  loading,
  error,
  onRetry,
  listHeader,
  listFooter,
  listWidth = 440,
  emptyTitle = "Sem revisões",
  emptyDescription,
  emptyIcon,
  actions,
}: {
  entries: LogEntry[];
  target: RevisionTarget;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  listHeader?: React.ReactNode;
  listFooter?: React.ReactNode;
  listWidth?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ReactNode;
  actions?: RevisionActions;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const ctx = useContextMenu();

  // Mantém a seleção se ainda existir; senão, cai para a primeira revisão.
  useEffect(() => {
    setSelected((cur) =>
      cur && entries.some((e) => e.revision === cur) ? cur : entries[0]?.revision ?? null,
    );
  }, [entries]);

  const selectedEntry = entries.find((e) => e.revision === selected) ?? null;

  return (
    <>
      <div className="flex h-full overflow-hidden">
        <div
          className="flex shrink-0 flex-col border-r border-line"
          style={{ width: listWidth }}
        >
          {listHeader}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && entries.length === 0 ? (
              <Loading label="Carregando histórico…" />
            ) : error ? (
              <Empty
                icon={<ServerCrash className="size-7" />}
                title="Não consegui ler o histórico"
                description={error}
                action={
                  onRetry && (
                    <Button variant="outline" onClick={onRetry}>
                      Tentar de novo
                    </Button>
                  )
                }
              />
            ) : entries.length === 0 ? (
              <Empty
                icon={emptyIcon ?? <History className="size-7" />}
                title={emptyTitle}
                description={emptyDescription}
              />
            ) : (
              <>
                {entries.map((e) => (
                  <RevisionItem
                    key={e.revision}
                    entry={e}
                    active={selected === e.revision}
                    onClick={() => setSelected(e.revision)}
                    onContext={(ev) => {
                      setSelected(e.revision);
                      ctx.open(ev, revisionMenuItems(e, actions));
                    }}
                  />
                ))}
                {listFooter}
              </>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {selectedEntry ? (
            <RevisionDetail entry={selectedEntry} target={target} actions={actions} />
          ) : (
            !loading &&
            !error && (
              <div className="flex h-full items-center justify-center text-sm text-faint">
                Selecione uma revisão
              </div>
            )
          )}
        </div>
      </div>

      <ContextMenu menu={ctx.menu} onClose={ctx.close} />
    </>
  );
}
