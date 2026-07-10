/**
 * Faixa de abas do editor embutido (estilo IntelliJ: indicador embaixo da aba
 * ativa, bolinha de "não salvo", fechar no hover/clique do meio). O menu de
 * contexto (fechar outras, mover para o outro grupo, dividir…) é montado pelo
 * modal e aberto via `onContext`.
 */

import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";

export interface TabMeta {
  path: string;
  title: string;
  /** Pasta (diferencia abas de arquivos homônimos), mostrada no tooltip. */
  detail?: string;
  dirty: boolean;
}

export function EditorTabs({
  tabs,
  active,
  focused,
  onSelect,
  onClose,
  onContext,
}: {
  tabs: TabMeta[];
  active: string | null;
  /** O grupo desta faixa é o focado? (atenua o indicador quando não). */
  focused: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onContext: (e: React.MouseEvent, path: string) => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-line bg-panel-2 px-1.5">
      {tabs.map((t) => {
        const isActive = t.path === active;
        return (
          <Tooltip key={t.path} label={t.detail ? `${t.detail}/${t.title}` : t.title}>
            <div
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              onClick={() => onSelect(t.path)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(t.path)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(t.path);
                }
              }}
              onContextMenu={(e) => onContext(e, t.path)}
              className={cn(
                "group relative flex h-8 max-w-56 min-w-0 cursor-pointer items-center gap-1.5 rounded-t-md px-2.5 text-xs transition-colors",
                isActive ? "bg-panel text-ink" : "text-muted hover:bg-panel-3/60 hover:text-ink",
              )}
            >
              {t.dirty && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-mod"
                  title="Alterações não salvas"
                />
              )}
              <span className="truncate">{t.title}</span>
              <button
                type="button"
                aria-label={`Fechar ${t.title}`}
                title="Fechar (Ctrl+F4 · clique do meio)"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.path);
                }}
                className={cn(
                  "flex size-4.5 shrink-0 items-center justify-center rounded text-faint transition-opacity hover:bg-panel-3 hover:text-ink",
                  isActive ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70",
                )}
              >
                <X className="size-3" />
              </button>
              {isActive && (
                <span
                  className={cn(
                    "absolute inset-x-0 -bottom-px h-0.5 rounded-full",
                    focused ? "bg-brand" : "bg-line-strong",
                  )}
                />
              )}
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}
