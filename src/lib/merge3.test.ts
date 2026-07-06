import { describe, expect, it } from "vitest";

import { detectEol, diff3, fromLines, magicMerge, type MergeRegion, toLines } from "@/lib/merge3";

describe("diff3", () => {
  it("texto igual nas três vias vira uma única região estável", () => {
    const r = diff3(["a", "b"], ["a", "b"], ["a", "b"]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("stable");
    expect(r[0].base).toEqual(["a", "b"]);
  });

  it("mudança só minha é 'left' (aplicação automática)", () => {
    const r = diff3(["a", "b", "c"], ["a", "X", "c"], ["a", "b", "c"]);
    expect(r.map((x) => x.kind)).toEqual(["stable", "left", "stable"]);
    expect(r[1].mine).toEqual(["X"]);
    expect(r[1].base).toEqual(["b"]);
  });

  it("mudança só do servidor é 'right'", () => {
    const r = diff3(["a", "b", "c"], ["a", "b", "c"], ["a", "Y", "c"]);
    expect(r.map((x) => x.kind)).toEqual(["stable", "right", "stable"]);
    expect(r[1].theirs).toEqual(["Y"]);
  });

  it("a mesma mudança dos dois lados é 'both'", () => {
    const r = diff3(["a", "b", "c"], ["a", "X", "c"], ["a", "X", "c"]);
    expect(r.map((x) => x.kind)).toEqual(["stable", "both", "stable"]);
  });

  it("mudanças divergentes no mesmo trecho são 'conflict'", () => {
    const r = diff3(["a", "b", "c"], ["a", "X", "c"], ["a", "Y", "c"]);
    expect(r.map((x) => x.kind)).toEqual(["stable", "conflict", "stable"]);
    expect(r[1].mine).toEqual(["X"]);
    expect(r[1].theirs).toEqual(["Y"]);
  });

  it("inserção de um lado só é automática", () => {
    const r = diff3(["a", "c"], ["a", "b", "c"], ["a", "c"]);
    expect(r.map((x) => x.kind)).toEqual(["stable", "left", "stable"]);
    expect(r[1].mine).toEqual(["b"]);
    expect(r[1].base).toEqual([]);
  });

  it("edições divergentes no fim do arquivo conflitam", () => {
    const r = diff3(["a", "b"], ["a", "M"], ["a", "T"]);
    expect(r.map((x) => x.kind)).toEqual(["stable", "conflict"]);
  });
});

describe("EOL e linhas", () => {
  it("detecta o fim-de-linha dominante", () => {
    expect(detectEol("a\r\nb\r\nc\n")).toBe("\r\n");
    expect(detectEol("a\nb\n")).toBe("\n");
    expect(detectEol("")).toBe("\n");
  });

  it("toLines separa linhas e marca a quebra final", () => {
    expect(toLines("a\r\nb\r\n")).toEqual({ lines: ["a", "b"], trailingEol: true });
    expect(toLines("a\nb")).toEqual({ lines: ["a", "b"], trailingEol: false });
    expect(toLines("")).toEqual({ lines: [], trailingEol: false });
  });

  it("fromLines reconstrói no estilo original (roundtrip)", () => {
    expect(fromLines(["a", "b"], "\r\n", true)).toBe("a\r\nb\r\n");
    expect(fromLines(["a", "b"], "\n", false)).toBe("a\nb");
    expect(fromLines([], "\n", true)).toBe("");

    const original = "x\r\ny\r\n";
    const { lines, trailingEol } = toLines(original);
    expect(fromLines(lines, detectEol(original), trailingEol)).toBe(original);
  });
});

describe("magicMerge (varinha: conflitos simples)", () => {
  const conflict = (base: string[], mine: string[], theirs: string[]): MergeRegion => ({
    kind: "conflict",
    base,
    mine,
    theirs,
  });

  it("edições em palavras diferentes da mesma linha se resolvem sozinhas", () => {
    // eu troquei o valor; o servidor trocou o nome — não brigam.
    expect(magicMerge(conflict(["foo = 1"], ["foo = 2"], ["bar = 1"]))).toBe("bar = 2");
  });

  it("edições na MESMA palavra continuam conflito (null)", () => {
    expect(magicMerge(conflict(["x = 1"], ["x = 2"], ["x = 3"]))).toBeNull();
  });

  it("mescla por palavra atravessa múltiplas linhas", () => {
    const r = conflict(["foo(1)", "bar(2)"], ["foo(9)", "bar(2)"], ["foo(1)", "bar(8)"]);
    expect(magicMerge(r)).toBe("foo(9)\nbar(8)");
  });

  it("preserva espaços e indentação (roundtrip por token)", () => {
    // eu acrescentei um comentário no fim; o servidor trocou a→A no começo.
    const r = conflict(["  a = 1;"], ["  a = 1; // meu"], ["  A = 1;"]);
    expect(magicMerge(r)).toBe("  A = 1; // meu");
  });

  it("só age em regiões de conflito", () => {
    expect(magicMerge({ kind: "left", base: ["a"], mine: ["b"], theirs: ["a"] })).toBeNull();
    expect(magicMerge({ kind: "stable", base: ["a"], mine: ["a"], theirs: ["a"] })).toBeNull();
  });
});
