/**
 * Navegador de Repositórios (estilo "SVN Repositories" do IntelliJ). Independe
 * de working copy: cadastra localizações, navega a árvore remota e executa ops
 * SVN sobre o nó selecionado — por botões (toolbar) e por menu de contexto.
 *
 * Atalhos: F5 / Ctrl+F5 = atualizar; Ctrl+Alt+Insert = copiar URL do nó.
 */

import { useEffect, useState } from "react";
import { FolderTree } from "lucide-react";

import * as api from "@/lib/api";
import { ContextMenu, useContextMenu } from "@/components/ui/ContextMenu";
import { Empty } from "@/components/ui/Empty";
import { FilePreview } from "@/components/repos/FilePreview";
import { RepoBreadcrumb } from "@/components/repos/RepoBreadcrumb";
import { RepoLocationsSidebar } from "@/components/repos/RepoLocationsSidebar";
import { RepoToolbar } from "@/components/repos/RepoToolbar";
import { RepoTree } from "@/components/repos/RepoTree";
import { copyUrl, useRepoActions } from "@/components/repos/useRepoActions";
import type { UrlInfo } from "@/lib/types";
import { decodeUrl, formatAbsolute, formatRelative } from "@/lib/utils";
import { useConfigStore } from "@/store/config";
import { useConfirmStore } from "@/store/confirm";
import { useRepoBrowserStore, type RepoNode } from "@/store/repoBrowser";
import { useUiStore } from "@/store/ui";

function NodeDetails({ node }: { node: RepoNode }) {
  const [info, setInfo] = useState<UrlInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setInfo(null);
    api
      .getUrlInfo(node.url)
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [node.url]);

  const rows: [string, string][] = info
    ? [
        ["Tipo", info.kind === "dir" ? "Pasta" : "Arquivo"],
        ["Revisão (HEAD)", `r${info.revision}`],
        ["Última alteração", info.lastChangedRev ? `r${info.lastChangedRev}` : "—"],
        ["Autor", info.lastChangedAuthor ?? "—"],
        ["Data", info.lastChangedDate ? formatAbsolute(info.lastChangedDate) : "—"],
      ]
    : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <FolderTree className="size-4 shrink-0 text-info" />
        <span className="truncate text-[13px] font-medium text-ink" title={decodeUrl(node.url)}>
          {decodeUrl(node.name)}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="break-all rounded-lg bg-panel-2 px-3 py-2 font-mono text-[11px] text-muted">
          {decodeUrl(node.url)}
        </div>
        {loading ? (
          <div className="mt-4 text-[12px] text-faint">Carregando informações…</div>
        ) : info ? (
          <dl className="mt-4 space-y-2">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 text-[12px]">
                <dt className="shrink-0 text-faint">{k}</dt>
                <dd className="truncate text-ink" title={v}>
                  {v}
                </dd>
              </div>
            ))}
            {info.lastChangedDate && (
              <div className="pt-1 text-right text-[11px] text-faint">
                {formatRelative(info.lastChangedDate)}
              </div>
            )}
          </dl>
        ) : (
          <div className="mt-4 text-[12px] text-faint">Sem informações do servidor.</div>
        )}
      </div>
    </div>
  );
}

export function ReposView() {
  const roots = useConfigStore((s) => s.config?.repoRoots ?? []);
  const activeLocation = useRepoBrowserStore((s) => s.activeLocation);
  const selected = useRepoBrowserStore((s) => s.selected);
  const setActiveLocation = useRepoBrowserStore((s) => s.setActiveLocation);
  const refreshAll = useRepoBrowserStore((s) => s.refreshAll);
  const openDialog = useRepoBrowserStore((s) => s.openDialog);
  const actionsFor = useRepoActions();
  const ctx = useContextMenu();

  // Seleciona a primeira localização ao abrir (mostra conteúdo de imediato).
  useEffect(() => {
    if (!activeLocation && roots.length > 0) setActiveLocation(roots[0]);
  }, [activeLocation, roots, setActiveLocation]);

  // Atalhos de teclado da view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      // Não interfere quando há um diálogo/paleta/confirmação por cima.
      if (
        useRepoBrowserStore.getState().dialog ||
        useConfirmStore.getState().pending ||
        useUiStore.getState().paletteOpen ||
        useUiStore.getState().checkoutOpen ||
        useUiStore.getState().createBranchOpen
      )
        return;
      if (e.key === "F5") {
        e.preventDefault();
        refreshAll();
      } else if (e.ctrlKey && e.altKey && e.key === "Insert") {
        e.preventDefault();
        if (selected) copyUrl(selected.url);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshAll, selected]);

  const onContext = (node: RepoNode, e: React.MouseEvent) =>
    ctx.open(e, actionsFor(node).filter((i) => !i.disabled));

  return (
    <div className="flex h-full overflow-hidden">
      <RepoLocationsSidebar onContext={onContext} onNew={() => openDialog("location", null)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <RepoToolbar />
        <RepoBreadcrumb />
        <div className="flex min-h-0 flex-1">
          <RepoTree onContext={onContext} />
          <div className="hidden w-[420px] shrink-0 border-l border-line lg:block">
            {selected ? (
              selected.kind === "file" ? (
                <FilePreview key={selected.url} node={selected} />
              ) : (
                <NodeDetails key={selected.url} node={selected} />
              )
            ) : (
              <Empty icon={<FolderTree className="size-7" />} title="Nada selecionado" />
            )}
          </div>
        </div>
      </div>

      <ContextMenu menu={ctx.menu} onClose={ctx.close} />
    </div>
  );
}
