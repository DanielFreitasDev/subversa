/**
 * SPIKE (experimental) — bloco do editor de conflitos no estilo IntelliJ.
 *
 * Renderiza uma região do `diff3` em CINCO colunas do grid do `MergeEditor`:
 *   [ LOCAL ] [ calha » ] [ RESULTADO ] [ calha « ] [ SERVIDOR ]
 *
 * Espelha o merge do IntelliJ nos detalhes: cor por TIPO de mudança (verde =
 * adicionado, azul = modificado, vermelho = conflito — igual nos dois lados),
 * fundo de linha inteira (claro) + realce por palavra (escuro), FAIXAS curvas
 * ligando cada bloco ao resultado e setas `»`/`«` limpas na calha para aplicar
 * um lado. O centro mostra o conteúdo de verdade (a base, em conflito pendente),
 * nunca um texto no lugar do código. Só apresentação — a lógica vive no
 * `MergeEditor`.
 */

import { Suspense, lazy } from "react";
import { ChevronsLeft, ChevronsRight, Combine, Eraser, Pencil } from "lucide-react";

import type { Span } from "@/components/diff/highlight";
import type { MergeRegion, RegionKind } from "@/lib/merge3";
import { cn } from "@/lib/utils";

import type { Choice } from "./MergeBlock";

const CmEditor = lazy(() => import("@/components/editor/CmEditor"));

/** Altura de uma linha de código em px — precisa casar com `leading-[20px]`. */
const LH = 20;

/** Tipo de mudança (legenda do IntelliJ) → cor (variável de tema). */
type Change = "added" | "deleted" | "modified" | "conflict";
const CHANGE_VAR: Record<Change, string> = {
  added: "--color-add", // verde
  deleted: "--color-del", // vermelho apagado
  modified: "--color-info", // azul
  conflict: "--color-conflict", // vermelho conflito
};

const tint = (v: string, pct: number) => `color-mix(in oklab, var(${v}) ${pct}%, transparent)`;

function leftChanged(k: RegionKind) {
  return k === "left" || k === "both" || k === "conflict";
}
function rightChanged(k: RegionKind) {
  return k === "right" || k === "both" || k === "conflict";
}

/** Tipo cru da mudança de um lado vs. base (sem considerar conflito). */
function rawChange(baseLen: number, sideLen: number): Change {
  if (baseLen === 0) return "added";
  if (sideLen === 0) return "deleted";
  return "modified";
}

