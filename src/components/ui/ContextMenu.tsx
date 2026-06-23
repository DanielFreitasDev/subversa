/**
 * Menu de contexto reutilizável (botão direito), no espírito de `Tooltip`/`Modal`:
 * `createPortal` + framer-motion, posição `fixed` por `clientX/clientY` com clamp
 * na viewport. Fecha em clique-fora, Escape, scroll, resize ou ao escolher um item.
 *
 * Uso:
 *   const ctx = useContextMenu();
 *   <div onContextMenu={(e) => ctx.open(e, itemsFor(node))} />
 *   <ContextMenu menu={ctx.menu} onClose={ctx.close} />
 */

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/utils";

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  /** Estilo destrutivo (vermelho). */
  danger?: boolean;
  /** Item visível mas inativo (usado na toolbar; o menu costuma omitir). */
  disabled?: boolean;
  /** Motivo da inatividade (vira `title`/tooltip). */
  disabledReason?: string;
  /** Desenha um divisor acima deste item. */
  separatorBefore?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Estado + helpers para abrir/fechar o menu a partir de um evento. */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    if (items.length === 0) return;
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const close = () => setMenu(null);
  return { menu, open, close };
}

function MenuPanel({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y, ready: false });

  // Mede e ajusta a posição para não vazar da viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    let x = menu.x;
    let y = menu.y;
    if (x + width + pad > window.innerWidth) x = window.innerWidth - width - pad;
    if (y + height + pad > window.innerHeight) y = window.innerHeight - height - pad;
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y), ready: true });
  }, [menu.x, menu.y, menu.items]);

  // Fecha em clique-fora / Escape / scroll / resize.
  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      role="menu"
      className="fixed z-[70] min-w-[200px] max-w-[280px] overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-pop"
      style={{ left: pos.x, top: pos.y, visibility: pos.ready ? "visible" : "hidden" }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.1 }}
    >
      {menu.items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="my-1 h-px bg-line" />}
          <button
            role="menuitem"
            disabled={item.disabled}
            title={item.disabled ? item.disabledReason : undefined}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onSelect?.();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors",
              item.disabled
                ? "cursor-not-allowed text-faint/60"
                : item.danger
                  ? "text-del hover:bg-del/12"
                  : "text-ink hover:bg-panel-2",
            )}
          >
            {item.icon && (
              <span className={cn("shrink-0", item.danger ? "text-del" : "text-faint")}>
                {item.icon}
              </span>
            )}
            <span className="truncate">{item.label}</span>
          </button>
        </div>
      ))}
    </motion.div>
  );
}

export function ContextMenu({
  menu,
  onClose,
}: {
  menu: ContextMenuState | null;
  onClose: () => void;
}) {
  return createPortal(
    <AnimatePresence>
      {menu && <MenuPanel menu={menu} onClose={onClose} />}
    </AnimatePresence>,
    document.body,
  );
}
