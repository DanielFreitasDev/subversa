/**
 * Caminho do nó selecionado (relativo à localização) + revisão atual (via
 * `getUrlInfo`), com atalhos rápidos para raiz/trunk/branches/tags.
 */

import { useEffect, useState } from "react";
import { ChevronRight, Home } from "lucide-react";

import * as api from "@/lib/api";
import { cn, decodeUrl, decodeUrlSafe } from "@/lib/utils";
import { useRepoBrowserStore, type RepoNode } from "@/store/repoBrowser";

export function RepoBreadcrumb() {
  const location = useRepoBrowserStore((s) => s.activeLocation);
  const selected = useRepoBrowserStore((s) => s.selected);
  const select = useRepoBrowserStore((s) => s.select);
  const toggle = useRepoBrowserStore((s) => s.toggle);

  const [rev, setRev] = useState<string | null>(null);

  const currentUrl = selected?.url ?? location ?? "";

  // Revisão do nó atual (HEAD) — informativo no canto direito.
  useEffect(() => {
    if (!currentUrl) return;
    let alive = true;
    setRev(null);
    // Debounce: navegar rápido pela árvore não dispara um enxame de `svn info`.
    const t = setTimeout(() => {
      api
        .getUrlInfo(currentUrl)
        .then((info) => alive && setRev(info.revision))
        .catch(() => alive && setRev(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [currentUrl]);

  if (!location) return null;

  const rel = decodeUrl(currentUrl.startsWith(location) ? currentUrl.slice(location.length) : "")
    .replace(/^\//, "");
  const crumbs = rel ? rel.split("/") : [];

  const selectDir = (url: string, name: string) => {
    const node: RepoNode = { url, name, kind: "dir" };
    select(node);
    if (!useRepoBrowserStore.getState().expanded.has(url)) toggle(url);
  };

  const goRoot = () => select({ url: location, name: location.split("/").pop() ?? location, kind: "dir" });

  const goCrumb = (idx: number) => {
    const path = crumbs.slice(0, idx + 1).join("/");
    // reconstrói a URL preservando o encoding original (junta os segmentos crus).
    const rawRel = currentUrl.slice(location.length).replace(/^\//, "");
    const rawSegs = rawRel.split("/").slice(0, idx + 1);
    const url = `${location}/${rawSegs.join("/")}`;
    select({ url, name: decodeUrl(path.split("/").pop() ?? path), kind: "dir" });
  };

  return (
    <div className="flex items-center gap-1 border-b border-line px-4 py-2 text-[12px]">
      <button
        onClick={goRoot}
        className={cn(
          "flex items-center gap-1 rounded px-1.5 py-1 hover:bg-panel-2 hover:text-ink",
          crumbs.length === 0 ? "text-ink" : "text-faint",
        )}
        title={decodeUrlSafe(location)}
      >
        <Home className="size-3.5" />
      </button>
      {crumbs.map((c, i) => (
        <div key={i} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3 shrink-0 text-faint" />
          <button
            onClick={() => goCrumb(i)}
            className={cn(
              "max-w-[200px] truncate rounded px-1.5 py-1 hover:bg-panel-2 hover:text-ink",
              i === crumbs.length - 1 ? "text-ink" : "text-muted",
            )}
          >
            {decodeUrlSafe(c)}
          </button>
        </div>
      ))}

      <div className="ml-auto flex items-center gap-1">
        {["trunk", "branches", "tags"].map((q) => (
          <button
            key={q}
            onClick={() => selectDir(`${location}/${q}`, q)}
            className="rounded px-2 py-1 text-[11px] text-faint hover:bg-panel-2 hover:text-ink"
          >
            {q}
          </button>
        ))}
        {rev && (
          <span className="ml-1 shrink-0 rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
            r{rev}
          </span>
        )}
      </div>
    </div>
  );
}
