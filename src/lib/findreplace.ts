/**
 * Motor de busca/substituição do editor embutido — lógica pura, sem CodeMirror
 * (testável em Node). A extensão `components/editor/search.ts` usa estas funções
 * para achar as ocorrências no documento e expandir o texto de substituição.
 *
 * Segue o comportamento do Localizar do IntelliJ:
 * - "Diferenciar maiúsculas" (match case), "Palavra inteira" e "Regex";
 * - em regex, `^`/`$` casam por linha (flag `m`) e `.` não atravessa linhas;
 * - a substituição em regex expande `$1`…`$99`, `$&` e `$$`, além de `\n`/`\t`/`\\`.
 *
 * Palavra inteira é verificada aqui (olhando o caractere vizinho) em vez de
 * lookbehind na regex — funciona igual nos modos literal e regex.
 */

export interface FindSpec {
  /** Texto (ou padrão, quando `regexp`) procurado. */
  search: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface FindMatch {
  from: number;
  to: number;
  /** Grupos capturados ([0] = casamento inteiro) — só com `withGroups`. */
  groups?: string[];
}

const escapeRegExp = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const isWordChar = (ch: string | undefined) => !!ch && WORD_CHAR.test(ch);

/**
 * Compila o padrão da busca. Regex inválida vira `{ error }` com a mensagem do
 * runtime (exibida no campo, como no IntelliJ), nunca uma exceção.
 */
export function buildPattern(spec: FindSpec): { re: RegExp } | { error: string } {
  const source = spec.regexp ? spec.search : escapeRegExp(spec.search);
  const flags = "gm" + (spec.caseSensitive ? "" : "i");
  try {
    return { re: new RegExp(source, flags) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Todas as ocorrências de `spec` em `text`, em ordem. Busca vazia → nenhuma.
 * `truncated` indica que parou no teto (`limit`) — o contador da UI mostra "+".
 */
export function findMatches(
  text: string,
  spec: FindSpec,
  limit = 100_000,
  withGroups = false,
): { matches: FindMatch[]; truncated: boolean } | { error: string } {
  if (!spec.search) return { matches: [], truncated: false };
  const built = buildPattern(spec);
  if ("error" in built) return built;
  const { re } = built;

  const matches: FindMatch[] = [];
  let truncated = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Casamento vazio (ex.: regex `a*`): avança 1 para não travar o laço.
    if (m[0].length === 0) re.lastIndex++;
    if (spec.wholeWord && (isWordChar(text[m.index - 1]) || isWordChar(text[m.index + m[0].length]))) {
      continue;
    }
    if (m[0].length > 0) {
      matches.push({
        from: m.index,
        to: m.index + m[0].length,
        ...(withGroups ? { groups: Array.from(m, (g) => g ?? "") } : null),
      });
    }
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
  }
  return { matches, truncated };
}

/**
 * Grupos capturados da ocorrência que começa exatamente em `from` (para expandir
 * `$1`… na substituição). `null` se o padrão não casar ali — ex.: o documento
 * mudou desde que a ocorrência foi calculada.
 */
export function groupsAt(text: string, spec: FindSpec, from: number, to: number): string[] | null {
  const built = buildPattern(spec);
  if ("error" in built) return null;
  const { re } = built;
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m || m.index !== from || m.index + m[0].length !== to) return null;
  return Array.from(m, (g) => g ?? "");
}

/**
 * Expande o texto de substituição no modo regex: `$1`…`$99` (grupo inexistente
 * fica literal, como no `String.replace`), `$&` (casamento inteiro), `$$` (um
 * `$`) e os escapes `\n`, `\t`, `\\`. No modo literal use o template como veio.
 */
export function expandReplacement(template: string, groups: string[]): string {
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    const next = template[i + 1];
    if (ch === "\\" && (next === "n" || next === "t" || next === "\\")) {
      out += next === "n" ? "\n" : next === "t" ? "\t" : "\\";
      i++;
    } else if (ch === "$" && next === "$") {
      out += "$";
      i++;
    } else if (ch === "$" && next === "&") {
      out += groups[0] ?? "";
      i++;
    } else if (ch === "$" && next && next >= "0" && next <= "9") {
      // Pega o número mais longo que corresponda a um grupo existente ($12 antes de $1).
      const two = template.slice(i + 1, i + 3);
      const n2 = /^\d\d$/.test(two) ? Number(two) : NaN;
      const n1 = Number(next);
      if (!Number.isNaN(n2) && n2 >= 1 && n2 < groups.length) {
        out += groups[n2];
        i += 2;
      } else if (n1 < groups.length) {
        out += groups[n1]; // $0 = casamento inteiro, como no IntelliJ/Java
        i++;
      } else {
        out += ch; // grupo não existe: mantém "$n" literal
      }
    } else {
      out += ch;
    }
  }
  return out;
}
