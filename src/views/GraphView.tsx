/**
 * Aba "Gráfico": o mapa de metrô do projeto — trunk + branches conectados,
 * com forks (copyfrom), syncs e reintegrações (mergeinfo via `svn log -g`).
 *
 * A topologia é reconstruída em `lib/graph.ts` a partir de um único
 * `svn log -v -g` na raiz do repositório restrito ao trunk do projeto e à
 * pasta de branches; clicar numa revisão abre o mesmo painel de detalhe do
 * Histórico (arquivos alterados + diff).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitGraph, Info, RefreshCw, ServerCrash, X } from "lucide-react";

import * as api from "@/lib/api";
import { RevisionDetail, type RevisionTarget } from "@/components/history/RevisionLog";
import { RevisionGraph } from "@/components/graph/RevisionGraph";
import { Button, IconButton } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Loading } from "@/components/ui/Spinner";
import { buildGraph, repoRelativePath, type GraphRow } from "@/lib/graph";
import type { GraphLogEntry, LogEntry, ProjectGraph, WorkingCopy } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/store/config";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { NeedWorkingCopy } from "./_shared";

/** A pasta de branches fica na raiz do repositório (mesma convenção da aba Branches). */
const BRANCHES_REL = "branches";

/** Adapta uma revisão do gráfico para o painel de detalhe do Histórico. */
function toLogEntry(e: GraphLogEntry): LogEntry {
  return {
    revision: String(e.revision),
    author: e.author,
    date: e.date,
    message: e.message,
    paths: e.paths.map((p) => ({
      action: p.action,
      path: p.path,
      kind: p.kind,
      copyfromPath: p.copyfromPath,
      copyfromRev: p.copyfromRev != null ? String(p.copyfromRev) : null,
    })),
  };
}

function LegendDot({ color, ring }: { color: string; ring?: boolean }) {
  return (
    <span
      className="inline-block size-2.5 rounded-full"
      style={
        ring
          ? { border: `2px solid ${color}`, background: "transparent" }
          : { background: color }
      }
    />
  );
}

function LegendArrow({ from, to }: { from: string; to: string }) {
  const id = `legend-${from.replace(/[^a-z]/gi, "")}-${to.replace(/[^a-z]/gi, "")}`;
  return (
    <svg width="18" height="10" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style={{ stopColor: from }} />
          <stop offset="100%" style={{ stopColor: to }} />
        </linearGradient>
      </defs>
      <line x1="1" y1="5" x2="12" y2="5" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" />
      <path d="M 11 1.5 L 16 5 L 11 8.5 Z" style={{ fill: to }} />
    </svg>
  );
}

function Legend({ mergeHistory }: { mergeHistory: boolean }) {
  const trunk = "var(--color-trunk)";
  const branch = "var(--color-branch)";
  return (
    <div className="hidden items-center gap-4 text-[11px] text-faint min-[900px]:flex">
      <span className="flex items-center gap-1.5">
        <LegendDot color={trunk} /> trunk
      </span>
      <span className="flex items-center gap-1.5">
        <LegendDot color={branch} /> branch
      </span>
      {mergeHistory && (
        <>
          <span className="flex items-center gap-1.5">
            <LegendDot color={branch} ring /> merge
          </span>
          <span className="flex items-center gap-1.5">
            <LegendArrow from={trunk} to={branch} /> sync
          </span>
          <span className="flex items-center gap-1.5">
            <LegendArrow from={branch} to={trunk} /> reintegração
          </span>
        </>
      )}
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-del">✕</span> branch removida
      </span>
    </div>
  );
}

