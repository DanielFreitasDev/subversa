/** Navegação e estado de UI global (visão atual, paleta, diálogos). */

import { create } from "zustand";

export type ViewId =
  | "overview"
  | "incoming"
  | "changes"
  | "history"
  | "branches"
  | "merge"
  | "repos"
  | "log"
  | "backups"
  | "settings";

export type DiffMode = "unified" | "split";
/** Natureza do arquivo no diff — decide o modo de exibição padrão. */
export type DiffKind = "added" | "modified";

const DIFF_MODE_KEYS: Record<DiffKind, string> = {
  added: "subversa.diffMode.added",
  modified: "subversa.diffMode.modified",
};
// Padrões pedidos: arquivo novo abre em "Unificado", alterado em "Lado a lado".
const DIFF_MODE_DEFAULTS: Record<DiffKind, DiffMode> = {
  added: "unified",
  modified: "split",
};

function initialDiffMode(kind: DiffKind): DiffMode {
  try {
    const v = localStorage.getItem(DIFF_MODE_KEYS[kind]);
    return v === "split" || v === "unified" ? v : DIFF_MODE_DEFAULTS[kind];
  } catch {
    return DIFF_MODE_DEFAULTS[kind]; // storage indisponível (modo privativo/quota)
  }
}

interface UiState {
  view: ViewId;
  paletteOpen: boolean;
  checkoutOpen: boolean;
  /** URL pré-preenchida no checkout (ex.: vinda do navegador de repositórios). */
  checkoutUrl: string | null;
  createBranchOpen: boolean;
  /**
   * Modo do visualizador de diff por natureza do arquivo (compartilhado entre
   * Alterações, Entrada e Histórico): arquivo novo e arquivo alterado guardam
   * preferências separadas, cada uma persistida.
   */
  diffModeAdded: DiffMode;
  diffModeModified: DiffMode;

  setView: (v: ViewId) => void;
  setPalette: (open: boolean) => void;
  togglePalette: () => void;
  setCheckout: (open: boolean, url?: string | null) => void;
  setCreateBranch: (open: boolean) => void;
  setDiffMode: (kind: DiffKind, m: DiffMode) => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "overview",
  paletteOpen: false,
  checkoutOpen: false,
  checkoutUrl: null,
  createBranchOpen: false,
  diffModeAdded: initialDiffMode("added"),
  diffModeModified: initialDiffMode("modified"),

  setView: (view) => set({ view }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setCheckout: (checkoutOpen, checkoutUrl = null) =>
    set({ checkoutOpen, checkoutUrl: checkoutOpen ? checkoutUrl : null }),
  setCreateBranch: (createBranchOpen) => set({ createBranchOpen }),
  setDiffMode: (kind, mode) => {
    try {
      localStorage.setItem(DIFF_MODE_KEYS[kind], mode);
    } catch {
      /* storage indisponível — ignora a persistência */
    }
    set(kind === "added" ? { diffModeAdded: mode } : { diffModeModified: mode });
  },
}));
