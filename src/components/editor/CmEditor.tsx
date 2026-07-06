/**
 * Componente CodeMirror isolado, carregado sob demanda (code-splitting): só é
 * baixado/avaliado quando o usuário abre o editor, mantendo o bundle inicial e o
 * boot do app leves. Concentra aqui as dependências pesadas do CodeMirror
 * (editor + pacotes de linguagem + tema), atrás de um `import()` dinâmico.
 */

import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";

import { cmExtras, cmInlineExtras, cmLanguageFor, cmTheme } from "./cm";

export default function CmEditor({
  value,
  onChange,
  path,
  isDark,
  inline = false,
  maxHeight = "40vh",
}: {
  value: string;
  onChange: (v: string) => void;
  path: string;
  isDark: boolean;
  /** Modo inline (trecho do editor de conflito): auto-altura, não ocupa 100%. */
  inline?: boolean;
  /** Altura máxima no modo inline (depois rola). */
  maxHeight?: string;
}) {
  const extensions = useMemo(() => {
    const base = inline ? cmInlineExtras(maxHeight) : cmExtras();
    const lang = cmLanguageFor(path);
    return lang ? [...base, lang] : base;
  }, [path, inline, maxHeight]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={cmTheme(isDark)}
      height={inline ? undefined : "100%"}
      minHeight={inline ? "2.4em" : undefined}
      autoFocus
      className={inline ? undefined : "h-full"}
      basicSetup={inline ? { foldGutter: false } : undefined}
    />
  );
}
