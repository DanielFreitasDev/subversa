/**
 * Botão com menu suspenso de seleção única (estilo IntelliJ): mostra o rótulo
 * da opção atual e abre uma lista com marca na selecionada. Renderiza por portal
 * no `body` (escapa de áreas com overflow) e fecha ao clicar fora ou apertar Esc.
 * Segue o mesmo padrão de posicionamento do `HelpPopover`.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Texto auxiliar opcional, alinhado à direita do item. */
  hint?: string;
}

const MARGIN = 8;

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  icon,
  title,
  ariaLabel,
  className,
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (v: T) => void;
  icon?: React.ReactNode;
  /** Tooltip do gatilho. */
  title?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, origin: "top left", minWidth: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  // Fecha ao clicar fora ou apertar Esc (Esc na captura, com a propagação
  // interrompida para não fechar um modal por baixo).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Posiciona abaixo do gatilho (com flip p/ cima e clamp horizontal).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const pw = panelRef.current?.offsetWidth ?? 240;
      const ph = panelRef.current?.offsetHeight ?? 200;
      const left = Math.max(MARGIN, Math.min(b.left, window.innerWidth - pw - MARGIN));
      const fitsBelow = b.bottom + MARGIN + ph <= window.innerHeight - MARGIN;
      const top = fitsBelow ? b.bottom + 4 : Math.max(MARGIN, b.top - ph - 4);
      setPos({ left, top, origin: fitsBelow ? "top left" : "bottom left", minWidth: b.width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        aria-label={ariaLabel ?? title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
          open
            ? "border-brand/40 bg-brand/10 text-brand"
            : "border-line/80 text-muted hover:bg-panel-2 hover:text-ink",
          className,
        )}
      >
        {icon}
        <span className="max-w-[16rem] truncate">{current?.label ?? ""}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              role="listbox"
              onMouseDown={(e) => e.stopPropagation()}
              className="fixed z-[70] overflow-hidden rounded-lg border border-line bg-panel-3 py-1 shadow-pop"
              style={{ left: pos.left, top: pos.top, minWidth: pos.minWidth, transformOrigin: pos.origin }}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.12 }}
            >
              {options.map((o) => {
                const active = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                      active ? "text-brand" : "text-muted hover:bg-panel-2 hover:text-ink",
                    )}
                  >
                    <Check className={cn("size-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} />
                    <span className="whitespace-nowrap">{o.label}</span>
                    {o.hint && <span className="ml-auto pl-4 text-[10px] text-faint">{o.hint}</span>}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
