/**
 * Painel Localizar/Substituir do editor embutido, no estilo da barra do
 * IntelliJ: campo com os toggles embutidos (Cc = diferenciar maiúsculas,
 * W = palavra inteira, .* = regex), contador "3/17", setas de navegação,
 * linha de substituição expansível e escopo "só na seleção".
 *
 * O painel é dono da consulta (React) e a injeta no editor via `setSearch`
 * (ver `search.ts`); o resumo (contagem/ocorrência atual/erro) volta pelo
 * `summary`, recalculado pelo modal a cada atualização do editor. Trocar de
 * aba move a busca para a nova view automaticamente.
 *
 * Atalhos: Enter próxima · Shift+Enter anterior · Esc fecha · Alt+C/W/X
 * alternam os modos (como no IntelliJ) · ↑/↓ percorrem o histórico.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Regex, WholeWord, X } from "lucide-react";

import type { FindSpec } from "@/lib/findreplace";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast";
import {
  clearSearch,
  findNearest,
  findNext,
  findPrevious,
  replaceAll,
  replaceCurrent,
  setSearch,
  setSearchScope,
  type SearchSummary,
} from "./search";

export interface SearchPanelHandle {
  open(opts?: { replace?: boolean }): void;
  close(): void;
  isOpen(): boolean;
  findNext(): boolean;
  findPrevious(): boolean;
}

/** Históricos da sessão (compartilhados entre abas/painéis, como no IntelliJ). */
const searchHistory: string[] = [];
const replaceHistory: string[] = [];

function remember(list: string[], value: string) {
  if (!value) return;
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
  list.unshift(value);
  if (list.length > 50) list.pop();
}

