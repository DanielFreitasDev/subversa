/**
 * Pré-visualização read-only de um arquivo remoto: conteúdo (`svn cat`, com
 * realce via lowlight, o mesmo do diff) e, opcionalmente, autoria (`svn blame`,
 * também realçado). Pode ser ampliado numa janela flutuante e tem busca de
 * texto embutida (Ctrl+F) com navegação entre as ocorrências.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, FileText, Maximize2, Search, ServerCrash, Users, X } from "lucide-react";

import * as api from "@/lib/api";
import { tokenizeText, type Span } from "@/components/diff/highlight";
import { Empty } from "@/components/ui/Empty";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { Loading } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { friendlyErrorMessage } from "@/lib/errors";
import type { BlameLine } from "@/lib/types";
import { cn, decodeUrlSafe } from "@/lib/utils";
import type { RepoNode } from "@/store/repoBrowser";

/** Acima disto não realça/rola tudo (evita travar a UI com arquivos enormes). */
const MAX_LINES = 4000;
const CAT_LIMIT_BYTES = 5 * 1024 * 1024;
const BLAME_LIMIT_BYTES = 10 * 1024 * 1024;

type Tab = "content" | "blame";

/** Ocorrência da busca numa linha, com seu índice global (para navegação). */
interface LineMatch {
  start: number;
  end: number;
  global: number;
}

/** Acha todas as ocorrências (case-insensitive) de `query` por linha. */
function computeMatches(lines: string[], query: string): { perLine: LineMatch[][]; total: number } {
  const perLine: LineMatch[][] = lines.map(() => []);
  const q = query.toLowerCase();
  if (!q) return { perLine, total: 0 };
  let global = 0;
  for (let i = 0; i < lines.length; i++) {
    const hay = lines[i].toLowerCase();
    let from = 0;
    for (;;) {
      const idx = hay.indexOf(q, from);
      if (idx < 0) break;
      perLine[i].push({ start: idx, end: idx + q.length, global: global++ });
      from = idx + q.length; // sem sobreposição
    }
  }
  return { perLine, total: global };
}

/** Pedaço renderizável: herda a cor de sintaxe e marca se (e como) casa a busca. */
interface Piece {
  text: string;
  className: string;
  match: "none" | "hit" | "active";
}

/** Cruza os spans de sintaxe da linha com as ocorrências (que partem o texto). */
function piecesForLine(base: Span[], matches: LineMatch[], active: number): Piece[] {
  const out: Piece[] = [];
  let pos = 0;
  for (const s of base) {
    const start = pos;
    const end = pos + s.text.length;
    pos = end;
    if (!s.text) continue;
    let cur = start;
    for (const m of matches) {
      if (m.end <= start || m.start >= end) continue; // não toca este span
      const ms = Math.max(m.start, start);
      const me = Math.min(m.end, end);
      if (ms > cur) out.push({ text: s.text.slice(cur - start, ms - start), className: s.className, match: "none" });
      out.push({
        text: s.text.slice(ms - start, me - start),
        className: s.className,
        match: m.global === active ? "active" : "hit",
      });
      cur = me;
    }
    if (cur < end) out.push({ text: s.text.slice(cur - start, end - start), className: s.className, match: "none" });
  }
  return out;
}

/** Conteúdo de uma linha: spans de sintaxe + realce das ocorrências da busca. */
function CodeCell({
  spans,
  raw,
  matches,
  active,
}: {
  spans: Span[] | null;
  raw: string;
  matches: LineMatch[];
  active: number;
}) {
  const base = spans && spans.length ? spans : [{ text: raw, className: "", changed: false }];
  if (!matches.length) {
    return (
      <>
        {base.map((s, i) => (
          <span key={i} className={s.className}>
            {s.text}
          </span>
        ))}
      </>
    );
  }
  return (
    <>
      {piecesForLine(base, matches, active).map((p, i) => (
        <span
          key={i}
          data-active-match={p.match === "active" || undefined}
          className={cn(p.className, p.match === "active" ? "sv-find-active" : p.match === "hit" ? "sv-find" : undefined)}
        >
          {p.text}
        </span>
      ))}
    </>
  );
}

/** Conteúdo do arquivo: nº da linha + código realçado (`.hl-code` → cores hljs). */
function ContentView({
  lines,
  highlighted,
  matches,
  active,
}: {
  lines: string[];
  highlighted: Span[][] | null;
  matches: LineMatch[][];
  active: number;
}) {
  return (
    <pre className="hl-code selectable min-w-full px-0 py-2 font-mono text-[12px] leading-relaxed">
      {lines.slice(0, MAX_LINES).map((ln, i) => (
        <div key={i} data-line={i + 1} className="flex hover:bg-panel-2/50">
          <span className="select-none px-3 text-right text-faint/60" style={{ minWidth: 56 }}>
            {i + 1}
          </span>
          <code className="whitespace-pre px-2 text-ink">
            <CodeCell spans={highlighted ? (highlighted[i] ?? null) : null} raw={ln} matches={matches[i] ?? []} active={active} />
          </code>
        </div>
      ))}
    </pre>
  );
}

