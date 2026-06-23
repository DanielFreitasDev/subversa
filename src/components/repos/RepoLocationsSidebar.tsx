/**
 * Lista de localizações (raízes de repositório) do navegador. Clicar troca a
 * localização ativa; botão direito abre o menu de contexto (Editar/Descartar,
 * ativos só na raiz). "Nova localização" abre o diálogo de cadastro.
 */

import { Database, Plus, Server } from "lucide-react";

import { cn, decodeUrl } from "@/lib/utils";
import { useConfigStore } from "@/store/config";
import { useRepoBrowserStore, type RepoNode } from "@/store/repoBrowser";

type OnContext = (node: RepoNode, e: React.MouseEvent) => void;

function leaf(url: string) {
  return decodeUrl(url).replace(/\/+$/, "").split("/").pop() ?? url;
}

export function RepoLocationsSidebar({
  onContext,
  onNew,
}: {
  onContext: OnContext;
  onNew: () => void;
}) {
  const roots = useConfigStore((s) => s.config?.repoRoots ?? []);
  const active = useRepoBrowserStore((s) => s.activeLocation);
  const setActiveLocation = useRepoBrowserStore((s) => s.setActiveLocation);

  return (
    <aside className="flex h-full w-[230px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <Database className="size-4 text-brand" />
        <span className="text-[13px] font-semibold text-ink">Repositórios</span>
      </div>
      <div className="px-4 pb-2 text-[11px] text-faint">
        {roots.length} localização(ões)
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {roots.map((url) => {
          const isActive = url === active;
          const rootNode: RepoNode = { url, name: leaf(url), kind: "dir" };
          return (
            <button
              key={url}
              onClick={() => setActiveLocation(url)}
              onContextMenu={(e) => {
                setActiveLocation(url);
                onContext(rootNode, e);
              }}
              className={cn(
                "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                isActive ? "bg-panel-3" : "hover:bg-panel-2",
              )}
              title={decodeUrl(url)}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-brand" />
              )}
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md",
                  isActive ? "bg-brand/15 text-brand" : "bg-panel-2 text-faint",
                )}
              >
                <Server className="size-4" />
              </div>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{leaf(url)}</span>
                <span className="block truncate text-[10px] text-faint">{decodeUrl(url)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-line p-2">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2.5 rounded-lg bg-panel-2 px-2.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-panel-3"
        >
          <Plus className="size-4 text-brand" />
          Nova localização
        </button>
      </div>
    </aside>
  );
}
