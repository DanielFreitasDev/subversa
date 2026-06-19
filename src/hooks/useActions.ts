/** Ações SVN de alto nível, com confirmação, toasts e refresh integrados. */

import { useCallback } from "react";

import * as api from "@/lib/api";
import { extractRevision, reportOutput, tryRun } from "@/lib/op";
import type { WorkingCopy } from "@/lib/types";
import { confirm } from "@/store/confirm";
import { useConfigStore } from "@/store/config";
import { toast } from "@/store/toast";
import { useWorkspaceStore } from "@/store/workspace";

export function useActions() {
  const refreshOne = useWorkspaceStore((s) => s.refreshOne);
  const confirmServerOps = useConfigStore((s) => s.config?.confirmServerOps ?? true);

  /** Atualiza a working copy (svn update). */
  const update = useCallback(
    async (wc: WorkingCopy) => {
      const out = await tryRun(() => api.update(wc.path), "Falha no update");
      if (!out) return false;
      if (out.success) {
        const rev = extractRevision(out.stdout) ?? wc.revision;
        toast.success("Working copy atualizada", `Agora em r${rev}`);
        await refreshOne(wc.path);
        return true;
      }
      reportOutput(out, "");
      return false;
    },
    [refreshOne],
  );

  /** Limpa/destrava a working copy (svn cleanup). */
  const cleanup = useCallback(
    async (wc: WorkingCopy) => {
      const out = await tryRun(() => api.cleanup(wc.path), "Falha no cleanup");
      if (out && reportOutput(out, "Working copy destravada")) {
        await refreshOne(wc.path);
        return true;
      }
      return false;
    },
    [refreshOne],
  );

  /** Reverte TODAS as alterações locais (recursivo) — destrutivo. */
  const revertAll = useCallback(
    async (wc: WorkingCopy) => {
      const ok = await confirm({
        title: "Reverter todas as alterações?",
        message:
          "Isso descarta TODAS as modificações locais desta working copy. Não dá para desfazer.",
        confirmLabel: "Reverter tudo",
        danger: true,
        cancelLabel: "Cancelar",
      });
      if (!ok) return false;
      const out = await tryRun(() => api.revert([wc.path], true), "Falha no revert");
      if (out && reportOutput(out, "Alterações revertidas")) {
        await refreshOne(wc.path);
        return true;
      }
      return false;
    },
    [refreshOne],
  );

  /** Troca a working copy para outra URL (svn switch). */
  const switchTo = useCallback(
    async (wc: WorkingCopy, url: string, label?: string) => {
      if (confirmServerOps) {
        const ok = await confirm({
          title: "Trocar de linha?",
          message: `A working copy passará a apontar para:\n\n${label ?? url}`,
          confirmLabel: "Trocar (switch)",
        });
        if (!ok) return false;
      }
      const out = await tryRun(() => api.switchWc(wc.path, url), "Falha no switch");
      if (out && reportOutput(out, "Linha trocada", label)) {
        await refreshOne(wc.path);
        return true;
      }
      return false;
    },
    [refreshOne, confirmServerOps],
  );

  return { update, cleanup, revertAll, switchTo };
}
