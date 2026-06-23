/** Tratamento uniforme dos resultados de operações SVN (toasts + dicas). */

import type { CommandOutput } from "./types";
import { toast } from "@/store/toast";
import { friendlyErrorMessage } from "./errors";

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
  // Prioriza a frase explícita ("Committed revision N" / "Revisão N enviada");
  // só então cai para "número no fim". O fallback é sem a flag `m`, para casar o
  // fim do texto inteiro — e não uma linha intermediária que por acaso termine
  // em dígito (ex.: "Enviando .../getran160" sequestrava a revisão).
  const m =
    stdout.match(/[Cc]ommitted revision\s+(\d+)/) ||
    stdout.match(/revis[ãa]o\s+(\d+)/i) ||
    stdout.match(/(\d+)\.?\s*$/);
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
    toast.error(errorTitle, friendlyErrorMessage(e));
    return null;
  }
}
