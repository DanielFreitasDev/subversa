import { useEffect, useRef, useState } from "react";
import { GitMerge, FileCheck2, FileX2, FileUp, ExternalLink, FileDiff } from "lucide-react";

import * as api from "@/lib/api";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { Modal } from "@/components/ui/Modal";
import { Loading } from "@/components/ui/Spinner";
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
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const tool = useConfigStore((s) => s.config?.externalDiffTool ?? "meld");
  // Token de requisição: invalida um getDiff em voo quando o arquivo muda ou a
  // prévia é alternada de novo (evita exibir o diff de outro arquivo).
  const reqRef = useRef(0);

  // Reinicia a prévia ao trocar de arquivo.
  useEffect(() => {
    reqRef.current++;
    setShowDiff(false);
    setDiff(null);
    setLoadingDiff(false);
  }, [path]);

  const togglePreview = async () => {
    const next = !showDiff;
    setShowDiff(next);
    if (next && diff === null && path && !loadingDiff) {
      const req = ++reqRef.current;
      setLoadingDiff(true);
      const t = await api.getDiff(wcPath, [path]).catch(() => "");
      if (req !== reqRef.current) return; // troca de arquivo assumiu
      setDiff(t);
      setLoadingDiff(false);
    }
  };

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
      size="lg"
      icon={<GitMerge className="size-5" />}
      title="Resolver conflito"
      description={path ? baseName(path) : undefined}
    >
      <div className="space-y-2">
        <div className="flex gap-2">
          <button
            onClick={() => tryRun(() => api.openExternalDiff(wcPath, tool), "Não consegui abrir o diff externo")}
            className="flex flex-1 items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-left transition-colors hover:bg-panel-3"
          >
            <ExternalLink className="size-4 text-brand" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-ink">Abrir no {tool}</div>
              <div className="text-[11px] text-faint">Editar manualmente em 3 painéis</div>
            </div>
          </button>
          <button
            onClick={togglePreview}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:bg-panel-2"
          >
            <FileDiff className="size-4 text-muted" />
            <div className="text-[13px] font-medium text-ink">
              {showDiff ? "Ocultar" : "Ver diferenças"}
            </div>
          </button>
        </div>

        {showDiff && (
          <div className="max-h-[42vh] overflow-y-auto rounded-lg border border-line bg-panel p-2">
            {loadingDiff ? (
              <Loading label="Gerando diff…" />
            ) : (
              <DiffViewer text={diff ?? ""} />
            )}
          </div>
        )}

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
