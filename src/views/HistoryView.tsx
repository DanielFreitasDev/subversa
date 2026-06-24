import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import * as api from "@/lib/api";
import { RevisionLog, type RevisionTarget } from "@/components/history/RevisionLog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { HELP } from "@/lib/help";
import type { LogEntry, WorkingCopy } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NeedWorkingCopy } from "./_shared";

function History_({ wc }: { wc: WorkingCopy }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const log = await api.getLog(wc.path, limit, query || undefined);
      setEntries(log);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [wc.path, limit, query]);

  useEffect(() => {
    load();
  }, [load]);

  const target = useMemo<RevisionTarget>(
    () => ({ diffTarget: wc.path, repoRoot: wc.repoRoot, baseUrl: wc.url }),
    [wc.path, wc.repoRoot, wc.url],
  );

  return (
    <RevisionLog
      entries={entries}
      target={target}
      loading={loading}
      error={error}
      onRetry={load}
      listHeader={
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
          <HelpPopover content={HELP.history} />
        </div>
      }
      listFooter={
        entries.length >= limit && !loading ? (
          <button
            onClick={() => setLimit((l) => l + 50)}
            className="w-full py-3 text-center text-[12px] text-brand hover:bg-panel-2"
          >
            Carregar mais
          </button>
        ) : null
      }
    />
  );
}

export function HistoryView() {
  const wc = useSelectedWc();
  if (!wc) return <NeedWorkingCopy />;
  return <History_ key={wc.path} wc={wc} />;
}
