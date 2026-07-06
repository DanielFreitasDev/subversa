/**
 * Um bloco (região) do editor de conflitos, renderizado como três células
 * alinhadas dentro do grid de 3 colunas do `MergeEditor`: LOCAL (meu) │ RESULTADO
 * (centro, editável) │ SERVIDOR (deles). Componente apenas de apresentação — toda
 * a lógica de resolução vive no `MergeEditor`.
 */

import { Suspense, lazy } from "react";
import { ArrowLeftToLine, ArrowRightToLine, Combine, Eraser, Pencil } from "lucide-react";

import type { Span } from "@/components/diff/highlight";
import type { MergeRegion, RegionKind } from "@/lib/merge3";
import { cn } from "@/lib/utils";

// Editor inline (CodeMirror) sob demanda — só baixa quando o usuário edita um trecho.
const CmEditor = lazy(() => import("@/components/editor/CmEditor"));

/** Decisão do usuário para uma região (sobre qual conteúdo vai pro resultado). */
export type Choice = "left" | "right" | "both" | "base" | "custom";

/** Tom de fundo por papel da célula. */
const TINT: Record<"mine" | "theirs" | "both" | "conflict", string> = {
  mine: "bg-mod/10",
  theirs: "bg-info/10",
  both: "bg-add/10",
  conflict: "bg-conflict/10",
};

function leftChanged(kind: RegionKind): boolean {
  return kind === "left" || kind === "both" || kind === "conflict";
}
function rightChanged(kind: RegionKind): boolean {
  return kind === "right" || kind === "both" || kind === "conflict";
}

