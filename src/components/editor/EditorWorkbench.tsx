/**
 * Editor de código embutido — um mini-IDE em modal, no espírito do IntelliJ:
 * abas (com divisão em dois grupos), busca/substituição completa (Ctrl+F /
 * Ctrl+R: maiúsculas, palavra inteira, regex, escopo na seleção), keymap
 * IntelliJ (Ctrl+D duplica, Ctrl+Y apaga linha, Ctrl+W expande seleção…),
 * multi-cursor, dobras, autocompletar, ir para linha (Ctrl+G) e ir para
 * arquivo (Ctrl+Shift+N, qualquer arquivo da cópia de trabalho), barra de
 * status (posição, indentação, LF/CRLF, codificação, linguagem) e zoom.
 *
 * Cada aba mantém sua própria `EditorView` viva (ver `manager.ts`): desfazer/
 * refazer, dobras e scroll sobrevivem à troca de aba. Salvar (Ctrl+S) grava no
 * DISCO — não no servidor: o arquivo vira "modificado" na lista e o commit
 * continua sendo a publicação. O EOL original (ajustável na barra de status)
 * e a codificação (UTF-8/ISO-8859-1) são preservados na gravação.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { redoDepth, undoDepth } from "@codemirror/commands";
import { AlertTriangle, Copy, ExternalLink, FileCode2, Pencil, Save, SaveAll, X } from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { ContextMenu, useContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { Modal } from "@/components/ui/Modal";
import { Loading } from "@/components/ui/Spinner";
import { HELP } from "@/lib/help";
import { tryRun } from "@/lib/op";
import { baseName, cn, resolveDark } from "@/lib/utils";
import { confirm } from "@/store/confirm";
import { useConfigStore } from "@/store/config";
import { toast } from "@/store/toast";

import { languageLabelFor } from "./cm";
import { canFormat, formatText, minimalReplace } from "./format";
import { EditorManager } from "./manager";
import { editorContextItems } from "./menus";
import { EditorTabs, type TabMeta } from "./EditorTabs";
import { EditorToolbar } from "./EditorToolbar";
import { GotoLinePopup } from "./GotoLinePopup";
import { QuickOpenPalette } from "./QuickOpenPalette";
import { SearchPanel, type SearchPanelHandle } from "./SearchPanel";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { StatusBar, type CursorInfo, type Eol } from "./StatusBar";
import { searchSummary } from "./search";

interface TabState {
  path: string;
  /** Caminho relativo (exibição); cai para o basename quando ausente. */
  relPath?: string;
  encoding: string;
  eol: Eol;
  /** EOL trocado na barra de status → conta como alteração a salvar. */
  eolChanged: boolean;
  loading: boolean;
  error: string | null;
}

const titleOf = (t: TabState) => baseName(t.relPath ?? t.path);
const detailOf = (t: TabState) => {
  const rel = t.relPath ?? t.path;
  const i = rel.lastIndexOf("/");
  return i > 0 ? rel.slice(0, i) : undefined;
};

export interface EditorWorkbenchProps {
  open: boolean;
  /** Arquivo pedido: abre em nova aba (ou ativa a existente). */
  path: string | null;
  /** Caminho relativo, só para exibição. */
  relPath?: string | null;
  /** Muda a cada pedido — reabre o arquivo mesmo se `path` repetir. */
  nonce?: number;
  /** Raiz da cópia de trabalho (habilita o "Ir para arquivo"). */
  root?: string | null;
  onClose: () => void;
  /** Chamado após cada salvamento (para a lista/diff se atualizarem). */
  onSaved?: () => void;
}

