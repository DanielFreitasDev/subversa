import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { HELP } from "@/lib/help";
import { reportOutput, tryRun } from "@/lib/op";

/**
 * Edita o comentário (svn:log) de uma revisão já enviada. É uma alteração de
 * revprop: vale no servidor para todos imediatamente e não vira commit — por
 * isso o aviso. O chamador recarrega o log via `onSaved`.
 */
export function EditRevisionMessageDialog({
  open,
  wcPath,
  revision,
  initialMessage,
  onClose,
  onSaved,
}: {
  open: boolean;
  wcPath: string;
  revision: string;
  initialMessage: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [msg, setMsg] = useState(initialMessage);
  const [busy, setBusy] = useState(false);

  // Recarrega o texto ao (re)abrir — inclusive para outra revisão.
  useEffect(() => {
    if (open) setMsg(initialMessage);
  }, [open, initialMessage, revision]);

  const canSave = msg.trim() !== initialMessage.trim() && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const out = await tryRun(
        () => api.setRevpropMessage(wcPath, revision, msg),
        "Falha ao editar o comentário",
      );
      if (out && reportOutput(out, "Comentário atualizado", `r${revision}`)) {
        onSaved();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      locked={busy}
      icon={<Pencil className="size-5" />}
      title={`Editar comentário · r${revision}`}
      description="Corrige a mensagem deste commit já enviado."
      help={HELP.editRevision}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!canSave}>
            Salvar comentário
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={6}
          autoFocus
          placeholder="Mensagem da revisão…"
          className="text-[13px]"
        />
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] leading-snug text-warn">
          Atenção: isto altera o comentário no servidor para todos, na hora — não é um novo commit
          e não dá para desfazer com facilidade.
        </p>
      </div>
    </Modal>
  );
}
