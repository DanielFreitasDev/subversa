/**
 * Fonte ÚNICA das ações do navegador de repositórios. `actionsFor(node)` decide,
 * por tipo de nó (raiz da localização / pasta / arquivo), o que está disponível
 * e, quando não, o `disabledReason`. A toolbar mostra TODAS (desabilitando as
 * inaplicáveis com tooltip); o menu de contexto mostra só as disponíveis.
 */

import { useCallback } from "react";
import {
  Download,
  Eye,
  FolderDown,
  FolderInput,
  FolderPlus,
  GitBranch,
  GitCompareArrows,
  HardDriveDownload,
  History,
  Link2,
  ListFilter,
  Pencil,
  RefreshCw,
  Trash,
  Trash2,
} from "lucide-react";

import * as api from "@/lib/api";
import type { MenuItem } from "@/components/ui/ContextMenu";
import { extractRevision, reportOutput, tryRun } from "@/lib/op";
import { baseName, decodeUrl } from "@/lib/utils";
import { confirm } from "@/store/confirm";
import { useConfigStore } from "@/store/config";
import { useRepoBrowserStore, type RepoNode } from "@/store/repoBrowser";
import { toast } from "@/store/toast";
import { useUiStore } from "@/store/ui";

function parentOf(url: string): string {
  const i = url.lastIndexOf("/");
  return i > 0 ? url.slice(0, i) : url;
}

export function copyUrl(url: string) {
  navigator.clipboard
    .writeText(decodeUrl(url))
    .then(() => toast.success("URL copiada"))
    .catch(() => toast.error("Não consegui copiar a URL"));
}

