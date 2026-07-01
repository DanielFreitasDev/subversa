import { describe, expect, it } from "vitest";

import { actionMeta, baseName, dirName, fileExt, formatBytes, initials, statusMeta } from "@/lib/utils";

describe("statusMeta", () => {
  it("mapeia os status conhecidos", () => {
    expect(statusMeta("modified").letter).toBe("M");
    expect(statusMeta("added").letter).toBe("A");
    expect(statusMeta("deleted").letter).toBe("D");
    expect(statusMeta("unversioned").letter).toBe("?");
    expect(statusMeta("conflicted").letter).toBe("C");
  });

  it("promove mudança só de propriedade a 'Modificado'", () => {
    expect(statusMeta("normal", "modified").letter).toBe("M");
    expect(statusMeta("none", "conflicted").letter).toBe("M");
  });

  it("não promove quando o item já tem status próprio", () => {
    expect(statusMeta("added", "modified").letter).toBe("A");
  });

  it("cai para o neutro em status desconhecido", () => {
    expect(statusMeta("banana").label).toBe("—");
  });
});

describe("actionMeta", () => {
  it("é case-insensitive e cobre as ações do log/merge", () => {
    expect(actionMeta("a").letter).toBe("A");
    expect(actionMeta("U").letter).toBe("U");
    expect(actionMeta("g").letter).toBe("G");
    expect(actionMeta("z").label).toBe("—");
  });
});

describe("formatBytes", () => {
  it("formata unidades e casas decimais", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(null)).toBe("");
  });
});

describe("caminhos e nomes", () => {
  it("extrai base, diretório e extensão", () => {
    expect(baseName("/wc/src/app.ts")).toBe("app.ts");
    expect(dirName("/wc/src/app.ts")).toBe("/wc/src");
    expect(fileExt("/wc/src/app.TS")).toBe("ts");
    expect(fileExt("/wc/Makefile")).toBe("");
  });

  it("gera iniciais de autores", () => {
    expect(initials("daniel.souza")).toBe("DS");
    expect(initials("ana")).toBe("AN");
    expect(initials("")).toBe("?");
  });
});
