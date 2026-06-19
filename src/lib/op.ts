/** Tratamento uniforme dos resultados de operações SVN (toasts + dicas). */

import type { CommandOutput } from "./types";
import { toast } from "@/store/toast";

/** Mostra toast de sucesso/erro a partir de um [`CommandOutput`]. */
export function reportOutput(
  out: CommandOutput,
  successTitle: string,
  successDesc?: string,
): boolean {
  if (out.success) {
    toast.success(successTitle, successDesc);
    return true;
  }
  const desc = [out.stderr.trim(), out.hint].filter(Boolean).join("\n\n");
  toast.error("A operação falhou", desc || `Código ${out.code ?? "?"}`);
  return false;
}

/** Extrai o número de revisão de uma saída de commit/copy/merge. */
export function extractRevision(stdout: string): string | null {
  const m = stdout.match(/(\d+)\.?\s*$/m) || stdout.match(/revis[ãa]o\s+(\d+)/i);
  return m ? m[1] : null;
}

/** Envolve uma chamada que pode lançar (Err string), reportando erro. */
export async function tryRun<T>(
  fn: () => Promise<T>,
  errorTitle = "Erro",
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    toast.error(errorTitle, String(e));
    return null;
  }
}
