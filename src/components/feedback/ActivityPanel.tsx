/**
 * Painel de atividade global: cartões flutuantes (centro-inferior) que mostram
 * o progresso das operações de transferência disparadas fora de um modal
 * (update, switch, merge, export). O backend emite o evento `op-progress`.
 *
 * checkout NÃO aparece aqui: tem barra inline no próprio modal, que fica aberto
 * durante o download — a atenção do usuário já está lá.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  GitBranch,
  GitMerge,
  HardDriveDownload,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

import type { OpProgress, TransferOp } from "@/lib/types";
import { TransferProgress } from "./TransferProgress";

const PANEL_OPS: Partial<Record<TransferOp, { label: string; icon: ReactNode }>> = {
  update: { label: "Atualizando", icon: <RefreshCw className="size-4" /> },
  switch: { label: "Trocando de linha", icon: <GitBranch className="size-4" /> },
  merge: { label: "Mesclando", icon: <GitMerge className="size-4" /> },
  export: { label: "Exportando", icon: <HardDriveDownload className="size-4" /> },
  backup: { label: "Fazendo backup", icon: <Archive className="size-4" /> },
  restore: { label: "Restaurando backup", icon: <RotateCcw className="size-4" /> },
};

/** Quanto tempo o cartão fica mostrando o total final antes de sumir. */
const LINGER_MS = 700;

export function ActivityPanel() {
  const [ops, setOps] = useState<OpProgress[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    const pending = timers.current;

    listen<OpProgress>("op-progress", (e) => {
      if (!alive) return;
      const p = e.payload;
      if (!PANEL_OPS[p.op]) return; // checkout tem barra própria; o resto ignoramos

      if (p.done) {
        // Houve transferência? Mantém o total visível um instante, depois some.
        // Operação instantânea (0 arquivos) some na hora, sem piscar.
        if (p.count > 0) {
          setOps((cur) => cur.map((o) => (o.id === p.id ? p : o)));
          pending.set(
            p.id,
            setTimeout(() => {
              pending.delete(p.id);
              setOps((cur) => cur.filter((o) => o.id !== p.id));
            }, LINGER_MS),
          );
        } else {
          setOps((cur) => cur.filter((o) => o.id !== p.id));
        }
        return;
      }

      setOps((cur) => {
        const i = cur.findIndex((o) => o.id === p.id);
        if (i === -1) return [...cur, p];
        const next = cur.slice();
        next[i] = p;
        return next;
      });
    }).then((un) => {
      if (alive) unlisten = un;
      else un(); // desmontou antes de o listener resolver
    });

    return () => {
      alive = false;
      unlisten?.();
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);

  if (!ops.length) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-10 left-1/2 z-[68] flex w-[420px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2">
      <AnimatePresence initial={false}>
        {ops.map((o) => {
          const meta = PANEL_OPS[o.op]!;
          return (
            <motion.div
              key={o.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 360, damping: 30 }}
              className="glass pointer-events-auto rounded-lg border border-line px-3.5 py-3 shadow-pop"
            >
              <TransferProgress
                label={meta.label}
                count={o.count}
                path={o.path}
                icon={<span className="shrink-0 text-brand">{meta.icon}</span>}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
