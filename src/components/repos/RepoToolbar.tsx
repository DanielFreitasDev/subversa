/**
 * Toolbar do navegador. Mesma fonte (`actionsFor`) do menu de contexto, mas aqui
 * mostramos TODAS as ações: as inaplicáveis ficam desabilitadas, com o motivo no
 * tooltip. Mais Refresh global (na breadcrumb/atalho) e "Nova localização".
 */

import { PanelRightClose, PanelRightOpen, Plus } from "lucide-react";

import { Tooltip } from "@/components/ui/Tooltip";
import type { MenuItem } from "@/components/ui/ContextMenu";
import { cn } from "@/lib/utils";
import { useRepoBrowserStore } from "@/store/repoBrowser";
import { useRepoActions } from "./useRepoActions";

function ToolbarButton({ item }: { item: MenuItem }) {
  return (
    <Tooltip label={item.disabled ? item.disabledReason ?? item.label : item.label}>
      {/* Não usamos o atributo `disabled` nativo: no WebKit ele suprime os
          eventos de hover, e perderíamos o tooltip com o motivo do bloqueio. */}
      <button
        aria-disabled={item.disabled || undefined}
        onClick={() => !item.disabled && item.onSelect?.()}
        className={cn(
          "flex size-8 items-center justify-center rounded-md transition-colors",
          item.disabled
            ? "cursor-not-allowed text-faint/40"
            : item.danger
              ? "text-faint hover:bg-del/12 hover:text-del"
              : "text-muted hover:bg-panel-2 hover:text-ink",
        )}
      >
        {item.icon}
      </button>
    </Tooltip>
  );
}

export function RepoToolbar() {
  const selected = useRepoBrowserStore((s) => s.selected);
  const openDialog = useRepoBrowserStore((s) => s.openDialog);
  const detailsCollapsed = useRepoBrowserStore((s) => s.detailsCollapsed);
  const toggleDetails = useRepoBrowserStore((s) => s.toggleDetails);
  const actionsFor = useRepoActions();
  const items = actionsFor(selected);

  return (
    <div className="flex items-center gap-0.5 border-b border-line px-3 py-1.5">
      {items.map((item) => (
        <div key={item.id} className="flex items-center">
          {item.separatorBefore && <div className="mx-1 h-5 w-px bg-line" />}
          <ToolbarButton item={item} />
        </div>
      ))}

      <div className="ml-auto flex items-center gap-1.5">
        {/* Recolher/expandir o painel de detalhes (só existe em telas largas). */}
        <Tooltip label={detailsCollapsed ? "Mostrar painel de detalhes" : "Ocultar painel de detalhes"}>
          <button
            onClick={toggleDetails}
            aria-pressed={!detailsCollapsed}
            className="hidden size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel-2 hover:text-ink lg:flex"
          >
            {detailsCollapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
          </button>
        </Tooltip>
        <Tooltip label="Nova localização">
          <button
            onClick={() => openDialog("location", null)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-medium text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <Plus className="size-3.5" />
            Localização
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
