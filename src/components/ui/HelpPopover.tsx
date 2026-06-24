/**
 * Ícone de ajuda (?) que abre um popover com uma explicação didática, escrita
 * para leigos. Usado nos cabeçalhos de diálogos (via prop `help` do Modal) e
 * inline nas telas onde alguma função é executada.
 *
 * Detalhes de comportamento:
 * - Clique abre/fecha; fecha ao clicar fora ou apertar Esc.
 * - Renderiza por portal no `body`, acima de modais e tooltips (z alto).
 * - O Esc é capturado na fase de captura e a propagação é interrompida, para
 *   que fechar o popover NÃO feche também o modal que estiver por baixo.
 * - Posiciona abaixo do gatilho por padrão, com clamp horizontal e flip para
 *   cima quando não cabe embaixo.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CircleHelp } from "lucide-react";

import { cn } from "@/lib/utils";

export interface HelpContent {
  /** Título curto do que está sendo explicado. */
  title: string;
  /** Abertura em linguagem simples — "o que é isso", 1-2 frases. */
  intro?: React.ReactNode;
  /** Pontos/passos em forma de lista. */
  points?: React.ReactNode[];
  /** Dica ou aviso destacado ao final. */
  note?: React.ReactNode;
  /** Tom do destaque final: dica neutra (padrão) ou aviso (amarelo). */
  noteTone?: "tip" | "warn";
}

const PANEL_W = 320;
const MARGIN = 8;

export function HelpPopover({
  content,
  className,
  label = "O que é isso?",
}: {
  content: HelpContent;
  /** Classes extras no gatilho — ex.: `size-8` para casar com botões maiores. */
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, origin: "top center" });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc. O Esc é tratado na captura e tem a
  // propagação interrompida para não fechar um modal por baixo.
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

  // Posiciona ao abrir e mantém alinhado em scroll/resize.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const ph = panelRef.current?.offsetHeight ?? 220;
      const left = Math.max(
        MARGIN,
        Math.min(b.left + b.width / 2 - PANEL_W / 2, window.innerWidth - PANEL_W - MARGIN),
      );
      const fitsBelow = b.bottom + MARGIN + ph <= window.innerHeight - MARGIN;
      const top = fitsBelow ? b.bottom + MARGIN : Math.max(MARGIN, b.top - ph - MARGIN);
      setPos({ left, top, origin: fitsBelow ? "top center" : "bottom center" });
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
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-faint transition-colors",
          "hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
          open && "bg-brand/12 text-brand",
          className,
        )}
      >
        <CircleHelp className="size-4" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-label={content.title}
              onMouseDown={(e) => e.stopPropagation()}
              className="fixed z-[70] rounded-xl border border-line bg-panel-3 p-4 text-left shadow-pop"
              style={{ left: pos.left, top: pos.top, width: PANEL_W, transformOrigin: pos.origin }}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.14 }}
            >
              <h3 className="text-[13px] font-semibold text-ink">{content.title}</h3>
              {content.intro && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{content.intro}</p>
              )}
              {content.points && content.points.length > 0 && (
                <ul className="mt-2.5 space-y-1.5">
                  {content.points.map((p, i) => (
                    <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-muted">
                      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-brand/70" />
                      <span className="min-w-0">{p}</span>
                    </li>
                  ))}
                </ul>
              )}
              {content.note && (
                <div
                  className={cn(
                    "mt-3 rounded-lg px-3 py-2 text-[11px] leading-relaxed",
                    content.noteTone === "warn" ? "bg-warn/10 text-warn" : "bg-panel-2 text-muted",
                  )}
                >
                  {content.note}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
