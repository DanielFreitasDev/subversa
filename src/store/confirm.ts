/** Diálogo de confirmação imperativo baseado em Promise. */

import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Texto do botão de confirmação. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Estilo destrutivo (vermelho) — para operações irreversíveis. */
  danger?: boolean;
  /** Frase que o usuário precisa digitar para liberar o botão (opcional). */
  requireText?: string;
  /** Ícone (nome do lucide) opcional. */
  icon?: string;
}

interface ConfirmState {
  pending: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
  ask: (opts: ConfirmOptions) => Promise<boolean>;
  resolve: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  ask: (opts) =>
    new Promise<boolean>((resolve) => {
      set({ pending: { ...opts, resolve } });
    }),
  resolve: (ok) => {
    const p = get().pending;
    if (p) p.resolve(ok);
    set({ pending: null });
  },
}));

/** Açúcar para usar fora de componentes. */
export const confirm = (opts: ConfirmOptions) => useConfirmStore.getState().ask(opts);
