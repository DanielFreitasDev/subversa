import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Titlebar } from "@/components/layout/Titlebar";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { checkPrerequisites, suggestedBaseDir } from "@/lib/api";
import type { Prerequisites } from "@/lib/types";
import { useConfigStore } from "@/store/config";
import { useConfirmStore } from "@/store/confirm";
import { useRepoBrowserStore } from "@/store/repoBrowser";
import { toast } from "@/store/toast";
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

/** Tela bloqueante quando o cliente `svn` não está disponível no PATH. */
function PrereqGate({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-danger/12 text-danger ring-1 ring-danger/30">
          <AlertTriangle className="size-7" />
        </div>
        <h1 className="text-lg font-semibold text-ink">Subversion não encontrado</h1>
        <p className="text-sm leading-relaxed text-muted">
          O Subversa precisa do cliente <code className="rounded bg-panel-2 px-1">svn</code> (1.8+)
          disponível no PATH. Instale o Subversion e verifique novamente.
        </p>
        <p className="text-[12px] text-faint">
          Debian/Ubuntu: <code className="rounded bg-panel-2 px-1">sudo apt install subversion</code>
        </p>
        <Button variant="primary" onClick={onRetry}>
          <RefreshCw className="size-4" /> Verificar de novo
        </Button>
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
  const [prereq, setPrereq] = useState<Prerequisites | null>(null);

  // Boot: carrega config, checa pré-requisitos, define a pasta-base e detecta.
  useEffect(() => {
    (async () => {
      const cfg = await load();
      // Pré-requisitos de runtime: `svn` é essencial (gate bloqueante adiante);
      // `sshpass` só quando o modo de autenticação exige — aí só avisamos.
      try {
        const pre = await checkPrerequisites();
        setPrereq(pre);
        if (pre.sshpassNeeded && !pre.sshpassOk) {
          toast.warn(
            "sshpass não encontrado",
            "A autenticação por senha precisa do sshpass no PATH. Instale-o ou use uma chave SSH.",
          );
        }
      } catch {
        /* se a checagem falhar, não bloqueia o boot */
      }
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

  // Re-verifica os pré-requisitos (botão do gate, após instalar o svn).
  const recheckPrereqs = async () => {
    try {
      const pre = await checkPrerequisites();
      setPrereq(pre);
      if (pre.svnOk && config?.host?.trim()) await refresh();
    } catch {
      /* ignore */
    }
  };

  // Atalho global da paleta de comandos (⌘K / Ctrl+K).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Não abre a paleta por cima de um diálogo/confirmação modal.
        if (
          useConfirmStore.getState().pending ||
          useUiStore.getState().checkoutOpen ||
          useUiStore.getState().createBranchOpen ||
          useRepoBrowserStore.getState().dialog
        )
          return;
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette]);

  const content = (() => {
    if (!loaded || booting) return <Splash />;
    if (prereq && !prereq.svnOk) return <PrereqGate onRetry={recheckPrereqs} />;
    if (!config?.host?.trim()) return <SetupView />;
    return <AppShell />;
  })();

  // Barra de título própria sempre no topo (mesmo na Splash/Setup), pois a janela
  // roda sem decoração nativa — é o único jeito de mover/fechar antes do app subir.
  return (
    <div className="flex h-full flex-col">
      <Titlebar />
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
}
