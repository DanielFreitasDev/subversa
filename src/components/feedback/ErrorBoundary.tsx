import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Captura erros de renderização para que uma falha em uma tela não derrube o
 * aplicativo inteiro (tela branca). Mostra um aviso e permite recarregar.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Rastro para depuração no devtools do webview (sem dados sensíveis).
    console.error("Erro não tratado na UI:", error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas p-8 text-center">
        <div className="text-lg font-semibold text-mod">Algo deu errado</div>
        <div className="max-w-md text-sm text-faint">
          A interface encontrou um erro inesperado. Você pode recarregar o
          aplicativo; suas working copies não foram afetadas.
        </div>
        <pre className="max-w-lg overflow-auto rounded-lg bg-panel p-3 text-left text-xs text-trunk">
          {String(this.state.error.message || this.state.error)}
        </pre>
        <button
          onClick={this.handleReload}
          className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow-pop"
        >
          Recarregar
        </button>
      </div>
    );
  }
}
