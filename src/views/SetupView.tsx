/**
 * Tela de primeira execução. Sem servidor configurado (host vazio), o app abre
 * aqui: o usuário informa o host SSH e escolhe semear os projetos-preset da
 * equipe ou começar só com a conexão. Tudo é editável depois em Configurações.
 */

import { useState } from "react";
import { ArrowRight, Server } from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { Logo } from "@/components/ui/Logo";
import { HELP } from "@/lib/help";
import { useConfigStore } from "@/store/config";
import { toast } from "@/store/toast";
import { useWorkspaceStore } from "@/store/workspace";

export function SetupView() {
  const save = useConfigStore((s) => s.save);
  const refresh = useWorkspaceStore((s) => s.refresh);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState<"preset" | "empty" | null>(null);

  const h = host.trim();
  const valid = h.length > 0 && !/\s/.test(h);
  const repoBase = valid ? `svn+ssh://${h}/usr/svn/` : "";

  const finish = async (mode: "preset" | "empty") => {
    if (!valid || busy) return;
    setBusy(mode);
    try {
      if (mode === "preset") {
        const cfg = await api.presetConfig(h);
        await save(cfg);
      } else {
        await save({ host: h, repoBase, repoRoots: [], projects: [] });
      }
      await refresh();
      // O config agora tem host → o App.tsx troca para a aplicação sozinho.
    } catch (e) {
      toast.error("Não consegui salvar a configuração", String(e));
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={56} className="rounded-[22%] shadow-pop" />
          <div>
            <h1 className="text-xl font-semibold text-ink">Bem-vindo ao Subversa</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-faint">
              Informe o servidor SVN para começar. Você pode ajustar tudo depois em Configurações.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-panel p-5">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <Server className="size-3.5 text-brand" /> Host SSH
              <HelpPopover content={HELP.setupHost} className="ml-0.5" />
            </span>
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && finish("preset")}
              placeholder="usuario@servidor   (ex.: ana@172.25.136.61)"
              autoFocus
              className="font-mono text-[13px]"
            />
          </label>

          {repoBase && (
            <div className="mt-3 break-all rounded-lg bg-panel-2 px-3 py-2 font-mono text-[11px] text-muted">
              base do repositório: {repoBase}
            </div>
          )}

          <div className="mt-5 space-y-2">
            <Button
              variant="primary"
              size="lg"
              className="w-full justify-center"
              onClick={() => finish("preset")}
              loading={busy === "preset"}
              disabled={!valid || !!busy}
            >
              {busy !== "preset" && <ArrowRight className="size-4" />}
              Continuar com meus projetos padrão
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-center"
              onClick={() => finish("empty")}
              loading={busy === "empty"}
              disabled={!valid || !!busy}
            >
              Começar vazio (só o host)
            </Button>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-faint">
            “Projetos padrão” cadastra as raízes e os projetos do fluxo da equipe a partir do host.
            “Começar vazio” cria só a conexão — você adiciona localizações depois.
          </p>
        </div>
      </div>
    </div>
  );
}
