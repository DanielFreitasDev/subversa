/**
 * Componente CodeMirror isolado, carregado sob demanda (code-splitting): só é
 * baixado/avaliado quando o usuário abre o editor, mantendo o bundle inicial e o
 * boot do app leves. Concentra aqui as dependências pesadas do CodeMirror
 * (editor + pacotes de linguagem + tema), atrás de um `import()` dinâmico.
 */

import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";

import { cmExtras, cmLanguageFor, cmTheme } from "./cm";

export default function CmEditor({
  value,
  onChange,
  path,
  isDark,
}: {
  value: string;
  onChange: (v: string) => void;
  path: string;
  isDark: boolean;
}) {
  const extensions = useMemo(() => {
    const lang = cmLanguageFor(path);
    return lang ? [...cmExtras(), lang] : cmExtras();
  }, [path]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={cmTheme(isDark)}
      height="100%"
      autoFocus
      className="h-full"
    />
  );
}
