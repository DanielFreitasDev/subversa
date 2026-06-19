import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw, Search, ServerCrash } from "lucide-react";

import * as api from "@/lib/api";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Loading } from "@/components/ui/Spinner";
import { Empty } from "@/components/ui/Empty";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import type { LogEntry, WorkingCopy } from "@/lib/types";
import { actionMeta, cn, formatAbsolute, formatRelative } from "@/lib/utils";
import { NeedWorkingCopy } from "./_shared";

function RevisionItem({
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

function RevisionDetail({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-5 py-4">
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
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
          {entry.paths.length} arquivo(s) alterado(s)
        </div>
        {entry.paths.map((p, i) => {
          const meta = actionMeta(p.action);
          return (
            <div key={i} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-panel-2">
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
                <span className="shrink-0 text-[10px] text-faint">
                  ← {p.copyfromPath}@{p.copyfromRev}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function History_({ wc }: { wc: WorkingCopy }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const log = await api.getLog(wc.path, limit, query || undefined);
      setEntries(log);
      setSelected((s) => s ?? log[0]?.revision ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [wc.path, limit, query]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedEntry = entries.find((e) => e.revision === selected) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex w-[440px] shrink-0 flex-col border-r border-line">
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setQuery(search)}
              placeholder="Buscar no log…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Button variant="ghost" size="icon" onClick={() => load()}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && entries.length === 0 ? (
            <Loading label="Carregando histórico…" />
          ) : error ? (
            <Empty
              icon={<ServerCrash className="size-7" />}
              title="Não consegui ler o histórico"
              description={error}
              action={
                <Button variant="outline" onClick={() => load()}>
                  Tentar de novo
                </Button>
              }
            />
          ) : entries.length === 0 ? (
            <Empty icon={<History className="size-7" />} title="Sem revisões" />
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
              {entries.length >= limit && (
                <button
                  onClick={() => setLimit((l) => l + 50)}
                  className="w-full py-3 text-center text-[12px] text-brand hover:bg-panel-2"
                >
                  Carregar mais
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {selectedEntry ? (
          <RevisionDetail entry={selectedEntry} />
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

export function HistoryView() {
  const wc = useSelectedWc();
  if (!wc) return <NeedWorkingCopy />;
  return <History_ key={wc.path} wc={wc} />;
}
