// Motor do grafo de revisões (aba "Gráfico").
//
// Reconstrói a topologia das linhas de desenvolvimento a partir do
// `svn log -v -g --xml` da raiz do repositório: no SVN a história é uma
// sequência global única de revisões; branch é uma cópia de diretório
// (copyfrom) e merge fica registrado em svn:mergeinfo (o `-g` aninha as
// revisões absorvidas dentro do commit de merge). Daqui saem as "lanes"
// (trunk + branches), a coluna de cada uma e as ligações (fork, sync,
// reintegração) que a view desenha em SVG.
//
// O repositório hospeda vários projetos, então o grafo é ESCOPADO: só entram
// o trunk do projeto e os branches conectados a ele por fork ou por merge
// (componente conexa do trunk). Branches de outros projetos, mesmo vizinhos
// na mesma pasta de branches, ficam de fora.
//
// Tudo aqui é puro e determinístico — sem DOM, sem IPC — para os testes
// unitários cobrirem a topologia sem depender de servidor.

import type { GraphLogEntry } from "./types";

/** Linha de desenvolvimento: o trunk ou a raiz de um branch. */
export interface GraphLane {
  /** Caminho-raiz repo-relativo (identidade da lane). */
  id: string;
  /** Rótulo curto (último segmento; o trunk vira "trunk"). */
  name: string;
  kind: "trunk" | "branch";
  /** Coluna no desenho (0 = trunk). */
  column: number;
  /** Índice na paleta de cores de branch (o trunk ignora). */
  colorIndex: number;
  /** Row mais recente da lane (0 = topo do grafo). */
  topRow: number;
  /** Row mais antiga da lane dentro da janela. */
  bottomRow: number;
  /** Row da cópia que criou o branch, se a criação está na janela. */
  createdRow?: number;
  /** Row da deleção da raiz, se aconteceu na janela. */
  deletedRow?: number;
  /** true = a raiz ainda existe (não vimos deleção na janela). */
  alive: boolean;
  /**
   * true = a lane continua além do fundo da janela (branch criado antes das
   * revisões carregadas, ou trunk com histórico truncado) — desenhar stub.
   */
  openBottom: boolean;
}

/** Uma revisão posicionada no grafo (mesma ordem do log: mais nova primeiro). */
export interface GraphRow {
  entry: GraphLogEntry;
  /** Lane primária da revisão (maioria dos paths alterados). */
  laneId: string;
  column: number;
  /** true = commit de merge (o `-g` aninhou revisões absorvidas). */
  isMerge: boolean;
}

export type GraphLinkKind = "fork" | "sync" | "reintegrate" | "merge";

/** Ligação entre lanes: cópia (fork) ou chegada de merge (seta direcional). */
export interface GraphLink {
  kind: GraphLinkKind;
  /** Origem (revisão fonte). Ignorado quando `offWindow`. */
  fromRow: number;
  fromColumn: number;
  fromLaneId: string;
  /** Destino (revisão que recebe a cópia/merge). */
  toRow: number;
  toColumn: number;
  toLaneId: string;
  /** true = a origem é mais antiga que a janela carregada (desenhar stub). */
  offWindow: boolean;
  /** Revisão de origem (para tooltip), quando conhecida. */
  sourceRev?: number;
}

export interface GraphModel {
  rows: GraphRow[];
  lanes: GraphLane[];
  links: GraphLink[];
  columnCount: number;
}

export interface GraphSource {
  /** Entradas do log, mais novas primeiro (ordem natural do `svn log`). */
  entries: GraphLogEntry[];
  /** Caminho repo-relativo do trunk do projeto (ex.: "/trunk/PROJETOS/sna"). */
  trunkPath: string;
  /** Caminho repo-relativo da raiz de branches (ex.: "/branches"). */
  branchesPath: string;
  /** true quando o log bateu no limite (há história além do fundo). */
  truncated?: boolean;
}

/** Quantidade de tons na paleta de branches da view. */
export const BRANCH_COLOR_COUNT = 6;

/**
 * Profundidade da convenção de branches do time:
 * `branches/ISSUES <ano>/<NN - MÊS>/<branch>` → a raiz fica 3 segmentos
 * abaixo da pasta de branches. Caminhos mais rasos são estrutura (anos/meses),
 * não branches.
 */
const BRANCH_DEPTH = 3;

const norm = (p: string) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
const under = (path: string, root: string) => path === root || path.startsWith(root + "/");

