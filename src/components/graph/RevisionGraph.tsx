/**
 * Renderizador do grafo de revisões (aba "Gráfico"): mapa de metrô do projeto.
 *
 * O trunk é a linha verde na coluna 0; cada branch é uma linha roxa que nasce
 * numa cópia (curva de fork), corre na própria coluna e termina no ✕ vermelho
 * quando a raiz é deletada. Setas com gradiente ligam as linhas nos merges —
 * verde→roxo é sync (trunk → branch), roxo→verde é reintegração. O SVG é
 * puramente decorativo (pointer-events off); toda interação vive nas rows
 * HTML alinhadas por altura fixa, o que mantém o desenho determinístico para
 * os screenshots do e2e.
 */

import { useMemo } from "react";
import { GitMerge } from "lucide-react";

import type { GraphLane, GraphLink, GraphModel, GraphRow } from "@/lib/graph";
import { cn, formatAbsolute, formatRelative } from "@/lib/utils";

const ROW_H = 30;
const COL_W = 18;
const PAD_X = 14;
const NODE_R = 4;

/**
 * Paleta de branches: variações do roxo da marca misturadas em oklab com
 * outros tokens do tema — segue o tema claro/escuro sem rebuild.
 */
const BRANCH_COLORS = [
  "var(--color-branch)",
  "color-mix(in oklab, var(--color-branch) 55%, var(--color-info))",
  "color-mix(in oklab, var(--color-branch) 55%, var(--color-del))",
  "color-mix(in oklab, var(--color-brand) 80%, var(--color-ink))",
  "color-mix(in oklab, var(--color-branch) 72%, var(--color-ink))",
  "color-mix(in oklab, var(--color-info) 55%, var(--color-branch))",
];

const laneColor = (lane: GraphLane) =>
  lane.kind === "trunk"
    ? "var(--color-trunk)"
    : BRANCH_COLORS[lane.colorIndex % BRANCH_COLORS.length];

const rowLabel = (link: GraphLink) =>
  link.kind === "sync" ? "sync" : link.kind === "reintegrate" ? "reintegração" : "merge";

