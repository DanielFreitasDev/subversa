import { describe, expect, it } from "vitest";

import { extractRevision } from "@/lib/op";

describe("extractRevision", () => {
  it("extrai da frase pt-BR de commit", () => {
    const out = "Enviando        src/arquivo.ts\nTransmitindo dados .\nRevisão 4822 gravada.\n";
    expect(extractRevision(out)).toBe("4822");
  });

  it("extrai da frase pt-BR de update", () => {
    expect(extractRevision("Atualizado para a revisão 12344.\n")).toBe("12344");
  });

  it("extrai da frase em inglês de commit", () => {
    expect(extractRevision("Committed revision 12345.")).toBe("12345");
  });

  it("cai para o número no fim do texto (inglês sem frase conhecida)", () => {
    // "revision" (inglês) não casa com `revis[ãa]o` — o fallback resolve.
    expect(extractRevision("Updating '.':\nAt revision 4821.\n")).toBe("4821");
  });

  it("não deixa uma linha intermediária terminada em dígito sequestrar a revisão", () => {
    // Regressão documentada em op.ts: "Enviando .../getran160" no meio da saída.
    const out = "Enviando        modulos/getran160\nTransmitindo dados .\nRevisão 4821 gravada.\n";
    expect(extractRevision(out)).toBe("4821");
  });

  it("ignora números com mais de 9 dígitos (não são revisões)", () => {
    expect(extractRevision("operação concluída, id 12345678901")).toBeNull();
  });

  it("devolve null quando não há revisão", () => {
    expect(extractRevision("Transmitindo dados .")).toBeNull();
    expect(extractRevision("")).toBeNull();
  });
});
