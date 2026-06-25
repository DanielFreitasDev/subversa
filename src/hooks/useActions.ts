/** Ações SVN de alto nível, com confirmação, toasts e refresh integrados. */

import { useCallback } from "react";

import * as api from "@/lib/api";
import { guardDestructive } from "@/lib/backup";
import { extractRevision, reportOutput, tryRun } from "@/lib/op";
import type { WorkingCopy } from "@/lib/types";
import { useConfigStore } from "@/store/config";
import { toast } from "@/store/toast";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";

export function useActions() {
  const refreshOne = useWorkspaceStore((s) => s.refreshOne);
  const setView = useUiStore((s) => s.setView);
  const confirmServerOps = useConfigStore((s) => s.config?.confirmServerOps ?? true);

  /** Atualiza a working copy (svn update). */
  const update = useCallback(
    async (wc: WorkingCopy) => {
      const ok = await guardDestructive(wc, "update", {
        confirm: {
          title: "Receber alterações do servidor?",
          message:
            "Atualiza a working copy com o que há de novo no servidor (svn update).",
          confirmLabel: "Receber agora",
        },
        confirmRequired: false,
      });
      if (!ok) return false;
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
      const ok = await guardDestructive(wc, "reverter tudo", {
        confirm: {
          title: "Reverter todas as alterações?",
          message:
            "Isso descarta TODAS as modificações locais desta working copy. Não dá para desfazer.",
          confirmLabel: "Reverter tudo",
          danger: true,
          cancelLabel: "Cancelar",
        },
        confirmRequired: true,
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

  /** Sai da pasta de trabalho: limpa o estado e esquece a pasta no config. */
  const closeFolder = useCallback(async () => {
    useWorkspaceStore.getState().closeFolder();
    await useConfigStore.getState().save({ baseDir: "" });
    toast.info(
      "Pasta de trabalho fechada",
      "Escolha uma pasta ou baixe um projeto para começar.",
    );
  }, []);

  /** Troca a working copy para outra URL (svn switch). */
  const switchTo = useCallback(
    async (wc: WorkingCopy, url: string, label?: string) => {
      const ok = await guardDestructive(wc, "switch", {
        confirm: {
          title: "Trocar de linha?",
          message: `A working copy passará a apontar para:\n\n${label ?? url}`,
          confirmLabel: "Trocar (switch)",
        },
        confirmRequired: confirmServerOps,
      });
      if (!ok) return false;
      const out = await tryRun(() => api.switchWc(wc.path, url), "Falha no switch");
      if (out && reportOutput(out, "Linha trocada", label)) {
        await refreshOne(wc.path);
        return true;
      }
      return false;
    },
    [refreshOne, confirmServerOps],
  );

  /** Reverte as mudanças de uma revisão na WC e leva o usuário para Alterações. */
  const revertRevision = useCallback(
    async (wc: WorkingCopy, revision: string) => {
      const ok = await guardDestructive(wc, `reverter r${revision}`, {
        confirm: {
          title: `Reverter as mudanças da revisão r${revision}?`,
          message:
            "Isso desfaz as alterações desta revisão na sua cópia local (não no servidor). Você poderá revisar e commitar na aba Alterações.",
          confirmLabel: `Reverter r${revision}`,
        },
        confirmRequired: true,
      });
      if (!ok) return false;
      const out = await tryRun(() => api.reverseMerge(wc.path, revision), "Falha ao reverter");
      if (out && reportOutput(out, "Reversão aplicada", "Revise e commite na aba Alterações")) {
        await refreshOne(wc.path);
        setView("changes");
        return true;
      }
      return false;
    },
    [refreshOne, setView],
  );

  return { update, cleanup, revertAll, switchTo, closeFolder, revertRevision };
}
