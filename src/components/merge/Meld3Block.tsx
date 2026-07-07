/**
 * SPIKE (experimental) — bloco do editor de conflitos no estilo IntelliJ.
 *
 * Calibrado a partir da fonte do IntelliJ (JetBrains/intellij-community):
 *  - Cores exatas do Darcula/Default (DefaultColorSchemesManager.xml) por TIPO de
 *    mudança: adicionado (verde), modificado (azul), apagado (cinza), conflito
 *    (vermelho) — iguais nos dois lados.
 *  - Regra `ignored = innerFragments != null` (DiffDrawUtil): linha modificada
 *    esmaece para `mix(60% cor + 40% fundo)` e as PALAVRAS ficam na cor cheia;
 *    inserção pura fica cheia (bloco sólido).
 *  - Faixas em bezier cúbica com tangentes horizontais, controle a 30%/70% da
 *    largura (`CTRL_PROXIMITY_X=0.3`, DiffDrawUtil#makeCurve). Resolvido = borda
 *    pontilhada (PaintMode.RESOLVED → BorderType.DOTTED).
 *  - Setas de aplicar neutras na calha (AllIcons.Diff.Arrow*), realçadas no hover.
 *
 * Renderiza uma região do `diff3` em 5 colunas do grid do `MergeEditor`:
 *   [ LOCAL ] [ calha » ] [ RESULTADO ] [ calha « ] [ SERVIDOR ]
 * Só apresentação — a lógica (escolha/edição/resolve) vive no `MergeEditor`.
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

/** Tipo de mudança (legenda do IntelliJ). */
type Change = "added" | "deleted" | "modified" | "conflict";

interface DiffColor {
  /** Fundo cheio (BACKGROUND do esquema) — palavras alteradas e blocos sólidos. */
  bg: string;
  /** Cor da faixa/stripe (ERROR_STRIPE_COLOR) — borda das faixas. */
  stripe: string;
}

// Valores exatos de DefaultColorSchemesManager.xml (Darcula e Default/claro).
const DIFF_DARK: Record<Change, DiffColor> = {
  added: { bg: "#294436", stripe: "#447152" },
  modified: { bg: "#385570", stripe: "#43698D" },
  deleted: { bg: "#484A4A", stripe: "#656E76" },
  conflict: { bg: "#45302B", stripe: "#8F5247" },
};
const DIFF_LIGHT: Record<Change, DiffColor> = {
  added: { bg: "#BEE6BE", stripe: "#AADEAA" },
  modified: { bg: "#CAD9FA", stripe: "#B8CBF5" },
  deleted: { bg: "#D6D6D6", stripe: "#C8C8C8" },
  conflict: { bg: "#FFD5CC", stripe: "#FFC8BD" },
};
const palette = (isDark: boolean) => (isDark ? DIFF_DARK : DIFF_LIGHT);

/** Linha "modificada" esmaece: mix(60% cor + 40% fundo do editor) — MIDDLE_COLOR_FACTOR. */
const mutedBg = (full: string) => `color-mix(in srgb, ${full} 60%, var(--color-panel))`;

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

/** Fundos de linha e de palavra de um tipo de mudança (regra `ignored`). */
function bgFor(change: Change | null, isDark: boolean): { line?: string; word?: string } {
  if (!change) return {};
  const full = palette(isDark)[change].bg;
  // Inserção/remoção pura = bloco cheio; modificado/conflito = linha esmaecida + palavra cheia.
  const solid = change === "added" || change === "deleted";
  return { line: solid ? full : mutedBg(full), word: full };
}

