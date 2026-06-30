import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";

import {
  buildHunkPatch,
  changeBlocks,
  type ChangeBlock,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type DiffLineType,
} from "@/lib/diff";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast";
import type { DiffMode } from "@/store/ui";

import { buildRows, buildSplitRows, type Segment } from "./rows";
import { mergeTokensWithSegments, spansForPlainLine, tokenizeFile, type Span } from "./highlight";

/** Conteúdo de referência (um lado inteiro) para revelar contexto sob demanda. */
export interface ContentRef {
  side: "old" | "new";
  lines: string[];
}

/** Acima disto, não renderiza por padrão (evita travar a UI). */
const LARGE_FILE = 2000;
/** Quantas linhas cada clique de "expandir" revela. */
const STEP = 20;

// ---------------------------------------------------------------------------
// Cálculo de lacunas (linhas ocultas entre/antes/depois dos hunks)
// ---------------------------------------------------------------------------

interface Bounds {
  firstOld: number;
  firstNew: number;
  lastOld: number;
  lastNew: number;
}

function hunkBounds(hunk: DiffHunk): Bounds {
  let lastOld = hunk.oldStart - 1;
  let lastNew = hunk.newStart - 1;
  for (const l of hunk.lines) {
    if (l.oldNumber != null) lastOld = l.oldNumber;
    if (l.newNumber != null) lastNew = l.newNumber;
  }
  return { firstOld: hunk.oldStart, firstNew: hunk.newStart, lastOld, lastNew };
}

interface Gap {
  id: string;
  prevLastNew: number;
  nextFirstNew: number | null; // null = fim do arquivo
  delta: number; // newNumber - oldNumber dentro da lacuna
}

function computeGaps(file: DiffFile): Gap[] {
  const bounds = file.hunks.map(hunkBounds);
  const gaps: Gap[] = [];
  for (let i = 0; i < file.hunks.length; i++) {
    const prevNew = i === 0 ? 0 : bounds[i - 1].lastNew;
    gaps.push({
      id: `g${i}`,
      prevLastNew: prevNew,
      nextFirstNew: bounds[i].firstNew,
      delta: bounds[i].firstNew - bounds[i].firstOld,
    });
  }
  if (bounds.length) {
    const last = bounds[bounds.length - 1];
    gaps.push({ id: "gEnd", prevLastNew: last.lastNew, nextFirstNew: null, delta: last.lastNew - last.lastOld });
  }
  return gaps;
}

/** Total de linhas ocultas na lacuna (o fim do arquivo depende do conteúdo). */
function gapHidden(gap: Gap, content: ContentRef | null): number {
  if (gap.nextFirstNew != null) return gap.nextFirstNew - gap.prevLastNew - 1;
  if (!content) return 0;
  const eofNew = content.side === "new" ? content.lines.length : content.lines.length + gap.delta;
  return Math.max(0, eofNew - gap.prevLastNew);
}

