/**
 * Casamento difuso (fuzzy) para o "Ir para arquivo" do editor embutido — no
 * espírito do Go to File do IntelliJ: a consulta precisa aparecer como
 * subsequência do caminho; pontua melhor quem casa no nome do arquivo, no
 * começo de um segmento (após `/`, `.`, `-`, `_`) e em sequência contígua.
 */

export interface FuzzyResult {
  score: number;
  /** Índices (no alvo) dos caracteres casados — para destacar na lista. */
  positions: number[];
}

const SEGMENT = new Set(["/", ".", "-", "_", " "]);

/** Quantas âncoras de partida diferentes tentar (matching guloso por âncora). */
const MAX_ANCHORS = 8;

/** Casa `query` como subsequência de `target` (sem diferenciar caixa). */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length > t.length) return null;

  const lastSlash = target.lastIndexOf("/");

  // Matching guloso a partir de `start`. O guloso puro escolhe caminhos ruins
  // (ex.: "context" preso no "Cont" de "WebContent"); por isso tentamos várias
  // âncoras — cada ocorrência do 1º caractere — e ficamos com o melhor score.
  const matchFrom = (start: number): FuzzyResult | null => {
    const positions: number[] = [];
    let score = 0;
    let ti = start;
    let prev = -2;
    for (let qi = 0; qi < q.length; qi++) {
      const idx = t.indexOf(q[qi], ti);
      if (idx < 0) return null;
      positions.push(idx);

      if (idx === prev + 1) score += 8; // sequência contígua
      if (idx === 0 || SEGMENT.has(t[idx - 1])) score += 6; // começo de segmento
      if (idx > lastSlash) score += 4; // dentro do nome do arquivo
      score -= Math.min(idx - ti, 20) * 0.5; // penaliza saltos longos

      prev = idx;
      ti = idx + 1;
    }
    score -= target.length * 0.02; // desempate: caminhos mais curtos primeiro
    return { score, positions };
  };

  let best: FuzzyResult | null = null;
  let anchor = t.indexOf(q[0]);
  for (let n = 0; anchor >= 0 && n < MAX_ANCHORS; n++, anchor = t.indexOf(q[0], anchor + 1)) {
    const r = matchFrom(anchor);
    if (r && (!best || r.score > best.score)) best = r;
  }
  return best;
}

/** Filtra e ordena `items` pela consulta; até `limit` resultados. */
export function fuzzyFilter(
  query: string,
  items: readonly string[],
  limit = 200,
): { item: string; result: FuzzyResult }[] {
  const out: { item: string; result: FuzzyResult }[] = [];
  for (const item of items) {
    const result = fuzzyMatch(query, item);
    if (result) out.push({ item, result });
  }
  out.sort((a, b) => b.result.score - a.result.score || a.item.localeCompare(b.item));
  return out.slice(0, limit);
}
