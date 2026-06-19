/** Navegação e estado de UI global (visão atual, paleta, diálogos). */

import { create } from "zustand";

export type ViewId =
  | "overview"
  | "changes"
  | "history"
  | "branches"
  | "merge"
  | "settings";

interface UiState {
  view: ViewId;
  paletteOpen: boolean;
  checkoutOpen: boolean;
  createBranchOpen: boolean;

  setView: (v: ViewId) => void;
  setPalette: (open: boolean) => void;
  togglePalette: () => void;
  setCheckout: (open: boolean) => void;
  setCreateBranch: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "overview",
  paletteOpen: false,
  checkoutOpen: false,
  createBranchOpen: false,

  setView: (view) => set({ view }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setCheckout: (checkoutOpen) => set({ checkoutOpen }),
  setCreateBranch: (createBranchOpen) => set({ createBranchOpen }),
}));
