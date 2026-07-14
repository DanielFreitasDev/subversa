import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import * as api from "@/lib/api";
import { EditRevisionMessageDialog } from "@/components/dialogs/EditRevisionMessageDialog";
import { RevisionLog, type RevisionActions, type RevisionTarget } from "@/components/history/RevisionLog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { useActions } from "@/hooks/useActions";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { HELP } from "@/lib/help";
import type { LogEntry, WorkingCopy } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NeedWorkingCopy } from "./_shared";

// Ao buscar, varremos o histórico inteiro — não só a janela já carregada. O
// `svn log --search` filtra por autor, mensagem e (com `-v`) caminhos, e imprime
// apenas as revisões que casam; então mesmo varrendo tudo a saída fica pequena.
// Usamos um teto de varredura alto em vez do `limit` de navegação, para que uma
// palavra que só aparece num arquivo de 2023 apareça sem precisar "Carregar mais".
const SEARCH_SCAN_LIMIT = 100000;

function History_({ wc }: { wc: WorkingCopy }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<LogEntry | null>(null);
  const { revertRevision } = useActions();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Loga pela URL (assume HEAD:1) e não pelo caminho da WC (assume BASE:1):
      // numa WC de revisão mista, a BASE da raiz fica defasada após um commit de
      // arquivos fundos e esconderia do histórico a revisão recém-commitada.
      const scanLimit = query ? SEARCH_SCAN_LIMIT : limit;
      const log = await api.getLog(wc.url, scanLimit, query || undefined);
      setEntries(log);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [wc.url, limit, query]);

  useEffect(() => {
    load();
  }, [load]);

  const target = useMemo<RevisionTarget>(
    () => ({ diffTarget: wc.path, repoRoot: wc.repoRoot, baseUrl: wc.url }),
    [wc.path, wc.repoRoot, wc.url],
  );

  const actions = useMemo<RevisionActions>(
    () => ({
      onRevert: (e) => revertRevision(wc, e.revision),
      onEditMessage: (e) => setEditing(e),
    }),
    [revertRevision, wc],
  );

  return (
    <>
    <RevisionLog
      entries={entries}
      target={target}
      loading={loading}
      error={error}
      onRetry={load}
      actions={actions}
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
        !query && entries.length >= limit && !loading ? (
          <button
            onClick={() => setLimit((l) => l + 50)}
            className="w-full py-3 text-center text-[12px] text-brand hover:bg-panel-2"
          >
            Carregar mais
          </button>
        ) : null
      }
    />
    <EditRevisionMessageDialog
      open={!!editing}
      wcPath={wc.path}
      revision={editing?.revision ?? ""}
      initialMessage={editing?.message ?? ""}
      onClose={() => setEditing(null)}
      onSaved={load}
    />
    </>
  );
}

export function HistoryView() {
  const wc = useSelectedWc();
  if (!wc) return <NeedWorkingCopy />;
  return <History_ key={wc.path} wc={wc} />;
}