export default function EditorWorkbench({
  open,
  path,
  relPath,
  nonce = 0,
  root,
  onClose,
  onSaved,
}: EditorWorkbenchProps) {
  const theme = useConfigStore((s) => s.config?.theme ?? "dark");
  const externalEditor = useConfigStore((s) => s.config?.externalEditor ?? "");
  const isDark = useMemo(() => resolveDark(theme), [theme]);

  const [tabs, setTabs] = useState<TabState[]>([]);
  const [panes, setPanes] = useState<string[][]>([[]]);
  const [active, setActive] = useState<(string | null)[]>([null]);
  const [focusedPane, setFocusedPane] = useState(0);
  const [saving, setSaving] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [wcFiles, setWcFiles] = useState<{ files: string[]; loading: boolean; error: string | null }>({
    files: [],
    loading: false,
    error: null,
  });
  // Re-render barato quando o editor muda (cursor, texto, busca) — os dados
  // são lidos direto das views na renderização.
  const [, setTick] = useState(0);

  const managerRef = useRef<EditorManager | null>(null);
  const searchRef = useRef<SearchPanelHandle>(null);
  const hostRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef(0);
  const wcLoadedRef = useRef(false);
  const ctx = useContextMenu();

  // Snapshot para os callbacks do manager/keymap (evita closures presas).
  const snap = { tabs, panes, active, focusedPane };
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const scheduleTick = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setTick((t) => t + 1);
    });
  };

  const focusPath = (p: string | null) => {
    if (!p) return;
    requestAnimationFrame(() => managerRef.current?.get(p)?.view.focus());
  };

  const activateTab = (paneIdx: number, p: string) => {
    setActive((a) => a.map((v, i) => (i === paneIdx ? p : v)));
    setFocusedPane(paneIdx);
    focusPath(p);
  };

  const cycleTab = (dir: 1 | -1) => {
    const { panes, active, focusedPane } = snapRef.current;
    const list = panes[focusedPane] ?? [];
    if (list.length < 2) return false;
    const idx = Math.max(0, list.indexOf(active[focusedPane] ?? ""));
    activateTab(focusedPane, list[(idx + dir + list.length) % list.length]);
    return true;
  };

  const ensureManager = () => {
    if (!managerRef.current) {
      managerRef.current = new EditorManager(
        {
          handlers: {
            openSearch: (replace) => (searchRef.current?.open({ replace }), true),
            findNext: () => {
              if (!searchRef.current) return false;
              if (!searchRef.current.isOpen()) searchRef.current.open({});
              else searchRef.current.findNext();
              return true;
            },
            findPrevious: () => {
              if (!searchRef.current) return false;
              if (!searchRef.current.isOpen()) searchRef.current.open({});
              else searchRef.current.findPrevious();
              return true;
            },
            gotoLine: () => (setGotoOpen(true), true),
            quickOpen: () => (openQuickOpen(), true),
            save: () => {
              const { active, focusedPane } = snapRef.current;
              void saveTab(active[focusedPane]);
              return true;
            },
            nextTab: () => cycleTab(1),
            prevTab: () => cycleTab(-1),
            format: () => {
              void formatActive();
              return true;
            },
          },
          onUpdate: scheduleTick,
          onFocus: (p) => {
            const i = snapRef.current.panes.findIndex((list) => list.includes(p));
            if (i >= 0 && i !== snapRef.current.focusedPane) setFocusedPane(i);
          },
        },
        isDark,
      );
    }
    return managerRef.current;
  };

  // --- abrir arquivos --------------------------------------------------------

  const openFile = (absPath: string, rel?: string | null) => {
    const { tabs, panes, focusedPane } = snapRef.current;
    const existing = tabs.find((t) => t.path === absPath);
    if (existing) {
      const paneIdx = Math.max(0, panes.findIndex((list) => list.includes(absPath)));
      activateTab(paneIdx, absPath);
      return;
    }
    // Updaters idempotentes: o StrictMode (dev) roda o efeito de abertura em
    // dobro antes de o estado assentar — sem isto a aba entraria duplicada.
    setTabs((ts) =>
      ts.some((t) => t.path === absPath)
        ? ts
        : [
            ...ts,
            { path: absPath, relPath: rel ?? undefined, encoding: "utf-8", eol: "\n", eolChanged: false, loading: true, error: null },
          ],
    );
    setPanes((ps) =>
      ps.map((list, i) => (i === focusedPane && !list.includes(absPath) ? [...list, absPath] : list)),
    );
    setActive((a) => a.map((v, i) => (i === focusedPane ? absPath : v)));

    api
      .readTextFile(absPath)
      .then(({ content, encoding }) => {
        const crlf = content.includes("\r\n");
        const norm = crlf ? content.replace(/\r\n/g, "\n") : content;
        ensureManager().open(absPath, norm);
        setTabs((ts) =>
          ts.map((t) => (t.path === absPath ? { ...t, encoding, eol: crlf ? "\r\n" : "\n", loading: false } : t)),
        );
        if (snapRef.current.active[snapRef.current.focusedPane] === absPath) focusPath(absPath);
      })
      .catch((e) =>
        setTabs((ts) => ts.map((t) => (t.path === absPath ? { ...t, loading: false, error: String(e) } : t))),
      );
  };

  // Pedido externo (botão "Editar" nas views) — abre/ativa a aba.
  useEffect(() => {
    if (open && path) openFile(path, relPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, path, nonce]);

  // Fechou o modal: descarta as views e zera tudo para a próxima sessão.
  useEffect(() => {
    if (open) return;
    managerRef.current?.dispose();
    managerRef.current = null;
    wcLoadedRef.current = false;
    setTabs([]);
    setPanes([[]]);
    setActive([null]);
    setFocusedPane(0);
    setGotoOpen(false);
    setQuickOpen(false);
    setWcFiles({ files: [], loading: false, error: null });
  }, [open]);

  // Tema claro/escuro em runtime.
  useEffect(() => {
    managerRef.current?.setDark(isDark);
  }, [isDark]);

  // Encaixa a view ativa de cada painel no host correspondente (idempotente).
  useLayoutEffect(() => {
    const m = managerRef.current;
    if (!m) return;
    panes.forEach((_, i) => {
      const p = active[i];
      const el = hostRefs.current[i];
      if (p && el && m.get(p)) m.attach(p, el);
    });
  });

  // --- salvar ----------------------------------------------------------------

  const isTabDirty = (t: TabState) =>
    t.eolChanged || (managerRef.current?.get(t.path)?.isDirty() ?? false);

  const saveTab = async (p: string | null): Promise<boolean> => {
    if (!p) return false;
    const tab = snapRef.current.tabs.find((t) => t.path === p);
    const handle = managerRef.current?.get(p);
    if (!tab || !handle || tab.loading || tab.error) return false;
    if (!isTabDirty(tab)) return true;
    setSaving(true);
    try {
      const text = handle.text();
      const restored = tab.eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
      await api.writeTextFile(p, restored, tab.encoding);
      handle.markSaved();
      setTabs((ts) => ts.map((t) => (t.path === p ? { ...t, eolChanged: false } : t)));
      toast.success("Arquivo salvo", titleOf(tab));
      onSaved?.();
      scheduleTick();
      return true;
    } catch (e) {
      toast.error("Falha ao salvar o arquivo", String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAll = async () => {
    for (const t of snapRef.current.tabs) {
      if (isTabDirty(t)) await saveTab(t.path);
    }
  };

  // --- reformatar por linguagem (Ctrl+Alt+L) ----------------------------------

  const formatActive = async () => {
    const { active, focusedPane, tabs } = snapRef.current;
    const p = active[focusedPane];
    const handle = p ? managerRef.current?.get(p) : undefined;
    const tab = tabs.find((t) => t.path === p);
    if (!p || !handle || !tab || tab.loading || tab.error) return;
    if (!canFormat(p)) {
      toast.info("Sem formatador para esta linguagem", languageLabelFor(p));
      return;
    }
    const text = handle.text();
    const r = await formatText(p, text, handle.indent);
    if ("error" in r) {
      toast.error("Não foi possível reformatar", r.error);
      return;
    }
    if (r.ok === text) {
      toast.info("Já estava formatado", titleOf(tab));
      return;
    }
    // Troca só o miolo que mudou (preserva cursor/scroll do resto) e vira um
    // único passo de desfazer.
    handle.view.dispatch({
      changes: minimalReplace(text, r.ok),
      userEvent: "input.format",
      scrollIntoView: true,
    });
    toast.success("Arquivo reformatado", `${titleOf(tab)} · ${languageLabelFor(p)}`);
  };

  // --- fechar abas/modal -----------------------------------------------------

  /** Remove abas do layout numa passada só (estado consistente mesmo fechando
   *  várias de uma vez), escolhendo novo ativo por painel e recolhendo grupos
   *  que esvaziarem. Fecha o modal quando não sobra nenhuma. */
  const removePaths = (paths: string[]) => {
    const gone = new Set(paths);
    const { tabs, panes, active, focusedPane } = snapRef.current;
    for (const p of paths) managerRef.current?.close(p);

    const prunedPanes = panes.map((list) => list.filter((x) => !gone.has(x)));
    const prunedActive = prunedPanes.map((list, i) => {
      const cur = active[i];
      if (cur && !gone.has(cur) && list.includes(cur)) return cur;
      // Ativa a vizinha mais próxima da posição da aba que saiu.
      const oldIdx = Math.max(0, panes[i].findIndex((x) => gone.has(x)));
      return list[Math.min(oldIdx, list.length - 1)] ?? null;
    });
    const keep = prunedPanes.map((list) => list.length > 0);
    const nextPanes = prunedPanes.filter((_, i) => keep[i]);
    const nextActive = prunedActive.filter((_, i) => keep[i]);

    setTabs(tabs.filter((t) => !gone.has(t.path)));
    setPanes(nextPanes.length ? nextPanes : [[]]);
    setActive(nextActive.length ? nextActive : [null]);
    setFocusedPane(Math.min(focusedPane, Math.max(0, nextPanes.length - 1)));

    if (tabs.length - gone.size <= 0) onClose();
  };

  const closeTab = async (p: string) => {
    const tab = snapRef.current.tabs.find((t) => t.path === p);
    if (!tab) return;
    if (isTabDirty(tab)) {
      const ok = await confirm({
        title: "Fechar sem salvar?",
        message: `“${titleOf(tab)}” tem alterações não salvas. Elas serão perdidas.`,
        danger: true,
        confirmLabel: "Descartar",
      });
      if (!ok) return;
    }
    removePaths([p]);
  };

  const closeMany = async (paths: string[]) => {
    const dirty = snapRef.current.tabs.filter((t) => paths.includes(t.path) && isTabDirty(t));
    if (dirty.length) {
      const ok = await confirm({
        title: "Fechar sem salvar?",
        message: `Alterações não salvas em: ${dirty.map(titleOf).join(", ")}. Elas serão perdidas.`,
        danger: true,
        confirmLabel: "Descartar",
      });
      if (!ok) return;
    }
    removePaths(paths);
  };

  const requestClose = async () => {
    if (saving) return;
    const dirty = snapRef.current.tabs.filter(isTabDirty);
    if (dirty.length) {
      const ok = await confirm({
        title: "Descartar alterações?",
        message: `Não salvo em: ${dirty.map(titleOf).join(", ")}. As mudanças serão perdidas.`,
        danger: true,
        confirmLabel: "Descartar",
      });
      if (!ok) return;
    }
    onClose();
  };

  // --- dividir / mover entre grupos -------------------------------------------

  const splitRight = (p: string) => {
    const { panes } = snapRef.current;
    if (panes.length !== 1 || panes[0].length < 2) return;
    const rest = panes[0].filter((x) => x !== p);
    setPanes([rest, [p]]);
    setActive((a) => [a[0] === p ? rest[rest.length - 1] : a[0], p]);
    setFocusedPane(1);
    focusPath(p);
  };

  const moveToOtherPane = (p: string) => {
    const { panes } = snapRef.current;
    if (panes.length === 1) return splitRight(p);
    const src = panes.findIndex((list) => list.includes(p));
    const dst = src === 0 ? 1 : 0;
    const next = panes.map((list, i) =>
      i === src ? list.filter((x) => x !== p) : i === dst ? [...list, p] : list,
    );
    if (next[src].length === 0) {
      // Grupo de origem esvaziou: volta a um painel único.
      setPanes([next[dst]]);
      setActive([p]);
      setFocusedPane(0);
    } else {
      setPanes(next);
      setActive((a) => a.map((v, i) => (i === dst ? p : v === p ? next[src][0] : v)));
      setFocusedPane(dst);
    }
    focusPath(p);
  };

  const toggleSplit = () => {
    const { panes, active, focusedPane } = snapRef.current;
    if (panes.length === 1) {
      const p = active[focusedPane];
      if (p) splitRight(p);
    } else {
      const merged = [...panes[0], ...panes[1]];
      setPanes([merged]);
      setActive([active[focusedPane] ?? active[0] ?? merged[0] ?? null]);
      setFocusedPane(0);
    }
  };

  // --- ir para arquivo ---------------------------------------------------------

  const openQuickOpen = () => {
    if (!root) {
      toast.info("Sem raiz da cópia de trabalho", "Abra o editor a partir de um projeto");
      return;
    }
    setQuickOpen(true);
    if (!wcLoadedRef.current) {
      wcLoadedRef.current = true;
      setWcFiles((s) => ({ ...s, loading: true }));
      api
        .listWcFiles(root)
        .then((files) => setWcFiles({ files, loading: false, error: null }))
        .catch((e) => setWcFiles({ files: [], loading: false, error: String(e) }));
    }
  };

  // --- atalhos no nível do modal (funcionam fora do foco do editor) -----------

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      let handled = true;
      if (mod && e.key === "Tab") cycleTab(e.shiftKey ? -1 : 1);
      else if (mod && e.key === "F4") void closeTab(snapRef.current.active[snapRef.current.focusedPane] ?? "");
      else if (mod && !e.shiftKey && k === "s") void saveTab(snapRef.current.active[snapRef.current.focusedPane]);
      else if (mod && e.shiftKey && k === "s") void saveAll();
      else if (mod && e.shiftKey && k === "n") openQuickOpen();
      else if (mod && k === "f") searchRef.current?.open({ replace: false });
      else if (mod && k === "r") searchRef.current?.open({ replace: true });
      else if (mod && k === "g") setGotoOpen(true);
      else if (e.key === "F3" && searchRef.current?.isOpen()) {
        if (e.shiftKey) searchRef.current.findPrevious();
        else searchRef.current.findNext();
      } else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // --- dados derivados para a renderização -------------------------------------

  const manager = managerRef.current;
  const focusedActivePath = active[focusedPane] ?? null;
  const focusedTab = tabs.find((t) => t.path === focusedActivePath) ?? null;
  const focusedHandle = focusedActivePath ? manager?.get(focusedActivePath) : undefined;
  const view = focusedHandle?.view ?? null;

  const cursor: CursorInfo | null = view
    ? (() => {
        const sel = view.state.selection;
        const head = sel.main.head;
        const line = view.state.doc.lineAt(head);
        const selChars = sel.ranges.reduce((n, r) => n + (r.to - r.from), 0);
        const selLines = sel.main.empty
          ? 0
          : view.state.doc.lineAt(sel.main.to).number - view.state.doc.lineAt(sel.main.from).number + 1;
        return { line: line.number, col: head - line.from + 1, selChars, selLines, cursors: sel.ranges.length };
      })()
    : null;

  const summary = view
    ? searchSummary(view.state)
    : { active: false, count: 0, truncated: false, current: 0, error: null, hasScope: false };

  const dirtyTabs = tabs.filter(isTabDirty);
  const activeDirty = !!focusedTab && isTabDirty(focusedTab);

  const tabContextItems = (p: string): MenuItem[] => {
    const tab = tabs.find((t) => t.path === p);
    const paneIdx = panes.findIndex((list) => list.includes(p));
    const others = tabs.filter((t) => t.path !== p);
    return [
      { id: "close", label: "Fechar (Ctrl+F4)", icon: <X className="size-3.5" />, onSelect: () => void closeTab(p) },
      {
        id: "close-others",
        label: "Fechar outras",
        disabled: others.length === 0,
        onSelect: () => void closeMany(others.map((t) => t.path)),
      },
      { id: "close-all", label: "Fechar todas", onSelect: () => void closeMany(tabs.map((t) => t.path)) },
      {
        id: "save",
        label: "Salvar (Ctrl+S)",
        icon: <Save className="size-3.5" />,
        separatorBefore: true,
        disabled: !tab || !isTabDirty(tab),
        onSelect: () => void saveTab(p),
      },
      panes.length === 1
        ? {
            id: "split",
            label: "Dividir à direita",
            separatorBefore: true,
            disabled: tabs.length < 2,
            disabledReason: "Abra pelo menos dois arquivos",
            onSelect: () => splitRight(p),
          }
        : {
            id: "move",
            label: `Mover para o grupo ${paneIdx === 0 ? "da direita" : "da esquerda"}`,
            separatorBefore: true,
            onSelect: () => moveToOtherPane(p),
          },
      {
        id: "copy-path",
        label: "Copiar caminho",
        icon: <Copy className="size-3.5" />,
        separatorBefore: true,
        onSelect: () => {
          void navigator.clipboard.writeText(p);
          toast.success("Caminho copiado");
        },
      },
      {
        id: "external",
        label: "Abrir no editor externo",
        icon: <ExternalLink className="size-3.5" />,
        onSelect: () =>
          void tryRun(() => api.openInEditor(p, externalEditor || undefined), "Não consegui abrir o editor externo"),
      },
    ];
  };

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          focusedActivePath &&
          void tryRun(
            () => api.openInEditor(focusedActivePath, externalEditor || undefined),
            "Não consegui abrir o editor externo",
          )
        }
        disabled={!focusedActivePath}
      >
        <ExternalLink className="size-3.5" />
        Abrir no editor externo
      </Button>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={requestClose} disabled={saving}>
          Fechar
        </Button>
        {dirtyTabs.length > 1 && (
          <Button variant="secondary" onClick={() => void saveAll()} loading={saving}>
            {!saving && <SaveAll className="size-4" />}
            Salvar tudo ({dirtyTabs.length})
          </Button>
        )}
        <Button
          variant="primary"
          onClick={() => void saveTab(focusedActivePath)}
          loading={saving}
          disabled={!activeDirty}
        >
          {!saving && <Save className="size-4" />}
          Salvar
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={requestClose}
      size="full"
      locked={saving}
      icon={<FileCode2 className="size-5" />}
      title={focusedTab ? titleOf(focusedTab) : "Editor de código"}
      description={
        dirtyTabs.length
          ? `${dirtyTabs.length} arquivo(s) com alterações não salvas · Ctrl+S salva`
          : (focusedActivePath ?? undefined)
      }
      help={HELP.editor}
      footer={footer}
      bodyClassName="p-0"
    >
      {/* Altura: encosta no limite da viewport (desconta topo do modal, cabeçalho
          e rodapé) sem estourar — o editor merece o máximo de área útil. */}
      <div className="relative flex h-[min(80vh,calc(100vh-15rem))] flex-col overflow-hidden">
        <EditorToolbar
          view={view}
          canUndo={!!view && undoDepth(view.state) > 0}
          canRedo={!!view && redoDepth(view.state) > 0}
          split={panes.length > 1}
          canSplit={tabs.length >= 2}
          canFormat={!!focusedActivePath && canFormat(focusedActivePath)}
          onOpenSearch={(replace) => searchRef.current?.open({ replace })}
          onGotoLine={() => setGotoOpen(true)}
          onQuickOpen={openQuickOpen}
          onFormat={() => void formatActive()}
          onToggleSplit={toggleSplit}
          onShortcuts={() => setShortcutsOpen(true)}
        />

        <SearchPanel ref={searchRef} view={view} summary={summary} />

        <div className="relative flex min-h-0 flex-1 divide-x divide-line">
          {panes.map((paneTabs, i) => {
            const activePath = active[i];
            const activeTab = tabs.find((t) => t.path === activePath) ?? null;
            const metas: TabMeta[] = paneTabs
              .map((p) => tabs.find((t) => t.path === p))
              .filter((t): t is TabState => !!t)
              .map((t) => ({ path: t.path, title: titleOf(t), detail: detailOf(t), dirty: isTabDirty(t) }));
            return (
              <section
                key={i}
                className="flex min-w-0 flex-1 flex-col"
                onMouseDownCapture={() => setFocusedPane(i)}
              >
                <EditorTabs
                  tabs={metas}
                  active={activePath}
                  focused={focusedPane === i}
                  onSelect={(p) => activateTab(i, p)}
                  onClose={(p) => void closeTab(p)}
                  onContext={(e, p) => ctx.open(e, tabContextItems(p))}
                />
                <div className="relative min-h-0 flex-1 bg-panel">
                  {!activeTab ? (
                    <div className="flex h-full items-center justify-center text-sm text-faint">
                      <span className="flex items-center gap-2">
                        <Pencil className="size-4" /> Nenhum arquivo neste grupo
                      </span>
                    </div>
                  ) : activeTab.loading ? (
                    <Loading label="Abrindo o arquivo…" />
                  ) : activeTab.error ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                      <AlertTriangle className="size-7 text-warn" />
                      <div className="text-sm text-ink">Não dá para editar este arquivo aqui.</div>
                      <div className="max-w-md text-[12px] text-faint">{activeTab.error}</div>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void tryRun(
                            () => api.openInEditor(activeTab.path, externalEditor || undefined),
                            "Não consegui abrir o editor externo",
                          )
                        }
                      >
                        <ExternalLink className="size-4" />
                        Abrir no editor externo
                      </Button>
                    </div>
                  ) : (
                    <div
                      ref={(el) => {
                        hostRefs.current[i] = el;
                      }}
                      // Botão direito no código: menu de edição do editor (o
                      // mousedown já focou este grupo via section acima).
                      onContextMenu={(e) => {
                        const v = managerRef.current?.get(activeTab.path)?.view;
                        if (!v) return;
                        ctx.open(
                          e,
                          editorContextItems({
                            view: v,
                            formatEnabled: canFormat(activeTab.path),
                            onSearch: (replace) => searchRef.current?.open({ replace }),
                            onGotoLine: () => setGotoOpen(true),
                            onFormat: () => void formatActive(),
                          }),
                        );
                      }}
                      className={cn("h-full [&_.cm-editor]:h-full", focusedPane !== i && "opacity-95")}
                    />
                  )}
                </div>
              </section>
            );
          })}

          <GotoLinePopup open={gotoOpen} view={view} onClose={() => setGotoOpen(false)} />
          <QuickOpenPalette
            open={quickOpen}
            files={wcFiles.files}
            loading={wcFiles.loading}
            error={wcFiles.error}
            onPick={(rel) => root && openFile(`${root.replace(/\/$/, "")}/${rel}`, rel)}
            onClose={() => setQuickOpen(false)}
          />
        </div>

        <StatusBar
          cursor={cursor}
          indent={focusedHandle?.indent ?? { useTabs: false, size: 4 }}
          onIndentChange={(ind) => {
            focusedHandle?.setIndent(ind);
            scheduleTick();
          }}
          eol={focusedTab?.eol ?? "\n"}
          onEolChange={(eol) => {
            if (!focusedTab || focusedTab.eol === eol) return;
            setTabs((ts) => ts.map((t) => (t.path === focusedTab.path ? { ...t, eol, eolChanged: true } : t)));
          }}
          encoding={focusedTab?.encoding ?? "utf-8"}
          language={focusedActivePath ? languageLabelFor(focusedActivePath) : "—"}
          wrap={focusedHandle?.wrap ?? false}
          onWrapToggle={() => {
            focusedHandle?.setWrap(!focusedHandle.wrap);
            scheduleTick();
          }}
          whitespace={focusedHandle?.whitespace ?? false}
          onWhitespaceToggle={() => {
            focusedHandle?.setWhitespace(!focusedHandle.whitespace);
            scheduleTick();
          }}
          onGotoLine={() => setGotoOpen(true)}
        />
      </div>

      <ContextMenu menu={ctx.menu} onClose={ctx.close} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </Modal>
  );
}