/** Linhas de código: fundo da linha + realce por palavra (na cor cheia) + números. */
function CodeLines({
  lines,
  spans,
  startNo,
  muted,
  lineBg,
  wordBg,
}: {
  lines: string[];
  spans: (Span[] | null)[];
  startNo: number | null;
  muted?: boolean;
  lineBg?: string;
  wordBg?: string;
}) {
  if (lines.length === 0) return null;
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

/**
 * Faixa curva ligando um bloco lateral ao resultado. Bezier cúbica com tangentes
 * horizontais nas duas pontas (controle a 30%/70% da largura), como o IntelliJ.
 */
function Ribbon({
  color,
  sideH,
  centerH,
  dir,
  rowH,
  dotted,
}: {
  color: DiffColor;
  sideH: number;
  centerH: number;
  /** "toCenter" = lado(esq)→centro(dir); "fromCenter" = centro(esq)→lado(dir). */
  dir: "toCenter" | "fromCenter";
  rowH: number;
  dotted?: boolean;
}) {
  const s = Math.max(sideH, 2);
  const c = Math.max(centerH, 2);
  // Espaço do path 0..100 em x (o SVG estica até a largura da calha). Topo reto
  // (blocos alinhados no topo da linha do grid); base em bezier 30/70.
  const d =
    dir === "toCenter"
      ? `M0,0 C30,0 70,0 100,0 L100,${c} C70,${c} 30,${s} 0,${s} Z`
      : `M0,0 C30,0 70,0 100,0 L100,${s} C70,${s} 30,${c} 0,${c} Z`;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 100 ${rowH}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d={d}
        style={{
          fill: `color-mix(in srgb, ${color.bg} 90%, transparent)`,
          stroke: color.stripe,
          strokeDasharray: dotted ? "2 2" : undefined,
        }}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Seta de aplicar um lado — ícone neutro (cinza), realçado no hover (IntelliJ). */
function AcceptArrow({
  dir,
  active,
  onClick,
  title,
}: {
  dir: "right" | "left";
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className={cn(
        "relative z-10 flex h-5 w-6 items-center justify-center rounded transition-colors hover:bg-panel-2 hover:text-ink",
        active ? "bg-panel-2 text-ink" : "text-faint/70",
      )}
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
  const C = palette(isDark);

  const lRaw = leftChanged(kind) ? rawChange(region.base.length, region.mine.length) : null;
  const rRaw = rightChanged(kind) ? rawChange(region.base.length, region.theirs.length) : null;
  // Vermelho só enquanto o conflito está PENDENTE; resolvido, cada lado mostra seu tipo.
  const lChange: Change | null = pending ? "conflict" : lRaw;
  const rChange: Change | null = pending ? "conflict" : rRaw;

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

  // Fade do resolvido: esmaece o lado não escolhido de um conflito resolvido; a
  // faixa de um conflito resolvido fica pontilhada (PaintMode.RESOLVED).
  const resolvedConflict = kind === "conflict" && !pending;
  const mineMuted = stable || (resolvedConflict && activeChoice !== "left" && activeChoice !== "both");
  const theirsMuted = stable || (resolvedConflict && activeChoice !== "right" && activeChoice !== "both");

  const lBg = bgFor(lChange, isDark);
  const rBg = bgFor(rChange, isDark);
  const cBg = bgFor(centerChange, isDark);

  return (
    <>
      {/* LOCAL (meu) */}
      <div className="relative min-w-0 border-t border-line/40" onClick={onActivate}>
        <CodeLines lines={region.mine} spans={leftSpans} startNo={leftNo} muted={mineMuted} lineBg={lBg.line} wordBg={lBg.word} />
      </div>

      {/* CALHA ESQUERDA: faixa curva + seta » (aplicar meu) */}
      <div className="relative border-t border-line/40" onClick={onActivate}>
        {lChange && (
          <Ribbon color={C[lChange]} sideH={mineH} centerH={centerH} dir="toCenter" rowH={rowH} dotted={resolvedConflict} />
        )}
        {leftChanged(kind) && (
          <div className="absolute left-0 top-0 z-10">
            <AcceptArrow
              dir="right"
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
            // Conflito pendente: mostra a base (ancestral) esmaecida em vermelho.
            <CodeLines
              lines={region.base}
              spans={region.base.map(() => null)}
              startNo={null}
              muted
              lineBg={mutedBg(C.conflict.bg)}
            />
          ) : (
            <div style={{ height: centerH, background: mutedBg(C.conflict.bg) }} />
          )
        ) : (
          <CodeLines lines={centerLines} spans={centerSpans} startNo={centerNo} muted={stable} lineBg={cBg.line} wordBg={cBg.word} />
        )}
      </div>

      {/* CALHA DIREITA: faixa curva + seta « (aplicar servidor) */}
      <div className="relative border-t border-line/40" onClick={onActivate}>
        {rChange && (
          <Ribbon color={C[rChange]} sideH={theirsH} centerH={centerH} dir="fromCenter" rowH={rowH} dotted={resolvedConflict} />
        )}
        {rightChanged(kind) && (
          <div className="absolute right-0 top-0 z-10">
            <AcceptArrow
              dir="left"
              active={activeChoice === "right"}
              onClick={() => onChoose("right")}
              title="Aplicar versão do servidor (s)"
            />
          </div>
        )}
      </div>

      {/* SERVIDOR (deles) */}
      <div className="relative min-w-0 border-t border-line/40" onClick={onActivate}>
        <CodeLines lines={region.theirs} spans={rightSpans} startNo={rightNo} muted={theirsMuted} lineBg={rBg.line} wordBg={rBg.word} />
      </div>
    </>
  );
}
