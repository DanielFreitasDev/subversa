/** Mensagens amigáveis para erros de validação vindos do backend Rust. */

export function friendlyErrorMessage(error: unknown): string {
  const raw = String(error);
  const lower = raw.toLowerCase();

  if (lower.includes("fora das localizações configuradas")) {
    return "URL fora das localizações configuradas. Cadastre a raiz em Configurações antes de usar esta URL.";
  }

  if (lower.includes("excedeu o limite")) {
    return "Saída grande demais para abrir no Subversa. Use uma ferramenta externa ou reduza o alvo.";
  }

  if (lower.includes("destino fora da pasta de trabalho")) {
    return raw;
  }

  return raw;
}