/** Renderiza linhas de código com realce de sintaxe (spans) e número de linha. */
function CodeLines({
  lines,
  spans,
  startNo,
  className,
}: {
  lines: string[];
  spans: (Span[] | null)[];
  /** Número da 1ª linha (1-based) para a calha; `null` esconde os números. */
  startNo: number | null;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 overflow-x-auto py-0.5", className)}>
      {lines.length === 0 ? (
        <div className="select-none px-3 font-mono text-[12px] leading-[1.65] text-faint">
          &#8203;
        </div>
      ) : (
        lines.map((line, i) => {
          const s = spans[i];
          return (
            <div key={i} className="flex font-mono text-[12px] leading-[1.65]">
              {startNo !== null && (
                <span className="sticky left-0 w-9 shrink-0 select-none bg-inherit pr-2 text-right text-faint/70">
                  {startNo + i}
                </span>
              )}
              <span className="whitespace-pre pl-1">
                {s && s.length > 0
                  ? s.map((sp, j) => (
                      <span key={j} className={sp.className || undefined}>
                        {sp.text}
                      </span>
                    ))
                  : line === ""
                    ? "​"
                    : line}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

/** Botão de ação da calha do bloco (escolher lado / editar / descartar). */
function ActionButton({
  active,
  onClick,
  icon,
  label,
  tone = "neutral",
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone?: "mine" | "theirs" | "both" | "neutral";
}) {
  const toneRing =
    tone === "mine"
      ? "text-mod"
      : tone === "theirs"
        ? "text-info"
        : tone === "both"
          ? "text-add"
          : "text-muted";
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-medium transition-colors",
        active
          ? "border-brand/40 bg-brand/15 text-ink"
          : cn("border-line bg-panel-2 hover:bg-panel-3", toneRing),
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export interface MergeBlockProps {
  region: MergeRegion;
  /** Caminho do arquivo (define a linguagem do editor inline). */
  path: string;
  /** Tema escuro? (para o editor inline). */
  isDark: boolean;
  /** Id DOM aplicado à célula central (para rolar até a região). */
  domId?: string;
  /** Linhas de cada coluna, já fatiadas, com seus spans de sintaxe. */
  leftSpans: (Span[] | null)[];
  rightSpans: (Span[] | null)[];
  centerLines: string[];
  centerSpans: (Span[] | null)[];
  /** Números da 1ª linha de cada coluna (1-based), para a calha. */
  leftNo: number;
  rightNo: number;
  /** Decisão ativa (qual botão destacar); `undefined` = conflito pendente. */
  activeChoice: Choice | undefined;
  active: boolean;
  editing: boolean;
  draft: string;
  onChoose: (choice: Choice) => void;
  onStartEdit: () => void;
  onDraftChange: (text: string) => void;
  onActivate: () => void;
}

export function MergeBlock({
  region,
  path,
  isDark,
  domId,
  leftSpans,
  rightSpans,
  centerLines,
  centerSpans,
  leftNo,
  rightNo,
  activeChoice,
  active,
  editing,
  draft,
  onChoose,
  onStartEdit,
  onDraftChange,
  onActivate,
}: MergeBlockProps) {
  const { kind } = region;
  const stable = kind === "stable";
  const pending = kind === "conflict" && activeChoice === undefined;

  const cellBase = "border-t border-line/60 px-0";
  const leftTint = leftChanged(kind) ? (kind === "both" ? TINT.both : TINT.mine) : "";
  const rightTint = rightChanged(kind) ? (kind === "both" ? TINT.both : TINT.theirs) : "";
  const centerTint = pending
    ? TINT.conflict
    : stable
      ? ""
      : activeChoice === "left"
        ? TINT.mine
        : activeChoice === "right"
          ? TINT.theirs
          : activeChoice === "both"
            ? TINT.both
            : "";

  // Calha de ações do centro (só em regiões não-estáveis).
  const actions = !stable && (
    <div className="flex flex-wrap items-center gap-1 px-2 pt-1.5 pb-1">
      {pending && (
        <span className="mr-0.5 inline-flex size-1.5 rounded-full bg-conflict" aria-hidden />
      )}
      {(kind === "conflict" || kind === "left" || kind === "both") && (
        <ActionButton
          tone="mine"
          active={activeChoice === "left"}
          onClick={() => onChoose("left")}
          icon={<ArrowLeftToLine className="size-3" />}
          label="Meu"
        />
      )}
      {kind === "conflict" && (
        <ActionButton
          tone="both"
          active={activeChoice === "both"}
          onClick={() => onChoose("both")}
          icon={<Combine className="size-3" />}
          label="Ambos"
        />
      )}
      {(kind === "conflict" || kind === "right") && (
        <ActionButton
          tone="theirs"
          active={activeChoice === "right"}
          onClick={() => onChoose("right")}
          icon={<ArrowRightToLine className="size-3" />}
          label="Servidor"
        />
      )}
      <ActionButton
        active={activeChoice === "base"}
        onClick={() => onChoose("base")}
        icon={<Eraser className="size-3" />}
        label="Descartar"
      />
      <ActionButton
        active={editing || activeChoice === "custom"}
        onClick={onStartEdit}
        icon={<Pencil className="size-3" />}
        label="Editar"
      />
    </div>
  );

  return (
    <>
      {/* LOCAL (meu) */}
      <div className={cn(cellBase, leftTint)} onClick={onActivate}>
        <CodeLines lines={region.mine} spans={leftSpans} startNo={leftNo} />
      </div>

      {/* RESULTADO (centro, editável) */}
      <div
        id={domId}
        className={cn(
          cellBase,
          "border-x border-line scroll-mt-16",
          centerTint,
          active && "ring-1 ring-inset ring-brand/40",
        )}
        onClick={onActivate}
      >
        {actions}
        {editing ? (
          <div
            className="border-y border-brand/40 bg-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <Suspense
              fallback={<div className="px-3 py-2 text-[11px] text-faint">Carregando editor…</div>}
            >
              <CmEditor
                value={draft}
                onChange={onDraftChange}
                path={path}
                isDark={isDark}
                inline
                maxHeight="40vh"
              />
            </Suspense>
          </div>
        ) : pending ? (
          <div className="px-3 py-2 text-[11.5px] text-conflict">
            Conflito — escolha um lado, junte (Ambos) ou edite.
          </div>
        ) : (
          <CodeLines lines={centerLines} spans={centerSpans} startNo={null} />
        )}
      </div>

      {/* SERVIDOR (deles) */}
      <div className={cn(cellBase, rightTint)} onClick={onActivate}>
        <CodeLines lines={region.theirs} spans={rightSpans} startNo={rightNo} />
      </div>
    </>
  );
}