/** Último segmento de um caminho (nome curto do branch). */
export function laneShortName(root: string): string {
  const i = root.lastIndexOf("/");
  return i >= 0 ? root.slice(i + 1) : root;
}

/**
 * Converte uma URL completa em caminho repo-relativo ("/trunk/PROJETOS/sna"),
 * decodificando percent-encoding (a convenção de branches tem espaços).
 */
export function repoRelativePath(url: string, repoRoot: string): string {
  const root = norm(repoRoot.replace(/\/+$/, ""));
  let rel = url.replace(/\/+$/, "");
  if (rel.startsWith(root)) rel = rel.slice(root.length);
  if (!rel.startsWith("/")) rel = "/" + rel;
  try {
    return decodeURIComponent(rel);
  } catch {
    return rel;
  }
}

interface LaneBuild {
  id: string;
  kind: "trunk" | "branch";
  /** Índices no array ORIGINAL de entradas (antes do escopo). */
  createdAt?: number;
  forkFromPath?: string;
  forkFromRev?: number;
  deletedAt?: number;
}

/** Monta o modelo do grafo a partir do log verboso da raiz do repositório. */
export function buildGraph(src: GraphSource): GraphModel {
  const trunkPath = norm(src.trunkPath);
  const branchesPath = norm(src.branchesPath);
  const entries = src.entries;
  const n = entries.length;

  const lanes = new Map<string, LaneBuild>();
  lanes.set(trunkPath, { id: trunkPath, kind: "trunk" });

  const segsAfterBranches = (path: string) =>
    path.slice(branchesPath.length + 1).split("/");

  /** Maior raiz de lane já conhecida que contém `path` (ou null). */
  const knownRootOf = (path: string): string | null => {
    if (under(path, trunkPath)) return trunkPath;
    let best: string | null = null;
    for (const id of lanes.keys()) {
      if (id !== trunkPath && under(path, id) && (!best || id.length > best.length))
        best = id;
    }
    return best;
  };

  /**
   * Raiz de branch inferida pela convenção (3 segmentos sob a pasta de
   * branches). Paths mais rasos são estrutura (ano/mês) → null.
   */
  const conventionRoot = (path: string, kind: string | null): string | null => {
    if (!under(path, branchesPath) || path === branchesPath) return null;
    const segs = segsAfterBranches(path);
    const depth = kind === "file" ? segs.length - 1 : segs.length;
    if (depth < BRANCH_DEPTH) return null;
    return branchesPath + "/" + segs.slice(0, BRANCH_DEPTH).join("/");
  };

  const resolveRoot = (path: string, kind: string | null): string | null =>
    knownRootOf(path) ?? conventionRoot(path, kind);

  // ---- Passo 1: descobrir lanes na ordem cronológica (fundo → topo) --------
  // Criações (A/R com copyfrom), deleções de raiz e branches pré-janela
  // (aparecem só por uso ou por deleção).
  for (let i = n - 1; i >= 0; i--) {
    for (const p of entries[i].paths) {
      const path = norm(p.path);

      const isCopy =
        p.copyfromPath != null &&
        p.copyfromRev != null &&
        (p.action === "A" || p.action === "R") &&
        p.kind !== "file";
      if (isCopy && under(path, branchesPath) && path !== branchesPath) {
        const inside = knownRootOf(path);
        const depth = segsAfterBranches(path).length;
        const copyOfTrunk = norm(p.copyfromPath!) === trunkPath;
        // Cópia interna a um branch existente não cria lane; fora disso, uma
        // cópia na profundidade da convenção (ou uma cópia do trunk inteiro,
        // onde quer que pouse) é criação de branch.
        if ((inside == null || inside === path) && (depth <= BRANCH_DEPTH || copyOfTrunk)) {
          lanes.set(path, {
            id: path,
            kind: "branch",
            createdAt: i,
            forkFromPath: norm(p.copyfromPath!),
            forkFromRev: p.copyfromRev!,
          });
          continue;
        }
      }

      if (p.action === "D" && under(path, branchesPath)) {
        // Deletar a raiz (ou uma pasta de estrutura acima dela) encerra a lane.
        let hit = false;
        for (const lane of lanes.values()) {
          if (lane.kind === "branch" && under(lane.id, path) && lane.deletedAt === undefined) {
            lane.deletedAt = i;
            hit = true;
          }
        }
        // Branch pré-janela deletado direto na raiz da convenção.
        if (!hit) {
          const conv = conventionRoot(path, p.kind);
          if (conv === path && !lanes.has(path)) {
            lanes.set(path, { id: path, kind: "branch", deletedAt: i });
          }
        }
        continue;
      }

      // Uso comum (M/A em arquivos) de branch criado antes da janela.
      if (knownRootOf(path) == null) {
        const conv = conventionRoot(path, p.kind);
        if (conv != null && !lanes.has(conv))
          lanes.set(conv, { id: conv, kind: "branch" });
      }
    }
  }

  // ---- Passo 2: lane primária de cada entrada (voto por paths) -------------
  const entryLane: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const votes = new Map<string, number>();
    for (const p of entries[i].paths) {
      const root = resolveRoot(norm(p.path), p.kind);
      if (root != null && lanes.has(root)) votes.set(root, (votes.get(root) ?? 0) + 1);
    }
    let laneId = trunkPath;
    let best = 0;
    for (const [id, v] of votes) {
      if (v > best) {
        best = v;
        laneId = id;
        continue;
      }
      if (v === best && best > 0 && id !== laneId) {
        // Desempate: a lane criada nesta revisão ganha; depois branch > trunk.
        const cand = lanes.get(id)!;
        const cur = lanes.get(laneId)!;
        const candCreated = cand.createdAt === i;
        const curCreated = cur.createdAt === i;
        if (candCreated && !curCreated) laneId = id;
        else if (candCreated === curCreated && cur.kind === "trunk" && cand.kind === "branch")
          laneId = id;
      }
    }
    entryLane[i] = laneId;
  }

  // Origens de merge por entrada: lane de origem → revisão absorvida mais nova.
  const idxByRev = new Map<number, number>();
  for (let i = 0; i < n; i++) idxByRev.set(entries[i].revision, i);
  const mergeSources: Map<string, number>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const sources = new Map<string, number>();
    for (const mr of entries[i].mergedRevisions) {
      const at = idxByRev.get(mr.revision);
      const root =
        at !== undefined
          ? entryLane[at]
          : mr.path != null
            ? resolveRoot(norm(mr.path), "file")
            : null;
      if (root == null || root === entryLane[i] || !lanes.has(root)) continue;
      sources.set(root, Math.max(sources.get(root) ?? 0, mr.revision));
    }
    mergeSources[i] = sources;
  }

  // ---- Passo 3: escopo do projeto (componente conexa do trunk) -------------
  // Aresta entre lanes = fork (copyfrom) ou merge em qualquer direção.
  const adjacency = new Map<string, Set<string>>();
  const connect = (a: string, b: string) => {
    if (a === b) return;
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  };
  for (const lane of lanes.values()) {
    if (lane.forkFromPath != null) {
      const src = resolveRoot(lane.forkFromPath, "dir");
      if (src != null && lanes.has(src)) connect(lane.id, src);
    }
  }
  for (let i = 0; i < n; i++) {
    for (const srcId of mergeSources[i].keys()) connect(entryLane[i], srcId);
  }
  const ours = new Set<string>([trunkPath]);
  const queue = [trunkPath];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const next of adjacency.get(cur) ?? []) {
      if (!ours.has(next)) {
        ours.add(next);
        queue.push(next);
      }
    }
  }

  // ---- Passo 4: rows = entradas cujas lanes pertencem ao projeto -----------
  const rows: GraphRow[] = [];
  const newIdx = new Map<number, number>(); // índice original → índice da row
  const laneRows = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const laneId = entryLane[i];
    if (!ours.has(laneId)) continue;
    newIdx.set(i, rows.length);
    (laneRows.get(laneId) ?? laneRows.set(laneId, []).get(laneId)!).push(rows.length);
    rows.push({
      entry: entries[i],
      laneId,
      column: 0, // preenchido após a atribuição de colunas
      isMerge: entries[i].mergedRevisions.length > 0,
    });
  }
  const total = rows.length;

  // ---- Passo 5: extensão vertical de cada lane ------------------------------
  interface LaneFinal extends GraphLane {
    rowIdxs: number[];
    forkFromPath?: string;
    forkFromRev?: number;
  }
  const finals: LaneFinal[] = [];
  for (const b of lanes.values()) {
    if (!ours.has(b.id)) continue;
    const rowIdxs = laneRows.get(b.id) ?? [];
    const createdRow = b.createdAt !== undefined ? newIdx.get(b.createdAt) : undefined;
    const deletedRow = b.deletedAt !== undefined ? newIdx.get(b.deletedAt) : undefined;
    const anchors = [...rowIdxs];
    if (createdRow !== undefined) anchors.push(createdRow);
    if (deletedRow !== undefined) anchors.push(deletedRow);
    if (b.kind === "trunk" && total > 0) anchors.push(0, total - 1);
    if (anchors.length === 0) continue; // lane sem presença na janela
    finals.push({
      id: b.id,
      name: b.kind === "trunk" ? "trunk" : laneShortName(b.id),
      kind: b.kind,
      column: 0,
      colorIndex: 0,
      topRow: Math.min(...anchors),
      bottomRow: Math.max(...anchors),
      createdRow,
      deletedRow,
      alive: b.deletedAt === undefined,
      openBottom: b.kind === "trunk" ? src.truncated === true : b.createdAt === undefined,
      rowIdxs,
      forkFromPath: b.forkFromPath,
      forkFromRev: b.forkFromRev,
    });
  }

  // ---- Passo 6: colunas (coloração gulosa de intervalos, reciclando) --------
  const overlaps = (a: LaneFinal, z: LaneFinal) =>
    a.topRow <= z.bottomRow && z.topRow <= a.bottomRow;
  const branchLanes = finals
    .filter((l) => l.kind === "branch")
    .sort((a, z) => z.bottomRow - a.bottomRow || z.topRow - a.topRow || a.id.localeCompare(z.id));
  let columnCount = 1;
  const assigned: LaneFinal[] = [];
  for (const lane of branchLanes) {
    let col = 1;
    while (assigned.some((o) => o.column === col && overlaps(o, lane))) col++;
    lane.column = col;
    assigned.push(lane);
    columnCount = Math.max(columnCount, col + 1);
  }

  // Cores: sequência estável na ordem cronológica (fundo → topo), para
  // branches vizinhos não repetirem tom.
  branchLanes.forEach((l, i) => (l.colorIndex = i % BRANCH_COLOR_COUNT));

  const byId = new Map(finals.map((l) => [l.id, l]));
  for (const row of rows) row.column = byId.get(row.laneId)?.column ?? 0;

  // ---- Passo 7: ligações -----------------------------------------------------
  const links: GraphLink[] = [];

  /** Row mais recente da lane com revisão ≤ rev (rows em ordem decrescente). */
  const anchorOn = (lane: LaneFinal, rev: number): number | null => {
    for (const idx of lane.rowIdxs) if (rows[idx].entry.revision <= rev) return idx;
    return null;
  };

  for (const lane of finals) {
    if (lane.createdRow === undefined || lane.forkFromPath == null) continue;
    const srcRoot = resolveRoot(lane.forkFromPath, "dir");
    const srcLane = srcRoot != null ? byId.get(srcRoot) : undefined;
    if (!srcLane) continue;
    const anchor = anchorOn(srcLane, lane.forkFromRev!);
    links.push({
      kind: "fork",
      fromRow: anchor ?? total,
      fromColumn: srcLane.column,
      fromLaneId: srcLane.id,
      toRow: lane.createdRow,
      toColumn: lane.column,
      toLaneId: lane.id,
      offWindow: anchor == null,
      sourceRev: lane.forkFromRev,
    });
  }

  for (let i = 0; i < n; i++) {
    const at = newIdx.get(i);
    if (at === undefined || mergeSources[i].size === 0) continue;
    const target = byId.get(entryLane[i]);
    if (!target) continue;
    for (const [srcId, maxRev] of mergeSources[i]) {
      const srcLane = byId.get(srcId);
      if (!srcLane) continue; // origem sem presença na janela — sem seta
      const anchor = anchorOn(srcLane, maxRev);
      const kind: GraphLinkKind =
        srcLane.kind === "trunk" && target.kind === "branch"
          ? "sync"
          : srcLane.kind === "branch" && target.kind === "trunk"
            ? "reintegrate"
            : "merge";
      links.push({
        kind,
        fromRow: anchor ?? total,
        fromColumn: srcLane.column,
        fromLaneId: srcLane.id,
        toRow: at,
        toColumn: target.column,
        toLaneId: target.id,
        offWindow: anchor == null,
        sourceRev: maxRev,
      });
    }
  }

  const outLanes: GraphLane[] = finals.map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind,
    column: l.column,
    colorIndex: l.colorIndex,
    topRow: l.topRow,
    bottomRow: l.bottomRow,
    createdRow: l.createdRow,
    deletedRow: l.deletedRow,
    alive: l.alive,
    openBottom: l.openBottom,
  }));
  return { rows, lanes: outLanes, links, columnCount };
}