/** Constrói as `DiffLine` de contexto reveladas (até `r` linhas) de uma lacuna. */
function buildGapLines(gap: Gap, content: ContentRef, r: number): DiffLine[] {
  const out: DiffLine[] = [];
  const at = (n: number): DiffLine | null => {
    const oldNumber = n - gap.delta;
    const idx = content.side === "new" ? n - 1 : oldNumber - 1;
    const text = content.lines[idx];
    if (text === undefined) return null;
    return { type: "context", content: text, oldNumber, newNumber: n };
  };
  if (gap.nextFirstNew != null) {
    const endNew = gap.nextFirstNew - 1;
    for (let n = endNew - r + 1; n <= endNew; n++) {
      const line = at(n);
      if (line) out.push(line);
    }
  } else {
    const startNew = gap.prevLastNew + 1;
    for (let n = startNew; n < startNew + r; n++) {
      const line = at(n);
      if (line) out.push(line);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Renderização de linhas
// ---------------------------------------------------------------------------

function SpanRun({ spans, type }: { spans: Span[]; type: DiffLineType }) {
  return (
    <>
      {spans.map((s, i) => (
        <span
          key={i}
          className={cn(
            s.className,
            s.changed && (type === "add" ? "rounded-sm bg-add/30" : "rounded-sm bg-del/30"),
          )}
        >
          {s.text}
        </span>
      ))}
    </>
  );
}

function bgFor(type: DiffLineType): string {
  return type === "add" ? "bg-add/10" : type === "del" ? "bg-del/10" : "";
}

function UnifiedRow({ line, spans, change }: { line: DiffLine; spans: Span[]; change?: boolean }) {
  const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  const signColor = line.type === "add" ? "text-add" : line.type === "del" ? "text-del" : "text-faint";
  return (
    <div data-change={change || undefined} className={cn("flex font-mono text-[12.5px] leading-[1.55]", bgFor(line.type))}>
      <span className="w-12 shrink-0 select-none border-r border-line/60 px-2 text-right text-faint">
        {line.oldNumber ?? ""}
      </span>
      <span className="w-12 shrink-0 select-none border-r border-line/60 px-2 text-right text-faint">
        {line.newNumber ?? ""}
      </span>
      <span className={cn("w-5 shrink-0 select-none text-center", signColor)}>{sign}</span>
      <code className="diff-code selectable whitespace-pre-wrap break-words pr-3">
        <SpanRun spans={spans} type={line.type} />
      </code>
    </div>
  );
}

function SplitSide({
  cell,
  spans,
  side,
}: {
  cell: { line: DiffLine; segments: Segment[] } | null;
  spans: Span[] | null;
  side: "left" | "right";
}) {
  const num = cell ? (side === "left" ? cell.line.oldNumber : cell.line.newNumber) : null;
  const bg = !cell ? "bg-panel-2/40" : bgFor(cell.line.type);
  return (
    <>
      <span
        className={cn(
          "select-none px-2 text-right text-faint",
          side === "right" && "border-l border-line/60",
          "border-r border-line/60",
          bg,
        )}
      >
        {num ?? ""}
      </span>
      <code className={cn("diff-code selectable whitespace-pre-wrap break-words px-2", bg)}>
        {cell && spans ? <SpanRun spans={spans} type={cell.line.type} /> : null}
      </code>
    </>
  );
}

/** Faixa do separador de hunk com o cabeçalho `@@` e os botões de expandir. */
function GapBand({
  header,
  remaining,
  canExpand,
  loading,
  onStep,
  onAll,
}: {
  header: string | null;
  remaining: number;
  canExpand: boolean;
  loading: boolean;
  onStep: () => void;
  onAll: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-y border-line/40 bg-panel-2/50 px-3 py-1 text-[11px]">
      {canExpand && remaining > 0 ? (
        <>
          <button
            onClick={onStep}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-info transition-colors hover:bg-info/10"
            title={`Mostrar ${Math.min(STEP, remaining)} linha(s)`}
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : <ChevronsUpDown className="size-3" />}
            {remaining > STEP ? `${STEP} linhas` : "expandir"}
          </button>
          {remaining > STEP && (
            <button onClick={onAll} className="rounded px-1.5 py-0.5 text-info transition-colors hover:bg-info/10">
              tudo ({remaining})
            </button>
          )}
          <span className="text-faint">{remaining} oculta(s)</span>
        </>
      ) : (
        <span className="text-faint">⋯</span>
      )}
      {header && <span className="ml-auto truncate font-mono text-info/70">{header}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileBlock
// ---------------------------------------------------------------------------

export interface FileBlockProps {
  file: DiffFile;
  mode: DiffMode;
  index: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  externalTool?: string;
  onOpenExternal?: () => void;
  onExpandContext?: (file: DiffFile) => Promise<ContentRef | null>;
  /**
   * Habilita o botão de reverter trecho (estilo IntelliJ) em cada bloco de
   * alteração. Recebe o caminho do arquivo e o patch mínimo daquele trecho (no
   * sentido direto — o backend o aplica em reverso). Ausente = sem reversão (ex.:
   * diffs históricos, que não são alterações locais).
   */
  onRevertHunk?: (target: string, patch: string) => void;
}

export function FileBlock({
  file,
  mode,
  index,
  collapsed,
  onToggleCollapse,
  externalTool,
  onOpenExternal,
  onExpandContext,
  onRevertHunk,
}: FileBlockProps) {
  // Arquivos enormes não são tokenizados (evita travar o realce de sintaxe).
  const tokens = useMemo(
    () => (file.additions + file.deletions > LARGE_FILE ? null : tokenizeFile(file)),
    [file],
  );
  const gaps = useMemo(() => computeGaps(file), [file]);

  const [content, setContent] = useState<ContentRef | null>(null);
  const [loading, setLoading] = useState(false);
  const [reveal, setReveal] = useState<Record<string, number>>({});
  const [forceShow, setForceShow] = useState(false);

  // Descarta conteúdo/expansões cacheados quando o diff muda. A key do bloco
  // (`${i}-${file.path}`) pode ser reusada entre revisões com mesmo índice+path,
  // o que faria o contexto expandido revelar linhas da revisão anterior.
  useEffect(() => {
    setContent(null);
    setReveal({});
    setForceShow(false);
  }, [file]);

  const ensureContent = async (): Promise<ContentRef | null> => {
    if (content) return content;
    if (!onExpandContext) return null;
    setLoading(true);
    try {
      const c = await onExpandContext(file);
      setContent(c);
      return c;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  };

  const expand = async (gap: Gap, all: boolean) => {
    const c = await ensureContent();
    if (!c) return;
    const hidden = gapHidden(gap, c);
    const cur = reveal[gap.id] ?? 0;
    const next = all ? hidden : Math.min(hidden, cur + STEP);
    setReveal((r) => ({ ...r, [gap.id]: next }));
  };

  const copyPath = () => {
    navigator.clipboard?.writeText(file.path).then(
      () => toast.success("Caminho copiado"),
      () => toast.error("Não consegui copiar"),
    );
  };

  const spansFor = (line: DiffLine, segments: Segment[]): Span[] =>
    mergeTokensWithSegments(tokens?.get(line), segments);

  const revealRow = (line: DiffLine, key: string) => {
    const spans = spansForPlainLine(line.content, file.path);
    if (mode === "split") {
      return (
        <div key={key} className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)] font-mono text-[12.5px] leading-[1.55]">
          <SplitSide cell={{ line, segments: [] }} spans={spans} side="left" />
          <SplitSide cell={{ line, segments: [] }} spans={spans} side="right" />
        </div>
      );
    }
    return <UnifiedRow key={key} line={line} spans={spans} />;
  };

  // Faixa de separação + linhas de contexto reveladas para a lacuna antes do hunk i.
  const renderTopGap = (gap: Gap, header: string) => {
    const hidden = gapHidden(gap, content);
    const r = reveal[gap.id] ?? 0;
    const remaining = hidden - r;
    return (
      <Fragment key={`top-${gap.id}`}>
        <GapBand
          header={header}
          remaining={remaining}
          canExpand={!!onExpandContext}
          loading={loading}
          onStep={() => expand(gap, false)}
          onAll={() => expand(gap, true)}
        />
        {r > 0 && content && buildGapLines(gap, content, r).map((l, i) => revealRow(l, `${gap.id}-r${i}`))}
      </Fragment>
    );
  };

  // Lacuna final (depois do último hunk): linhas reveladas e, abaixo, a faixa.
  const renderBottomGap = (gap: Gap) => {
    // Só após o conteúdo já ter sido carregado (por outra lacuna) sabemos se há
    // linhas após o último hunk — evita um `cat` só para descobrir que não há.
    if (!onExpandContext || !content) return null;
    const r = reveal[gap.id] ?? 0;
    const remaining = gapHidden(gap, content) - r;
    if (remaining <= 0 && r === 0) return null;
    return (
      <Fragment key="bottom">
        {r > 0 && buildGapLines(gap, content, r).map((l, i) => revealRow(l, `end-r${i}`))}
        {remaining > 0 && (
          <GapBand
            header={null}
            remaining={remaining}
            canExpand
            loading={loading}
            onStep={() => expand(gap, false)}
            onAll={() => expand(gap, true)}
          />
        )}
      </Fragment>
    );
  };

  // Agrupa as linhas de cada bloco de alteração e ancora nele o botão de reverter
  // trecho (revelado ao passar o mouse). Sem `onRevertHunk`, devolve as linhas
  // soltas — layout idêntico ao anterior. Os blocos de alteração saem na mesma
  // ordem em `changeBlocks(hunk)` e nas linhas renderizadas, então casam 1:1.
  const withRevertAnchors = <R,>(
    rows: R[],
    isChange: (r: R) => boolean,
    renderRow: (r: R, i: number) => React.ReactNode,
    blocks: ChangeBlock[],
    hunk: DiffHunk,
  ): React.ReactNode[] => {
    if (!onRevertHunk) return rows.map(renderRow);
    const out: React.ReactNode[] = [];
    let i = 0;
    let blk = 0;
    while (i < rows.length) {
      if (!isChange(rows[i])) {
        out.push(<Fragment key={`ctx-${i}`}>{renderRow(rows[i], i)}</Fragment>);
        i++;
        continue;
      }
      const start = i;
      while (i < rows.length && isChange(rows[i])) i++;
      const block = blocks[blk++];
      out.push(
        <div key={`blk-${start}`} className="group/blk relative">
          {rows.slice(start, i).map((r, j) => renderRow(r, start + j))}
          {block && (
            <button
              type="button"
              onClick={() => onRevertHunk(file.path, buildHunkPatch(file, hunk, block))}
              title="Reverter este trecho"
              aria-label="Reverter este trecho"
              className={
                mode === "split"
                  ? // Faixa no vão central entre os painéis (estilo IntelliJ):
                    // atravessa toda a altura do bloco, com a setinha ">>" apontando
                    // da base (esquerda) para o trabalho (direita) = desfazer.
                    "absolute inset-y-0 left-1/2 z-[5] flex w-6 -translate-x-1/2 items-center justify-center border-x border-info/30 bg-info/15 text-info transition-colors hover:bg-info/35 group-hover/blk:bg-info/25"
                  : // Unificado não tem vão central: botão flutuante à direita, no hover.
                    "absolute right-1.5 top-1 z-[5] flex size-6 items-center justify-center rounded-md border border-line bg-panel-3 text-muted opacity-0 shadow-md transition-all hover:border-info/50 hover:bg-info/10 hover:text-info focus-visible:opacity-100 group-hover/blk:opacity-100"
              }
            >
              <ChevronsRight className="size-3.5" />
            </button>
          )}
        </div>,
      );
    }
    return out;
  };

  // Corpo de um hunk nas duas visões (unificado/split), já com as âncoras de
  // reversão por trecho.
  const renderHunkBody = (hunk: DiffHunk): React.ReactNode[] => {
    const blocks = onRevertHunk ? changeBlocks(hunk) : [];

    if (mode === "split") {
      const rows = buildSplitRows(hunk);
      const isChange = (r: (typeof rows)[number]) =>
        r.left?.line.type === "del" || r.right?.line.type === "add";
      // Com reversão por trecho, abre um vão central (onde mora a faixa ">>", como
      // no IntelliJ); sem ela, mantém o layout de 4 colunas de sempre.
      const gutter = !!onRevertHunk;
      const cols = gutter
        ? "grid-cols-[3rem_minmax(0,1fr)_1.5rem_3rem_minmax(0,1fr)]"
        : "grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)]";
      const renderRow = (row: (typeof rows)[number], ri: number) => (
        <div
          key={ri}
          // marca só o início de cada bloco de alteração (navegação por teclado)
          data-change={(isChange(row) && (ri === 0 || !isChange(rows[ri - 1]))) || undefined}
          className={cn("grid font-mono text-[12.5px] leading-[1.55]", cols)}
        >
          <SplitSide
            cell={row.left}
            spans={row.left ? spansFor(row.left.line, row.left.segments) : null}
            side="left"
          />
          {gutter && <span className="border-l border-line/60 bg-panel" />}
          <SplitSide
            cell={row.right}
            spans={row.right ? spansFor(row.right.line, row.right.segments) : null}
            side="right"
          />
        </div>
      );
      return withRevertAnchors(rows, isChange, renderRow, blocks, hunk);
    }

    const rows = buildRows(hunk);
    const isChange = (r: (typeof rows)[number]) => r.line.type !== "context";
    const renderRow = (row: (typeof rows)[number], ri: number) => (
      <UnifiedRow
        key={ri}
        line={row.line}
        spans={spansFor(row.line, row.segments)}
        change={row.line.type !== "context" && (ri === 0 || rows[ri - 1].line.type === "context")}
      />
    );
    return withRevertAnchors(rows, isChange, renderRow, blocks, hunk);
  };

  const tooLarge = file.additions + file.deletions > LARGE_FILE && !forceShow;

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      {/* Cabeçalho fixo */}
      <div
        data-file-header={index}
        className="group/file sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-2"
      >
        <button
          onClick={onToggleCollapse}
          className="flex size-5 shrink-0 items-center justify-center rounded text-faint hover:bg-panel-3 hover:text-ink"
          title={collapsed ? "Expandir arquivo" : "Recolher arquivo"}
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        <FileText className="size-3.5 shrink-0 text-faint" />
        <span className="selectable truncate font-mono text-[12.5px] text-ink">{file.path}</span>
        <button
          onClick={copyPath}
          className="flex size-5 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-panel-3 hover:text-ink group-hover/file:opacity-100"
          title="Copiar caminho"
        >
          <Copy className="size-3" />
        </button>
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {file.additions > 0 && (
            <span className="flex items-center gap-0.5 text-add">
              <Plus className="size-3" />
              {file.additions}
            </span>
          )}
          {file.deletions > 0 && (
            <span className="flex items-center gap-0.5 text-del">
              <Minus className="size-3" />
              {file.deletions}
            </span>
          )}
        </div>
      </div>

      {collapsed ? null : file.binary ? (
        <div className="px-3 py-4 text-[13px] text-muted">Arquivo binário — diff não exibido.</div>
      ) : file.hunks.length === 0 ? (
        <div className="px-3 py-4 text-[13px] text-faint">
          {file.notes.length ? file.notes.join("\n") : "Sem alterações de texto."}
        </div>
      ) : tooLarge ? (
        <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
          <AlertTriangle className="size-6 text-warn" />
          <div className="text-[13px] text-ink">Arquivo muito grande para exibir aqui</div>
          <div className="text-[12px] text-faint">
            {file.additions + file.deletions} linhas alteradas. Renderizar pode deixar a interface lenta.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setForceShow(true)}
              className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink transition-colors hover:bg-panel-3"
            >
              Mostrar mesmo assim
            </button>
            {onOpenExternal && (
              <button
                onClick={onOpenExternal}
                className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink transition-colors hover:bg-panel-3"
              >
                <ExternalLink className="size-3.5" />
                Abrir no {externalTool ?? "diff externo"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto bg-panel">
          {file.hunks.map((hunk, hi) => (
            <Fragment key={hunk.header}>
              {renderTopGap(gaps[hi], hunk.header)}
              {renderHunkBody(hunk)}
            </Fragment>
          ))}
          {renderBottomGap(gaps[file.hunks.length])}
        </div>
      )}
    </div>
  );
}
