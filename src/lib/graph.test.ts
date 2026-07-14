import { describe, expect, it } from "vitest";

import { buildGraph, laneShortName, repoRelativePath } from "@/lib/graph";
import type { GraphLogEntry, GraphPath, MergedRevision } from "@/lib/types";

const TRUNK = "/trunk/PROJETOS/sna";
const ISSUE1 = "/branches/ISSUES 2026/06 - JUNHO/issue_1";
const ISSUE0 = "/branches/ISSUES 2026/05 - MAIO/issue_0";
const ALHEIO = "/branches/ISSUES 2026/06 - JUNHO/issue_x"; // de outro projeto

function path(p: Partial<GraphPath> & { path: string }): GraphPath {
  return {
    action: "M",
    kind: "file",
    copyfromPath: null,
    copyfromRev: null,
    ...p,
  };
}

function entry(
  revision: number,
  paths: GraphPath[],
  mergedRevisions: MergedRevision[] = [],
): GraphLogEntry {
  return {
    revision,
    author: "daniel",
    date: "2026-06-20T10:00:00.000Z",
    message: `r${revision}`,
    paths,
    mergedRevisions,
  };
}

/** História de exemplo, da mais antiga para a mais nova (o builder inverte). */
function story(): GraphLogEntry[] {
  const asc: GraphLogEntry[] = [
    // r99: branch pré-janela (issue_0) recebe um sync de uma revisão fora da janela
    entry(
      99,
      [path({ path: `${ISSUE0}/src/App.java` }), path({ path: ISSUE0, kind: "dir" })],
      [{ revision: 98, path: `${TRUNK}/src/App.java` }],
    ),
    // r100: commit no trunk
    entry(100, [path({ path: `${TRUNK}/src/App.java` })]),
    // r101: criação do issue_1 (cópia do trunk@100) + pasta de estrutura junto
    entry(101, [
      path({ path: "/branches/ISSUES 2026", action: "A", kind: "dir" }),
      path({
        path: ISSUE1,
        action: "A",
        kind: "dir",
        copyfromPath: TRUNK,
        copyfromRev: 100,
      }),
    ]),
    // r102: commit no issue_1
    entry(102, [
      path({ path: `${ISSUE1}/src/App.java` }),
      path({ path: `${ISSUE1}/src/Outro.java` }),
      path({ path: `${TRUNK}/README.md` }), // minoria: o voto fica no branch
    ]),
    // r103: commit no trunk
    entry(103, [path({ path: `${TRUNK}/src/Regra.java` })]),
    // r104: sync trunk → issue_1
    entry(
      104,
      [path({ path: ISSUE1, kind: "dir" }), path({ path: `${ISSUE1}/src/Regra.java` })],
      [{ revision: 103, path: `${TRUNK}/src/Regra.java` }],
    ),
    // r105: branch de OUTRO projeto (copyfrom fora do nosso trunk)
    entry(105, [
      path({
        path: ALHEIO,
        action: "A",
        kind: "dir",
        copyfromPath: "/trunk/PROJETOS/getran",
        copyfromRev: 90,
      }),
    ]),
    // r106: commit no branch alheio
    entry(106, [path({ path: `${ALHEIO}/src/Coisa.java` })]),
    // r107: reintegração issue_1 → trunk
    entry(
      107,
      [path({ path: TRUNK, kind: "dir" }), path({ path: `${TRUNK}/src/App.java` })],
      [
        { revision: 102, path: `${ISSUE1}/src/App.java` },
        { revision: 104, path: `${ISSUE1}/src/Regra.java` },
      ],
    ),
    // r108: apaga o issue_1
    entry(108, [path({ path: ISSUE1, action: "D", kind: "dir" })]),
  ];
  return asc.reverse();
}

function build(truncated = true) {
  return buildGraph({
    entries: story(),
    trunkPath: TRUNK,
    branchesPath: "/branches",
    truncated,
  });
}

const rowOf = (m: ReturnType<typeof build>, rev: number) =>
  m.rows.findIndex((r) => r.entry.revision === rev);

