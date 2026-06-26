/**
 * Barra de ações da árvore remota: "Expandir tudo" / "Recolher tudo" (geral) e a
 * busca (por nome ou por conteúdo). O estado da busca vem do hook `useRepoSearch`
 * (compartilhado com a lista de resultados). Fica logo abaixo da breadcrumb.
 */

import { ChevronsDownUp, ChevronsUpDown, FolderSearch, Loader2, Search, X } from "lucide-react";

import { Input } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn, decodeUrlSafe, baseName } from "@/lib/utils";
import { useRepoBrowserStore } from "@/store/repoBrowser";
import type { UseRepoSearch } from "./useRepoSearch";

function ScopeChip({ scope, location }: { scope: string | null; location: string | null }) {
  if (!scope) return null;
  const isRoot = scope === location;
  return (
    <span
      className="hidden min-w-0 shrink items-center gap-1.5 rounded-md bg-panel-2 px-2 py-1 text-[11px] text-faint lg:flex"
      title={decodeUrlSafe(scope)}
    >
      <FolderSearch className="size-3.5 shrink-0" />
      <span className="truncate">
        {isRoot ? "na localização" : `em ${decodeUrlSafe(baseName(scope))}`}
      </span>
    </span>
  );
}

export function RepoSearchBar({ search }: { search: UseRepoSearch }) {
  const activeLocation = useRepoBrowserStore((s) => s.activeLocation);
  const expandSubtree = useRepoBrowserStore((s) => s.expandSubtree);
  const collapseSubtree = useRepoBrowserStore((s) => s.collapseSubtree);
  const expanding = useRepoBrowserStore((s) =>
    activeLocation ? s.expandingUrls.has(activeLocation) : false,
  );

  const { mode, query, scope, setMode, setQuery, submit, clear } = search;

  const iconBtn =
    "flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:text-faint/40 disabled:hover:bg-transparent";

  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
      <Tooltip label="Expandir tudo">
        <button
          onClick={() => activeLocation && expandSubtree(activeLocation)}
          disabled={!activeLocation || expanding}
          className={iconBtn}
        >
          {expanding ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ChevronsUpDown className="size-4" />
          )}
        </button>
      </Tooltip>
      <Tooltip label="Recolher tudo">
        <button
          onClick={() => activeLocation && collapseSubtree(activeLocation)}
          disabled={!activeLocation}
          className={iconBtn}
        >
          <ChevronsDownUp className="size-4" />
        </button>
      </Tooltip>

      <div className="mx-0.5 h-5 w-px bg-line" />

      <Segmented
        size="sm"
        value={mode}
        onChange={setMode}
        options={[
          { value: "name", label: "Nome" },
          { value: "content", label: "Conteúdo" },
        ]}
      />

      <div className="relative flex min-w-0 flex-1 items-center">
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && mode === "content") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              clear();
            }
          }}
          spellCheck={false}
          placeholder={
            mode === "name"
              ? "Buscar arquivo ou pasta…"
              : "Buscar no conteúdo (Enter para buscar)…"
          }
          className={cn("h-8 py-0 pl-8", query ? "pr-8" : "pr-3")}
        />
        {query && (
          <button
            onClick={clear}
            title="Limpar (Esc)"
            className="absolute right-2 flex size-5 items-center justify-center rounded text-faint transition-colors hover:bg-panel-3 hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {mode === "content" && (
        <button
          onClick={submit}
          disabled={query.trim().length < 2 || !scope}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-medium text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:text-faint/40 disabled:hover:bg-transparent"
        >
          <Search className="size-3.5" />
          Buscar
        </button>
      )}

      <ScopeChip scope={scope} location={activeLocation} />
    </div>
  );
}
