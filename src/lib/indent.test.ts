import { describe, expect, it } from "vitest";

import { detectIndent } from "./indent";

describe("detectIndent", () => {
  it("java com 4 espaços", () => {
    const text = [
      "public class A {",
      "    void m() {",
      "        int x = 1;",
      "    }",
      "}",
    ].join("\n");
    expect(detectIndent(text)).toEqual({ useTabs: false, size: 4 });
  });

  it("xml com 2 espaços", () => {
    const text = ["<a>", "  <b>", "    <c/>", "  </b>", "</a>"].join("\n");
    expect(detectIndent(text)).toEqual({ useTabs: false, size: 2 });
  });

  it("tabs vencem quando são maioria", () => {
    const text = ["fn main() {", "\tlet a = 1;", "\tif a > 0 {", "\t\tprint!();", "\t}", "}"].join("\n");
    expect(detectIndent(text).useTabs).toBe(true);
  });

  it("arquivo sem indentação usa o padrão (4 espaços)", () => {
    expect(detectIndent("a\nb\nc")).toEqual({ useTabs: false, size: 4 });
    expect(detectIndent("")).toEqual({ useTabs: false, size: 4 });
  });

  it("linhas em branco e CRLF não atrapalham", () => {
    const text = "<a>\r\n\r\n  <b/>\r\n</a>\r\n";
    expect(detectIndent(text).size).toBe(2);
  });
});
