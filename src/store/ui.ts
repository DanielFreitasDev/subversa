/** Navegação e estado de UI global (visão atual, paleta, diálogos). */

import { create } from "zustand";

export type ViewId =
  | "overview"
  | "changes"
  | "history"
  | "branches"
  | "merge"
  | "repos"
  | "settings";

export type DiffMode = "unified" | "split";

const DIFF_MODE_KEY = "subversa.diffMode";

function initialDiffMode(): DiffMode {
  try {
    return localStorage.getItem(DIFF_MODE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified"; // storage indisponível (modo privativo/quota)
  }
}

interface UiState {
  view: ViewId;
  paletteOpen: boolean;
  checkoutOpen: boolean;
  /** URL pré-preenchida no checkout (ex.: vinda do navegador de repositórios). */
  checkoutUrl: string | null;
  createBranchOpen: boolean;
  /** Modo do visualizador de diff, compartilhado entre Alterações e Histórico. */
  diffMode: DiffMode;

  setView: (v: ViewId) => void;
  setPalette: (open: boolean) => void;
  togglePalette: () => void;
  setCheckout: (open: boolean, url?: string | null) => void;
  setCreateBranch: (open: boolean) => void;
  setDiffMode: (m: DiffMode) => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "overview",
  paletteOpen: false,
  checkoutOpen: false,
  checkoutUrl: null,
  createBranchOpen: false,
  diffMode: initialDiffMode(),

  setView: (view) => set({ view }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setCheckout: (checkoutOpen, checkoutUrl = null) =>
    set({ checkoutOpen, checkoutUrl: checkoutOpen ? checkoutUrl : null }),
  setCreateBranch: (createBranchOpen) => set({ createBranchOpen }),
  setDiffMode: (diffMode) => {
    try {
      localStorage.setItem(DIFF_MODE_KEY, diffMode);
    } catch {
      /* storage indisponível — ignora a persistência */
    }
    set({ diffMode });
  },
}));
