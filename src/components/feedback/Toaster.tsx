import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToastStore, type ToastKind } from "@/store/toast";

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 className="size-5 text-success" />,
  error: <XCircle className="size-5 text-danger" />,
  info: <Info className="size-5 text-info" />,
  warn: <AlertTriangle className="size-5 text-warn" />,
};

const ACCENT: Record<ToastKind, string> = {
  success: "border-l-success",
  error: "border-l-danger",
  info: "border-l-info",
  warn: "border-l-warn",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2.5">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className={cn(
              "glass pointer-events-auto flex gap-3 rounded-lg border border-l-2 border-line p-3.5 shadow-pop",
              ACCENT[t.kind],
            )}
          >
            <div className="mt-0.5 shrink-0">{ICONS[t.kind]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug text-muted selectable">
                  {t.description}
                </p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="-mr-1 -mt-1 size-6 shrink-0 rounded-md text-faint transition-colors hover:bg-panel-2 hover:text-ink"
              aria-label="Dispensar"
            >
              <X className="mx-auto size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
