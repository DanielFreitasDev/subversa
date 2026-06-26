/**
 * Lista de resultados da busca — substitui a árvore enquanto há busca ativa.
 *
 * - **Nome:** lista plana de arquivos/pastas; clicar revela o nó na árvore.
 * - **Conteúdo:** ocorrências agrupadas por arquivo; clicar abre o arquivo no
 *   preview (à direita) e pula para a linha.
 */

import { useMemo } from "react";
import { File as FileIcon, Folder, Loader2, ServerCrash } from "lucide-react";

import { Empty } from "@/components/ui/Empty";
import { Loading } from "@/components/ui/Spinner";
import { baseName, decodeUrlSafe, dirName } from "@/lib/utils";
import type { SearchMatch } from "@/lib/types";
import { useRepoBrowserStore, type RepoNode } from "@/store/repoBrowser";
import type { UseRepoSearch } from "./useRepoSearch";

/** Realça (case-insensitive) as ocorrências de `query` em `text`. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let from = 0;
  let key = 0;
  for (let idx = lower.indexOf(ql); idx >= 0; idx = lower.indexOf(ql, from)) {
    if (idx > from) out.push(text.slice(from, idx));
    out.push(
      <mark key={key++} className="rounded bg-info/20 text-ink">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    from = idx + q.length;
  }
  if (from < text.length) out.push(text.slice(from));
  return <>{out}</>;
}

function NameResults({ search }: { search: UseRepoSearch }) {
  const revealNode = useRepoBrowserStore((s) => s.revealNode);
  const { nameResults, nameLoading, nameTotal, query } = search;

  if (nameLoading && nameResults.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-faint">
        <Loader2 className="size-3.5 animate-spin" />
        Buscando…
      </div>
    );
  }
  if (nameResults.length === 0) {
    return (
      <Empty
        icon={<Folder className="size-7" />}
        title="Nada encontrado"
        description={`Nenhum arquivo ou pasta corresponde a "${query.trim()}".`}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
      {nameResults.map(({ node, rel }) => {
        const dir = dirName(rel);
        return (
          <button
            key={node.url}
            onClick={() => {
              revealNode(node);
              search.clear();
            }}
            className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-panel-2"
          >
            {node.kind === "dir" ? (
              <Folder className="size-4 shrink-0 text-info" />
            ) : (
              <FileIcon className="size-4 shrink-0 text-faint" />
            )}
            <span className="truncate text-[13px] text-ink">
              <Highlight text={decodeUrlSafe(node.name)} query={query} />
            </span>
            {dir && (
              <span className="ml-auto truncate pl-3 text-[11px] text-faint" title={decodeUrlSafe(rel)}>
                {decodeUrlSafe(dir)}
              </span>
            )}
          </button>
        );
      })}
      {nameTotal > nameResults.length && (
        <div className="px-2 py-2 text-center text-[11px] text-faint">
          Mostrando {nameResults.length} de {nameTotal.toLocaleString("pt-BR")} resultados. Refine o
          termo.
        </div>
      )}
    </div>
  );
}

interface FileGroup {
  path: string;
  matches: SearchMatch[];
}

function ContentResults({ search }: { search: UseRepoSearch }) {
  const select = useRepoBrowserStore((s) => s.select);
  const setPreviewJump = useRepoBrowserStore((s) => s.setPreviewJump);
  const {
    contentScope,
    contentResults,
    contentLoading,
    contentScanned,
    contentMatchedFiles,
    contentTruncated,
    contentError,
    query,
  } = search;

  const groups = useMemo<FileGroup[]>(() => {
    if (!contentResults) return [];
    const map = new Map<string, SearchMatch[]>();
    for (const m of contentResults) {
      const g = map.get(m.path);
      if (g) g.push(m);
      else map.set(m.path, [m]);
    }
    return [...map.entries()].map(([path, matches]) => ({ path, matches }));
  }, [contentResults]);

  if (contentLoading) {
    return (
      <Loading
        label={`Verificando… ${contentScanned.toLocaleString("pt-BR")} arquivo(s)`}
      />
    );
  }
  if (contentError) {
    return (
      <Empty
        icon={<ServerCrash className="size-7" />}
        title="Não consegui buscar"
        description={contentError}
      />
    );
  }
  if (!contentResults || contentResults.length === 0) {
    return (
      <Empty
        icon={<FileIcon className="size-7" />}
        title="Nenhuma ocorrência"
        description={`O termo "${query.trim()}" não foi encontrado no conteúdo dos arquivos do escopo.`}
      />
    );
  }

  const openAt = (path: string, line: number) => {
    const url = `${contentScope}/${path}`;
    const node: RepoNode = { url, name: baseName(path), kind: "file" };
    setPreviewJump({ url, line, query });
    select(node);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-line px-4 py-2 text-[11px] text-faint">
        {contentResults.length.toLocaleString("pt-BR")} ocorrência(s) em{" "}
        {contentMatchedFiles.toLocaleString("pt-BR")} arquivo(s)
        {contentTruncated && " · resultados truncados"}
      </div>
      {groups.map((g) => (
        <div key={g.path} className="border-b border-line/60">
          <button
            onClick={() => openAt(g.path, g.matches[0].line)}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors hover:bg-panel-2"
            title={decodeUrlSafe(g.path)}
          >
            <FileIcon className="size-3.5 shrink-0 text-faint" />
            <span className="truncate text-[12px] font-medium text-ink">
              {decodeUrlSafe(g.path)}
            </span>
            <span className="ml-auto shrink-0 rounded bg-panel-2 px-1.5 text-[10px] text-faint">
              {g.matches.length}
            </span>
          </button>
          {g.matches.map((m, i) => (
            <button
              key={`${m.line}-${i}`}
              onClick={() => openAt(m.path, m.line)}
              className="flex w-full items-start gap-2 px-3 py-1 pl-8 text-left font-mono text-[11.5px] leading-relaxed transition-colors hover:bg-panel-2"
            >
              <span className="shrink-0 select-none pt-px text-right text-faint/70" style={{ minWidth: 40 }}>
                {m.line}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted">
                <Highlight text={m.snippet} query={query} />
              </span>
            </button>
          ))}
        </div>
      ))}
      {contentTruncated && (
        <div className="px-4 py-3 text-center text-[11px] text-faint">
          A busca atingiu um limite e pode haver mais ocorrências. Refine o termo ou o escopo.
        </div>
      )}
    </div>
  );
}

export function RepoSearchResults({ search }: { search: UseRepoSearch }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {search.mode === "name" ? (
        <NameResults search={search} />
      ) : (
        <ContentResults search={search} />
      )}
    </div>
  );
}
