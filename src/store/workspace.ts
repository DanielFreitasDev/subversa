/** Estado das working copies detectadas e da seleção atual. */

import { create } from "zustand";

import * as api from "@/lib/api";
import type { WorkingCopy } from "@/lib/types";

interface WorkspaceState {
  baseDir: string;
  workingCopies: WorkingCopy[];
  selectedPath: string | null;
  loading: boolean;
  error: string | null;

  setBaseDir: (dir: string) => void;
  refresh: (base?: string) => Promise<void>;
  refreshOne: (path: string) => Promise<void>;
  select: (path: string | null) => void;
  selected: () => WorkingCopy | null;
}

// Época de detecção: refreshes concorrentes (boot, troca de pasta, botões)
// podem resolver fora de ordem; só o mais recente pode escrever o resultado.
let refreshEpoch = 0;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  baseDir: "",
  workingCopies: [],
  selectedPath: null,
  loading: false,
  error: null,

  setBaseDir: (dir) => set({ baseDir: dir }),

  refresh: async (base) => {
    const target = (base ?? get().baseDir).trim();
    if (!target) return;
    const epoch = ++refreshEpoch;
    set({ loading: true, error: null });
    try {
      const wcs = await api.detectWorkingCopies(target);
      if (epoch !== refreshEpoch) return; // um refresh mais novo assumiu
      // mantém a seleção se ainda existir (relida após o await); senão a primeira.
      const prev = get().selectedPath;
      const stillThere = wcs.some((w) => w.path === prev);
      set({
        workingCopies: wcs,
        loading: false,
        selectedPath: stillThere ? prev : wcs[0]?.path ?? null,
      });
    } catch (e) {
      if (epoch !== refreshEpoch) return;
      set({ loading: false, error: String(e) });
    }
  },

  refreshOne: async (path) => {
    try {
      const wc = await api.getInfo(path);
      set((s) => ({
        workingCopies: s.workingCopies.map((w) => (w.path === path ? wc : w)),
      }));
    } catch {
      // se falhar (ex.: removida), recarrega tudo.
      await get().refresh();
    }
  },

  select: (path) =>
    set((s) =>
      path == null || s.workingCopies.some((w) => w.path === path)
        ? { selectedPath: path }
        : s,
    ),

  selected: () => {
    const { workingCopies, selectedPath } = get();
    return workingCopies.find((w) => w.path === selectedPath) ?? null;
  },
}));
