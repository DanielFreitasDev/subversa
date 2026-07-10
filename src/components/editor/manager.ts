/**
 * Gerência das instâncias CodeMirror do editor embutido — uma `EditorView` viva
 * por arquivo aberto (aba). Trocar de aba só move o DOM da view para o painel
 * visível: o histórico de desfazer, a seleção, as dobras e o scroll de cada
 * arquivo sobrevivem à troca. O React nunca controla o texto (a view é a fonte
 * da verdade); o modal lê/salva pelo `Handle`.
 *
 * Ajustes por arquivo (quebra de linha, invisíveis, indentação, tema, zoom)
 * são `Compartment`s reconfigurados em runtime, sem recriar a view.
 */

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState, type Text } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";

import { DEFAULT_INDENT, detectIndent, type IndentInfo } from "@/lib/indent";
import { cmLanguageFor, cmTheme } from "./cm";
import { editorKeymap, type EditorUiHandlers } from "./keymap";
import { svSearch } from "./search";

export interface ManagerCallbacks {
  /** Ações de UI disparadas pelo keymap (busca, ir para linha, salvar…). */
  handlers: EditorUiHandlers;
  /** Documento/seleção/busca mudou — o modal atualiza barra de status etc. */
  onUpdate: (path: string) => void;
  /** A view deste arquivo recebeu foco (define o painel "ativo" do modal). */
  onFocus: (path: string) => void;
}

/** Fonte/altura do editor; o tamanho da fonte vem por compartimento (zoom). */
const chromeTheme = EditorView.theme({
  "&": { height: "100%" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace)",
    lineHeight: "1.55",
  },
});

const fontTheme = (size: number) => EditorView.theme({ "&": { fontSize: `${size}px` } });

const MIN_FONT = 9;
const MAX_FONT = 26;

export class Handle {
  readonly path: string;
  readonly view: EditorView;
  indent: IndentInfo;
  wrap = false;
  whitespace = false;

  private savedDoc: Text;
  private comp: Record<"wrap" | "whitespace" | "indent" | "theme" | "font", Compartment>;

  constructor(path: string, view: EditorView, comp: Handle["comp"], indent: IndentInfo) {
    this.path = path;
    this.view = view;
    this.comp = comp;
    this.indent = indent;
    this.savedDoc = view.state.doc;
  }

  text(): string {
    return this.view.state.doc.toString();
  }
  isDirty(): boolean {
    return !this.view.state.doc.eq(this.savedDoc);
  }
  markSaved() {
    this.savedDoc = this.view.state.doc;
  }

  setWrap(on: boolean) {
    this.wrap = on;
    this.view.dispatch({ effects: this.comp.wrap.reconfigure(on ? EditorView.lineWrapping : []) });
  }
  setWhitespace(on: boolean) {
    this.whitespace = on;
    this.view.dispatch({ effects: this.comp.whitespace.reconfigure(on ? highlightWhitespace() : []) });
  }
  setIndent(info: IndentInfo) {
    this.indent = info;
    this.view.dispatch({ effects: this.comp.indent.reconfigure(indentConf(info)) });
  }
  /** Interno do manager (tema claro/escuro e zoom valem para todas as views). */
  reconfigure(dark: boolean, font: number) {
    this.view.dispatch({
      effects: [this.comp.theme.reconfigure(cmTheme(dark)), this.comp.font.reconfigure(fontTheme(font))],
    });
  }
}

const indentConf = (info: IndentInfo) => [
  indentUnit.of(info.useTabs ? "\t" : " ".repeat(info.size)),
  EditorState.tabSize.of(info.size),
];

export class EditorManager {
  private views = new Map<string, Handle>();
  private cb: ManagerCallbacks;
  private dark: boolean;
  private font = 12.5;

  constructor(cb: ManagerCallbacks, dark: boolean) {
    this.cb = cb;
    this.dark = dark;
  }

  /** Cria (ou retorna) a view do arquivo. `content` já normalizado para LF. */
  open(path: string, content: string): Handle {
    const existing = this.views.get(path);
    if (existing) return existing;

    const comp = {
      wrap: new Compartment(),
      whitespace: new Compartment(),
      indent: new Compartment(),
      theme: new Compartment(),
      font: new Compartment(),
    };
    const indent = content ? detectIndent(content) : DEFAULT_INDENT;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        // Completar por palavras do arquivo mesmo sem suporte de linguagem.
        EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
        // Alt+arrastar = seleção retangular; Alt+Shift+clique = novo cursor.
        rectangularSelection({ eventFilter: (e) => e.altKey && !e.shiftKey && e.button === 0 }),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.clickAddsSelectionRange.of((e) => e.altKey && e.shiftKey),
        editorKeymap(this.cb.handlers),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
        svSearch(),
        // Zoom estilo IDE: Ctrl+roda do mouse.
        EditorView.domEventHandlers({
          wheel: (e) => {
            if (!e.ctrlKey) return false;
            e.preventDefault();
            this.zoom(e.deltaY < 0 ? 1 : -1);
            return true;
          },
          focus: () => {
            this.cb.onFocus(path);
            return false;
          },
        }),
        cmLanguageFor(path) ?? [],
        comp.indent.of(indentConf(indent)),
        comp.wrap.of([]),
        comp.whitespace.of([]),
        comp.theme.of(cmTheme(this.dark)),
        comp.font.of(fontTheme(this.font)),
        chromeTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.length)) {
            this.cb.onUpdate(path);
          }
        }),
      ],
    });

    const view = new EditorView({ state });
    const handle = new Handle(path, view, comp, indent);
    this.views.set(path, handle);
    return handle;
  }

  get(path: string): Handle | undefined {
    return this.views.get(path);
  }

  close(path: string) {
    const h = this.views.get(path);
    if (!h) return;
    h.view.destroy();
    this.views.delete(path);
  }

  /** Coloca a view do arquivo dentro do painel visível (movendo o DOM). */
  attach(path: string, host: HTMLElement) {
    const h = this.views.get(path);
    if (!h) return;
    if (h.view.dom.parentElement !== host) host.replaceChildren(h.view.dom);
    h.view.requestMeasure();
  }

  setDark(dark: boolean) {
    if (dark === this.dark) return;
    this.dark = dark;
    for (const h of this.views.values()) h.reconfigure(dark, this.font);
  }

  zoom(step: 1 | -1) {
    const next = Math.max(MIN_FONT, Math.min(MAX_FONT, this.font + step));
    if (next === this.font) return;
    this.font = next;
    for (const h of this.views.values()) h.reconfigure(this.dark, next);
  }

  dispose() {
    for (const h of this.views.values()) h.view.destroy();
    this.views.clear();
  }
}
