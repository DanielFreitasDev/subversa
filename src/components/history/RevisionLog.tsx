/**
 * Log de revisões reutilizável (lista mestre + detalhe com diff), extraído da
 * `HistoryView` e parametrizado pelo *alvo* — uma working copy (caminho) ou uma
 * URL remota — para servir tanto a Histórico quanto o navegador de repositórios.
 */

import { useCallback, useEffect, useState } from "react";
import { FileDiff, History, ServerCrash } from "lucide-react";

import * as api from "@/lib/api";
import { DiffViewer } from "@/components/diff/DiffViewer";
import type { ContentRef } from "@/components/diff/FileBlock";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Loading } from "@/components/ui/Spinner";
import type { DiffFile } from "@/lib/diff";
import type { LogEntry, LogPath } from "@/lib/types";
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

export function RevisionItem({
  entry,
  active,
  onClick,
}: {
  entry: LogEntry;
  active: boolean;
  onClick: () => void;
}) {
  const firstLine = entry.message.split("\n")[0] || "(sem mensagem)";
  return (
    <button
      onClick={onClick}
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
}: {
  entry: LogEntry;
  target: RevisionTarget;
}) {
  const [sel, setSel] = useState<"all" | LogPath>("all");
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [ignoreWs, setIgnoreWs] = useState(false);

  // Volta para "revisão inteira" ao trocar de revisão.
  useEffect(() => setSel("all"), [entry.revision]);

  const diffOn = sel === "all" ? target.diffTarget : `${target.repoRoot}${sel.path}`;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .diffRevision(diffOn, entry.revision, ignoreWs)
      .then((d) => alive && setDiff(d))
      .catch(() => alive && setDiff(""))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [diffOn, entry.revision, ignoreWs]);

  // Conteúdo de referência (revisão REV) para expandir contexto sob demanda.
  const expandFor = useCallback(
    (file: DiffFile): Promise<ContentRef | null> => {
      const url =
        sel === "all" ? `${target.baseUrl}/${file.path}` : `${target.repoRoot}${sel.path}`;
      return api
        .catFile(url, entry.revision)
        .then((t) => ({ side: "new" as const, lines: t.split("\n") }))
        .catch(() => null);
    },
    [sel, target.baseUrl, target.repoRoot, entry.revision],
  );

  const selectedPath = sel === "all" ? null : sel;

  return (
    <div className="flex h-full flex-col">
      {/* Topo: cabeçalho, mensagem e arquivos clicáveis. */}
      <div className="flex max-h-[45%] shrink-0 flex-col border-b border-line">
        <div className="px-5 pt-4">
          <div className="flex items-center gap-3">
            <Avatar name={entry.author} size={38} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-brand">r{entry.revision}</span>
                <span className="text-[13px] font-medium text-ink">{entry.author}</span>
              </div>
              <div className="text-[11px] text-faint">{formatAbsolute(entry.date)}</div>
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
          <DiffViewer
            text={diff}
            ignoreWs={ignoreWs}
            onToggleIgnoreWs={setIgnoreWs}
            onExpandContext={expandFor}
          />
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
}) {
  const [selected, setSelected] = useState<string | null>(null);

  // Mantém a seleção se ainda existir; senão, cai para a primeira revisão.
  useEffect(() => {
    setSelected((cur) =>
      cur && entries.some((e) => e.revision === cur) ? cur : entries[0]?.revision ?? null,
    );
  }, [entries]);

  const selectedEntry = entries.find((e) => e.revision === selected) ?? null;

  return (
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
            <Empty icon={<History className="size-7" />} title={emptyTitle} />
          ) : (
            <>
              {entries.map((e) => (
                <RevisionItem
                  key={e.revision}
                  entry={e}
                  active={selected === e.revision}
                  onClick={() => setSelected(e.revision)}
                />
              ))}
              {listFooter}
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {selectedEntry ? (
          <RevisionDetail entry={selectedEntry} target={target} />
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
  );
}
