import { describe, expect, it } from "vitest";

import { buildPattern, expandReplacement, findMatches, groupsAt, type FindSpec } from "./findreplace";

const spec = (search: string, over: Partial<FindSpec> = {}): FindSpec => ({
  search,
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  ...over,
});

const ranges = (text: string, s: FindSpec) => {
  const r = findMatches(text, s);
  if ("error" in r) throw new Error(r.error);
  return r.matches.map((m) => text.slice(m.from, m.to));
};

describe("findMatches", () => {
  it("busca literal sem diferenciar caixa por padrão", () => {
    expect(ranges("Foo foo FOO", spec("foo"))).toEqual(["Foo", "foo", "FOO"]);
  });

  it("diferencia caixa quando pedido", () => {
    expect(ranges("Foo foo FOO", spec("foo", { caseSensitive: true }))).toEqual(["foo"]);
  });

  it("escapa metacaracteres no modo literal", () => {
    expect(ranges("a.c abc a.c", spec("a.c"))).toEqual(["a.c", "a.c"]);
  });

  it("palavra inteira ignora ocorrências coladas em letra, número ou _", () => {
    const text = "cat catalog concat cat_x cat1 (cat)";
    expect(ranges(text, spec("cat", { wholeWord: true }))).toEqual(["cat", "cat"]);
  });

  it("palavra inteira respeita acentos como letra", () => {
    expect(ranges("ação operação ação", spec("ação", { wholeWord: true }))).toEqual(["ação", "ação"]);
    expect(ranges("maçã", spec("maç", { wholeWord: true }))).toEqual([]);
  });

  it("regex: ^ e $ casam por linha", () => {
    expect(ranges("um\ndois\num dois", spec("^um", { regexp: true }))).toEqual(["um", "um"]);
  });

  it("regex com grupos e quantificadores", () => {
    expect(ranges("v1 v22 x v333", spec("v(\\d+)", { regexp: true }))).toEqual(["v1", "v22", "v333"]);
  });

  it("regex que casa vazio não trava nem vira ocorrência", () => {
    const r = findMatches("abc", spec("x*", { regexp: true }));
    if ("error" in r) throw new Error(r.error);
    expect(r.matches).toEqual([]);
  });

  it("regex inválida vira erro amigável, não exceção", () => {
    const r = findMatches("abc", spec("a(", { regexp: true }));
    expect("error" in r).toBe(true);
  });

  it("busca vazia não retorna nada", () => {
    const r = findMatches("abc", spec(""));
    if ("error" in r) throw new Error(r.error);
    expect(r.matches).toEqual([]);
  });

  it("trunca no teto e sinaliza", () => {
    const r = findMatches("a".repeat(50), spec("a"), 10);
    if ("error" in r) throw new Error(r.error);
    expect(r.matches.length).toBe(10);
    expect(r.truncated).toBe(true);
  });
});

describe("groupsAt", () => {
  it("recupera os grupos da ocorrência naquela posição exata", () => {
    const text = "url=jdbc:postgresql://172.25.136.30:5432";
    const s = spec("(\\d+)\\.(\\d+)", { regexp: true });
    const r = findMatches(text, s);
    if ("error" in r) throw new Error(r.error);
    const g = groupsAt(text, s, r.matches[0].from, r.matches[0].to);
    expect(g).toEqual(["172.25", "172", "25"]);
  });

  it("retorna null quando o texto mudou e o padrão não casa mais ali", () => {
    expect(groupsAt("abc", spec("z", { regexp: true }), 0, 1)).toBeNull();
  });
});

describe("expandReplacement", () => {
  it("expande $1, $& e $0", () => {
    const groups = ["172.25", "172", "25"];
    expect(expandReplacement("$2-$1", groups)).toBe("25-172");
    expect(expandReplacement("[$&]", groups)).toBe("[172.25]");
    expect(expandReplacement("[$0]", groups)).toBe("[172.25]");
  });

  it("$$ vira $ e grupo inexistente fica literal", () => {
    expect(expandReplacement("$$1 = $1; $9", ["ab", "x"])).toBe("$1 = x; $9");
  });

  it("expande \\n, \\t e \\\\", () => {
    expect(expandReplacement("a\\nb\\tc\\\\d", ["m"])).toBe("a\nb\tc\\d");
  });

  it("prefere grupo de dois dígitos quando ele existe", () => {
    const groups = ["w", ...Array.from({ length: 12 }, (_, i) => `g${i + 1}`)];
    expect(expandReplacement("$12", groups)).toBe("g12");
    expect(expandReplacement("$12", ["w", "só-um"])).toBe("só-um2");
  });
});

describe("buildPattern", () => {
  it("literal nunca falha, regex inválida reporta erro", () => {
    expect("re" in buildPattern(spec("a("))).toBe(true);
    expect("error" in buildPattern(spec("a(", { regexp: true }))).toBe(true);
  });
});
