/**
 * Estado do Navegador de Repositórios (estilo "SVN Repositories" do IntelliJ).
 *
 * Desacoplado do `workspace` (que é de working copies): aqui navegamos a árvore
 * remota de uma URL de repositório, com cache lazy por nó. Cada pasta carrega
 * seus filhos via `listDir` só quando expandida.
 */

import { create } from "zustand";

import * as api from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import type { ListEntry } from "@/lib/types";
import { baseName } from "@/lib/utils";
import { toast } from "@/store/toast";

/** Um nó da árvore remota. */
export interface RepoNode {
  url: string;
  name: string;
  kind: "dir" | "file";
  size?: number | null;
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

/** Alvo de "pular para a linha" no preview (vindo da busca por conteúdo). */
export interface PreviewJump {
  url: string;
  line: number;
  query: string;
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
  /** URLs cuja subárvore está sendo expandida (spinner do "Expandir tudo"). */
  expandingUrls: Set<string>;
  /** Nó que a árvore deve rolar até a vista (uma vez), após uma busca por nome. */
  pendingReveal: string | null;
  /** Alvo de "pular para a linha" no preview (busca por conteúdo). */
  previewJump: PreviewJump | null;
  /** Diálogo aberto (ou `null`). */
  dialog: RepoDialog | null;
  /** Painel de detalhes recolhido? (persistido) */
  detailsCollapsed: boolean;
  /** Largura do painel de detalhes em px (persistida). */
  detailsWidth: number;