/** Autoria (blame): nº + revisão + autor + código realçado (mesmas cores). */
function BlameView({
  blame,
  highlighted,
  matches,
  active,
}: {
  blame: BlameLine[];
  highlighted: Span[][] | null;
  matches: LineMatch[][];
  active: number;
}) {
  return (
    <div className="hl-code py-2 font-mono text-[12px] leading-relaxed">
      {blame.slice(0, MAX_LINES).map((b, i) => (
        <div key={b.lineNumber} className="flex hover:bg-panel-2/50">
          <span className="select-none px-2 text-right text-faint/60" style={{ minWidth: 48 }}>
            {b.lineNumber}
          </span>
          <span
            className="select-none truncate px-2 text-right text-brand"
            style={{ minWidth: 56 }}
            title={b.author ?? ""}
          >
            r{b.revision ?? "?"}
          </span>
          <span
            className="select-none truncate px-2 text-faint"
            style={{ minWidth: 110 }}
            title={b.author ?? ""}
          >
            {b.author ?? "—"}
          </span>
          <code className="whitespace-pre px-2 text-ink">
            <CodeCell spans={highlighted ? (highlighted[i] ?? null) : null} raw={b.content} matches={matches[i] ?? []} active={active} />
          </code>
        </div>
      ))}
    </div>
  );
}

