import { describe, expect, it } from "vitest";

import { canFormat, formatText, minimalReplace } from "./format";

const INDENT4 = { useTabs: false, size: 4 };
const INDENT2 = { useTabs: false, size: 2 };

const ok = (r: Awaited<ReturnType<typeof formatText>>): string => {
  if ("error" in r) throw new Error(r.error);
  return r.ok;
};

describe("formatText", () => {
  it("java: reflui e indenta pela largura do arquivo", async () => {
    const out = ok(await formatText("/wc/A.java", "package a;\npublic class A { void m(){int x=1;} }", INDENT4));
    expect(out).toContain("public class A {");
    expect(out).toContain("    void m() {");
    expect(out).toContain("        int x = 1;");
  });

  it("xml: reindenta ignorando o whitespace original (context.xml da vida)", async () => {
    const out = ok(await formatText("/wc/context.xml", '<Context path="/getran"><Resource name="jdbc/x"/></Context>', INDENT2));
    expect(out).toContain('<Context path="/getran">');
    expect(out).toContain('  <Resource name="jdbc/x" />');
  });

  it("json e css: formatadores nativos do prettier", async () => {
    expect(ok(await formatText("/wc/a.json", '{"b":1,"a":[1,2]}', INDENT2))).toBe('{ "b": 1, "a": [1, 2] }\n');
    expect(ok(await formatText("/wc/a.css", "a{color:red;b:1px}", INDENT2))).toBe("a {\n  color: red;\n  b: 1px;\n}\n");
  });

  it("sql: usa o sql-formatter respeitando a indentação", async () => {
    const out = ok(await formatText("/wc/q.sql", "select a,b from t where x=1", INDENT2));
    expect(out.split("\n")).toContain("select");
    expect(out).toContain("  a,");
  });

  it("erro de sintaxe vira mensagem amigável, não exceção", async () => {
    const r = await formatText("/wc/B.java", "public class {", INDENT4);
    expect("error" in r).toBe(true);
  });

  it("linguagem sem formatador reporta erro (e canFormat concorda)", async () => {
    expect(canFormat("/wc/app.properties")).toBe(false);
    expect(canFormat("/wc/A.java")).toBe(true);
    const r = await formatText("/wc/app.properties", "a=1", INDENT4);
    expect("error" in r).toBe(true);
  });
});

describe("minimalReplace", () => {
  it("troca só o miolo diferente (prefixo/sufixo comuns preservados)", () => {
    expect(minimalReplace("abcXYdef", "abcQQQdef")).toEqual({ from: 3, to: 5, insert: "QQQ" });
  });

  it("inserção pura e remoção pura", () => {
    expect(minimalReplace("abdef", "abcdef")).toEqual({ from: 2, to: 2, insert: "c" });
    expect(minimalReplace("abcdef", "abdef")).toEqual({ from: 2, to: 3, insert: "" });
  });

  it("textos iguais viram troca vazia", () => {
    const r = minimalReplace("mesmo", "mesmo");
    expect(r.insert).toBe("");
    expect(r.from).toBe(r.to);
  });
});
