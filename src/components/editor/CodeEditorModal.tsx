/**
 * Casca leve do editor de código embutido. Todo o peso (CodeMirror, painéis,
 * abas) vive em `EditorWorkbench`, carregado sob demanda no primeiro pedido de
 * edição — mantém o bundle inicial e o boot do app leves (como o CmEditor dos
 * blocos de conflito). Depois de carregado, fica montado para as animações de
 * abrir/fechar do modal funcionarem normalmente.
 */

import { Suspense, lazy, useEffect, useState } from "react";

import type { EditorWorkbenchProps } from "./EditorWorkbench";

const EditorWorkbench = lazy(() => import("./EditorWorkbench"));

export function CodeEditorModal(props: EditorWorkbenchProps) {
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (props.open) setEverOpened(true);
  }, [props.open]);

  if (!everOpened && !props.open) return null;
  return (
    <Suspense fallback={null}>
      <EditorWorkbench {...props} />
    </Suspense>
  );
}
