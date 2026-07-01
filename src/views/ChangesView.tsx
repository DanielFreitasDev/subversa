import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ChevronRight,
  CloudDownload,
  ExternalLink,
  EyeOff,
  FilePlus2,
  Folder,
  FolderOpen,
  GitMerge,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

import * as api from "@/lib/api";
import { BlameModal, type BlameRequest } from "@/components/blame/BlameModal";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { ConflictDialog } from "@/components/dialogs/ConflictDialog";
import { MergeEditor } from "@/components/merge/MergeEditor";
import { CodeEditorModal } from "@/components/editor/CodeEditorModal";
import { StatusLetter } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ContextMenu, useContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { Loading } from "@/components/ui/Spinner";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Tooltip } from "@/components/ui/Tooltip";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { useActions } from "@/hooks/useActions";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { useStatus } from "@/hooks/useStatus";
import { HELP } from "@/lib/help";
import { extractRevision, reportOutput, tryRun } from "@/lib/op";
import type { HunkRef, ShelfEntry, StashResult, StatusEntry, WorkingCopy } from "@/lib/types";
import { baseName, cn, dirName, fileExt, formatRelative, statusMeta } from "@/lib/utils";
import { confirm, useConfirmStore } from "@/store/confirm";
import { useConfigStore } from "@/store/config";
import { toast } from "@/store/toast";
import { useUndoStore } from "@/store/undo";
import { useWorkspaceStore } from "@/store/workspace";
import { NeedWorkingCopy } from "./_shared";

const COMMITTABLE = ["modified", "added", "deleted", "replaced", "missing", "conflicted"];

/** O que pode ser marcado para commit: mudanças versionadas, novos arquivos e
 *  mudanças só de propriedade. (Conflitos aparecem na lista, mas não entram por
 *  padrão e o commit é bloqueado até resolver.) */
function isSelectable(e: StatusEntry): boolean {
  return COMMITTABLE.includes(e.item) || e.item === "unversioned" || e.props === "modified";
}

/** Arquivos que dá para abrir no editor embutido: um arquivo (não pasta) que
 *  existe em disco — exclui apagados/sumidos, que não têm conteúdo local. */
function isEditable(e: StatusEntry): boolean {
  return !e.isDir && e.item !== "deleted" && e.item !== "missing";
}