export function useRepoActions(): (node: RepoNode | null) => MenuItem[] {
  const refresh = useRepoBrowserStore((s) => s.refresh);
  const select = useRepoBrowserStore((s) => s.select);
  const setActiveLocation = useRepoBrowserStore((s) => s.setActiveLocation);
  const openDialog = useRepoBrowserStore((s) => s.openDialog);
  const setCheckout = useUiStore((s) => s.setCheckout);
  const roots = useConfigStore((s) => s.config?.repoRoots ?? []);
  const saveConfig = useConfigStore((s) => s.save);

  const removeNode = useCallback(
    async (node: RepoNode) => {
      const ok = await confirm({
        title: "Excluir do servidor?",
        message: `Isso remove permanentemente:\n\n${decodeUrl(node.url)}`,
        danger: true,
        confirmLabel: "Excluir",
        requireText: node.name,
      });
      if (!ok) return;
      const out = await tryRun(
        () => api.deleteRemote(node.url, `removendo ${node.name}`),
        "Falha ao excluir",
      );
      if (
        out &&
        reportOutput(out, "Excluído", extractRevision(out.stdout) ? `r${extractRevision(out.stdout)}` : undefined)
      ) {
        const parent = parentOf(node.url);
        await refresh(parent);
        select({ url: parent, name: baseName(parent), kind: "dir" });
      }
    },
    [refresh, select],
  );

  const discardLocation = useCallback(
    async (node: RepoNode) => {
      const ok = await confirm({
        title: "Descartar localização?",
        message: `Remove esta localização do navegador (não toca no servidor):\n\n${decodeUrl(node.url)}`,
        confirmLabel: "Descartar",
      });
      if (!ok) return;
      // Lê estado fresco: o closure do item de menu é congelado ao abrir.
      const currentRoots = useConfigStore.getState().config?.repoRoots ?? [];
      const next = currentRoots.filter((r) => r !== node.url);
      await saveConfig({ repoRoots: next });
      if (useRepoBrowserStore.getState().activeLocation === node.url) {
        setActiveLocation(next[0] ?? null);
      }
      toast.success("Localização descartada");
    },
    [saveConfig, setActiveLocation],
  );

  return useCallback(
    (node: RepoNode | null): MenuItem[] => {
      if (!node) return [];
      // "Raiz" = é uma das localizações cadastradas. Mais robusto que comparar
      // com `activeLocation`, que pode estar defasado ao clicar (botão direito)
      // numa localização ainda não-ativa na sidebar.
      const isRoot = roots.includes(node.url);
      const isDir = node.kind === "dir";
      const isFile = node.kind === "file";

      const onlyDir = isDir ? undefined : "Disponível apenas em pastas";
      const notRoot = isRoot ? "Não aplicável à raiz da localização" : undefined;
      const onlyRoot = isRoot ? undefined : "Disponível apenas na raiz da localização";

      return [
        {
          id: "history",
          label: "Mostrar histórico",
          icon: <History className="size-4" />,
          onSelect: () => openDialog("history", node),
        },
        {
          id: "browseChanges",
          label: "Navegar alterações…",
          icon: <ListFilter className="size-4" />,
          onSelect: () => openDialog("browseChanges", node),
        },
        {
          id: "compare",
          label: "Comparar com…",
          icon: <GitCompareArrows className="size-4" />,
          disabled: !!notRoot,
          disabledReason: notRoot,
          onSelect: () => openDialog("compare", node),
        },
        {
          id: "preview",
          label: "Ver conteúdo",
          icon: <Eye className="size-4" />,
          disabled: !isFile,
          disabledReason: isFile ? undefined : "Disponível apenas em arquivos",
          onSelect: () => select(node),
        },
        {
          id: "checkout",
          label: "Checkout (baixar)…",
          icon: <Download className="size-4" />,
          separatorBefore: true,
          disabled: !isDir,
          disabledReason: isDir ? undefined : "Disponível apenas em pastas",
          onSelect: () => setCheckout(true, node.url),
        },
        {
          id: "export",
          label: "Exportar…",
          icon: <HardDriveDownload className="size-4" />,
          onSelect: () => openDialog("export", node),
        },
        {
          id: "import",
          label: "Importar…",
          icon: <FolderDown className="size-4" />,
          disabled: !isDir,
          disabledReason: isDir ? undefined : "Selecione uma pasta de destino",
          onSelect: () => openDialog("import", node),
        },
        {
          id: "mkdir",
          label: "Nova pasta remota…",
          icon: <FolderPlus className="size-4" />,
          separatorBefore: true,
          disabled: !!onlyDir,
          disabledReason: onlyDir,
          onSelect: () => openDialog("mkdir", node),
        },
        {
          id: "branchTag",
          label: "Branch ou Tag…",
          icon: <GitBranch className="size-4" />,
          disabled: !!onlyDir,
          disabledReason: onlyDir,
          onSelect: () => openDialog("branchTag", node),
        },
        {
          id: "move",
          label: "Mover ou Renomear…",
          icon: <FolderInput className="size-4" />,
          disabled: !!notRoot,
          disabledReason: notRoot,
          onSelect: () => openDialog("move", node),
        },
        {
          id: "delete",
          label: "Excluir…",
          icon: <Trash2 className="size-4" />,
          danger: true,
          disabled: !!notRoot,
          disabledReason: notRoot,
          onSelect: () => removeNode(node),
        },
        {
          id: "copy",
          label: "Copiar URL",
          icon: <Link2 className="size-4" />,
          separatorBefore: true,
          onSelect: () => copyUrl(node.url),
        },
        {
          id: "refresh",
          label: "Atualizar",
          icon: <RefreshCw className="size-4" />,
          onSelect: () => refresh(isDir ? node.url : parentOf(node.url)),
        },
        {
          id: "editLocation",
          label: "Editar URL da localização…",
          icon: <Pencil className="size-4" />,
          separatorBefore: true,
          disabled: !!onlyRoot,
          disabledReason: onlyRoot,
          onSelect: () => openDialog("location", node),
        },
        {
          id: "discardLocation",
          label: "Descartar localização",
          icon: <Trash className="size-4" />,
          danger: true,
          disabled: !!onlyRoot,
          disabledReason: onlyRoot,
          onSelect: () => discardLocation(node),
        },
      ];
    },
    [roots, openDialog, select, setCheckout, refresh, removeNode, discardLocation],
  );
}