function OptToggle({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-5.5 items-center justify-center rounded transition-colors",
        on ? "bg-brand/25 text-brand" : "text-faint hover:bg-panel-3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function NavButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded text-muted transition-colors hover:bg-panel-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export const SearchPanel = forwardRef<
  SearchPanelHandle,
  {
    /** Editor alvo (a view ativa do painel focado); null = sem arquivo. */
    view: EditorView | null;
    summary: SearchSummary;
    /** Chamado ao fechar (o modal devolve o foco ao editor). */
    onClosed?: () => void;
  }
>(function SearchPanel({ view, summary, onClosed }, ref) {
  const [open, setOpen] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [inSelection, setInSelection] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const histIdx = useRef(-1);
  const prevView = useRef<EditorView | null>(null);

  const spec: FindSpec = { search: query, caseSensitive, wholeWord, regexp };

  // Injeta/atualiza a consulta na view ativa; ao trocar de aba, limpa a antiga
  // e leva a busca junto para a nova (comportamento do IntelliJ).
  useEffect(() => {
    if (prevView.current && prevView.current !== view) {
      try {
        clearSearch(prevView.current);
      } catch {
        // view da aba fechada já foi destruída — nada a limpar
      }
      setInSelection(false);
    }
    prevView.current = view;
    if (!view) return;
    const active = open && !!query;
    view.dispatch({ effects: setSearch.of(active ? spec : null) });
    if (active) findNearest(view); // incremental: digitar já pula ao resultado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, open, query, caseSensitive, wholeWord, regexp]);

  const focusEditor = () => view?.focus();

  const doClose = () => {
    if (!open) return;
    setOpen(false);
    setInSelection(false);
    if (view) clearSearch(view);
    onClosed?.();
    focusEditor();
  };

  const doOpen = (opts?: { replace?: boolean }) => {
    setOpen(true);
    if (opts?.replace !== undefined) setReplaceMode(opts.replace);
    // Pré-preenche com a seleção atual (uma linha, tamanho razoável).
    if (view) {
      const { main } = view.state.selection;
      if (!main.empty && main.to - main.from <= 200) {
        const text = view.state.sliceDoc(main.from, main.to);
        if (!text.includes("\n")) setQuery(text);
      }
    }
    histIdx.current = -1;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const next = () => {
    remember(searchHistory, query);
    return view ? findNext(view) : false;
  };
  const previous = () => {
    remember(searchHistory, query);
    return view ? findPrevious(view) : false;
  };

  useImperativeHandle(ref, () => ({
    open: doOpen,
    close: doClose,
    isOpen: () => open,
    findNext: next,
    findPrevious: previous,
  }));

  const doReplace = () => {
    if (!view) return;
    remember(replaceHistory, replaceText);
    replaceCurrent(view, replaceText);
  };

  const doReplaceAll = () => {
    if (!view) return;
    remember(replaceHistory, replaceText);
    const n = replaceAll(view, replaceText);
    if (n > 0) toast.success(`${n} ocorrência(s) substituída(s)`);
    else toast.info("Nada para substituir");
  };

  const toggleScope = () => {
    if (!view) return;
    if (inSelection) {
      view.dispatch({ effects: setSearchScope.of(null) });
      setInSelection(false);
      return;
    }
    const ranges = view.state.selection.ranges
      .filter((r) => !r.empty)
      .map((r) => ({ from: r.from, to: r.to }));
    if (!ranges.length) {
      toast.info("Selecione um trecho primeiro", "O escopo usa a seleção atual do editor");
      return;
    }
    view.dispatch({ effects: setSearchScope.of(ranges) });
    setInSelection(true);
  };

  // Alt+C / Alt+W / Alt+X alternam os modos; Esc fecha (nos dois campos).
  const panelKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      doClose();
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === "c") setCaseSensitive((v) => !v);
    else if (k === "w") setWholeWord((v) => !v);
    else if (k === "x") setRegexp((v) => !v);
    else return;
    e.preventDefault();
  };

  const queryKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) previous();
      else next();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!searchHistory.length) return;
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      const idx = Math.max(-1, Math.min(searchHistory.length - 1, histIdx.current + dir));
      histIdx.current = idx;
      setQuery(idx < 0 ? "" : searchHistory[idx]);
    }
  };

  const replaceKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doReplace();
    }
  };

  if (!open) return null;

  const hasError = !!summary.error;
  const emptyResult = !hasError && !!query && summary.count === 0;
  const counter = hasError
    ? "regex inválida"
    : !query
      ? ""
      : summary.count === 0
        ? "Nenhum resultado"
        : summary.current
          ? `${summary.current}/${summary.count}${summary.truncated ? "+" : ""}`
          : `${summary.count}${summary.truncated ? "+" : ""} resultado(s)`;

  const scopeChip = (
    <button
      type="button"
      onClick={toggleScope}
      title="Substituir só dentro da seleção feita no editor"
      className={cn(
        "h-6 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium transition-colors",
        inSelection
          ? "border-brand/40 bg-brand/15 text-brand"
          : "border-line text-faint hover:bg-panel-3 hover:text-ink",
      )}
    >
      Na seleção
    </button>
  );

  return (
    <div className="border-b border-line bg-panel-2 px-2 py-1.5" onKeyDown={panelKeys}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          title={replaceMode ? "Ocultar substituição" : "Mostrar substituição (Ctrl+R)"}
          aria-expanded={replaceMode}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setReplaceMode((v) => !v)}
          className="flex size-6 shrink-0 items-center justify-center rounded text-faint hover:bg-panel-3 hover:text-ink"
        >
          {replaceMode ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>

        <div className="relative w-80 max-w-[42vw] shrink-0">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              histIdx.current = -1;
              setQuery(e.target.value);
            }}
            onKeyDown={queryKeys}
            placeholder="Localizar…"
            spellCheck={false}
            className={cn(
              "h-7 w-full rounded-md border bg-canvas/50 pl-2.5 pr-[74px] font-mono text-[12px] text-ink outline-none transition-colors placeholder:font-sans placeholder:text-faint",
              hasError || emptyResult ? "border-danger/60" : "border-line focus:border-brand/50",
            )}
            title={summary.error ?? undefined}
          />
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            <OptToggle on={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} title="Diferenciar maiúsculas (Alt+C)">
              <CaseSensitive className="size-4" />
            </OptToggle>
            <OptToggle on={wholeWord} onClick={() => setWholeWord((v) => !v)} title="Palavra inteira (Alt+W)">
              <WholeWord className="size-4" />
            </OptToggle>
            <OptToggle on={regexp} onClick={() => setRegexp((v) => !v)} title="Expressão regular (Alt+X)">
              <Regex className="size-4" />
            </OptToggle>
          </div>
        </div>

        <NavButton title="Anterior (Shift+F3)" disabled={!summary.count} onClick={previous}>
          <ChevronUp className="size-4" />
        </NavButton>
        <NavButton title="Próxima (F3 ou Enter)" disabled={!summary.count} onClick={next}>
          <ChevronDown className="size-4" />
        </NavButton>

        <span
          className={cn(
            "min-w-16 whitespace-nowrap px-1 text-[11px] tabular-nums",
            hasError || emptyResult ? "font-medium text-danger" : "text-faint",
          )}
        >
          {counter}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {!replaceMode && summary.hasScope && scopeChip}
          <button
            type="button"
            title="Fechar (Esc)"
            aria-label="Fechar busca"
            onClick={doClose}
            className="flex size-6 items-center justify-center rounded text-faint hover:bg-panel-3 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {replaceMode && (
        <div className="mt-1.5 flex items-center gap-1.5 pl-[30px]">
          <input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={replaceKeys}
            placeholder="Substituir por…"
            spellCheck={false}
            className="h-7 w-80 max-w-[42vw] shrink-0 rounded-md border border-line bg-canvas/50 px-2.5 font-mono text-[12px] text-ink outline-none transition-colors placeholder:font-sans placeholder:text-faint focus:border-brand/50"
            title={regexp ? "No modo regex: $1…$9 e $0/$& usam os grupos; \\n e \\t inserem quebra/tab" : undefined}
          />
          <button
            type="button"
            onClick={doReplace}
            disabled={!summary.count}
            className="h-6.5 rounded-md border border-line px-2.5 text-[11px] font-medium text-muted transition-colors hover:bg-panel-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            Substituir
          </button>
          <button
            type="button"
            onClick={doReplaceAll}
            disabled={!summary.count}
            className="h-6.5 rounded-md border border-line px-2.5 text-[11px] font-medium text-muted transition-colors hover:bg-panel-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            Substituir tudo
          </button>
          {scopeChip}
        </div>
      )}
    </div>
  );
});