function StatusRow({
  entry,
  checked,
  highlighted,
  onToggle,
  onHighlight,
  onAdd,
  onDelete,
  onRevert,
  onReveal,
  onResolve,
  onEdit,
  onContext,
}: {
  entry: StatusEntry;
  checked: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onHighlight: () => void;
  onAdd: () => void;
  onDelete: () => void;
  onRevert: () => void;
  onReveal: () => void;
  onResolve: () => void;
  onEdit?: () => void;
  onContext: (e: React.MouseEvent) => void;
}) {
  const isConflict = entry.item === "conflicted" || entry.treeConflicted;
  const isUnversioned = entry.item === "unversioned";
  const dir = dirName(entry.relPath);
  const name = baseName(entry.relPath);
  return (
    <div
      onClick={onHighlight}
      onContextMenu={onContext}
      className={cn(
        "group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors",
        highlighted ? "bg-panel-3" : "hover:bg-panel-2",
      )}
    >
      <Checkbox
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
      />
      <StatusLetter item={entry.item} props={entry.props} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          {entry.isDir && (
            <Folder className="size-3.5 shrink-0 text-muted" aria-label="pasta" />
          )}
          <span className="truncate text-[13px] text-ink">{name}</span>
          {entry.props === "modified" && entry.item !== "modified" && (
            <span className="rounded bg-mod/12 px-1 text-[9px] font-semibold text-mod">props</span>
          )}
          {entry.remoteModified && (
            <span title="novidade no servidor" className="size-1.5 rounded-full bg-info" />
          )}
        </div>
        {dir && <div className="truncate text-[11px] text-faint">{dir}</div>}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {isConflict && (
          <Tooltip label="Resolver conflito">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              className="flex size-6 items-center justify-center rounded text-conflict hover:bg-conflict/15"
            >
              <GitMerge className="size-3.5" />
            </button>
          </Tooltip>
        )}
        {isUnversioned && (
          <>
            <Tooltip label="Adicionar ao SVN">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd();
                }}
                className="flex size-6 items-center justify-center rounded text-add hover:bg-add/15"
              >
                <FilePlus2 className="size-3.5" />
              </button>
            </Tooltip>
            <Tooltip label="Excluir do disco">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="flex size-6 items-center justify-center rounded text-faint hover:bg-danger/15 hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            </Tooltip>
          </>
        )}
        {!isUnversioned && (
          <Tooltip label="Reverter este arquivo">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRevert();
              }}
              className="flex size-6 items-center justify-center rounded text-faint hover:bg-panel-3 hover:text-ink"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </Tooltip>
        )}
        {onEdit && (
          <Tooltip label="Editar arquivo">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="flex size-6 items-center justify-center rounded text-faint hover:bg-panel-3 hover:text-ink"
            >
              <Pencil className="size-3.5" />
            </button>
          </Tooltip>
        )}
        <Tooltip label="Abrir no sistema">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReveal();
            }}
            className="flex size-6 items-center justify-center rounded text-faint hover:bg-panel-3 hover:text-ink"
          >
            <FolderOpen className="size-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function Changes({ wc }: { wc: WorkingCopy }) {
  const { data, loading, reload } = useStatus(wc.path);
  const refreshOne = useWorkspaceStore((s) => s.refreshOne);
  // Recarrega a lista/diff quando um desfazer (Ctrl+Z) conclui em outro lugar.
  const undoReloadKey = useUndoStore((s) => s.reloadKey);
  const { revertAll } = useActions();
  const ctx = useContextMenu();
  const config = useConfigStore((s) => s.config);
  const confirmServerOps = config?.confirmServerOps ?? true;
  const tool = config?.externalDiffTool ?? "meld";
  const editorCmd = config?.externalEditor || undefined;

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  // Força recarregar o diff após salvar no editor embutido: o arquivo mudou em
  // disco, mas o caminho destacado continua o mesmo.
  const [diffNonce, setDiffNonce] = useState(0);
  // Arquivo aberto no editor de código embutido.
  const [editPath, setEditPath] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [checkingServer, setCheckingServer] = useState(false);
  const [conflictPath, setConflictPath] = useState<string | null>(null);
  const [blameReq, setBlameReq] = useState<BlameRequest | null>(null);
  const [shelves, setShelves] = useState<ShelfEntry[]>([]);
  const [shelvesOpen, setShelvesOpen] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [shelfName, setShelfName] = useState("");
  const [shelving, setShelving] = useState(false);
  // Editor visual de 3 painéis (conflitos de texto); o ConflictDialog cobre
  // árvore/propriedade/binário e serve de fallback.
  const [mergePath, setMergePath] = useState<string | null>(null);
  // Semeia a seleção só uma vez por WC (o componente remonta via key={wc.path}).
  const seededRef = useRef(false);

  const entries = data?.entries ?? [];

  // 1ª carga: marca por padrão o que é committável (menos conflitos e novos
  // arquivos). Em reloads (checkServer, pós-resolução) preserva a seleção do
  // usuário, só descartando itens que sumiram da lista.
  useEffect(() => {
    if (!data) return;
    const present = new Set(data.entries.map((e) => e.path));
    setChecked((prev) => {
      if (seededRef.current) {
        const kept = new Set<string>();
        for (const p of prev) if (present.has(p)) kept.add(p);
        return kept;
      }
      seededRef.current = true;
      const def = new Set<string>();
      for (const e of data.entries) {
        if (isSelectable(e) && e.item !== "unversioned" && e.item !== "conflicted") {
          def.add(e.path);
        }
      }
      return def;
    });
    // Mantém o destaque se ainda existir; senão cai para o primeiro item.
    setHighlight((h) =>
      (h && present.has(h) ? h : null) ?? data.entries[0]?.path ?? null,
    );
  }, [data]);

  // Carrega o diff do arquivo destacado.
  useEffect(() => {
    if (!highlight) {
      setDiff("");
      return;
    }
    let alive = true;
    setDiffLoading(true);
    api
      .getDiff(wc.path, [highlight])
      .then((d) => alive && setDiff(d))
      .catch(() => alive && setDiff(""))
      .finally(() => alive && setDiffLoading(false));
    return () => {
      alive = false;
    };
  }, [highlight, wc.path, diffNonce]);

  // Reconsulta o status local quando a janela volta ao foco: ao editar/criar
  // arquivos em outro programa e voltar ao Subversa, a lista atualiza sozinha
  // (sem precisar trocar de aba e voltar).
  useEffect(() => {
    const onFocus = () => reload(false);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  // Após um desfazer (botão "Desfazer" do toast ou Ctrl+Z), ressincroniza a
  // lista e o diff. Pula a 1ª execução (montagem) — só reage a desfazeres reais.
  const firstUndoSync = useRef(true);
  useEffect(() => {
    if (firstUndoSync.current) {
      firstUndoSync.current = false;
      return;
    }
    reload(false);
    setDiffNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoReloadKey]);

  // Ctrl+Z (⌘Z) desfaz a última reversão desta working copy. Ignora quando se
  // está digitando (campo/textarea/editor) ou com um modal aberto — nesses casos
  // o Ctrl+Z pertence ao campo/editor, não à pilha de reversões.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "z") return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable ||
        el?.closest?.(".cm-editor")
      ) {
        return;
      }
      if (editPath || mergePath || conflictPath || useConfirmStore.getState().pending) return;
      const item = useUndoStore.getState().latestFor(wc.path);
      if (!item) return;
      e.preventDefault();
      void useUndoStore.getState().run(item.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wc.path, editPath, mergePath, conflictPath]);

  const selectedEntries = entries.filter((e) => checked.has(e.path));
  const selectableEntries = entries.filter(isSelectable);
  const allSelected = selectableEntries.length > 0 && selectableEntries.every((e) => checked.has(e.path));
  const hasConflicts = entries.some((e) => e.item === "conflicted" || e.treeConflicted);
  // "Reverter" só faz sentido em itens versionados (revert não toca em arquivos
  // novos fora do SVN).
  const hasRevertable = entries.some((e) => e.item !== "unversioned");
  // "trunk" literal só quando a WC está mesmo no trunk (um preset pode ter uma
  // branch como linha principal do projeto).
  const mainlineLabel = wc.kind === "trunk" ? "linha principal (trunk)" : "linha principal";

  const toggle = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const toggleAll = () =>
    setChecked(allSelected ? new Set() : new Set(selectableEntries.map((e) => e.path)));

  // Empilha o ponto de desfazer (se capturado) e mostra o toast de sucesso com o
  // botão "Desfazer" (que, como o Ctrl+Z, restaura o que a reversão descartou).
  const offerUndo = (stash: StashResult | null, title: string) => {
    if (stash?.id) {
      useUndoStore.getState().push({
        id: stash.id,
        label: stash.label,
        wcPath: wc.path,
        fileCount: stash.fileCount,
      });
      toast.success(title, undefined, {
        action: { label: "Desfazer", onClick: () => useUndoStore.getState().run(stash.id) },
      });
    } else {
      toast.success(title);
    }
  };

  const revertPaths = async (paths: string[]) => {
    if (!paths.length) return;
    const ok = await confirm({
      title: paths.length === 1 ? "Reverter este arquivo?" : `Reverter ${paths.length} itens?`,
      message: "As alterações locais selecionadas serão descartadas. Dá para desfazer logo depois (Ctrl+Z).",
      danger: true,
      confirmLabel: "Reverter",
    });
    if (!ok) return;
    // Captura o estado atual ANTES de reverter (best-effort), para o desfazer.
    const stash = await api
      .stashRevert(wc.path, paths, paths.length === 1 ? "reverter arquivo" : "reverter selecionados")
      .catch(() => null);
    const out = await tryRun(() => api.revert(paths, false), "Falha no revert");
    if (!out) return;
    if (!out.success) {
      reportOutput(out, "");
      return;
    }
    await reload(false);
    await refreshOne(wc.path);
    offerUndo(stash, "Alterações revertidas");
  };

  // Reverte TODAS as alterações da working copy (recursivo). Reaproveita a ação
  // de alto nível (confirma, oferece ponto de restauração e captura o desfazer);
  // passa a lista de versionados para o stash e só ressincroniza ao concluir.
  const revertEverything = async () => {
    const paths = entries.filter((e) => e.item !== "unversioned").map((e) => e.path);
    if (await revertAll(wc, paths)) await reload(false);
  };

  // Reverte um único trecho do arquivo destacado (a setinha estilo IntelliJ).
  // Ação precisa e localizada — sem modal de confirmação; ao concluir, recarrega
  // a lista e o diff (o trecho some; se era a última alteração, o arquivo some).
  // O backend remonta o patch a partir do diff bruto, então a reversão funciona
  // mesmo em arquivos não-UTF-8; o DiffViewer ainda só libera a setinha quando
  // não há modo de "espaços em branco" ativo (o diff colapsado não casaria).
  const revertHunk = async (target: string, hunk: HunkRef) => {
    // Stash do arquivo inteiro antes de aplicar o patch — restaura no desfazer.
    const stash = await api.stashRevert(wc.path, [target], "reverter trecho").catch(() => null);
    const out = await tryRun(() => api.revertHunk(wc.path, target, hunk), "Falha ao reverter o trecho");
    if (!out) return;
    if (!out.success) {
      reportOutput(out, "");
      return;
    }
    await reload(false);
    await refreshOne(wc.path);
    setDiffNonce((n) => n + 1);
    offerUndo(stash, "Trecho revertido");
  };

  // Coloca um arquivo novo (não versionado) sob o SVN — passa a "Adicionado".
  const addToSvn = async (path: string) => {
    const out = await tryRun(() => api.svnAdd([path]), "Falha ao adicionar ao SVN");
    if (out && reportOutput(out, "Adicionado ao SVN")) {
      await reload(false);
      await refreshOne(wc.path);
    }
  };

  // Apaga do disco um arquivo novo (fora do SVN). `svn rm --force` remove o
  // stray direto do disco; é irreversível, então confirma antes.
  const deleteUnversioned = async (path: string) => {
    const ok = await confirm({
      title: "Excluir do disco?",
      message: "Este arquivo novo (fora do SVN) será apagado do disco. Não dá para desfazer.",
      danger: true,
      confirmLabel: "Excluir",
    });
    if (!ok) return;
    const out = await tryRun(() => api.remove([path], false, true), "Falha ao excluir o arquivo");
    if (out && reportOutput(out, "Arquivo excluído")) {
      await reload(false);
      await refreshOne(wc.path);
    }
  };

  // Acrescenta um padrão ao svn:ignore da pasta-pai do item. A propriedade
  // alterada vira uma modificação da pasta na lista — commitar publica a regra.
  const ignorePattern = async (path: string, pattern: string) => {
    const out = await tryRun(() => api.addToIgnore(dirName(path), pattern), "Falha ao ignorar");
    if (
      out &&
      reportOutput(
        out,
        `“${pattern}” adicionado ao svn:ignore`,
        "A pasta aparece como modificada — commite para a regra valer para todos.",
      )
    ) {
      await reload(false);
      await refreshOne(wc.path);
    }
  };

  // --- Guardados para depois (shelves) ---------------------------------------

  const loadShelves = useCallback(async () => {
    const all = await api.listShelves().catch(() => [] as ShelfEntry[]);
    setShelves(all.filter((s) => s.wcPath === wc.path));
  }, [wc.path]);

  useEffect(() => {
    loadShelves();
  }, [loadShelves]);

  /** Guarda os arquivos marcados com o nome digitado (captura + limpa a WC). */
  const doShelve = async () => {
    const paths = selectedEntries.map((e) => e.path);
    if (!paths.length || !shelfName.trim()) return;
    setShelving(true);
    const res = await tryRun(() => api.shelve(wc.path, paths, shelfName.trim()), "Falha ao guardar");
    setShelving(false);
    if (!res) return;
    setShelfOpen(false);
    setShelvesOpen(true);
    toast.success(
      "Guardado para depois",
      `“${res.name}” — ${res.fileCount} arquivo(s) saíram da working copy; aplique de volta quando quiser.`,
    );
    await reload(false);
    await refreshOne(wc.path);
    await loadShelves();
  };

  const applyShelf = async (s: ShelfEntry) => {
    const ok = await confirm({
      title: `Aplicar “${s.name}” de volta?`,
      message:
        `${s.fileCount} arquivo(s) voltam para a working copy. Se algum deles mudou depois de guardar, ` +
        "o conteúdo atual será sobrescrito pelo guardado.",
      confirmLabel: "Aplicar",
    });
    if (!ok) return;
    const out = await tryRun(() => api.unshelve(s.id), "Falha ao aplicar o guardado");
    if (out && reportOutput(out, "Guardado aplicado", `“${s.name}” voltou para a working copy`)) {
      await reload(false);
      await refreshOne(wc.path);
      await loadShelves();
    }
  };

  const removeShelf = async (s: ShelfEntry) => {
    const ok = await confirm({
      title: `Excluir o guardado “${s.name}”?`,
      message: "O conteúdo guardado será apagado do disco. Não dá para desfazer.",
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    const done = await tryRun(() => api.deleteShelf(s.id), "Falha ao excluir o guardado");
    if (done !== null) {
      toast.success("Guardado excluído");
      await loadShelves();
    }
  };

  // Itens do menu de contexto (botão direito) de uma linha — espelham as ações
  // que aparecem no hover e ainda oferecem "Reverter tudo" como atalho global.
  const itemsFor = (e: StatusEntry): MenuItem[] => {
    const isConflict = e.item === "conflicted" || e.treeConflicted;
    const isUnversioned = e.item === "unversioned";
    const items: MenuItem[] = [];

    if (isConflict)
      items.push({
        id: "resolve",
        label: "Resolver conflito",
        icon: <GitMerge className="size-3.5" />,
        onSelect: () =>
          e.item === "conflicted" && !e.treeConflicted
            ? setMergePath(e.path)
            : setConflictPath(e.path),
      });

    if (isUnversioned) {
      items.push({
        id: "add",
        label: "Adicionar ao SVN",
        icon: <FilePlus2 className="size-3.5" />,
        onSelect: () => addToSvn(e.path),
      });
      items.push({
        id: "ignore",
        label: e.isDir ? "Ignorar esta pasta (svn:ignore)" : "Ignorar este arquivo (svn:ignore)",
        icon: <EyeOff className="size-3.5" />,
        onSelect: () => ignorePattern(e.path, baseName(e.path)),
      });
      const ext = fileExt(e.path);
      if (!e.isDir && ext)
        items.push({
          id: "ignore-ext",
          label: `Ignorar extensão (*.${ext})`,
          icon: <EyeOff className="size-3.5" />,
          onSelect: () => ignorePattern(e.path, `*.${ext}`),
        });
      items.push({
        id: "delete",
        label: "Excluir do disco",
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onSelect: () => deleteUnversioned(e.path),
      });
    } else {
      items.push({
        id: "revert",
        label: "Reverter este arquivo",
        icon: <RotateCcw className="size-3.5" />,
        danger: true,
        onSelect: () => revertPaths([e.path]),
      });
    }

    // Autoria da BASE: só faz sentido para arquivo já versionado no servidor.
    if (!isUnversioned && !e.isDir && e.item !== "added") {
      items.push({
        id: "blame",
        label: "Ver autoria (blame)",
        icon: <Users className="size-3.5" />,
        onSelect: () => setBlameReq({ target: e.path }),
      });
    }

    if (isEditable(e)) {
      items.push({
        id: "edit",
        label: "Editar arquivo",
        icon: <Pencil className="size-3.5" />,
        onSelect: () => setEditPath(e.path),
      });
      items.push({
        id: "edit-external",
        label: "Abrir no editor externo",
        icon: <ExternalLink className="size-3.5" />,
        onSelect: () =>
          tryRun(() => api.openInEditor(e.path, editorCmd), "Não consegui abrir o editor externo"),
      });
    }

    items.push({
      id: "reveal",
      label: "Abrir no sistema",
      icon: <FolderOpen className="size-3.5" />,
      onSelect: () =>
        tryRun(() => api.revealInFileManager(e.path), "Não consegui abrir o gerenciador de arquivos"),
    });

    items.push({
      id: "revert-all",
      label: "Reverter tudo",
      icon: <RotateCcw className="size-3.5" />,
      danger: true,
      separatorBefore: true,
      onSelect: revertEverything,
    });

    return items;
  };

  const checkServer = async () => {
    setCheckingServer(true);
    const r = await tryRun(() => api.getStatus(wc.path, true), "Falha ao consultar o servidor");
    setCheckingServer(false);
    if (!r) return;
    if (r.incomingCount > 0)
      toast.info(`${r.incomingCount} novidade(s) no servidor`, "Atualize para receber antes de commitar");
    else toast.success("Em dia com o servidor", "Nada novo para receber");
    await reload(true);
  };

  const doCommit = async () => {
    if (committing) return; // evita dupla submissão (ex.: Ctrl+Enter repetido)
    const toCommit = entries.filter((e) => checked.has(e.path));
    if (!toCommit.length) return toast.warn("Selecione ao menos um arquivo");
    if (!message.trim()) return toast.warn("Escreva uma mensagem de commit");
    if (toCommit.some((e) => e.item === "conflicted")) {
      return toast.error("Há conflitos pendentes", "Resolva os conflitos antes de commitar");
    }

    const summary = `${toCommit.length} item(ns) → ${wc.isMainline ? mainlineLabel : wc.branchLabel}`;
    if (confirmServerOps) {
      const ok = await confirm({
        title: "Enviar ao servidor?",
        message: wc.isMainline
          ? `ATENÇÃO: você está commitando DIRETO na ${mainlineLabel}.\nIsso publica para todos imediatamente.\n\n${summary}`
          : summary,
        confirmLabel: "Commitar",
        danger: wc.isMainline,
      });
      if (!ok) return;
    }

    setCommitting(true);
    try {
      const toAdd = toCommit.filter((e) => e.item === "unversioned").map((e) => e.path);
      const toDel = toCommit.filter((e) => e.item === "missing").map((e) => e.path);
      if (toAdd.length) {
        const o = await api.svnAdd(toAdd);
        if (!o.success) return reportOutput(o, "");
      }
      if (toDel.length) {
        const o = await api.remove(toDel, false);
        if (!o.success) return reportOutput(o, "");
      }
      const out = await api.commit(
        toCommit.map((e) => e.path),
        message.trim(),
      );
      if (out.success) {
        const rev = extractRevision(out.stdout);
        toast.success("Commit enviado", rev ? `Revisão r${rev}` : undefined);
        setMessage("");
      } else {
        reportOutput(out, "");
        // add/remove já aplicados no disco, mas o commit não foi enviado: avisa
        // para o usuário não achar que nada mudou (os itens seguem pendentes).
        if (toAdd.length || toDel.length)
          toast.info(
            "Itens preparados, não enviados",
            "Os arquivos foram adicionados/removidos localmente, mas o commit falhou; eles continuam pendentes na lista.",
          );
      }
    } catch (e) {
      toast.error("Falha no commit", String(e));
    } finally {
      setCommitting(false);
      // add/remove/commit podem ter mexido no disco mesmo em caso de erro:
      // ressincroniza a lista para a UI não ficar desatualizada.
      await reload(false);
      await refreshOne(wc.path);
    }
  };

  const highlightEntry = entries.find((e) => e.path === highlight);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Coluna esquerda: lista + compositor */}
      <div className="flex w-[440px] shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
            <Checkbox
              checked={allSelected}
              indeterminate={selectedEntries.length > 0 && !allSelected}
              onChange={toggleAll}
            />
            {selectedEntries.length}/{selectableEntries.length} selecionados
          </label>
          <div className="flex items-center gap-1">
            <HelpPopover content={HELP.changes} />
            <Tooltip label="Atualizar a lista de alterações">
              <Button variant="ghost" size="icon" onClick={() => reload(false)} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              </Button>
            </Tooltip>
            <Tooltip label="Conferir novidades no servidor">
              <Button variant="ghost" size="icon" onClick={checkServer} disabled={checkingServer}>
                {checkingServer ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CloudDownload className="size-4" />
                )}
              </Button>
            </Tooltip>
            <Tooltip label="Abrir no diff externo">
              <Button variant="ghost" size="icon" onClick={() => tryRun(() => api.openExternalDiff(wc.path, tool), "Não consegui abrir o diff externo")}>
                <ExternalLink className="size-4" />
              </Button>
            </Tooltip>
          </div>
        </div>

        {hasConflicts && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-conflict/30 bg-conflict/10 px-3 py-2 text-[12px] text-conflict">
            <AlertTriangle className="size-4 shrink-0" />
            Há conflitos — resolva antes de commitar.
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading && !data ? (
            <Loading label="Lendo alterações…" />
          ) : entries.length === 0 ? (
            <div className="px-3 py-12 text-center">
              <div className="text-sm font-medium text-ink">Tudo limpo ✨</div>
              <div className="mt-1 text-[12px] text-faint">Sem modificações locais nesta working copy.</div>
            </div>
          ) : (
            entries.map((e) => (
              <StatusRow
                key={e.path}
                entry={e}
                checked={checked.has(e.path)}
                highlighted={highlight === e.path}
                onToggle={() => toggle(e.path)}
                onHighlight={() => setHighlight(e.path)}
                onAdd={() => addToSvn(e.path)}
                onDelete={() => deleteUnversioned(e.path)}
                onRevert={() => revertPaths([e.path])}
                onReveal={() => tryRun(() => api.revealInFileManager(e.path), "Não consegui abrir o gerenciador de arquivos")}
                onResolve={() =>
                  e.item === "conflicted" && !e.treeConflicted
                    ? setMergePath(e.path)
                    : setConflictPath(e.path)
                }
                onEdit={isEditable(e) ? () => setEditPath(e.path) : undefined}
                onContext={(ev) => {
                  setHighlight(e.path);
                  ctx.open(ev, itemsFor(e));
                }}
              />
            ))
          )}
        </div>

        {/* Guardados para depois (shelves) desta working copy */}
        {shelves.length > 0 && (
          <div className="border-t border-line">
            <button
              onClick={() => setShelvesOpen((o) => !o)}
              className="flex w-full items-center gap-2 px-4 py-2 text-[12px] font-medium text-muted transition-colors hover:bg-panel-2"
            >
              <Archive className="size-3.5 text-brand" />
              Guardados para depois
              <span className="rounded-full bg-panel-2 px-1.5 py-0.5 text-[10px] text-faint">
                {shelves.length}
              </span>
              <ChevronRight
                className={cn("ml-auto size-3.5 text-faint transition-transform", shelvesOpen && "rotate-90")}
              />
            </button>
            {shelvesOpen &&
              shelves.map((s) => (
                <div key={s.id} className="flex items-center gap-2 px-4 py-1.5 text-[12px] hover:bg-panel-2/50">
                  <span className="min-w-0 flex-1 truncate text-ink" title={s.name}>
                    {s.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-faint">
                    {s.fileCount} arq. · {formatRelative(new Date(s.createdMs).toISOString())}
                  </span>
                  <Tooltip label="Aplicar de volta na working copy">
                    <button
                      onClick={() => applyShelf(s)}
                      className="flex size-6 items-center justify-center rounded text-faint transition-colors hover:bg-panel-3 hover:text-brand"
                    >
                      <ArchiveRestore className="size-3.5" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Excluir o guardado">
                    <button
                      onClick={() => removeShelf(s)}
                      className="flex size-6 items-center justify-center rounded text-faint transition-colors hover:bg-conflict/15 hover:text-conflict"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </Tooltip>
                </div>
              ))}
          </div>
        )}

        {/* Compositor de commit */}
        <div className="border-t border-line p-3">
          {wc.isMainline && entries.length > 0 && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] leading-snug text-warn">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Você está na <b>{mainlineLabel}</b>. O commit publica para todos. Para isolar,
                crie uma branch.
              </span>
            </div>
          )}
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Mensagem do commit…  (Ctrl+Enter para enviar)"
            rows={3}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doCommit();
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => revertPaths(selectedEntries.filter((e) => e.item !== "unversioned").map((e) => e.path))}
                disabled={!selectedEntries.some((e) => e.item !== "unversioned")}
                className="text-[12px] text-faint transition-colors hover:text-danger disabled:opacity-40"
              >
                Reverter selecionados
              </button>
              <button
                onClick={revertEverything}
                disabled={!hasRevertable}
                className="text-[12px] text-faint transition-colors hover:text-danger disabled:opacity-40"
              >
                Reverter tudo
              </button>
              <button
                onClick={() => {
                  setShelfName("");
                  setShelfOpen(true);
                }}
                disabled={!selectedEntries.length || committing}
                title="Tira as mudanças marcadas da working copy e as guarda com um nome, para aplicar de volta depois"
                className="text-[12px] text-faint transition-colors hover:text-ink disabled:opacity-40"
              >
                Guardar para depois
              </button>
            </div>
            <Button variant="primary" onClick={doCommit} loading={committing} disabled={!selectedEntries.length}>
              {!committing && <Upload className="size-4" />}
              Commitar {selectedEntries.length > 0 && `(${selectedEntries.length})`}
            </Button>
          </div>
        </div>
      </div>

      {/* Coluna direita: diff */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {highlightEntry ? (
              <div className="flex items-center gap-2">
                <StatusLetter item={highlightEntry.item} props={highlightEntry.props} />
                {highlightEntry.isDir && <Folder className="size-4 shrink-0 text-muted" />}
                <span className="truncate text-[13px] font-medium text-ink">
                  {highlightEntry.relPath}
                </span>
                <span className="text-[11px] text-faint">
                  {statusMeta(highlightEntry.item, highlightEntry.props).label}
                </span>
              </div>
            ) : (
              <span className="text-[13px] text-faint">Selecione um arquivo para ver o diff</span>
            )}
          </div>
          {highlightEntry && (
            <div className="flex shrink-0 items-center gap-1.5">
              {isEditable(highlightEntry) && (
                <Button variant="ghost" size="sm" onClick={() => setEditPath(highlightEntry.path)}>
                  <Pencil className="size-3.5" />
                  Editar
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => tryRun(() => api.openExternalDiff(wc.path, tool), "Não consegui abrir o diff externo")}>
                <ExternalLink className="size-3.5" />
                {tool}
              </Button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {diffLoading ? (
            <Loading label="Gerando diff…" />
          ) : highlightEntry?.item === "unversioned" ? (
            <div className="px-3 py-10 text-center text-sm text-faint">
              {highlightEntry.isDir
                ? "Pasta nova (fora do SVN). Será adicionada no commit."
                : "Arquivo novo (fora do SVN). Será adicionado no commit."}
            </div>
          ) : highlightEntry?.isDir && !diff.trim() ? (
            <div className="px-3 py-10 text-center text-sm text-faint">
              Pasta — não há diferenças de conteúdo para mostrar.
            </div>
          ) : (
            <DiffViewer
              text={diff}
              externalTool={tool}
              onOpenExternal={() => tryRun(() => api.openExternalDiff(wc.path, tool), "Não consegui abrir o diff externo")}
              // Reverter trecho só em arquivos modificados versionados — onde um
              // patch reverso faz sentido. (O DiffViewer ainda desabilita quando há
              // um modo de "espaços em branco" ativo.)
              onRevertHunk={highlightEntry?.item === "modified" ? revertHunk : undefined}
              onExpandContext={
                highlight &&
                highlightEntry &&
                !["added", "unversioned", "replaced"].includes(highlightEntry.item)
                  ? async () => {
                      // Contexto não exibido = linhas inalteradas → vêm da BASE (svn cat).
                      const t = await api.catFile(highlight);
                      const lines = t.split("\n");
                      if (lines[lines.length - 1] === "") lines.pop(); // descarta a "linha" vazia final
                      return { side: "old" as const, lines };
                    }
                  : undefined
              }
            />
          )}
        </div>
      </div>

      <CodeEditorModal
        open={!!editPath}
        path={editPath}
        relPath={entries.find((e) => e.path === editPath)?.relPath}
        onClose={() => setEditPath(null)}
        onSaved={async () => {
          await reload(false);
          await refreshOne(wc.path);
          setDiffNonce((n) => n + 1);
        }}
      />

      <MergeEditor
        open={!!mergePath}
        path={mergePath}
        onClose={() => setMergePath(null)}
        onResolved={async () => {
          await reload(false);
          await refreshOne(wc.path);
        }}
        onFallback={(p) => {
          setMergePath(null);
          setConflictPath(p);
        }}
      />

      <ConflictDialog
        open={!!conflictPath}
        path={conflictPath}
        wcPath={wc.path}
        onClose={() => setConflictPath(null)}
        onResolved={async () => {
          await reload(false);
          await refreshOne(wc.path);
        }}
      />

      <ContextMenu menu={ctx.menu} onClose={ctx.close} />
      <BlameModal req={blameReq} onClose={() => setBlameReq(null)} />

      {/* Nome do guardado (shelve) */}
      <Modal
        open={shelfOpen}
        onClose={() => !shelving && setShelfOpen(false)}
        size="sm"
        icon={<Archive className="size-5" />}
        title="Guardar para depois"
        description="Tira as mudanças marcadas da working copy e as guarda com um nome; aplique de volta quando quiser."
        footer={
          <>
            <Button variant="ghost" onClick={() => setShelfOpen(false)} disabled={shelving}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={doShelve} loading={shelving} disabled={!shelfName.trim()}>
              {!shelving && <Archive className="size-4" />}
              Guardar {selectedEntries.length > 0 && `(${selectedEntries.length})`}
            </Button>
          </>
        }
      >
        <Label>
          Nome do guardado
          <Input
            value={shelfName}
            onChange={(e) => setShelfName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shelfName.trim()) {
                e.preventDefault();
                doShelve();
              }
            }}
            placeholder="ex.: ajuste do relatório (issue 1234)"
            className="mt-1"
            autoFocus
          />
        </Label>
      </Modal>
    </div>
  );
}

export function ChangesView() {
  const wc = useSelectedWc();
  if (!wc) return <NeedWorkingCopy />;
  return <Changes key={wc.path} wc={wc} />;
}
