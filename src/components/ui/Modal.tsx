import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { IconButton } from "./Button";

type Size = "sm" | "md" | "lg" | "xl";

const SIZES: Record<Size, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  size?: Size;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Impede fechar ao clicar fora (para operações em andamento). */
  locked?: boolean;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  size = "md",
  children,
  footer,
  locked,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, onClose]);

  // Trava o scroll do body enquanto o modal está aberto.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]">
          <motion.div
            className="fixed inset-0 bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => !locked && onClose()}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            className={cn(
              "relative w-full rounded-xl border border-line bg-panel shadow-pop",
              SIZES[size],
              className,
            )}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            {(title || icon) && (
              <div className="flex items-start gap-3 border-b border-line px-5 py-4">
                {icon && (
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand">
                    {icon}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  {title && (
                    <h2 id={titleId} className="text-[15px] font-semibold text-ink">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p id={descId} className="mt-0.5 text-[13px] leading-snug text-muted">
                      {description}
                    </p>
                  )}
                </div>
                {!locked && (
                  <IconButton label="Fechar" onClick={onClose} className="-mr-1.5 -mt-1">
                    <X className="size-4" />
                  </IconButton>
                )}
              </div>
            )}
            <div className="px-5 py-4">{children}</div>
            {footer && (
              <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
