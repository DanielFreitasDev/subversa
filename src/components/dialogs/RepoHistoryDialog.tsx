/**
 * "Mostrar histórico" e "Navegar alterações…" de uma URL remota. Reusa o
 * `RevisionLog` (lista + diff). "Navegar alterações" expõe filtros: autor/termo
 * (→ `--search`, que casa autor+mensagem) e intervalo de revisão/data (→ `-r`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, ListFilter, RefreshCw, Search } from "lucide-react";

import * as api from "@/lib/api";
import { RevisionLog, type RevisionTarget } from "@/components/history/RevisionLog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { repoHistoryHelp } from "@/lib/help";
import type { LogEntry } from "@/lib/types";
import { cn, decodeUrl } from "@/lib/utils";
import { useRepoBrowserStore } from "@/store/repoBrowser";

export function RepoHistoryDialog() {
  const dialog = useRepoBrowserStore((s) => s.dialog);
  const closeDialog = useRepoBrowserStore((s) => s.closeDialog);
  const activeLocation = useRepoBrowserStore((s) => s.activeLocation);

  const open = dialog?.kind === "history" || dialog?.kind === "browseChanges";
  const browse = dialog?.kind === "browseChanges";
  const node = dialog?.node ?? null;
  const url = node?.url ?? "";

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [rangeInput, setRangeInput] = useState("");
  const [range, setRange] = useState("");
  const [repoRoot, setRepoRoot] = useState("");

  // Reset ao (re)abrir / trocar de alvo.
  useEffect(() => {
    if (open) {
      setEntries([]);
      setLimit(50);
      setSearchInput("");
      setQuery("");
      setRangeInput("");
      setRange("");
      setError(null);
      setRepoRoot("");
    }
  }, [open, url]);

  // Raiz real do repositório (para montar URLs por arquivo dos paths do log).
  // Mais correto que assumir a localização ativa (que pode ser uma subpasta).
  useEffect(() => {
    if (!open || !url) return;
    let alive = true;
    api
      .getUrlInfo(url)
      .then((i) => alive && setRepoRoot(i.repoRoot))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, url]);

  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const log = await api.getLog(url, limit, query || undefined, range || undefined);
      setEntries(log);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [url, limit, query, range]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const target = useMemo<RevisionTarget>(
    () => ({ diffTarget: url, repoRoot: repoRoot || activeLocation || url, baseUrl: url }),
    [url, repoRoot, activeLocation],
  );

  if (!open || !node) return null;

  return (
    <Modal
      open={open}
      onClose={closeDialog}
      size="xl"
      icon={browse ? <ListFilter className="size-5" /> : <History className="size-5" />}
      title={browse ? "Navegar alterações" : "Histórico"}
      description={decodeUrl(url)}
      help={repoHistoryHelp(browse)}
      className="max-w-6xl"
    >
      <div className="h-[72vh]">
        <RevisionLog
          entries={entries}
          target={target}
          loading={loading}
          error={error}
          onRetry={load}
          listWidth={360}
          listHeader={
            <div className="space-y-2 px-3 py-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                  <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && setQuery(searchInput)}
                    placeholder={browse ? "Autor ou termo…" : "Buscar no log…"}
                    className="h-8 pl-8 text-[13px]"
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={() => load()}>
                  <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                </Button>
              </div>
              {browse && (
                <Input
                  value={rangeInput}
                  onChange={(e) => setRangeInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setRange(rangeInput)}
                  placeholder="intervalo: 1000:2000  ou  {2026-01-01}:{2026-06-30}"
                  className="h-8 font-mono text-[12px]"
                />
              )}
              {browse && (
                <p className="text-[10px] leading-snug text-faint">
                  Autor usa <code>--search</code> (casa autor + mensagem). Intervalo usa <code>-r</code>.
                </p>
              )}
            </div>
          }
          listFooter={
            entries.length >= limit ? (
              <button
                onClick={() => setLimit((l) => l + 50)}
                className="w-full py-3 text-center text-[12px] text-brand hover:bg-panel-2"
              >
                Carregar mais
              </button>
            ) : null
          }
        />
      </div>
    </Modal>
  );
}
