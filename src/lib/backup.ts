/**
 * Pontos de restauração (backup) — criação e a "guarda" das operações
 * destrutivas. Centraliza a lógica de oferecer/forçar um backup antes de
 * mexer na working copy, conforme o modo configurado (`ask`/`always`/`off`).
 */

import * as api from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import type { WorkingCopy } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { confirm, type ConfirmOptions } from "@/store/confirm";
import { useConfigStore } from "@/store/config";
import { toast } from "@/store/toast";

/** Cria um ponto de restauração da working copy. Toasts inclusos. */
export async function createRestorePoint(wc: WorkingCopy, op: string): Promise<boolean> {
  try {
    const b = await api.createBackup(wc.path, op, wc.name, wc.url, wc.revision, wc.branchLabel);
    toast.success(
      "Ponto de restauração criado",
      `${b.fileCount} arquivo(s) • ${formatBytes(b.sizeBytes)}`,
    );
    return true;
  } catch (e) {
    toast.error("Falha ao criar o backup", friendlyErrorMessage(e));
    return false;
  }
}

/** Modo de backup atual (default `ask`). */
function backupMode(): "ask" | "always" | "off" {
  return useConfigStore.getState().config?.backupMode ?? "ask";
}

interface GuardOptions {
  /** Conteúdo da confirmação própria da operação (título/mensagem/botões). */
  confirm: Omit<ConfirmOptions, "backup">;
  /**
   * A confirmação é obrigatória por si só (segurança de servidor/destrutiva),
   * independentemente do backup? Operações como update têm `false` — sem backup
   * a oferecer, elas seguem direto, sem diálogo.
   */
  confirmRequired: boolean;
}

/**
 * Guarda uma operação destrutiva: mostra a confirmação e/ou oferece um backup
 * conforme o modo. Retorna `true` se o usuário quer prosseguir (após o eventual
 * backup já ter sido criado).
 */
export async function guardDestructive(
  wc: WorkingCopy,
  op: string,
  { confirm: base, confirmRequired }: GuardOptions,
): Promise<boolean> {
  const mode = backupMode();
  const offer = mode !== "off";

  if (confirmRequired) {
    // Sempre confirma; embute a opção de backup quando o modo permite.
    return confirm({ ...base, backup: offer ? { wc, op } : undefined });
  }

  // Confirmação não é obrigatória (ex.: update):
  if (mode === "off") return true; // sem atrito, comportamento original
  if (mode === "always") return createRestorePoint(wc, op); // backup silencioso
  // modo "ask": pergunta, oferecendo o backup.
  return confirm({ ...base, backup: { wc, op } });
}
