import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@/styles/index.css";

import App from "@/App";
import { ErrorBoundary } from "@/components/feedback/ErrorBoundary";

// O WebKit abre um menu de contexto nativo (Voltar/Avançar/Parar/Recarregar) em
// qualquer área sem menu próprio — sem função no app e fora do design. Bloqueia
// aqui na raiz: os menus do app (useContextMenu) chamam preventDefault antes de o
// evento chegar à window, então não passam por este listener. O menu nativo só
// sobrevive onde tem função real: campos de texto (colar com o mouse) e texto
// selecionado sob o cursor (copiar).
window.addEventListener("contextmenu", (e) => {
  // No dev, Shift+botão direito preserva o "Inspecionar elemento" do WebKit.
  if (import.meta.env.DEV && e.shiftKey) return;
  const alvo = e.target instanceof Element ? e.target : null;
  if (alvo && menuNativoTemFuncao(alvo)) return;
  e.preventDefault();
});

const TIPOS_DE_TEXTO = /^(?:text|search|password|email|url|tel|number)$/;

function menuNativoTemFuncao(alvo: Element): boolean {
  // Editores contenteditable (CodeMirror): recortar/copiar/colar.
  if (alvo instanceof HTMLElement && alvo.isContentEditable) return true;
  // Campos de texto (inputs de checkbox/radio etc. ganhariam o menu de navegação).
  const campo = alvo.closest("input, textarea");
  if (campo instanceof HTMLTextAreaElement) return true;
  if (campo instanceof HTMLInputElement) return TIPOS_DE_TEXTO.test(campo.type);
  // Clique sobre texto selecionado: o menu nativo oferece "Copiar".
  const sel = window.getSelection();
  return sel !== null && !sel.isCollapsed && sel.containsNode(alvo, true);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
