import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, CheckCircle2, RefreshCw } from "lucide-react";

import * as api from "@/lib/api";
import { RevisionLog, type RevisionTarget } from "@/components/history/RevisionLog";
import { Button } from "@/components/ui/Button";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { useActions } from "@/hooks/useActions";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { HELP } from "@/lib/help";
import type { LogEntry, WorkingCopy } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NeedWorkingCopy } from "./_shared";

/**
 * "Entrada": o que chega do servidor ao atualizar a working copy. Reaproveita o
 * `RevisionLog` do Histórico — então cada revisão a receber vem com autor,
 * mensagem, arquivos alterados e diff —, com um cabeçalho que resume o atraso
 * (r{base} → r{head}) e oferece "Atualizar agora".
 */
function Incoming_({ wc }: { wc: WorkingCopy }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [base, setBase] = useState(wc.revision);
  const [head, setHead] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { update } = useActions();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.incoming(wc.path);
      setEntries(res.entries);
      setBase(res.baseRevision);
      setHead(res.headRevision);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [wc.path]);

  useEffect(() => {
    load();
  }, [load]);

  // Atualiza a WC e, se deu certo, recarrega a entrada (que deve esvaziar).
  const onUpdate = async () => {
    if (await update(wc)) load();
  };

  const target = useMemo<RevisionTarget>(
    () => ({ diffTarget: wc.path, repoRoot: wc.repoRoot, baseUrl: wc.url }),
    [wc.path, wc.repoRoot, wc.url],
  );

  const n = entries.length;

  return (
    <RevisionLog
      entries={entries}
      target={target}
      loading={loading}
      error={error}
      onRetry={load}
      emptyIcon={<CheckCircle2 className="size-7 text-success" />}
      emptyTitle="Tudo em dia ✨"
      emptyDescription="Nada a receber do servidor."
      listHeader={
        <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink">
                {loading
                  ? "Conferindo o servidor…"
                  : n > 0
                    ? `${n} revisã${n > 1 ? "ões" : "o"} a receber`
                    : "Nada a receber"}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-faint">
                você está em <span className="font-mono text-brand">r{base}</span>
                {head && head !== base && (
                  <>
                    {" · servidor em "}
                    <span className="font-mono text-info">r{head}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => load()} aria-label="Recarregar">
                <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              </Button>
              <HelpPopover content={HELP.incoming} />
            </div>
          </div>
          {n > 0 && (
            <Button
              variant="primary"
              size="sm"
              className="w-full justify-center"
              onClick={onUpdate}
            >
              <ArrowDownToLine className="size-4" />
              Atualizar agora
            </Button>
          )}
        </div>
      }
    />
  );
}

export function IncomingView() {
  const wc = useSelectedWc();
  if (!wc) return <NeedWorkingCopy />;
  return <Incoming_ key={wc.path} wc={wc} />;
}
