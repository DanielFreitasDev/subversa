/**
 * Estado do Navegador de Repositórios (estilo "SVN Repositories" do IntelliJ).
 *
 * Desacoplado do `workspace` (que é de working copies): aqui navegamos a árvore
 * remota de uma URL de repositório, com cache lazy por nó. Cada pasta carrega
 * seus filhos via `listDir` só quando expandida.
 */

import { create } from "zustand";

import * as api from "@/lib/api";
import type { ListEntry } from "@/lib/types";
import { baseName } from "@/lib/utils";

/** Um nó da árvore remota. */
export interface RepoNode {
  url: string;
  name: string;
  kind: "dir" | "file";
}

/** Diálogos parametrizados do navegador. */
export type RepoDialogKind =
  | "mkdir"
  | "move"
  | "branchTag"
  | "import"
  | "export"
  | "compare"
  | "history"
  | "browseChanges"
  | "location";

export interface RepoDialog {
  kind: RepoDialogKind;
  /** Nó-alvo da operação; `null` em "Nova localização". */
  node: RepoNode | null;
}

interface RepoBrowserState {
  /** Raiz de repositório atualmente navegada (uma das `repoRoots`). */
  activeLocation: string | null;
  /** Nó selecionado (alvo das ações da toolbar / breadcrumb). */
  selected: RepoNode | null;
  /** Cache lazy: URL da pasta → seus filhos. */
  tree: Map<string, ListEntry[] | undefined>;
  /** URLs sendo carregadas no momento. */
  loadingUrls: Set<string>;
  /** Erro de carregamento por URL. */
  errors: Map<string, string>;
  /** Pastas expandidas. */
  expanded: Set<string>;
  /** Diálogo aberto (ou `null`). */
  dialog: RepoDialog | null;

  setActiveLocation: (url: string | null) => void;
  select: (node: RepoNode | null) => void;
  toggle: (url: string) => void;
  loadChildren: (url: string, force?: boolean) => Promise<void>;
  refresh: (url: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  openDialog: (kind: RepoDialogKind, node: RepoNode | null) => void;
  closeDialog: () => void;
}

/** Normaliza o `kind` cru do `svn list` para o nosso união. */
function nodeKind(kind: string): "dir" | "file" {
  return kind === "dir" ? "dir" : "file";
}

export const useRepoBrowserStore = create<RepoBrowserState>((set, get) => ({
  activeLocation: null,
  selected: null,
  tree: new Map(),
  loadingUrls: new Set(),
  errors: new Map(),
  expanded: new Set(),
  dialog: null,

  setActiveLocation: (url) => {
    set({
      activeLocation: url,
      selected: url ? { url, name: baseName(url), kind: "dir" } : null,
      expanded: url ? new Set([url]) : new Set(),
    });
    if (url) get().loadChildren(url);
  },

  select: (selected) => set({ selected }),

  toggle: (url) => {
    const expanded = new Set(get().expanded);
    if (expanded.has(url)) {
      expanded.delete(url);
      set({ expanded });
    } else {
      expanded.add(url);
      set({ expanded });
      get().loadChildren(url);
    }
  },

  loadChildren: async (url, force = false) => {
    const { tree, loadingUrls } = get();
    if (loadingUrls.has(url)) return;
    if (!force && tree.has(url)) return;
    set((s) => {
      const errors = new Map(s.errors);
      errors.delete(url);
      return { loadingUrls: new Set(s.loadingUrls).add(url), errors };
    });
    try {
      const list = await api.listDir(url);
      set((s) => {
        const loadingUrls = new Set(s.loadingUrls);
        loadingUrls.delete(url);
        return { tree: new Map(s.tree).set(url, list), loadingUrls };
      });
    } catch (e) {
      set((s) => {
        const loadingUrls = new Set(s.loadingUrls);
        loadingUrls.delete(url);
        return { errors: new Map(s.errors).set(url, String(e)), loadingUrls };
      });
    }
  },

  refresh: (url) => get().loadChildren(url, true),

  refreshAll: async () => {
    const { activeLocation, expanded } = get();
    if (!activeLocation) return;
    const urls = new Set<string>([activeLocation, ...expanded]);
    await Promise.all([...urls].map((u) => get().loadChildren(u, true)));
  },

  openDialog: (kind, node) => set({ dialog: { kind, node } }),
  closeDialog: () => set({ dialog: null }),
}));

export { nodeKind };
