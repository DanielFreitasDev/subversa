import { describe, expect, it } from "vitest";

import { fuzzyFilter, fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("exige subsequência (sem diferenciar caixa)", () => {
    expect(fuzzyMatch("ctx", "WebContent/META-INF/context.xml")).not.toBeNull();
    expect(fuzzyMatch("zzz", "WebContent/META-INF/context.xml")).toBeNull();
  });

  it("consulta vazia casa tudo com score neutro", () => {
    expect(fuzzyMatch("", "qualquer/coisa")).toEqual({ score: 0, positions: [] });
  });

  it("devolve as posições casadas para destaque", () => {
    const r = fuzzyMatch("bp", "build.properties");
    expect(r?.positions).toEqual([0, 6]);
  });
});

describe("fuzzyFilter", () => {
  const files = [
    "WebContent/META-INF/context.xml",
    "conf/context.xml.getran.producao.oracle",
    "build.properties",
    "src/br/tjsc/getran/Contexto.java",
    "WebContent/WEB-INF/web.xml",
  ];

  it("prioriza casar no nome do arquivo", () => {
    const r = fuzzyFilter("context.xml", files);
    expect(r[0].item).toBe("WebContent/META-INF/context.xml");
  });

  it("começo de segmento pesa mais que meio de palavra", () => {
    const r = fuzzyFilter("web", files).map((x) => x.item);
    expect(r[0]).toBe("WebContent/WEB-INF/web.xml");
  });

  it("filtra fora quem não é subsequência e respeita o limite", () => {
    expect(fuzzyFilter("web", files).every((x) => /w.*e.*b/i.test(x.item))).toBe(true);
    expect(fuzzyFilter("", files, 2).length).toBe(2);
  });
});
