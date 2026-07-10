/**
 * Popup "Ir para linha:coluna" (Ctrl+G), como o do IntelliJ: flutua no topo do
 * editor, aceita "12", "12:34" ou ":34" e pula centralizando a linha.
 */

import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";

import { cn } from "@/lib/utils";
import { gotoLineCol } from "./commands";

export function GotoLinePopup({
  open,
  view,
  onClose,
}: {
  open: boolean;
  view: EditorView | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ao abrir, pré-preenche com a posição atual e seleciona tudo.
  useEffect(() => {
    if (!open) return;
    if (view) {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      setValue(`${line.number}:${head - line.from + 1}`);
    }
    setInvalid(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, view]);

  if (!open) return null;

  const submit = () => {
    if (view && gotoLineCol(view, value)) onClose();
    else setInvalid(true);
  };

  return (
    <div className="absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-line bg-panel-3 p-2 shadow-pop">
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-muted" htmlFor="sv-goto">
          Linha:coluna
        </label>
        <input
          id="sv-goto"
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
              view?.focus();
            }
          }}
          onBlur={onClose}
          spellCheck={false}
          className={cn(
            "h-7 w-28 rounded-md border bg-canvas/50 px-2 font-mono text-[12px] text-ink outline-none tabular-nums",
            invalid ? "border-danger/70" : "border-line focus:border-brand/50",
          )}
        />
      </div>
    </div>
  );
}
