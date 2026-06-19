import { useState } from "react";
import { GitMerge, FileCheck2, FileX2, FileUp, ExternalLink } from "lucide-react";

import * as api from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { reportOutput, tryRun } from "@/lib/op";
import { baseName } from "@/lib/utils";
import { useConfigStore } from "@/store/config";

const OPTIONS = [
  {
    accept: "working",
    label: "Marcar como resolvido",
    hint: "Já editei o arquivo e escolhi o conteúdo certo",
    icon: <FileCheck2 className="size-4" />,
  },
  {
    accept: "mine-full",
    label: "Ficar com a minha versão",
    hint: "Descarta o que veio do servidor (mine-full)",
    icon: <FileUp className="size-4" />,
  },
  {
    accept: "theirs-full",
    label: "Ficar com a do servidor",
    hint: "Descarta as minhas mudanças (theirs-full)",
    icon: <FileX2 className="size-4" />,
  },
] as const;

export function ConflictDialog({
  open,
  path,
  wcPath,
  onClose,
  onResolved,
}: {
  open: boolean;
  path: string | null;
  wcPath: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const tool = useConfigStore((s) => s.config?.externalDiffTool ?? "meld");

  const resolveAs = async (accept: string) => {
    if (!path) return;
    setBusy(accept);
    const out = await tryRun(() => api.resolve(path, accept), "Falha ao resolver");
    setBusy(null);
    if (out && reportOutput(out, "Conflito resolvido")) {
      onResolved();
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      icon={<GitMerge className="size-5" />}
      title="Resolver conflito"
      description={path ? baseName(path) : undefined}
    >
      <div className="space-y-2">
        <button
          onClick={() => api.openExternalDiff(wcPath, tool)}
          className="flex w-full items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-left transition-colors hover:bg-panel-3"
        >
          <ExternalLink className="size-4 text-brand" />
          <div className="flex-1">
            <div className="text-[13px] font-medium text-ink">Abrir no {tool}</div>
            <div className="text-[11px] text-faint">Editar manualmente em 3 painéis</div>
          </div>
        </button>

        {OPTIONS.map((opt) => (
          <button
            key={opt.accept}
            disabled={!!busy}
            onClick={() => resolveAs(opt.accept)}
            className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:bg-panel-2 disabled:opacity-50"
          >
            <span className="text-muted">{opt.icon}</span>
            <div className="flex-1">
              <div className="text-[13px] font-medium text-ink">{opt.label}</div>
              <div className="text-[11px] text-faint">{opt.hint}</div>
            </div>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        Dica: edite o arquivo procurando os marcadores <code className="font-mono">{"<<<<<<<"}</code>{" "}
        <code className="font-mono">{"======="}</code> <code className="font-mono">{">>>>>>>"}</code>{" "}
        e depois use “Marcar como resolvido”.
      </p>
    </Modal>
  );
}