export function FilePreview({
  node,
  jump,
}: {
  node: RepoNode;
  /** Pular para uma linha e semear a busca (vindo da busca por conteúdo). */
  jump?: { line: number; query: string };
}) {
  const [tab, setTab] = useState<Tab>("content");
  const [text, setText] = useState<string | null>(null);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);

  const findInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reseta ao trocar de arquivo (evita um frame com o conteúdo do arquivo anterior
  // sob o cabeçalho do novo, antes de o carregamento recomeçar).
  useEffect(() => {
    setTab("content");
    setText(null);
    setBlame(null);
    setError(null);
    setFindOpen(false);
    setQuery("");
  }, [node.url]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const knownSize = node.size ?? null;
        const limit = tab === "content" ? CAT_LIMIT_BYTES : BLAME_LIMIT_BYTES;
        if (knownSize != null && knownSize > limit) {
          const label = tab === "content" ? "5 MiB" : "10 MiB";
          throw new Error(
            `Arquivo grande demais para abrir no Subversa (limite de ${label}). Use uma ferramenta externa ou reduza o alvo.`,
          );
        }
        if (tab === "content") {
          const t = await api.catFile(node.url);
          if (alive) setText(t);
        } else {
          const b = await api.blame(node.url);
          if (alive) setBlame(b);
        }
      } catch (e) {
        if (alive) setError(friendlyErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [node.url, tab]);

  const lines = useMemo(() => (text != null ? text.split("\n") : []), [text]);
  // Realça o arquivo inteiro de uma vez (preserva strings/comentários
  // multi-linha) em vez de linha a linha; `null` cai para texto puro.
  const highlighted = useMemo(
    () => (text != null ? tokenizeText(text, node.name) : null),
    [text, node.name],
  );
  // Mesmo realce para a autoria: junta as linhas do blame e tokeniza o conjunto.
  const blameHighlighted = useMemo(
    () => (blame != null ? tokenizeText(blame.map((b) => b.content).join("\n"), node.name) : null),
    [blame, node.name],
  );

  // Texto exibido na aba ativa (usado pela busca; alinhado linha a linha).
  const activeLines = useMemo(
    () => (tab === "content" ? lines : (blame ?? []).map((b) => b.content)),
    [tab, lines, blame],
  );
  const { perLine, total } = useMemo(
    () => computeMatches(activeLines.slice(0, MAX_LINES), query),
    [activeLines, query],
  );
  const active = total ? Math.min(activeMatch, total - 1) : 0;
  const truncated = tab === "content" ? lines.length > MAX_LINES : (blame?.length ?? 0) > MAX_LINES;

  // Volta para a 1ª ocorrência quando a busca ou a aba muda.
  useEffect(() => {
    setActiveMatch(0);
  }, [query, tab]);

  // Foca a caixa de busca ao abri-la (inclusive depois de (des)ampliar).
  useEffect(() => {
    if (findOpen) {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }
  }, [findOpen, expanded]);

  // Rola a ocorrência ativa para o centro da área visível.
  useEffect(() => {
    if (!findOpen || !total) return;
    const el = scrollRef.current?.querySelector<HTMLElement>("[data-active-match]");
    el?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [active, total, findOpen, tab, expanded]);

  // Ctrl/Cmd+F abre a busca (enquanto há um arquivo selecionado nos Repositórios).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setFindOpen(true);
        findInputRef.current?.focus();
        findInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pular para a linha pedida (vindo da busca por conteúdo): semeia a query
  // (reaproveita o realce) e rola até a linha assim que o conteúdo renderizar.
  useEffect(() => {
    if (!jump) return;
    setTab("content");
    setFindOpen(true);
    setQuery(jump.query);
    if (text == null) return; // ainda carregando — rola quando o texto chegar
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-line="${jump.line}"]`);
    row?.scrollIntoView({ block: "center", inline: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.line, jump?.query, text]);

  const closeFind = () => {
    setFindOpen(false);
    setQuery("");
    setActiveMatch(0);
  };
  const step = (dir: 1 | -1) => {
    if (!total) return;
    setActiveMatch((a) => (Math.min(a, total - 1) + dir + total) % total);
  };

  const toggle = (
    <Segmented<Tab>
      size="sm"
      value={tab}
      onChange={setTab}
      options={[
        { value: "content", label: "Conteúdo", icon: <Eye className="size-3.5" /> },
        { value: "blame", label: "Autoria", icon: <Users className="size-3.5" /> },
      ]}
    />
  );

  const searchBtn = (
    <Tooltip label="Buscar no arquivo (Ctrl+F)">
      <button
        onClick={() => (findOpen ? closeFind() : setFindOpen(true))}
        aria-pressed={findOpen}
        className={cn(
          "flex size-7 items-center justify-center rounded-md transition-colors",
          findOpen ? "bg-panel-3 text-ink" : "text-muted hover:bg-panel-2 hover:text-ink",
        )}
      >
        <Search className="size-4" />
      </button>
    </Tooltip>
  );

  const navBtn = "flex size-6 items-center justify-center rounded text-faint transition-colors hover:bg-panel-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40";
  const findBar = (flush: boolean) => (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 bg-panel-2/60 px-3 py-1.5",
        flush ? "border-b border-line" : "mb-2 rounded-md border border-line",
      )}
    >
      <Search className="size-3.5 shrink-0 text-faint" />
      <input
        ref={findInputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation(); // não fecha a janela ampliada junto
            closeFind();
          }
        }}
        placeholder="Buscar no arquivo…"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
      />
      <span className="shrink-0 text-[11px] tabular-nums text-faint">
        {query ? `${total ? active + 1 : 0}/${total}` : ""}
      </span>
      <button onClick={() => step(-1)} disabled={!total} title="Anterior (Shift+Enter)" className={navBtn}>
        <ChevronUp className="size-3.5" />
      </button>
      <button onClick={() => step(1)} disabled={!total} title="Próximo (Enter)" className={navBtn}>
        <ChevronDown className="size-3.5" />
      </button>
      <button onClick={closeFind} title="Fechar (Esc)" className={navBtn}>
        <X className="size-3.5" />
      </button>
    </div>
  );

  const body = loading ? (
    <Loading label={tab === "content" ? "Lendo arquivo…" : "Carregando autoria…"} />
  ) : error ? (
    <Empty icon={<ServerCrash className="size-7" />} title="Não consegui ler o arquivo" description={error} />
  ) : tab === "content" ? (
    <ContentView lines={lines} highlighted={highlighted} matches={perLine} active={active} />
  ) : (
    <BlameView blame={blame ?? []} highlighted={blameHighlighted} matches={perLine} active={active} />
  );

  const truncatedNote = truncated && (
    <div className="border-t border-line px-4 py-2 text-center text-[11px] text-faint">
      Mostrando as primeiras {MAX_LINES.toLocaleString("pt-BR")} linhas.
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-faint" />
          <span className="truncate text-[13px] font-medium text-ink" title={decodeUrlSafe(node.url)}>
            {decodeUrlSafe(node.name)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {toggle}
          {searchBtn}
          <Tooltip label="Abrir em janela ampliada">
            <button
              onClick={() => setExpanded(true)}
              className="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel-2 hover:text-ink"
            >
              <Maximize2 className="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {!expanded && findOpen && findBar(true)}
      {!expanded && (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {body}
          {truncatedNote}
        </div>
      )}

      <Modal
        open={expanded}
        onClose={() => setExpanded(false)}
        size="xl"
        className="max-w-6xl"
        icon={<FileText className="size-5" />}
        title={decodeUrlSafe(node.name)}
        description={decodeUrlSafe(node.url)}
      >
        <div className="flex h-[74vh] flex-col">
          <div className="mb-3 flex shrink-0 items-center justify-end gap-1.5">
            {toggle}
            {searchBtn}
          </div>
          {findOpen && findBar(false)}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-panel">
            {body}
            {truncatedNote}
          </div>
        </div>
      </Modal>
    </div>
  );
}
