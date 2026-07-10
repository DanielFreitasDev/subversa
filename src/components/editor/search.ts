/**
 * Busca/substituição do editor embutido como extensão CodeMirror — o motor por
 * trás do painel "Localizar/Substituir" (`SearchPanel`). A UI manda a consulta
 * via `setSearch`; este campo recalcula as ocorrências a cada edição, desenha os
 * realces (todas + a atual) e expõe os comandos de navegação e substituição.
 *
 * A correspondência em si (regex, caixa, palavra inteira, grupos) vive em
 * `lib/findreplace.ts` (pura e testada); aqui fica só a parte ligada ao estado
 * do editor: decorações, seleção, escopo "na seleção" e transações.
 */

import { EditorSelection, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

import {
  expandReplacement,
  findMatches,
  groupsAt,
  type FindMatch,
  type FindSpec,
} from "@/lib/findreplace";

/** Teto de ocorrências contadas (o contador vira "9999+" ao estourar). */
const MATCH_LIMIT = 10_000;
/** Teto de ocorrências decoradas (realce) — protege arquivos patológicos. */
const DECO_LIMIT = 2_000;

export interface SearchScope {
  from: number;
  to: number;
}

interface SearchStateValue {
  spec: FindSpec | null;
  matches: FindMatch[];
  truncated: boolean;
  /** Mensagem de regex inválida (mostrada no campo, como no IntelliJ). */
  error: string | null;
  /** Trechos do "substituir só na seleção" (null = documento inteiro). */
  scope: SearchScope[] | null;
  deco: DecorationSet;
}

const EMPTY: SearchStateValue = {
  spec: null,
  matches: [],
  truncated: false,
  error: null,
  scope: null,
  deco: Decoration.none,
};

/** Define (ou limpa, com `null`) a consulta ativa. */
export const setSearch = StateEffect.define<FindSpec | null>();
/** Liga/desliga o escopo "na seleção" (ranges capturados na hora do toggle). */
export const setSearchScope = StateEffect.define<SearchScope[] | null>();

const matchMark = Decoration.mark({ class: "cm-sv-match" });
const scopeMark = Decoration.mark({ class: "cm-sv-scope" });

function inScope(m: FindMatch, scope: SearchScope[] | null): boolean {
  return !scope || scope.some((s) => m.from >= s.from && m.to <= s.to);
}

function compute(state: EditorState, spec: FindSpec | null, scope: SearchScope[] | null): SearchStateValue {
  if (!spec || !spec.search) return { ...EMPTY, spec, scope, deco: scopeDeco(scope) };
  const found = findMatches(state.doc.toString(), spec, MATCH_LIMIT);
  if ("error" in found) return { ...EMPTY, spec, scope, error: found.error, deco: scopeDeco(scope) };

  const matches = found.matches.filter((m) => inScope(m, scope));
  const ranges = matches.slice(0, DECO_LIMIT).map((m) => matchMark.range(m.from, m.to));
  const deco = Decoration.set([...scopeRanges(scope), ...ranges], true);
  return { spec, matches, truncated: found.truncated, error: null, scope, deco };
}

const scopeRanges = (scope: SearchScope[] | null) =>
  (scope ?? []).filter((s) => s.to > s.from).map((s) => scopeMark.range(s.from, s.to));
const scopeDeco = (scope: SearchScope[] | null) => Decoration.set(scopeRanges(scope), true);

export const searchField = StateField.define<SearchStateValue>({
  create: () => EMPTY,
  update(value, tr) {
    let spec = value.spec;
    let scope = value.scope;
    let dirty = false;

    if (tr.docChanged && scope) {
      scope = scope
        .map((s) => ({ from: tr.changes.mapPos(s.from, 1), to: tr.changes.mapPos(s.to, -1) }))
        .filter((s) => s.to > s.from);
      if (!scope.length) scope = null;
    }
    for (const e of tr.effects) {
      if (e.is(setSearch)) {
        spec = e.value;
        dirty = true;
      } else if (e.is(setSearchScope)) {
        scope = e.value;
        dirty = true;
      }
    }
    if (!dirty && !tr.docChanged) return value;
    if (!dirty && tr.docChanged && !spec) {
      // Sem busca ativa: só reposiciona o realce de escopo, se houver.
      return { ...value, scope, deco: scopeDeco(scope) };
    }
    return compute(tr.state, spec, scope);
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** Realce diferenciado da ocorrência ATUAL (a que está selecionada). */
const currentMark = Decoration.mark({ class: "cm-sv-match-cur" });
const currentMatchDeco = EditorView.decorations.compute(["selection", searchField], (state) => {
  const { main } = state.selection;
  const { matches } = state.field(searchField);
  const cur = matches.find((m) => m.from === main.from && m.to === main.to);
  return cur ? Decoration.set([currentMark.range(cur.from, cur.to)]) : Decoration.none;
});

/** Cores dos realces — junto da extensão para funcionar em qualquer tema. */
const searchTheme = Prec.low(
  EditorView.baseTheme({
    ".cm-sv-match": { backgroundColor: "rgba(234, 92, 0, 0.33)" },
    ".cm-sv-match-cur": {
      backgroundColor: "rgba(158, 106, 3, 0.85)",
      outline: "1px solid rgba(255, 200, 100, 0.65)",
    },
    ".cm-sv-scope": { backgroundColor: "rgba(124, 108, 255, 0.10)" },
  }),
);

/** Extensão completa: instale uma vez por editor. */
export function svSearch() {
  return [searchField, currentMatchDeco, searchTheme];
}

// ---------------------------------------------------------------------------
// Consulta do estado (para o painel: contador, erro, escopo)
// ---------------------------------------------------------------------------

export interface SearchSummary {
  active: boolean;
  count: number;
  truncated: boolean;
  /** 1-based; 0 = nenhuma ocorrência selecionada no momento. */
  current: number;
  error: string | null;
  hasScope: boolean;
}

export function searchSummary(state: EditorState): SearchSummary {
  const f = state.field(searchField, false);
  if (!f) return { active: false, count: 0, truncated: false, current: 0, error: null, hasScope: false };
  const { main } = state.selection;
  const idx = f.matches.findIndex((m) => m.from === main.from && m.to === main.to);
  return {
    active: !!f.spec?.search,
    count: f.matches.length,
    truncated: f.truncated,
    current: idx + 1,
    error: f.error,
    hasScope: !!f.scope,
  };
}

// ---------------------------------------------------------------------------
// Navegação e substituição
// ---------------------------------------------------------------------------

function gotoMatch(view: EditorView, m: FindMatch) {
  view.dispatch({
    selection: EditorSelection.single(m.from, m.to),
    effects: EditorView.scrollIntoView(EditorSelection.range(m.from, m.to), { y: "center" }),
    userEvent: "select.search",
  });
}

/**
 * Busca incremental: seleciona a ocorrência mais próxima a partir do INÍCIO da
 * seleção atual (digitar no campo já pula para o resultado, como no IntelliJ —
 * e a ocorrência sob o cursor continua a atual enquanto o texto casar).
 */
export function findNearest(view: EditorView): boolean {
  const { matches } = view.state.field(searchField);
  if (!matches.length) return false;
  const at = view.state.selection.main.from;
  const next = matches.find((m) => m.from >= at) ?? matches[0];
  gotoMatch(view, next);
  return true;
}

/** Vai para a próxima ocorrência depois da seleção (com volta ao início). */
export function findNext(view: EditorView): boolean {
  const { matches } = view.state.field(searchField);
  if (!matches.length) return false;
  const from = view.state.selection.main.to;
  const next = matches.find((m) => m.from >= from) ?? matches[0];
  gotoMatch(view, next);
  return true;
}

/** Vai para a ocorrência anterior à seleção (com volta ao fim). */
export function findPrevious(view: EditorView): boolean {
  const { matches } = view.state.field(searchField);
  if (!matches.length) return false;
  const at = view.state.selection.main.from;
  let prev: FindMatch | undefined;
  for (const m of matches) {
    if (m.to <= at) prev = m;
    else break;
  }
  gotoMatch(view, prev ?? matches[matches.length - 1]);
  return true;
}

/** Texto de substituição para uma ocorrência (expande $1… no modo regex). */
function replacementFor(view: EditorView, spec: FindSpec, m: FindMatch, template: string): string {
  if (!spec.regexp) return template;
  const groups =
    m.groups ?? groupsAt(view.state.doc.toString(), spec, m.from, m.to) ?? [view.state.sliceDoc(m.from, m.to)];
  return expandReplacement(template, groups);
}

/**
 * Substitui a ocorrência selecionada e pula para a próxima. Se a seleção ainda
 * não está numa ocorrência, só localiza a próxima (como o Replace do IntelliJ).
 */
export function replaceCurrent(view: EditorView, template: string): boolean {
  const f = view.state.field(searchField);
  if (!f.spec) return false;
  const { main } = view.state.selection;
  const cur = f.matches.find((m) => m.from === main.from && m.to === main.to);
  if (!cur) return findNext(view);

  const insert = replacementFor(view, f.spec, cur, template);
  view.dispatch({
    changes: { from: cur.from, to: cur.to, insert },
    selection: EditorSelection.cursor(cur.from + insert.length),
    userEvent: "input.replace",
  });
  findNext(view);
  return true;
}

/** Substitui todas as ocorrências (no escopo, se ativo). Retorna o total. */
export function replaceAll(view: EditorView, template: string): number {
  const f = view.state.field(searchField);
  if (!f.spec?.search) return 0;
  // Recalcula com grupos (o campo não os guarda, por memória).
  const found = findMatches(view.state.doc.toString(), f.spec, MATCH_LIMIT, true);
  if ("error" in found) return 0;
  const targets = found.matches.filter((m) => inScope(m, f.scope));
  if (!targets.length) return 0;

  view.dispatch({
    changes: targets.map((m) => ({
      from: m.from,
      to: m.to,
      insert: replacementFor(view, f.spec!, m, template),
    })),
    userEvent: "input.replace.all",
  });
  return targets.length;
}

/** Fecha a busca: limpa consulta, realces e escopo. */
export function clearSearch(view: EditorView) {
  view.dispatch({ effects: [setSearch.of(null), setSearchScope.of(null)] });
}