export function RevisionGraph({
  model,
  selectedRev,
  onSelect,
  focusLaneId,
  onFocusLane,
}: {
  model: GraphModel;
  selectedRev: number | null;
  /** Clique numa revisão (a mesma revisão de novo = desselecionar). */
  onSelect: (row: GraphRow | null) => void;
  focusLaneId: string | null;
  onFocusLane: (id: string | null) => void;
}) {
  const { rows, lanes, links } = model;
  const gutterWidth = PAD_X * 2 + Math.max(model.columnCount, 2) * COL_W;
  const height = rows.length * ROW_H;
  const x = (col: number) => PAD_X + col * COL_W + COL_W / 2;
  const y = (row: number) => row * ROW_H + ROW_H / 2;

  const laneById = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);

  // Chip com o nome da lane na sua primeira row própria (a mais recente).
  const chipsByRow = useMemo(() => {
    const m = new Map<number, GraphLane[]>();
    for (const lane of lanes) {
      const at = rows.findIndex((r) => r.laneId === lane.id);
      if (at >= 0) (m.get(at) ?? m.set(at, []).get(at)!).push(lane);
    }
    return m;
  }, [lanes, rows]);

  // Pills de chegada de merge (sync/reintegração) na row que recebe.
  const arrivalsByRow = useMemo(() => {
    const m = new Map<number, GraphLink[]>();
    for (const l of links) {
      if (l.kind === "fork") continue;
      (m.get(l.toRow) ?? m.set(l.toRow, []).get(l.toRow)!).push(l);
    }
    return m;
  }, [links]);

  const dimLane = (id: string) => focusLaneId != null && id !== focusLaneId;
  const dimLink = (l: GraphLink) =>
    focusLaneId != null && l.fromLaneId !== focusLaneId && l.toLaneId !== focusLaneId;

  /** Curva cúbica vertical entre dois nós (transição suave entre colunas). */
  const curve = (xf: number, yf: number, xt: number, yt: number) => {
    const v = Math.min(Math.max((yf - yt) * 0.35, ROW_H * 0.55), ROW_H * 2.4);
    return `M ${xf} ${yf} C ${xf} ${yf - v}, ${xt} ${yt + v}, ${xt} ${yt}`;
  };

  return (
    <div className="relative" style={{ minWidth: gutterWidth + 420 }}>
      {rows.map((row, i) => {
        const selected = selectedRev === row.entry.revision;
        const dim = dimLane(row.laneId);
        const firstLine = row.entry.message.split("\n")[0] || "(sem mensagem)";
        const chips = chipsByRow.get(i) ?? [];
        const arrivals = arrivalsByRow.get(i) ?? [];
        return (
          <div
            key={row.entry.revision}
            onClick={() => onSelect(selected ? null : row)}
            className={cn(
              "flex cursor-pointer items-center gap-2 pr-4 transition-colors",
              selected ? "bg-panel-3" : "hover:bg-panel-2",
              dim && "opacity-35",
            )}
            style={{ height: ROW_H, paddingLeft: gutterWidth }}
          >
            {chips.map((chip) => {
              const color = laneColor(chip);
              const focused = focusLaneId === chip.id;
              return (
                <button
                  key={chip.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFocusLane(focused ? null : chip.id);
                  }}
                  title={
                    (chip.alive ? "" : "branch removida — ") +
                    chip.id +
                    " (clique para focar a linha)"
                  }
                  className={cn(
                    "shrink-0 rounded-full border px-1.5 py-px font-mono text-[10px] leading-4 transition-shadow",
                    !chip.alive && "line-through opacity-70",
                  )}
                  style={{
                    color,
                    borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
                    background: `color-mix(in oklab, ${color} ${focused ? 26 : 12}%, transparent)`,
                  }}
                >
                  {chip.name}
                </button>
              );
            })}
            {row.isMerge && <GitMerge className="size-3 shrink-0 text-muted" />}
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{firstLine}</span>
            {arrivals.map((l, k) => {
              const from = laneById.get(l.fromLaneId);
              const color = from ? laneColor(from) : "var(--color-muted)";
              return (
                <span
                  key={k}
                  title={`${rowLabel(l)} — última revisão absorvida: r${l.sourceRev ?? "?"}`}
                  className="shrink-0 rounded-full border px-1.5 py-px text-[10px] leading-4"
                  style={{
                    color,
                    borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
                    background: `color-mix(in oklab, ${color} 10%, transparent)`,
                  }}
                >
                  {rowLabel(l)}
                  {l.sourceRev != null && (
                    <span className="opacity-75"> ← r{l.sourceRev}</span>
                  )}
                </span>
              );
            })}
            <span className="w-28 shrink-0 truncate text-right text-[12px] text-muted">
              {row.entry.author}
            </span>
            <span
              className="w-20 shrink-0 text-right text-[11px] text-faint"
              title={formatAbsolute(row.entry.date)}
            >
              {formatRelative(row.entry.date)}
            </span>
            <span className="w-14 shrink-0 text-right font-mono text-[11px] text-brand">
              r{row.entry.revision}
            </span>
          </div>
        );
      })}

      {/* Desenho por cima das rows (os cliques atravessam). */}
      <svg
        className="pointer-events-none absolute left-0 top-0"
        width={gutterWidth}
        height={height}
        aria-hidden
      >
        <defs>
          {links.map((l, i) => {
            const from = laneById.get(l.fromLaneId);
            const to = laneById.get(l.toLaneId);
            if (!from || !to) return null;
            const yf = l.offWindow ? height : y(l.fromRow);
            return (
              <linearGradient
                key={i}
                id={`sv-graph-link-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={x(l.fromColumn)}
                y1={yf}
                x2={x(l.toColumn)}
                y2={y(l.toRow)}
              >
                <stop offset="0%" style={{ stopColor: laneColor(from) }} />
                <stop offset="100%" style={{ stopColor: laneColor(to) }} />
              </linearGradient>
            );
          })}
        </defs>

        {/* Linhas verticais das lanes */}
        {lanes.map((lane) => {
          const color = laneColor(lane);
          const x0 = x(lane.column);
          return (
            <g key={lane.id} opacity={dimLane(lane.id) ? 0.15 : 1}>
              {lane.bottomRow > lane.topRow && (
                <line
                  x1={x0}
                  y1={y(lane.topRow)}
                  x2={x0}
                  y2={y(lane.bottomRow)}
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              )}
              {lane.openBottom && (
                <line
                  x1={x0}
                  y1={y(lane.bottomRow)}
                  x2={x0}
                  y2={Math.min(y(lane.bottomRow) + ROW_H * 0.8, height)}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray="2 4"
                  strokeLinecap="round"
                  opacity={0.4}
                />
              )}
            </g>
          );
        })}

        {/* Forks e merges (curvas com gradiente entre as cores das lanes) */}
        {links.map((l, i) => {
          const from = laneById.get(l.fromLaneId);
          const to = laneById.get(l.toLaneId);
          if (!from || !to) return null;
          const xf = x(l.fromColumn);
          const xt = x(l.toColumn);
          const yf = l.offWindow ? height : y(l.fromRow);
          const yt = y(l.toRow);
          const isMergeArrow = l.kind !== "fork";
          return (
            <g key={i} opacity={dimLink(l) ? 0.12 : l.offWindow ? 0.5 : 0.95}>
              <path
                d={curve(xf, yf, xt, isMergeArrow ? yt + NODE_R + 2 : yt)}
                fill="none"
                stroke={`url(#sv-graph-link-${i})`}
                strokeWidth={2}
                strokeDasharray={l.offWindow ? "3 3" : undefined}
                strokeLinecap="round"
              />
              {isMergeArrow && (
                <path
                  d={`M ${xt - 3.2} ${yt + NODE_R + 5.5} L ${xt} ${yt + NODE_R + 0.5} L ${xt + 3.2} ${yt + NODE_R + 5.5} Z`}
                  fill={laneColor(to)}
                />
              )}
            </g>
          );
        })}

        {/* Nós */}
        {rows.map((row, i) => {
          const lane = laneById.get(row.laneId);
          if (!lane) return null;
          const color = laneColor(lane);
          const cx = x(row.column);
          const cy = y(i);
          const selected = selectedRev === row.entry.revision;
          const isDeletion = lane.deletedRow === i;
          return (
            <g key={row.entry.revision} opacity={dimLane(row.laneId) ? 0.15 : 1}>
              {selected && <circle cx={cx} cy={cy} r={9} fill={color} opacity={0.22} />}
              {isDeletion ? (
                // Raiz do branch deletada: a linha termina num ✕.
                <g stroke="var(--color-del)" strokeWidth={2} strokeLinecap="round">
                  <line x1={cx - 3.5} y1={cy - 3.5} x2={cx + 3.5} y2={cy + 3.5} />
                  <line x1={cx - 3.5} y1={cy + 3.5} x2={cx + 3.5} y2={cy - 3.5} />
                </g>
              ) : row.isMerge ? (
                // Commit de merge: anel (donut).
                <circle
                  cx={cx}
                  cy={cy}
                  r={NODE_R + 0.5}
                  fill="var(--color-panel)"
                  stroke={color}
                  strokeWidth={2.5}
                />
              ) : (
                <circle
                  cx={cx}
                  cy={cy}
                  r={NODE_R}
                  fill={color}
                  stroke="var(--color-panel)"
                  strokeWidth={1.5}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
