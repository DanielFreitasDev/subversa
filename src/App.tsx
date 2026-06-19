import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { suggestedBaseDir } from "@/lib/api";
import { useConfigStore } from "@/store/config";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";

function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-4">
        <div className="flex size-14 animate-pulse items-center justify-center rounded-2xl bg-brand-gradient shadow-pop">
          <GitBranch className="size-7 text-white" strokeWidth={2.4} />
        </div>
        <div className="text-sm text-faint">Carregando Subversa…</div>
      </div>
    </div>
  );
}

export default function App() {
  const load = useConfigStore((s) => s.load);
  const loaded = useConfigStore((s) => s.loaded);
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
      await refresh();
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
  return <AppShell />;
}