describe("buildGraph", () => {
  it("escopa o grafo ao projeto: branches alheios ficam de fora", () => {
    const m = build();
    expect(m.lanes.map((l) => l.id)).not.toContain(ALHEIO);
    expect(rowOf(m, 105)).toBe(-1);
    expect(rowOf(m, 106)).toBe(-1);
    // e as revisões do projeto continuam todas lá
    expect(m.rows).toHaveLength(8);
  });

  it("reconhece a criação do branch e liga o fork na revisão de origem", () => {
    const m = build();
    const lane = m.lanes.find((l) => l.id === ISSUE1)!;
    expect(lane.kind).toBe("branch");
    expect(lane.createdRow).toBe(rowOf(m, 101));

    const fork = m.links.find((l) => l.kind === "fork" && l.toLaneId === ISSUE1)!;
    expect(fork.fromLaneId).toBe(TRUNK);
    expect(fork.fromRow).toBe(rowOf(m, 100)); // copyfrom-rev 100
    expect(fork.toRow).toBe(rowOf(m, 101));
    expect(fork.sourceRev).toBe(100);
    expect(fork.offWindow).toBe(false);
  });

  it("vota a lane primária pela maioria dos paths", () => {
    const m = build();
    expect(m.rows[rowOf(m, 102)].laneId).toBe(ISSUE1); // 2 paths no branch × 1 no trunk
    expect(m.rows[rowOf(m, 101)].laneId).toBe(ISSUE1); // criação: estrutura não vota
    expect(m.rows[rowOf(m, 100)].laneId).toBe(TRUNK);
  });

  it("desenha sync (trunk → branch) e reintegração (branch → trunk)", () => {
    const m = build();
    const sync = m.links.find((l) => l.kind === "sync")!;
    expect(sync.fromLaneId).toBe(TRUNK);
    expect(sync.toLaneId).toBe(ISSUE1);
    expect(sync.fromRow).toBe(rowOf(m, 103));
    expect(sync.toRow).toBe(rowOf(m, 104));

    const reint = m.links.find((l) => l.kind === "reintegrate")!;
    expect(reint.fromLaneId).toBe(ISSUE1);
    expect(reint.toLaneId).toBe(TRUNK);
    expect(reint.fromRow).toBe(rowOf(m, 104)); // revisão absorvida mais nova
    expect(reint.toRow).toBe(rowOf(m, 107));
    expect(m.rows[rowOf(m, 107)].isMerge).toBe(true);
  });

  it("encerra a lane na deleção da raiz", () => {
    const m = build();
    const lane = m.lanes.find((l) => l.id === ISSUE1)!;
    expect(lane.deletedRow).toBe(rowOf(m, 108));
    expect(lane.alive).toBe(false);
    expect(m.rows[rowOf(m, 108)].laneId).toBe(ISSUE1);
  });

  it("inclui branch pré-janela conectado por merge, com fundo aberto", () => {
    const m = build();
    const lane = m.lanes.find((l) => l.id === ISSUE0)!;
    expect(lane.openBottom).toBe(true);
    expect(lane.createdRow).toBeUndefined();

    // O sync veio de uma revisão fora da janela → stub, sem row de origem.
    const sync = m.links.find((l) => l.kind === "sync" && l.toLaneId === ISSUE0)!;
    expect(sync.offWindow).toBe(true);
    expect(sync.sourceRev).toBe(98);
  });

  it("dá coluna 0 ao trunk e colunas distintas a branches que se sobrepõem", () => {
    const m = build();
    const trunk = m.lanes.find((l) => l.kind === "trunk")!;
    expect(trunk.column).toBe(0);
    // issue_0 (só a linha do fundo) não sobrepõe o issue_1 → recicla a coluna.
    expect(m.lanes.find((l) => l.id === ISSUE1)!.column).toBe(1);
    expect(m.lanes.find((l) => l.id === ISSUE0)!.column).toBe(1);

    // Dois branches vivos ao mesmo tempo ganham colunas diferentes.
    const asc = [
      entry(400, [path({ path: `${TRUNK}/a.java` })]),
      entry(401, [
        path({ path: "/branches/ISSUES 2026/06 - JUNHO/issue_a", action: "A", kind: "dir", copyfromPath: TRUNK, copyfromRev: 400 }),
      ]),
      entry(402, [path({ path: "/branches/ISSUES 2026/06 - JUNHO/issue_a/x.java" })]),
      entry(403, [
        path({ path: "/branches/ISSUES 2026/06 - JUNHO/issue_b", action: "A", kind: "dir", copyfromPath: TRUNK, copyfromRev: 400 }),
      ]),
      entry(404, [path({ path: "/branches/ISSUES 2026/06 - JUNHO/issue_b/y.java" })]),
      entry(405, [path({ path: "/branches/ISSUES 2026/06 - JUNHO/issue_a/z.java" })]),
    ].reverse();
    const m2 = buildGraph({ entries: asc, trunkPath: TRUNK, branchesPath: "/branches" });
    const a = m2.lanes.find((l) => l.name === "issue_a")!;
    const b = m2.lanes.find((l) => l.name === "issue_b")!;
    expect(a.column).not.toBe(b.column);
    expect(m2.columnCount).toBe(3);
  });

  it("recicla a coluna de um branch morto para o próximo", () => {
    // issue_a vive (r201..r203) e morre; issue_b nasce depois (r205) → mesma coluna.
    const asc = [
      entry(200, [path({ path: `${TRUNK}/a.java` })]),
      entry(201, [
        path({ path: "/branches/ISSUES 2026/06 - JUNHO/issue_a", action: "A", kind: "dir", copyfromPath: TRUNK, copyfromRev: 200 }),
      ]),
      entry(202, [path({ path: "/branches/ISSUES 2026/06 - JUNHO/issue_a/x.java" })]),
      entry(203, [path({ path: "/branches/ISSUES 2026/06 - JUNHO/issue_a", action: "D", kind: "dir" })]),
      entry(204, [path({ path: `${TRUNK}/b.java` })]),
      entry(205, [
        path({ path: "/branches/ISSUES 2026/07 - JULHO/issue_b", action: "A", kind: "dir", copyfromPath: TRUNK, copyfromRev: 204 }),
      ]),
    ].reverse();
    const m = buildGraph({ entries: asc, trunkPath: TRUNK, branchesPath: "/branches" });
    const a = m.lanes.find((l) => l.name === "issue_a")!;
    const b = m.lanes.find((l) => l.name === "issue_b")!;
    expect(a.column).toBe(1);
    expect(b.column).toBe(1);
    expect(m.columnCount).toBe(2);
  });

  it("commit só de estrutura cai no trunk sem criar lane", () => {
    const asc = [
      entry(300, [path({ path: `${TRUNK}/a.java` })]),
      entry(301, [path({ path: "/branches/ISSUES 2027", action: "A", kind: "dir" })]),
    ].reverse();
    const m = buildGraph({ entries: asc, trunkPath: TRUNK, branchesPath: "/branches" });
    expect(m.lanes).toHaveLength(1);
    expect(m.rows[rowOf(m, 301)].laneId).toBe(TRUNK);
  });

  it("marca o trunk com fundo aberto quando a janela está truncada", () => {
    const trunk = (t: boolean) => build(t).lanes.find((l) => l.kind === "trunk")!;
    expect(trunk(true).openBottom).toBe(true);
    expect(trunk(false).openBottom).toBe(false);
  });

  it("grafo vazio não quebra", () => {
    const m = buildGraph({ entries: [], trunkPath: TRUNK, branchesPath: "/branches" });
    expect(m.rows).toHaveLength(0);
    expect(m.lanes).toHaveLength(0);
    expect(m.columnCount).toBe(1);
  });
});

describe("helpers", () => {
  it("repoRelativePath tira a raiz e decodifica percent-encoding", () => {
    expect(
      repoRelativePath(
        "svn+ssh://host/usr/svn/veiculo/branches/ISSUES%202026/06%20-%20JUNHO/issue_1",
        "svn+ssh://host/usr/svn/veiculo",
      ),
    ).toBe("/branches/ISSUES 2026/06 - JUNHO/issue_1");
    expect(repoRelativePath("svn+ssh://host/repo/trunk/", "svn+ssh://host/repo")).toBe(
      "/trunk",
    );
  });

  it("laneShortName devolve o último segmento", () => {
    expect(laneShortName(ISSUE1)).toBe("issue_1");
    expect(laneShortName("trunk")).toBe("trunk");
  });
});