function Graph_({ wc }: { wc: WorkingCopy }) {
  const projects = useConfigStore((s) => s.config?.projects ?? []);
  // Linha principal: o preset do projeto; sem preset, uma WC de trunk serve.
  const mainlineUrl = wc.projectKey
    ? projects.find((p) => p.key === wc.projectKey)?.url ?? null
    : null;
  const trunkUrl = mainlineUrl ?? (wc.kind === "trunk" ? wc.url : null);
  const trunkPath = trunkUrl ? repoRelativePath(trunkUrl, wc.repoRoot) : null;

  const [data, setData] = useState<ProjectGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(300);
  const [selected, setSelected] = useState<number | null>(null);
  const [focusLane, setFocusLane] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!trunkPath) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const graph = await api.projectGraph(
        wc.repoRoot,
        [trunkPath.replace(/^\//, ""), BRANCHES_REL],
        limit,
      );
      setData(graph);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [wc.repoRoot, trunkPath, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const model = useMemo(
    () =>
      data && trunkPath
        ? buildGraph({
            entries: data.entries,
            trunkPath,
            branchesPath: "/" + BRANCHES_REL,
            truncated: data.entries.length >= limit,
          })
        : null,
    [data, trunkPath, limit],
  );

  const selectedRow = useMemo(
    () => model?.rows.find((r) => r.entry.revision === selected) ?? null,
    [model, selected],
  );
  const detailEntry = useMemo(
    () => (selectedRow ? toLogEntry(selectedRow.entry) : null),
    [selectedRow],
  );
  // O diff da revisão sai da URL da própria linha (trunk ou branch) — a WC
  // pode estar em outra linha e não veria a mudança.
  const target = useMemo<RevisionTarget>(() => {
    const base = selectedRow ? wc.repoRoot + selectedRow.laneId : wc.url;
    return { diffTarget: base, repoRoot: wc.repoRoot, baseUrl: base };
  }, [selectedRow, wc.repoRoot, wc.url]);

  const onSelect = useCallback(
    (row: GraphRow | null) => setSelected(row?.entry.revision ?? null),
    [],
  );

  // Esc fecha o painel de detalhe.
  useEffect(() => {
    if (selected == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  if (!trunkPath) {
    return (
      <Empty
        icon={<GitGraph className="size-7" />}
        title="Sem linha principal para desenhar"
        description="Associe esta working copy a um projeto (Configurações → Projetos) para que o gráfico saiba qual é o trunk."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
        <Legend mergeHistory={data?.mergeHistory ?? true} />
        {data && !data.mergeHistory && (
          <span
            className="flex items-center gap-1.5 text-[11px] text-faint"
            title="O servidor rejeitou o `svn log -g` (E200007): repositórios antigos não expõem mergeinfo. Lanes, forks e deleções continuam completos."
          >
            <Info className="size-3.5" />
            sem setas de merge — o servidor não expõe mergeinfo
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="field h-8 w-auto py-0 pr-7 text-[12px]"
            title="Quantidade de revisões carregadas"
          >
            {[150, 300, 600, 1000].map((n) => (
              <option key={n} value={n}>
                {n} revisões
              </option>
            ))}
          </select>
          <Button variant="ghost" size="icon" onClick={() => load()} title="Recarregar">
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-auto">
          {loading && !data ? (
            <Loading label="Montando o gráfico do projeto…" />
          ) : error ? (
            <Empty
              icon={<ServerCrash className="size-7" />}
              title="Não consegui montar o gráfico"
              description={error}
              action={
                <Button variant="outline" onClick={load}>
                  Tentar de novo
                </Button>
              }
            />
          ) : !model || model.rows.length === 0 ? (
            <Empty
              icon={<GitGraph className="size-7" />}
              title="Sem revisões no gráfico"
              description="Nenhuma revisão do trunk ou de branches conectados apareceu na janela carregada."
            />
          ) : (
            <>
              <RevisionGraph
                model={model}
                selectedRev={selected}
                onSelect={onSelect}
                focusLaneId={focusLane}
                onFocusLane={setFocusLane}
              />
              {data != null && data.entries.length >= limit && (
                <button
                  onClick={() => setLimit((l) => l * 2)}
                  className="w-full py-3 text-center text-[12px] text-brand hover:bg-panel-2"
                >
                  Carregar mais revisões
                </button>
              )}
            </>
          )}
        </div>

        {detailEntry && (
          <div className="flex w-[520px] shrink-0 flex-col border-l border-line">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-line pl-4 pr-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                Detalhes da revisão
              </span>
              <IconButton label="Fechar detalhes (Esc)" onClick={() => setSelected(null)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1">
              <RevisionDetail entry={detailEntry} target={target} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function GraphView() {
  const wc = useSelectedWc();
  if (!wc) return <NeedWorkingCopy />;
  return <Graph_ key={wc.path} wc={wc} />;
}
