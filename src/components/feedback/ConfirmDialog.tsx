import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input, Switch } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { createRestorePoint } from "@/lib/backup";
import { useConfigStore } from "@/store/config";
import { useConfirmStore } from "@/store/confirm";

export function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending);
  const resolve = useConfirmStore((s) => s.resolve);
  const backupMode = useConfigStore((s) => s.config?.backupMode ?? "ask");
  const [text, setText] = useState("");
  const [backupOn, setBackupOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offerBackup = !!pending?.backup && backupMode !== "off";
  const forced = offerBackup && backupMode === "always";

  useEffect(() => {
    setText("");
    setBackupOn(!!pending?.backup && backupMode !== "off");
    setBusy(false);
    setError(null);
  }, [pending, backupMode]);

  const open = !!pending;
  const needsText = pending?.requireText;
  const unlocked = !needsText || text.trim() === needsText.trim();

  const close = () => {
    if (!busy) resolve(false);
  };

  const onConfirm = async () => {
    if (!unlocked || busy) return;
    if (offerBackup && backupOn && pending?.backup) {
      setBusy(true);
      setError(null);
      const ok = await createRestorePoint(pending.backup.wc, pending.backup.op);
      setBusy(false);
      if (!ok) {
        setError("Não consegui criar o backup. Tente de novo ou desmarque a opção para seguir sem ele.");
        return;
      }
    }
    resolve(true);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      icon={
        pending?.danger ? (
          <ShieldAlert className="size-5 text-danger" />
        ) : (
          <AlertTriangle className="size-5 text-warn" />
        )
      }
      title={pending?.title}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {pending?.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            variant={pending?.danger ? "danger" : "primary"}
            disabled={!unlocked || busy}
            loading={busy}
            onClick={onConfirm}
            autoFocus
          >
            {busy ? "Fazendo backup…" : pending?.confirmLabel ?? "Confirmar"}
          </Button>
        </>
      }
    >
      {pending?.message && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted selectable">
          {pending.message}
        </p>
      )}

      {offerBackup &&
        (forced ? (
          <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-[13px] text-ink">
            <ShieldCheck className="size-4 shrink-0 text-success" />
            <span>
              Um <span className="font-medium">ponto de restauração</span> será criado
              automaticamente antes de continuar.
            </span>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2.5">
            <Switch checked={backupOn} onChange={setBackupOn} />
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
              <span className="text-[13px] leading-snug text-ink">
                Fazer um <span className="font-medium">backup (ponto de restauração)</span> antes
                <span className="block text-[11px] text-faint">
                  Cópia completa da pasta para poder voltar atrás se algo der errado.
                </span>
              </span>
            </div>
          </div>
        ))}

      {busy && (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
          <Loader2 className="size-3.5 animate-spin text-brand" />
          Copiando a working copy… acompanhe o progresso no rodapé.
        </div>
      )}
      {error && <p className="mt-3 text-[12px] leading-snug text-danger">{error}</p>}

      {needsText && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs text-faint">
            Digite <span className="font-mono font-semibold text-ink">{needsText}</span> para
            confirmar:
          </p>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            placeholder={needsText}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && unlocked && !busy) onConfirm();
            }}
          />
        </div>
      )}
    </Modal>
  );
}
