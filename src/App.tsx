import { useEffect, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { Logo } from "@/components/ui/Logo";
import { suggestedBaseDir } from "@/lib/api";
import { useConfigStore } from "@/store/config";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";
import { SetupView } from "@/views/SetupView";

function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-4">
        <Logo size={56} className="animate-pulse rounded-[22%] shadow-pop" />
        <div className="text-sm text-faint">Carregando Subversa…</div>
      </div>
    </div>
  );
}

export default function App() {
  const load = useConfigStore((s) => s.load);
  const loaded = useConfigStore((s) => s.loaded);
  const config = useConfigStore((s) => s.config);
  const setBaseDir = useWorkspaceStore((s) => s.setBaseDir);
  const refresh = useWorkspaceStore((s) => s.refresh);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const [booting, setBooting] = useState(true);

  // Boot: carrega config, define a pasta-base e detecta as working copies.
  useEffect(() => {
    (async () => {
      const cfg = await load();
      let base = cfg.baseDir;
      try {
        // Na primeira execução (ou pasta inexistente), sugere uma melhor.
        if (!base) base = await suggestedBaseDir();
      } catch {
        /* ignore */
      }
      setBaseDir(base);
      // Sem host configurado → primeira execução (tela de setup); detecta depois.
      if (cfg.host?.trim()) await refresh();
      setBooting(false);
    })();
  }, [load, setBaseDir, refresh]);

  // Atalho global da paleta de comandos (⌘K / Ctrl+K).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette]);

  if (!loaded || booting) return <Splash />;
  if (!config?.host?.trim()) return <SetupView />;
  return <AppShell />;
}
