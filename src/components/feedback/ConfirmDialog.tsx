import { useEffect, useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useConfirmStore } from "@/store/confirm";

export function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending);
  const resolve = useConfirmStore((s) => s.resolve);
  const [text, setText] = useState("");

  useEffect(() => {
    setText("");
  }, [pending]);

  const open = !!pending;
  const needsText = pending?.requireText;
  const unlocked = !needsText || text.trim() === needsText.trim();

  return (
    <Modal
      open={open}
      onClose={() => resolve(false)}
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
          <Button variant="ghost" onClick={() => resolve(false)}>
            {pending?.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            variant={pending?.danger ? "danger" : "primary"}
            disabled={!unlocked}
            onClick={() => resolve(true)}
            autoFocus
          >
            {pending?.confirmLabel ?? "Confirmar"}
          </Button>
        </>
      }
    >
      {pending?.message && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted selectable">
          {pending.message}
        </p>
      )}
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && unlocked) resolve(true);
            }}
          />
        </div>
      )}
    </Modal>
  );
}
