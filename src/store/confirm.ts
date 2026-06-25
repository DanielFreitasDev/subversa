/** Diálogo de confirmação imperativo baseado em Promise. */

import { create } from "zustand";

import type { WorkingCopy } from "@/lib/types";

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
  /**
   * Oferece um backup (ponto de restauração) antes de confirmar. Quando
   * presente e o modo de backup não for `off`, o diálogo mostra a opção e cria
   * o backup (aguardando) antes de resolver `true`.
   */
  backup?: { wc: WorkingCopy; op: string };
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
      // Se já houver um confirm aberto, resolve o anterior como cancelado para
      // não deixar aquele `await confirm()` pendente para sempre.
      get().pending?.resolve(false);
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