  setActiveLocation: (url: string | null) => void;
  select: (node: RepoNode | null) => void;
  toggle: (url: string) => void;
  loadChildren: (url: string, force?: boolean) => Promise<void>;
  refresh: (url: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  /** Lista a subárvore inteira (`svn list -R`) de `url`; `[]` em erro. */
  fetchSubtree: (url: string) => Promise<ListEntry[]>;
  /** Popula o cache `tree` (por pasta) a partir da listagem recursiva de `baseUrl`. */
  populateTree: (baseUrl: string, flat: ListEntry[]) => void;
  /** Expande `url` e toda a sua subárvore (carrega de uma vez; protege árvores enormes). */
  expandSubtree: (url: string) => Promise<void>;
  /** Recolhe `url` e seus descendentes (geral, quando `url` é a localização). */
  collapseSubtree: (url: string) => void;
  /** Seleciona `node`, expande seus ancestrais e o rola até a vista. */
  revealNode: (node: RepoNode) => void;
  setPreviewJump: (jump: PreviewJump | null) => void;
  /** Limpa o `pendingReveal` após a árvore rolar até o nó. */
  consumeReveal: () => void;
  openDialog: (kind: RepoDialogKind, node: RepoNode | null) => void;
  closeDialog: () => void;
  toggleDetails: () => void;
  /** Atualiza a largura do painel; `commit` persiste (use ao fim do arraste). */
  setDetailsWidth: (width: number, commit?: boolean) => void;
}

/** Normaliza o `kind` cru do `svn list` para o nosso união. */
function nodeKind(kind: string): "dir" | "file" {
  return kind === "dir" ? "dir" : "file";
}

/**
 * Teto do "Expandir tudo": acima disto não expandimos de uma vez (a árvore não é
 * virtualizada — cada pasta aberta vira uma linha no DOM, e milhares travariam a
 * UI). O usuário expande por pasta nesse caso.
 */
export const EXPAND_ALL_MAX_NODES = 5000;

/** Comparador padrão do `svn list`: pastas primeiro, depois por nome. */
function compareEntries(a: ListEntry, b: ListEntry): number {
  const da = a.kind !== "dir" ? 1 : 0;
  const db = b.kind !== "dir" ? 1 : 0;
  return da - db || a.name.localeCompare(b.name);
}

// Persistência (localStorage) do painel de detalhes: recolhido + largura.
const DETAILS_WIDTH_KEY = "subversa.repos.detailsWidth";
const DETAILS_COLLAPSED_KEY = "subversa.repos.detailsCollapsed";
/** Largura padrão do painel de detalhes (px). */
export const DETAILS_WIDTH_DEFAULT = 420;
const DETAILS_WIDTH_MIN = 280;
const DETAILS_WIDTH_MAX = 640;

/** Mantém a largura do painel dentro de limites sãos (não deixa a árvore sumir). */
function clampDetailsWidth(w: number): number {
  return Math.min(DETAILS_WIDTH_MAX, Math.max(DETAILS_WIDTH_MIN, Math.round(w)));
}

function initialDetailsWidth(): number {
  try {
    const v = Number(localStorage.getItem(DETAILS_WIDTH_KEY));
    return v > 0 ? clampDetailsWidth(v) : DETAILS_WIDTH_DEFAULT;
  } catch {
    return DETAILS_WIDTH_DEFAULT; // storage indisponível (modo privativo/quota)
  }
}

function initialDetailsCollapsed(): boolean {
  try {
    return localStorage.getItem(DETAILS_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export const useRepoBrowserStore = create<RepoBrowserState>((set, get) => ({
  activeLocation: null,
  selected: null,
  tree: new Map(),
  loadingUrls: new Set(),
  errors: new Map(),
  expanded: new Set(),
  expandingUrls: new Set(),
  pendingReveal: null,
  previewJump: null,
  dialog: null,
  detailsCollapsed: initialDetailsCollapsed(),
  detailsWidth: initialDetailsWidth(),

  setActiveLocation: (url) => {
    set({
      activeLocation: url,
      selected: url ? { url, name: baseName(url), kind: "dir" } : null,
      expanded: url ? new Set([url]) : new Set(),
      pendingReveal: null,
      previewJump: null,
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
        return {
          errors: new Map(s.errors).set(url, friendlyErrorMessage(e)),
          loadingUrls,
        };
      });
    }
  },

  refresh: (url) => get().loadChildren(url, true),

  refreshAll: async () => {
    const { activeLocation, expanded } = get();
    if (!activeLocation) return;
    const urls = [...new Set<string>([activeLocation, ...expanded])];
    // Limita a concorrência para não saturar o SSH com dezenas de `svn list`.
    const LIMIT = 6;
    for (let i = 0; i < urls.length; i += LIMIT) {
      await Promise.all(urls.slice(i, i + LIMIT).map((u) => get().loadChildren(u, true)));
    }
  },

  fetchSubtree: async (url) => {
    set((s) => {
      const errors = new Map(s.errors);
      errors.delete(url);
      return { errors };
    });
    try {
      return await api.listTree(url);
    } catch (e) {
      set((s) => ({ errors: new Map(s.errors).set(url, friendlyErrorMessage(e)) }));
      return [];
    }
  },

  populateTree: (baseUrl, flat) => {
    const buckets = new Map<string, ListEntry[]>();
    const ensure = (u: string) => {
      let b = buckets.get(u);
      if (!b) buckets.set(u, (b = []));
      return b;
    };
    ensure(baseUrl); // a própria base sempre tem um balde (mesmo vazia)
    for (const e of flat) {
      // `e.name` é o caminho relativo (cru/encodado). Segmentos crus → URL.
      const segs = e.name.split("/");
      const leaf = segs.pop() ?? e.name;
      const parentUrl = segs.length ? `${baseUrl}/${segs.join("/")}` : baseUrl;
      ensure(parentUrl).push({ ...e, name: leaf });
      // Toda pasta precisa de um balde (mesmo vazia) p/ mostrar "pasta vazia".
      if (e.kind === "dir") ensure(`${baseUrl}/${e.name}`);
    }
    for (const b of buckets.values()) b.sort(compareEntries);
    // Sobrescreve os baldes da subárvore (também serve de refresh).
    const tree = new Map(get().tree);
    for (const [u, entries] of buckets) tree.set(u, entries);
    set({ tree });
  },

  expandSubtree: async (url) => {
    if (get().expandingUrls.has(url)) return;
    set((s) => ({ expandingUrls: new Set(s.expandingUrls).add(url) }));
    try {
      const flat = await get().fetchSubtree(url);
      if (flat.length > EXPAND_ALL_MAX_NODES) {
        toast.info(
          "Pasta grande demais para expandir de uma vez",
          `${flat.length.toLocaleString("pt-BR")} itens. Expanda por pasta para não travar a interface.`,
        );
        return;
      }
      get().populateTree(url, flat);
      const expanded = new Set(get().expanded);
      expanded.add(url);
      for (const e of flat) if (e.kind === "dir") expanded.add(`${url}/${e.name}`);
      set({ expanded });
    } finally {
      set((s) => {
        const expandingUrls = new Set(s.expandingUrls);
        expandingUrls.delete(url);
        return { expandingUrls };
      });
    }
  },

  collapseSubtree: (url) => {
    const { activeLocation, expanded } = get();
    if (url === activeLocation) {
      set({ expanded: new Set(activeLocation ? [activeLocation] : []) });
      return;
    }
    const prefix = `${url}/`;
    const next = new Set<string>();
    for (const u of expanded) if (u !== url && !u.startsWith(prefix)) next.add(u);
    set({ expanded: next });
  },

  revealNode: (node) => {
    const loc = get().activeLocation;
    if (!loc) {
      get().select(node);
      return;
    }
    const expanded = new Set(get().expanded);
    expanded.add(loc);
    const rawRel = node.url.startsWith(loc) ? node.url.slice(loc.length).replace(/^\//, "") : "";
    const segs = rawRel ? rawRel.split("/") : [];
    const ancestors: string[] = [];
    // Expande cada ancestral (todos menos o último segmento = o próprio nó).
    for (let i = 0; i < segs.length - 1; i++) {
      const u = `${loc}/${segs.slice(0, i + 1).join("/")}`;
      expanded.add(u);
      ancestors.push(u);
    }
    set({ expanded, selected: node, pendingReveal: node.url });
    // Rede de segurança: garante filhos carregados nos ancestrais (no-op se já em cache).
    const tree = get().tree;
    for (const u of [loc, ...ancestors]) if (!tree.has(u)) get().loadChildren(u);
  },

  setPreviewJump: (previewJump) => set({ previewJump }),
  consumeReveal: () => set({ pendingReveal: null }),

  openDialog: (kind, node) => set({ dialog: { kind, node } }),
  closeDialog: () => set({ dialog: null }),

  toggleDetails: () => {
    const detailsCollapsed = !get().detailsCollapsed;
    try {
      localStorage.setItem(DETAILS_COLLAPSED_KEY, detailsCollapsed ? "1" : "0");
    } catch {
      /* storage indisponível — ignora a persistência */
    }
    set({ detailsCollapsed });
  },

  setDetailsWidth: (width, commit = false) => {
    const detailsWidth = clampDetailsWidth(width);
    if (commit) {
      try {
        localStorage.setItem(DETAILS_WIDTH_KEY, String(detailsWidth));
      } catch {
        /* storage indisponível — ignora a persistência */
      }
    }
    set({ detailsWidth });
  },
}));

export { nodeKind };
