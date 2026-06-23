import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Prende o foco do teclado dentro de `ref` enquanto `active` for verdadeiro:
 *  - leva o foco para dentro ao ativar (preservando um `autoFocus` já aplicado);
 *  - cicla Tab / Shift+Tab nas bordas, sem deixar o foco "vazar" para trás;
 *  - devolve o foco ao elemento anterior (o gatilho) ao desativar.
 *
 * Cobre o requisito de acessibilidade de qualquer sobreposição modal.
 */
export function useFocusTrap<T extends HTMLElement>(ref: RefObject<T | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0,
      );

    // Foco inicial: se o React já aplicou um `autoFocus` (o foco está dentro),
    // respeita-o; senão foca o próprio container (o leitor de tela anuncia o
    // título via aria-labelledby) e o primeiro Tab segue para o conteúdo.
    if (!node.contains(document.activeElement)) {
      node.setAttribute("tabindex", "-1");
      node.focus();
    }

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey) {
        if (current === first || current === node || !node.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !node.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeydown);
    return () => {
      node.removeEventListener("keydown", onKeydown);
      // Devolve o foco ao gatilho, se ele ainda estiver no documento.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active, ref]);
}
