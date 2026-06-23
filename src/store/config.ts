/** Configuração da aplicação + aplicação do tema. */

import { create } from "zustand";

import * as api from "@/lib/api";
import type { AppConfig } from "@/lib/types";
import { toast } from "./toast";

interface ConfigState {
  config: AppConfig | null;
  loaded: boolean;
  load: () => Promise<AppConfig>;
  save: (patch: Partial<AppConfig>) => Promise<void>;
  applyTheme: (theme: AppConfig["theme"]) => void;
}

function resolveTheme(theme: AppConfig["theme"]): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return theme;
}

// Listener único do tema "system": acompanha a troca claro/escuro do SO em
// runtime, registrado só enquanto o tema for "system".
let mql: MediaQueryList | null = null;
let mqlHandler: (() => void) | null = null;

function paintTheme(theme: AppConfig["theme"]) {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("theme-light", resolved === "light");
  document.documentElement.style.colorScheme = resolved;

  if (typeof window !== "undefined" && window.matchMedia) {
    if (!mql) mql = window.matchMedia("(prefers-color-scheme: light)");
    if (mqlHandler) {
      mql.removeEventListener("change", mqlHandler);
      mqlHandler = null;
    }
    if (theme === "system") {
      mqlHandler = () => paintTheme("system");
      mql.addEventListener("change", mqlHandler);
    }
  }
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  loaded: false,
  load: async () => {
    const config = await api.loadConfig();
    paintTheme(config.theme);
    set({ config, loaded: true });
    return config;
  },
  save: async (patch) => {
    const current = get().config;
    if (!current) return;
    const next = { ...current, ...patch };
    set({ config: next });
    paintTheme(next.theme);
    try {
      await api.saveConfig(next);
    } catch (e) {
      // Persistência falhou: reverte o estado em memória e o tema para não
      // divergir do que está em disco.
      set({ config: current });
      paintTheme(current.theme);
      toast.error("Não consegui salvar a configuração", String(e));
    }
  },
  applyTheme: paintTheme,
}));
