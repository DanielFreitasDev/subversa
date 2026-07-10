/**
 * Diálogo "Atalhos do editor" — o cartão de referência do keymap (estilo
 * IntelliJ), agrupado por tema. A fonte da verdade é `EDITOR_SHORTCUTS`
 * (keymap.ts); este componente só apresenta.
 */

import { Keyboard } from "lucide-react";

import { Kbd } from "@/components/ui/Kbd";
import { Modal } from "@/components/ui/Modal";
import { EDITOR_SHORTCUTS } from "./keymap";

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Keyboard className="size-5" />}
      title="Atalhos do editor"
      description="Keymap no estilo IntelliJ — Ctrl+roda do mouse ajusta o zoom."
    >
      <div className="grid max-h-[62vh] grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto pr-1 sm:grid-cols-2">
        {EDITOR_SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
              {g.group}
            </h3>
            <ul className="space-y-1.5">
              {g.items.map((it) => (
                <li key={it.label} className="flex items-center justify-between gap-4 text-[12.5px]">
                  <span className="text-muted">{it.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {it.keys.map((k, i) => (
                      <Kbd key={i}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
