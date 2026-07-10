/**
 * "Ir para arquivo" (Ctrl+Shift+N) do editor embutido — o Go to File do
 * IntelliJ: paleta flutuante com busca difusa sobre TODOS os arquivos da
 * cópia de trabalho (listados pelo backend, ignorando `.svn` e afins), para
 * abrir qualquer arquivo em nova aba sem sair do editor.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, Loader2 } from "lucide-react";

import { fuzzyFilter } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";

const LIMIT = 60;

/** Realça os caracteres casados (posições vindas do fuzzy). */
function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>;
  const set = new Set(positions);
  const parts: React.ReactNode[] = [];
  let run = "";
  let runHit = set.has(0);
  const flush = (i: number) => {
    if (!run) return;
    parts.push(
      runHit ? (
        <span key={i} className="font-semibold text-brand">
          {run}
        </span>
      ) : (
        run
      ),
    );
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== runHit) {
      flush(i);
      runHit = hit;
    }
    run += text[i];
  }
  flush(text.length);
  return <>{parts}</>;
}

export function QuickOpenPalette({
  open,
  files,
  loading,
  error,
  onPick,
  onClose,
}: {
  open: boolean;
  /** Caminhos relativos à raiz da cópia de trabalho. */
  files: string[];
  loading: boolean;
  error: string | null;
  onPick: (relPath: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIdx(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(
    () => (open ? fuzzyFilter(query.trim(), files, LIMIT) : []),
    [open, query, files],
  );

  useEffect(() => setIdx(0), [query]);

  // Mantém o item ativo à vista ao navegar com as setas.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  if (!open) return null;

  const pick = (rel: string) => {
    onPick(rel);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[idx];
      if (r) pick(r.item);
    }
  };

  return (
    <>
      {/* Fundo clicável para dispensar (sem escurecer: paleta leve, estilo IDE). */}
      <div className="absolute inset-0 z-20" onMouseDown={onClose} />
      <div
        className="absolute top-6 left-1/2 z-30 w-[620px] max-w-[92%] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-panel-3 shadow-pop"
        onKeyDown={onKey}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ir para arquivo… (nome ou trecho do caminho)"
          spellCheck={false}
          className="h-9 w-full border-b border-line bg-transparent px-3 text-[13px] text-ink outline-none placeholder:text-faint"
        />
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-faint">
              <Loader2 className="size-3.5 animate-spin" /> Listando os arquivos da cópia de trabalho…
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-xs text-danger">{error}</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-faint">
              {query ? "Nenhum arquivo casa com a busca." : "Nenhum arquivo encontrado."}
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.item}
                type="button"
                data-active={i === idx}
                onMouseEnter={() => setIdx(i)}
                onClick={() => pick(r.item)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px]",
                  i === idx ? "bg-brand/15 text-ink" : "text-muted",
                )}
              >
                <FileCode2 className="size-3.5 shrink-0 text-faint" />
                <span className="truncate">
                  <Highlighted text={r.item} positions={r.result.positions} />
                </span>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-line px-3 py-1.5 text-[10px] text-faint">
          ↑↓ navegar · Enter abrir · Esc fechar
        </div>
      </div>
    </>
  );
}
