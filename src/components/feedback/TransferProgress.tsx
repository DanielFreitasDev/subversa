/**
 * Barra de progresso de transferência reutilizável (checkout, update, switch,
 * merge, export). SVN não informa o total de arquivos de antemão, então é uma
 * barra indeterminada + contador ao vivo + caminho atual — não porcentagem.
 *
 * Usada inline no modal de checkout e nos cartões do painel de atividade global.
 */

import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Caminho relativo a uma raiz, para exibição. O `svn` imprime a raiz inteira à
 * frente de cada arquivo; tiramos esse prefixo para mostrar só a parte que
 * importa. Cai para o caminho cru se não casar.
 */
export function relativeToBase(path: string, base: string): string {
  const root = base.replace(/\/+$/, "");
  if (path === root) return "";
  return path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
}

/** Últimos dois segmentos do caminho — legível quando não há raiz para tirar. */
function tail(path: string): string {
  return path.split("/").filter(Boolean).slice(-2).join("/");
}

interface TransferProgressProps {
  /** Verbo da operação, ex.: "Baixando", "Atualizando", "Mesclando". */
  label: string;
  /** Arquivos processados até agora. */
  count: number;
  /** Caminho mais recente (vazio = ainda iniciando ou já concluído). */
  path: string;
  /** Raiz a remover do caminho exibido (destino do checkout/export). */
  base?: string;
  /** Ícone opcional à esquerda do rótulo (usado nos cartões do painel). */
  icon?: ReactNode;
  /** Quando presente, mostra um botão para cancelar a operação. */
  onCancel?: () => void;
  className?: string;
}

export function TransferProgress({ label, count, path, base, icon, onCancel, className }: TransferProgressProps) {
  const shown = !path ? "" : base ? relativeToBase(path, base) : tail(path);
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-muted">
        {icon}
        <span className="truncate">
          {count > 0
            ? `${label}… ${count.toLocaleString("pt-BR")} ${count === 1 ? "arquivo" : "arquivos"}`
            : `${label}…`}
        </span>
        {onCancel && (
          <button
            onClick={onCancel}
            title="Cancelar operação"
            aria-label="Cancelar operação"
            className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-panel-3 hover:text-conflict"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-panel-3">
        <div className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-brand animate-[indeterminate_1.15s_ease-in-out_infinite]" />
      </div>
      <div className="mt-2 h-4 truncate font-mono text-[11px] text-faint" title={path}>
        {shown}
      </div>
    </div>
  );
}
