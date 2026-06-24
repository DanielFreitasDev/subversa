/**
 * Registro de comandos — auditoria, em tempo real, de TODA chamada `svn` que o
 * app dispara (horário, código de saída e duração). A lista é mantida pelo
 * backend (anel em memória + arquivo persistente); aqui carregamos o histórico
 * ao montar e anexamos as novas entradas pelo evento `command-log`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowDownToLine, FolderOpen, Search, Terminal, Trash2 } from "lucide-react";

import * as api from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Input } from "@/components/ui/Field";
import { ViewHeader } from "@/views/_shared";
import type { CommandLogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Teto do que guardamos no cliente (o backend já limita o anel da sessão). */
const CLIENT_CAP = 2000;

/** Horário local com milissegundos (`14:32:01.123`). */
function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function LogRow({ entry }: { entry: CommandLogEntry }) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-3 px-5 py-1 font-mono text-[12px] leading-relaxed",
        "border-l-2 hover:bg-panel-2/60",
        entry.success ? "border-transparent" : "border-conflict/60 bg-conflict/[0.06]",
      )}
    >
      <span className="shrink-0 tabular-nums text-faint" title={new Date(entry.timestampMs).toLocaleString("pt-BR")}>
        {fmtTime(entry.timestampMs)}
      </span>
      <span
        className={cn(
          "w-16 shrink-0 font-semibold",
          entry.success ? "text-success" : "text-conflict",
        )}
      >
        {entry.success ? "OK" : `ERRO ${entry.code ?? "?"}`}
      </span>
      <span className="min-w-0 flex-1 break-all text-ink">{entry.command}</span>
      <span className="shrink-0 tabular-nums text-faint">{entry.durationMs} ms</span>
    </div>
  );
}

export function CommandLogView() {
  const [entries, setEntries] = useState<CommandLogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Funde por `seq` (monotônico) — dedup e ordena, resistente a corridas. */
  const addEntries = useCallback((incoming: CommandLogEntry[]) => {
    setEntries((prev) => {
      const bySeq = new Map<number, CommandLogEntry>();
      for (const e of prev) bySeq.set(e.seq, e);
      for (const e of incoming) bySeq.set(e.seq, e);
      const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
      return merged.length > CLIENT_CAP ? merged.slice(-CLIENT_CAP) : merged;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;

    api.getCommandLog().then((list) => alive && addEntries(list));
    listen<CommandLogEntry>("command-log", (e) => alive && addEntries([e.payload])).then((un) => {
      if (alive) unlisten = un;
      else un(); // desmontou antes de o listener resolver
    });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [addEntries]);

  // Mantém a rolagem colada no fim conforme novas entradas chegam.
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter((e) => e.command.toLowerCase().includes(q)) : entries;
  }, [entries, query]);

  const clear = async () => {
    await api.clearCommandLog();
    setEntries([]);
  };

  const openFile = async () => {
    const path = await api.commandLogPath();
    if (path) await api.revealInFileManager(path);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line">
        <ViewHeader
          title="Registro"
          subtitle={`${entries.length} comando${entries.length === 1 ? "" : "s"} svn nesta sessão`}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filtrar…"
              className="h-8 w-44 pl-8 text-[12px]"
            />
          </div>
          <IconButton
            label={autoScroll ? "Rolagem automática ligada" : "Rolagem automática desligada"}
            onClick={() => setAutoScroll((v) => !v)}
            className={cn("size-8", autoScroll ? "text-brand" : "text-faint")}
          >
            <ArrowDownToLine className="size-4" />
          </IconButton>
          <Button size="sm" variant="ghost" onClick={openFile}>
            <FolderOpen className="size-4" />
            Abrir arquivo
          </Button>
          <Button size="sm" variant="ghost" onClick={clear} disabled={entries.length === 0}>
            <Trash2 className="size-4" />
            Limpar
          </Button>
        </ViewHeader>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Empty
              icon={<Terminal className="size-7" />}
              title={entries.length === 0 ? "Nenhum comando ainda" : "Nada corresponde ao filtro"}
              description={
                entries.length === 0
                  ? "Toda chamada svn feita pelo app aparece aqui em tempo real e fica gravada no arquivo de log."
                  : "Ajuste ou limpe o filtro para ver os comandos registrados."
              }
            />
          </div>
        ) : (
          filtered.map((e) => <LogRow key={e.seq} entry={e} />)
        )}
      </div>
    </div>
  );
}
