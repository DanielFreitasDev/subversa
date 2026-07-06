/**
 * Mesclagem de três vias (diff3) — o coração do editor de conflitos.
 *
 * A partir de BASE (ancestral comum), MINE (minha versão) e THEIRS (do servidor),
 * produz uma lista de regiões alinhadas. Cada região é classificada como:
 *  - `stable`   — igual nas três (vai pro resultado como está);
 *  - `left`     — só eu mudei (aplicação automática);
 *  - `right`    — só o servidor mudou (aplicação automática);
 *  - `both`     — os dois fizeram a MESMA mudança (automática);
 *  - `conflict` — os dois mudaram de forma diferente (exige decisão do usuário).
 *
 * É a mesma classificação "mudança automática × conflito" do IntelliJ, derivada da
 * BASE. Construída sobre `diffArrays` do pacote `diff` (já é dependência do projeto),
 * que faz o LCS por linha; aqui só cruzamos os dois diffs (base↔mine e base↔theirs).
 */

import { diffArrays } from "diff";

export type RegionKind = "stable" | "left" | "right" | "both" | "conflict";

export interface MergeRegion {
  kind: RegionKind;
  /** Linhas da BASE nesta região (iguais às demais quando `stable`). */
  base: string[];
  /** Linhas do LOCAL (minha versão). */
  mine: string[];
  /** Linhas do SERVIDOR (deles). */
  theirs: string[];
}

/** Trecho inalterado (run comum) entre BASE e o outro lado. */
interface Common {
  base: number;
  other: number;
  len: number;
}

/** Runs comuns entre `base` e `other`, derivados do diff por linha. */
function commons(base: string[], other: string[]): Common[] {
  const out: Common[] = [];
  let bi = 0;
  let oi = 0;
  for (const part of diffArrays(base, other)) {
    const n = part.value.length;
    if (!part.added && !part.removed) {
      out.push({ base: bi, other: oi, len: n });
      bi += n;
      oi += n;
    } else if (part.removed) {
      bi += n; // presente só na base
    } else {
      oi += n; // presente só no outro lado
    }
  }
  return out;
}

/** Mapa base→índice no outro lado para linhas inalteradas; -1 se a linha mudou. */
function mapBaseTo(n: number, cs: Common[]): Int32Array {
  const map = new Int32Array(n).fill(-1);
  for (const c of cs) {
    for (let k = 0; k < c.len; k++) map[c.base + k] = c.other + k;
  }
  return map;
}

function eq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Classifica um vão instável comparando os três lados. */
function classify(base: string[], mine: string[], theirs: string[]): RegionKind {
  const mineSame = eq(mine, base);
  const theirsSame = eq(theirs, base);
  if (mineSame && theirsSame) return "stable";
  if (mineSame) return "right"; // só o servidor mudou
  if (theirsSame) return "left"; // só eu mudei
  if (eq(mine, theirs)) return "both"; // mudança idêntica dos dois lados
  return "conflict";
}

/**
 * Mescla de três vias. Caminha pela BASE: as linhas que MINE *e* THEIRS mantêm
 * são os pontos estáveis (sincronização); entre dois pontos estáveis fica um vão
 * instável (base/mine/theirs fatiados) que é classificado.
 */
