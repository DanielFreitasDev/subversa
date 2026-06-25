import { cloneElement, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

type Side = "top" | "bottom" | "left" | "right";

export function Tooltip({
  label,
  children,
  side = "bottom",
  delay = 350,
}: {
  label: React.ReactNode;
  children: React.ReactElement<Record<string, unknown>>;
  side?: Side;
  delay?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // Limpa o timer pendente ao desmontar (evita setOpen após o unmount).
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = () => {
    // Limpa um timer pendente antes de agendar outro: quando o gatilho recebe
    // mouseenter E focus juntos (ex.: clique), o `show` é chamado duas vezes e o
    // 1º timer ficaria órfão — disparando depois de um `hide`, abrindo um tooltip
    // que não fecha mais se o gatilho já tiver saído da tela (coberto por modal).
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const map: Record<Side, { x: number; y: number }> = {
        top: { x: r.left + r.width / 2, y: r.top - 8 },
        bottom: { x: r.left + r.width / 2, y: r.bottom + 8 },
        left: { x: r.left - 8, y: r.top + r.height / 2 },
        right: { x: r.right + 8, y: r.top + r.height / 2 },
      };
      setPos(map[side]);
      setOpen(true);
    }, delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  const translate: Record<Side, string> = {
    top: "translate(-50%, -100%)",
    bottom: "translate(-50%, 0)",
    left: "translate(-100%, -50%)",
    right: "translate(0, -50%)",
  };

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      ref.current = node;
    },
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    // Acessibilidade: usa o texto do tooltip como rótulo se o filho não tiver um.
    "aria-label":
      children.props["aria-label"] ?? (typeof label === "string" ? label : undefined),
  });

  return (
    <>
      {trigger}
      {createPortal(
        <AnimatePresence>
          {open && label && (
            <motion.div
              className="pointer-events-none fixed z-[60] max-w-xs rounded-md border border-line bg-panel-3 px-2 py-1 text-xs text-ink shadow-pop"
              style={{ left: pos.x, top: pos.y, transform: translate[side] }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.12 }}
            >
              {label}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