/** Linhas de código: fundo da linha (claro) + realce por palavra (escuro) + números. */
function CodeLines({
  lines,
  spans,
  startNo,
  muted,
  change,
}: {
  lines: string[];
  spans: (Span[] | null)[];
  startNo: number | null;
  muted?: boolean;
  change?: Change | null;
}) {
  if (lines.length === 0) return null;
  const lineBg = change ? tint(CHANGE_VAR[change], 12) : undefined;
  const wordBg = change ? tint(CHANGE_VAR[change], 30) : undefined;
  return (
    <div className="overflow-x-auto">
      {lines.map((line, i) => {
        const s = spans[i];
        return (
          <div
            key={i}
            className={cn("flex font-mono text-[12px] leading-[20px]", muted && "opacity-45")}
            style={{ background: lineBg }}
          >
            {startNo !== null && (
              <span className="sticky left-0 w-9 shrink-0 select-none bg-inherit pr-2 text-right text-faint/50">
                {startNo + i}
              </span>
            )}
            <span className="whitespace-pre pl-1 pr-3">
              {s && s.length > 0
                ? s.map((sp, j) => (
                    <span
                      key={j}
                      className={sp.className || undefined}
                      style={sp.changed && wordBg ? { background: wordBg, borderRadius: "2px" } : undefined}
                    >
                      {sp.text}
                    </span>
                  ))
                : line === ""
                  ? "​"
                  : line}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Faixa curva (bezier) ligando um bloco lateral ao resultado, como no IntelliJ. */
function Ribbon({
  change,
  sideH,
  centerH,
  dir,
  rowH,
}: {
  change: Change;
  sideH: number;
  centerH: number;
  /** "toCenter" = lado(esq)→centro(dir); "fromCenter" = centro(esq)→lado(dir). */
  dir: "toCenter" | "fromCenter";
  rowH: number;
}) {
  const v = CHANGE_VAR[change];
  const s = Math.max(sideH, 2);
  const c = Math.max(centerH, 2);
  const W = 100;
  // Topo reto (blocos alinhados no topo da linha do grid); base em curva suave.
  const d =
    dir === "toCenter"
      ? `M0,0 L${W},0 L${W},${c} C${W * 0.5},${c} ${W * 0.5},${s} 0,${s} Z`
      : `M0,0 L${W},0 L${W},${s} C${W * 0.5},${s} ${W * 0.5},${c} 0,${c} Z`;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${W} ${rowH}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d={d}
        style={{ fill: tint(v, 16), stroke: tint(v, 52) }}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Seta de aplicar um lado (glifo limpo, sem caixa; cor do tipo de mudança). */
function AcceptArrow({
  dir,
  change,
  active,
  onClick,
  title,
}: {
  dir: "right" | "left";
  change: Change;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  const v = CHANGE_VAR[change];
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className="relative z-10 flex h-5 w-6 items-center justify-center rounded transition-colors hover:brightness-125"
      style={{ color: `var(${v})`, background: active ? tint(v, 22) : "transparent" }}
    >
      {dir === "right" ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
    </button>
  );
}

/** Ação do canto do centro (juntar / editar / descartar) — ícone limpo. */
function CornerBtn({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className={cn(
        "flex size-5 items-center justify-center rounded text-faint transition-colors hover:bg-panel-3 hover:text-ink",
        active && "bg-brand/20 text-brand",
      )}
    >
      {children}
    </button>
  );
}

export interface Meld3BlockProps {
  region: MergeRegion;
  path: string;
  isDark: boolean;
  domId?: string;
  leftSpans: (Span[] | null)[];
  rightSpans: (Span[] | null)[];
  centerLines: string[];
  centerSpans: (Span[] | null)[];
  leftNo: number;
  rightNo: number;
  centerNo: number;
  activeChoice: Choice | undefined;
  active: boolean;
  editing: boolean;
  draft: string;
  onChoose: (choice: Choice) => void;
  onStartEdit: () => void;
  onDraftChange: (text: string) => void;
  onActivate: () => void;
}

export function Meld3Block({
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
  centerNo,
  activeChoice,
  active,
  editing,
  draft,
  onChoose,
  onStartEdit,
  onDraftChange,
  onActivate,
}: Meld3BlockProps) {
  const { kind } = region;
  const stable = kind === "stable";
  const pending = kind === "conflict" && activeChoice === undefined;

  const lRaw = leftChanged(kind) ? rawChange(region.base.length, region.mine.length) : null;
  const rRaw = rightChanged(kind) ? rawChange(region.base.length, region.theirs.length) : null;
  // Vermelho só enquanto o conflito está PENDENTE; resolvido, cada lado mostra seu tipo.
  const lChange: Change | null = pending ? "conflict" : lRaw;
  const rChange: Change | null = pending ? "conflict" : rRaw;

  // Alturas dos blocos (px) para as faixas. Conflito pendente: o centro mostra a
  // base (ou vazio) com a altura do maior lado, para as faixas convergirem limpas.
  const mineH = region.mine.length * LH;
  const theirsH = region.theirs.length * LH;
  const baseH = region.base.length * LH;
  const centerH = pending ? Math.max(mineH, theirsH, baseH, LH) : centerLines.length * LH;
  const rowH = Math.max(mineH, theirsH, centerH, LH);

  // Cor do resultado conforme a decisão (tipo cru do lado escolhido; nunca vermelho
  // depois de resolvido).
  const centerChange: Change | null = pending
    ? "conflict"
    : activeChoice === "left"
      ? lRaw
      : activeChoice === "right"
        ? rRaw
        : activeChoice === "both"
          ? (lRaw ?? rRaw ?? "modified")
          : null;

  // Fade do resolvido: acalma (esmaece) o lado não escolhido de um conflito resolvido.
  const resolvedConflict = kind === "conflict" && !pending;
  const mineMuted = stable || (resolvedConflict && activeChoice !== "left" && activeChoice !== "both");
  const theirsMuted = stable || (resolvedConflict && activeChoice !== "right" && activeChoice !== "both");

  const border = (v: string) => ({ background: tint(v, 55) });

  return (
    <>
      {/* LOCAL (meu) */}
      <div className="relative min-w-0 border-t border-line/40" onClick={onActivate}>
        {lChange && <span className="absolute inset-y-0 left-0 w-0.5" style={border(CHANGE_VAR[lChange])} aria-hidden />}
        <CodeLines lines={region.mine} spans={leftSpans} startNo={leftNo} muted={mineMuted} change={lChange} />
      </div>

      {/* CALHA ESQUERDA: faixa curva + seta » (aplicar meu) */}
      <div className="relative border-t border-line/40" onClick={onActivate}>
        {lChange && <Ribbon change={lChange} sideH={mineH} centerH={centerH} dir="toCenter" rowH={rowH} />}
        {leftChanged(kind) && lChange && (
          <div className="absolute right-0 top-0 z-10">
            <AcceptArrow
              dir="right"
              change={lChange}
              active={activeChoice === "left"}
              onClick={() => onChoose("left")}
              title="Aplicar minha versão (m)"
            />
          </div>
        )}
      </div>

      {/* RESULTADO (centro, editável) */}
      <div
        id={domId}
        className="group/center relative min-w-0 scroll-mt-16 border-x border-line/70 border-t border-t-line/40"
        onClick={onActivate}
      >
        {active && <span className="pointer-events-none absolute inset-0 z-0 ring-1 ring-inset ring-brand/40" aria-hidden />}

        {/* Ações de canto (hover): juntar / editar / descartar. */}
        {!stable && !editing && (
          <div className="absolute right-1 top-0.5 z-20 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/center:opacity-100">
            {kind === "conflict" && (
              <CornerBtn onClick={() => onChoose("both")} title="Juntar os dois (b)" active={activeChoice === "both"}>
                <Combine className="size-3.5" />
              </CornerBtn>
            )}
            <CornerBtn onClick={onStartEdit} title="Editar à mão" active={activeChoice === "custom"}>
              <Pencil className="size-3.5" />
            </CornerBtn>
            <CornerBtn onClick={() => onChoose("base")} title="Descartar (manter ancestral)" active={activeChoice === "base"}>
              <Eraser className="size-3.5" />
            </CornerBtn>
          </div>
        )}

        {editing ? (
          <div className="border-y border-brand/40 bg-panel" onClick={(e) => e.stopPropagation()}>
            <Suspense fallback={<div className="px-3 py-2 text-[11px] text-faint">Carregando editor…</div>}>
              <CmEditor value={draft} onChange={onDraftChange} path={path} isDark={isDark} inline maxHeight="40vh" />
            </Suspense>
          </div>
        ) : pending ? (
          region.base.length > 0 ? (
            // Conflito pendente: mostra a base (ancestral) em vermelho, sem números.
            <CodeLines lines={region.base} spans={region.base.map(() => null)} startNo={null} muted change="conflict" />
          ) : (
            <div style={{ height: centerH, background: tint(CHANGE_VAR.conflict, 12) }} />
          )
        ) : (
          <CodeLines lines={centerLines} spans={centerSpans} startNo={centerNo} muted={stable} change={centerChange} />
        )}
      </div>

      {/* CALHA DIREITA: faixa curva + seta « (aplicar servidor) */}
      <div className="relative border-t border-line/40" onClick={onActivate}>
        {rChange && <Ribbon change={rChange} sideH={theirsH} centerH={centerH} dir="fromCenter" rowH={rowH} />}
        {rightChanged(kind) && rChange && (
          <div className="absolute left-0 top-0 z-10">
            <AcceptArrow
              dir="left"
              change={rChange}
              active={activeChoice === "right"}
              onClick={() => onChoose("right")}
              title="Aplicar versão do servidor (s)"
            />
          </div>
        )}
      </div>

      {/* SERVIDOR (deles) */}
      <div className="relative min-w-0 border-t border-line/40" onClick={onActivate}>
        {rChange && <span className="absolute inset-y-0 right-0 w-0.5" style={border(CHANGE_VAR[rChange])} aria-hidden />}
        <CodeLines lines={region.theirs} spans={rightSpans} startNo={rightNo} muted={theirsMuted} change={rChange} />
      </div>
    </>
  );
}
