/**
 * Pilha de **desfazer** (Ctrl+Z) das reversões, espelhando a pilha do backend
 * (`svn::undo`). Cada reversão bem-sucedida empilha um ponto; desfazer chama
 * `undo_revert`, que restaura o conteúdo e o agendamento svn capturados antes da
 * reversão. Some ao recarregar o app (igual ao backend, que guarda só em memória).
 */

import { create } from "zustand";

import * as api from "@/lib/api";
import { reportOutput, tryRun } from "@/lib/op";
import { useWorkspaceStore } from "@/store/workspace";

export interface UndoItem {
  /** Id do ponto de desfazer no backend. */
  id: number;
  /** Rótulo da operação (ex.: "reverter trecho"). */
  label: string;
  /** Working copy onde a reversão ocorreu (escopo do Ctrl+Z). */
  wcPath: string;
  /** Quantos arquivos serão restaurados. */
  fileCount: number;
}

interface UndoState {
  stack: UndoItem[];
  /**
   * Incrementa a cada desfazer concluído — a aba Alterações observa para
   * recarregar a lista e o diff sem que o desfazer precise conhecer a view.
   */
  reloadKey: number;
  running: boolean;
  push: (item: UndoItem) => void;
  /** O ponto mais recente de uma working copy (o que o Ctrl+Z desfaz). */
  latestFor: (wcPath: string) => UndoItem | undefined;
  /** Executa o desfazer de um ponto específico (toast "Desfazer" ou Ctrl+Z). */
  run: (id: number) => Promise<void>;
}

/** Quantos pontos manter (o backend poda em 20; aqui um pouco mais, por folga). */
const MAX = 30;

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  reloadKey: 0,
  running: false,
  push: (item) => set((s) => ({ stack: [...s.stack, item].slice(-MAX) })),
  latestFor: (wcPath) => {
    const s = get().stack;
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].wcPath === wcPath) return s[i];
    }
    return undefined;
  },
  run: async (id) => {
    if (get().running) return;
    const item = get().stack.find((x) => x.id === id);
    if (!item) return;
    set({ running: true });
    try {
      const out = await tryRun(() => api.undoRevert(id), "Falha ao desfazer");
      // Sai da pilha de qualquer modo (foi consumido — ou já tinha expirado).
      set((s) => ({ stack: s.stack.filter((x) => x.id !== id) }));
      if (
        out &&
        reportOutput(out, "Reversão desfeita", `${item.fileCount} arquivo(s) restaurado(s)`)
      ) {
        await useWorkspaceStore.getState().refreshOne(item.wcPath);
        set((s) => ({ reloadKey: s.reloadKey + 1 }));
      }
    } finally {
      set({ running: false });
    }
  },
}));
