/** Sistema de notificações (toasts). */

import { create } from "zustand";

export type ToastKind = "success" | "error" | "info" | "warn";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  /** Duração em ms; 0 = não some sozinho. */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let seq = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = seq++;
    const duration = t.duration ?? (t.kind === "error" ? 8000 : 4200);
    set((s) => ({ toasts: [...s.toasts, { ...t, id, duration }] }));
    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Atalhos imperativos para usar fora de componentes. */
export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "success", title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "error", title, description, duration: 9000 }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "info", title, description }),
  warn: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "warn", title, description }),
};
