import { describe, expect, it } from "vitest";

import { canRedo, canUndo, initHistory, push, redo, reset, undo } from "@/lib/history";

describe("history", () => {
  it("começa só com o present, sem desfazer/refazer", () => {
    const h = initHistory(1);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("push empilha e habilita o desfazer", () => {
    const h = push(initHistory(1), 2);
    expect(h.present).toBe(2);
    expect(h.past).toEqual([1]);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it("desfazer e refazer voltam ao mesmo estado (roundtrip)", () => {
    let h = push(push(initHistory(1), 2), 3);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    expect(canRedo(h)).toBe(false);
  });

  it("um novo push descarta o que havia para refazer", () => {
    let h = push(push(initHistory(1), 2), 3);
    h = undo(h); // present 2, future [3]
    expect(canRedo(h)).toBe(true);
    h = push(h, 9); // novo caminho
    expect(h.present).toBe(9);
    expect(canRedo(h)).toBe(false);
  });

  it("coalesce: pushes com a mesma chave viram uma entrada só", () => {
    let h = initHistory("");
    h = push(h, "a", "edit-1");
    h = push(h, "ab", "edit-1");
    h = push(h, "abc", "edit-1");
    expect(h.present).toBe("abc");
    expect(h.past).toEqual([""]); // uma única entrada agrupada
    h = undo(h);
    expect(h.present).toBe(""); // desfaz o grupo inteiro
  });

  it("coalesce quebra quando a chave muda (ou some)", () => {
    let h = initHistory("");
    h = push(h, "a", "edit-1");
    h = push(h, "b", "edit-2"); // chave diferente → entrada nova
    expect(h.past).toEqual(["", "a"]);
    h = push(h, "c"); // sem chave → nunca coalesce
    h = push(h, "d"); // sem chave → também não coalesce entre si
    expect(h.past).toEqual(["", "a", "b", "c"]);
  });

  it("reset limpa past e future", () => {
    let h = push(push(initHistory(1), 2), 3);
    h = undo(h);
    h = reset(42);
    expect(h.present).toBe(42);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("undo/redo sem histórico devolvem o mesmo objeto", () => {
    const h = initHistory(1);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});
