/**
 * Barra de status do editor embutido (rodapé), como a do IntelliJ: posição do
 * cursor (clicável → ir para linha), resumo da seleção/cursores, indentação
 * (ajustável), fim de linha (LF/CRLF, ajustável — vale na hora de salvar),
 * codificação (preservada ao salvar), linguagem e os toggles de quebra de
 * linha e caracteres invisíveis.
 */

import { Pilcrow, WrapText } from "lucide-react";

import type { IndentInfo } from "@/lib/indent";
import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/ui/Dropdown";
import { EncodingBadge } from "@/components/ui/EncodingBadge";

export interface CursorInfo {
  line: number;
  col: number;
  selChars: number;
  selLines: number;
  cursors: number;
}

export type Eol = "\n" | "\r\n";

const INDENT_OPTIONS = [
  { value: "s2", label: "2 espaços" },
  { value: "s4", label: "4 espaços" },
  { value: "s8", label: "8 espaços" },
  { value: "tab", label: "Tab" },
] as const;
type IndentKey = (typeof INDENT_OPTIONS)[number]["value"];

const indentKey = (i: IndentInfo): IndentKey => (i.useTabs ? "tab" : (`s${i.size}` as IndentKey));
const indentFromKey = (k: IndentKey): IndentInfo =>
  k === "tab" ? { useTabs: true, size: 4 } : { useTabs: false, size: Number(k.slice(1)) };

function MiniToggle({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex size-6 items-center justify-center rounded transition-colors",
        on ? "bg-brand/20 text-brand" : "text-faint hover:bg-panel-3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function StatusBar({
  cursor,
  indent,
  onIndentChange,
  eol,
  onEolChange,
  encoding,
  language,
  wrap,
  onWrapToggle,
  whitespace,
  onWhitespaceToggle,
  onGotoLine,
}: {
  cursor: CursorInfo | null;
  indent: IndentInfo;
  onIndentChange: (i: IndentInfo) => void;
  eol: Eol;
  onEolChange: (e: Eol) => void;
  encoding: string;
  language: string;
  wrap: boolean;
  onWrapToggle: () => void;
  whitespace: boolean;
  onWhitespaceToggle: () => void;
  onGotoLine: () => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-t border-line bg-panel-2 px-2 text-[11px] text-faint">
      <button
        type="button"
        onClick={onGotoLine}
        title="Ir para linha:coluna (Ctrl+G)"
        className="rounded px-1.5 py-0.5 tabular-nums text-muted transition-colors hover:bg-panel-3 hover:text-ink"
      >
        {cursor ? `${cursor.line}:${cursor.col}` : "–"}
      </button>

      {cursor && cursor.cursors > 1 && (
        <span className="text-brand">{cursor.cursors} cursores</span>
      )}
      {cursor && cursor.cursors <= 1 && cursor.selChars > 0 && (
        <span>
          {cursor.selChars} caractere(s)
          {cursor.selLines > 1 ? ` · ${cursor.selLines} linhas` : ""}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Dropdown
          value={indentKey(indent)}
          options={[...INDENT_OPTIONS]}
          onChange={(k) => onIndentChange(indentFromKey(k))}
          title="Indentação deste arquivo (Tab indenta com isto)"
          className="h-6 border-transparent px-1.5 text-[11px] text-faint hover:text-ink"
        />
        <Dropdown
          value={eol === "\r\n" ? "crlf" : "lf"}
          options={[
            { value: "lf", label: "LF", hint: "Unix" },
            { value: "crlf", label: "CRLF", hint: "Windows" },
          ]}
          onChange={(v) => onEolChange(v === "crlf" ? "\r\n" : "\n")}
          title="Fim de linha usado ao salvar"
          className="h-6 border-transparent px-1.5 text-[11px] text-faint hover:text-ink"
        />
        <EncodingBadge encoding={encoding} />
        <span className="px-1 text-muted">{language}</span>
        <MiniToggle on={wrap} onClick={onWrapToggle} title="Quebrar linhas longas (visual)">
          <WrapText className="size-3.5" />
        </MiniToggle>
        <MiniToggle on={whitespace} onClick={onWhitespaceToggle} title="Mostrar espaços e tabs">
          <Pilcrow className="size-3.5" />
        </MiniToggle>
      </div>
    </div>
  );
}