export function diff3(base: string[], mine: string[], theirs: string[]): MergeRegion[] {
  const mineOf = mapBaseTo(base.length, commons(base, mine));
  const theirsOf = mapBaseTo(base.length, commons(base, theirs));

  const regions: MergeRegion[] = [];
  // Posição (exclusiva) já consumida em cada lado após o último ponto estável.
  let pb = 0;
  let pm = 0;
  let pt = 0;

  const pushUnstable = (
    b0: number,
    b1: number,
    m0: number,
    m1: number,
    t0: number,
    t1: number,
  ) => {
    if (b0 === b1 && m0 === m1 && t0 === t1) return; // vão vazio
    const bb = base.slice(b0, b1);
    const mm = mine.slice(m0, m1);
    const tt = theirs.slice(t0, t1);
    regions.push({ kind: classify(bb, mm, tt), base: bb, mine: mm, theirs: tt });
  };

  for (let b = 0; b < base.length; b++) {
    const m = mineOf[b];
    const t = theirsOf[b];
    if (m < 0 || t < 0) continue; // linha mudada em algum lado: parte do vão instável

    // Emite o vão instável antes deste ponto estável.
    pushUnstable(pb, b, pm, m, pt, t);

    // Linha estável (1 linha); coalesce com a região estável anterior se contígua.
    const last = regions[regions.length - 1];
    const line = base[b];
    if (last && last.kind === "stable" && pb === b && pm === m && pt === t) {
      last.base.push(line);
      last.mine.push(line);
      last.theirs.push(line);
    } else {
      regions.push({ kind: "stable", base: [line], mine: [line], theirs: [line] });
    }
    pb = b + 1;
    pm = m + 1;
    pt = t + 1;
  }

  // Vão final (após o último ponto estável).
  pushUnstable(pb, base.length, pm, mine.length, pt, theirs.length);

  return regions;
}

// ---------------------------------------------------------------------------
// Utilidades de texto ↔ linhas (montagem do arquivo resolvido)
// ---------------------------------------------------------------------------

/** Fim-de-linha dominante do texto (preserva o estilo do arquivo ao gravar). */
export function detectEol(text: string): "\n" | "\r\n" {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

/** Quebra o texto em linhas (sem o separador), marcando se havia newline final. */
export function toLines(text: string): { lines: string[]; trailingEol: boolean } {
  if (text === "") return { lines: [], trailingEol: false };
  const normalized = text.replace(/\r\n/g, "\n");
  const trailingEol = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (trailingEol) lines.pop(); // descarta o "" final criado pelo split
  return { lines, trailingEol };
}

/** Reconstrói o texto a partir das linhas resolvidas, no estilo de EOL do arquivo. */
export function fromLines(lines: string[], eol: "\n" | "\r\n", trailingEol: boolean): string {
  const body = lines.join(eol);
  return trailingEol && lines.length > 0 ? body + eol : body;
}

// ---------------------------------------------------------------------------
// Resolução automática de conflitos simples (a "varinha" do IntelliJ)
// ---------------------------------------------------------------------------

/**
 * Quebra o texto em tokens de forma REVERSÍVEL (concatenar reproduz a entrada):
 * runs de espaço (incl. quebras de linha), runs de caracteres de palavra, e cada
 * pontuação isolada. Permite mesclar no nível de palavra reaproveitando o `diff3`.
 */
function tokenize(s: string): string[] {
  return s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

/**
 * Tenta resolver um conflito automaticamente no nível de PALAVRA — o caso "nem
 * devia ser conflito", em que os dois lados mexeram em partes diferentes da(s)
 * mesma(s) linha(s). Junta cada versão em texto, tokeniza e roda o MESMO `diff3`
 * nos tokens; se o merge por palavra não briga (nenhuma sub-região `conflict`),
 * devolve o texto mesclado. Devolve `null` quando a sobreposição é real e exige
 * decisão do usuário. Só faz sentido em regiões `conflict`.
 */
export function magicMerge(region: MergeRegion): string | null {
  if (region.kind !== "conflict") return null;
  const base = tokenize(region.base.join("\n"));
  const mine = tokenize(region.mine.join("\n"));
  const theirs = tokenize(region.theirs.join("\n"));

  const out: string[] = [];
  for (const p of diff3(base, mine, theirs)) {
    switch (p.kind) {
      case "stable":
        out.push(...p.base);
        break;
      case "left":
      case "both":
        out.push(...p.mine);
        break;
      case "right":
        out.push(...p.theirs);
        break;
      case "conflict":
        return null; // sobreposição real de palavras — sem mágica
    }
  }
  return out.join("");
}
