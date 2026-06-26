import { forwardRef, useEffect, useRef } from "react";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Estado "alguns, mas não todos" — usado no marcar-tudo parcial. */
  indeterminate?: boolean;
}

/**
 * Checkbox com aparência própria (o nativo `accent-color` fica inconsistente
 * entre WebKit/plataformas). O `<input>` continua sendo o controle real — só
 * trocamos a pele: o quadro é estilizado e os ícones (check / traço) são
 * sobrepostos via `peer-checked`/`peer-indeterminate`, então teclado, foco e
 * semântica seguem nativos.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate = false, ...props }, ref) => {
    const innerRef = useRef<HTMLInputElement | null>(null);

    // `indeterminate` não é atributo HTML — só existe como propriedade do DOM.
    useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <span className="relative inline-grid shrink-0 place-items-center">
        <input
          ref={(node) => {
            innerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          type="checkbox"
          className={cn(
            "peer size-4 cursor-pointer appearance-none rounded-[5px] border border-line-strong bg-panel-2",
            "transition-[background-color,border-color,box-shadow] duration-150",
            "hover:border-brand/70",
            "checked:border-brand checked:bg-brand",
            "indeterminate:border-brand indeterminate:bg-brand",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/30",
            "disabled:cursor-not-allowed disabled:opacity-40",
            className,
          )}
          {...props}
        />
        <Check
          strokeWidth={3.5}
          className="pointer-events-none absolute size-3 scale-50 text-brand-ink opacity-0 transition-[transform,opacity] duration-150 peer-checked:scale-100 peer-checked:opacity-100 peer-indeterminate:opacity-0"
        />
        <Minus
          strokeWidth={3.5}
          className="pointer-events-none absolute size-3 text-brand-ink opacity-0 transition-opacity duration-150 peer-indeterminate:opacity-100"
        />
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";
