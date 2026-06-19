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
  refresh: () => Promise<void>;
  refreshOne: (path: string) => Promise<void>;
  select: (path: string | null) => void;
  selected: () => WorkingCopy | null;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  baseDir: "",
  workingCopies: [],
  selectedPath: null,
  loading: false,
  error: null,

  setBaseDir: (dir) => set({ baseDir: dir }),

  refresh: async () => {
    const base = get().baseDir;
    if (!base) return;
    set({ loading: true, error: null });
    try {
      const wcs = await api.detectWorkingCopies(base);
      // mantém a seleção se ainda existir; senão seleciona a primeira.
      const prev = get().selectedPath;
      const stillThere = wcs.some((w) => w.path === prev);
      set({
        workingCopies: wcs,
        loading: false,
        selectedPath: stillThere ? prev : wcs[0]?.path ?? null,
      });
    } catch (e) {
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

  select: (path) => set({ selectedPath: path }),

  selected: () => {
    const { workingCopies, selectedPath } = get();
    return workingCopies.find((w) => w.path === selectedPath) ?? null;
  },
}));
