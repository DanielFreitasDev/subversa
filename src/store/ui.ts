/** Navegação e estado de UI global (visão atual, paleta, diálogos). */

import { create } from "zustand";

export type ViewId =
  | "overview"
  | "incoming"
  | "changes"
  | "history"
  | "graph"
  | "branches"
  | "merge"
  | "repos"
  | "log"
  | "backups"
  | "settings";

export type DiffMode = "unified" | "split";
/** Natureza do arquivo no diff — decide o modo de exibição padrão. */
export type DiffKind = "added" | "modified";

/**
 * Tratamento de espaços em branco no diff (estilo IntelliJ), aplicado no
 * frontend sobre o diff já parseado:
 * - `none` — não ignora nada (padrão);
 * - `trim` — ignora espaços no início/fim da linha;
 * - `ignore` — ignora qualquer espaço, em qualquer posição;
 * - `ignoreEmpty` — ignora espaços e linhas em branco;
 * - `ignoreFormat` — ignora espaços e linhas de import (heurística).
 */
export type WsMode = "none" | "trim" | "ignore" | "ignoreEmpty" | "ignoreFormat";
/**
 * Granularidade do realce de alterações (estilo IntelliJ):
 * - `lines` — só o fundo da linha alterada;
 * - `words` — realça as palavras alteradas (padrão);
 * - `split` — palavras, dividindo alterações grandes;
 * - `chars` — realça os caracteres alterados;
 * - `none` — sem realce algum.
 */
export type HighlightMode = "lines" | "words" | "split" | "chars" | "none";

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

// Espaços/realce são preferências globais do diff (não por natureza do arquivo).
const WS_MODE_KEY = "subversa.diff.wsMode";
const HIGHLIGHT_MODE_KEY = "subversa.diff.highlightMode";
const WS_MODES: WsMode[] = ["none", "trim", "ignore", "ignoreEmpty", "ignoreFormat"];
const HIGHLIGHT_MODES: HighlightMode[] = ["lines", "words", "split", "chars", "none"];

function initialFrom<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
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
  /** Tratamento de espaços em branco no diff (global, persistido). */
  wsMode: WsMode;
  /** Granularidade do realce de alterações (global, persistido). */
  highlightMode: HighlightMode;

  setView: (v: ViewId) => void;
  setPalette: (open: boolean) => void;
  togglePalette: () => void;
  setCheckout: (open: boolean, url?: string | null) => void;
  setCreateBranch: (open: boolean) => void;
  setDiffMode: (kind: DiffKind, m: DiffMode) => void;
  setWsMode: (m: WsMode) => void;
  setHighlightMode: (m: HighlightMode) => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "overview",
  paletteOpen: false,
  checkoutOpen: false,
  checkoutUrl: null,
  createBranchOpen: false,
  diffModeAdded: initialDiffMode("added"),
  diffModeModified: initialDiffMode("modified"),
  wsMode: initialFrom(WS_MODE_KEY, WS_MODES, "none"),
  highlightMode: initialFrom(HIGHLIGHT_MODE_KEY, HIGHLIGHT_MODES, "words"),

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
  setWsMode: (wsMode) => {
    try {
      localStorage.setItem(WS_MODE_KEY, wsMode);
    } catch {
      /* storage indisponível — ignora a persistência */
    }
    set({ wsMode });
  },
  setHighlightMode: (highlightMode) => {
    try {
      localStorage.setItem(HIGHLIGHT_MODE_KEY, highlightMode);
    } catch {
      /* storage indisponível — ignora a persistência */
    }
    set({ highlightMode });
  },
}));
