/**
 * Autoria por linha (blame) em janela — leva o blame para FORA do navegador de
 * repositórios: na aba Alterações (arquivo local; anota a BASE) e no Histórico
 * (arquivo do servidor numa revisão). A visão integrada com busca do navegador
 * continua em `FilePreview` (aba Autoria), que tem o mesmo formato de linha.
 */

import { useEffect, useMemo, useState } from "react";
import { ServerCrash, Users } from "lucide-react";

import * as api from "@/lib/api";
import { tokenizeText } from "@/components/diff/highlight";
import { Empty } from "@/components/ui/Empty";
import { Modal } from "@/components/ui/Modal";
import { Loading } from "@/components/ui/Spinner";
import { friendlyErrorMessage } from "@/lib/errors";
import type { BlameLine } from "@/lib/types";
import { baseName } from "@/lib/utils";

/** Acima disto não renderiza tudo (mesmo teto do FilePreview). */
const MAX_LINES = 4000;

export interface BlameRequest {
  /** Caminho local (WC) ou URL remota do arquivo. */
  target: string;
  /** Revisão (histórico); ausente = BASE do arquivo local / HEAD da URL. */
  revision?: string;
}

export function BlameModal({ req, onClose }: { req: BlameRequest | null; onClose: () => void }) {
  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!req) return;
    let alive = true;
    setBlame(null);
    setError(null);
    setLoading(true);
    api
      .blame(req.target, req.revision)
      .then((b) => alive && setBlame(b))
      .catch((e) => alive && setError(friendlyErrorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [req]);

  const name = req ? baseName(req.target) : "";
  // Mesmo realce do diff/preview: junta as linhas e tokeniza o conjunto (preserva
  // strings/comentários multilinha); `null` cai para texto puro.
  const highlighted = useMemo(
    () => (blame ? tokenizeText(blame.map((b) => b.content).join("\n"), name) : null),
    [blame, name],
  );

  return (
    <Modal
      open={!!req}
      onClose={onClose}
      size="xl"
      className="max-w-6xl"
      icon={<Users className="size-5" />}
      title={`Autoria — ${name}`}
      description={
        req?.revision ? `quem escreveu cada linha, na revisão r${req.revision}` : "quem escreveu cada linha (BASE do arquivo)"
      }
    >
      <div className="h-[70vh] overflow-auto rounded-lg border border-line bg-panel">
        {loading ? (
          <Loading label="Carregando autoria…" />
        ) : error ? (
          <Empty icon={<ServerCrash className="size-7" />} title="Não consegui carregar a autoria" description={error} />
        ) : (
          <div className="hl-code py-2 font-mono text-[12px] leading-relaxed">
            {(blame ?? []).slice(0, MAX_LINES).map((b, i) => (
              <div key={b.lineNumber} className="flex hover:bg-panel-2/50">
                <span className="select-none px-2 text-right text-faint/60" style={{ minWidth: 48 }}>
                  {b.lineNumber}
                </span>
                <span
                  className="select-none truncate px-2 text-right text-brand"
                  style={{ minWidth: 56 }}
                  title={b.date ?? ""}
                >
                  r{b.revision ?? "?"}
                </span>
                <span
                  className="select-none truncate px-2 text-faint"
                  style={{ minWidth: 110 }}
                  title={b.author ?? ""}
                >
                  {b.author ?? "—"}
                </span>
                <code className="whitespace-pre px-2 text-ink">
                  {(highlighted?.[i] ?? [{ text: b.content, className: "", changed: false }]).map((s, j) => (
                    <span key={j} className={s.className}>
                      {s.text}
                    </span>
                  ))}
                </code>
              </div>
            ))}
            {(blame?.length ?? 0) > MAX_LINES && (
              <div className="px-4 py-2 text-center text-[11px] text-faint">
                Mostrando as primeiras {MAX_LINES.toLocaleString("pt-BR")} linhas.
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
