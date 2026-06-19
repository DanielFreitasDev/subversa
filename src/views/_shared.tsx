import { FolderGit2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { useUiStore } from "@/store/ui";

/** Estado vazio padrão quando nenhuma working copy está selecionada. */
export function NeedWorkingCopy() {
  const setView = useUiStore((s) => s.setView);
  const setCheckout = useUiStore((s) => s.setCheckout);
  return (
    <div className="flex h-full items-center justify-center">
      <Empty
        icon={<FolderGit2 className="size-7" />}
        title="Nenhum projeto selecionado"
        description="Escolha uma working copy na barra lateral ou baixe um projeto para começar."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setView("overview")}>
              Ver visão geral
            </Button>
            <Button variant="primary" onClick={() => setCheckout(true)}>
              Baixar projeto
            </Button>
          </div>
        }
      />
    </div>
  );
}

/** Cabeçalho de seção dentro de uma view (título + ações à direita). */
export function ViewHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-[11px] text-faint">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
