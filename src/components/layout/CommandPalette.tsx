import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownToLine,
  Database,
  Download,
  FileDiff,
  FolderOpen,
  FolderX,
  GitBranch,
  GitMerge,
  History,
  LayoutDashboard,
  MapPin,
  RotateCcw,
  Search,
  Settings,
  Terminal,
  TreePine,
  Upload,
  Wrench,
} from "lucide-react";

import { revealInFileManager } from "@/lib/api";
import { tryRun } from "@/lib/op";
import { cn } from "@/lib/utils";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { HELP } from "@/lib/help";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useActions } from "@/hooks/useActions";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { useConfigStore } from "@/store/config";
import { useRepoBrowserStore } from "@/store/repoBrowser";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  keywords?: string;
  section: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setPalette = useUiStore((s) => s.setPalette);
  const setView = useUiStore((s) => s.setView);
  const setCheckout = useUiStore((s) => s.setCheckout);
  const setCreateBranch = useUiStore((s) => s.setCreateBranch);
  const wc = useSelectedWc();
  const refresh = useWorkspaceStore((s) => s.refresh);
  const baseDir = useWorkspaceStore((s) => s.baseDir);
  const projects = useConfigStore((s) => s.config?.projects ?? []);
  const openRepoDialog = useRepoBrowserStore((s) => s.openDialog);
  const { update, cleanup, revertAll, switchTo, closeFolder } = useActions();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  const commands = useMemo<Command[]>(() => {
    const close = (fn: () => void) => () => {
      setPalette(false);
      fn();
    };
    const list: Command[] = [
      {
        id: "nav-overview",
        title: "Ir para Visão geral",
        icon: <LayoutDashboard className="size-4" />,
        section: "Navegação",
        run: close(() => setView("overview")),
      },
      {
        id: "nav-repos",
        title: "Abrir Navegador de Repositórios",
        icon: <Database className="size-4" />,
        keywords: "repositorio repos navegar arvore remoto svn repositories",
        section: "Navegação",
        run: close(() => setView("repos")),
      },
      {
        id: "nav-log",
        title: "Abrir Registro de comandos",
        icon: <Terminal className="size-4" />,
        keywords: "registro log comandos svn auditoria historico terminal",
        section: "Navegação",
        run: close(() => setView("log")),
      },
      {
        id: "checkout",
        title: "Baixar projeto (checkout)",
        icon: <Download className="size-4" />,
        keywords: "clone baixar checkout novo",
        section: "Repositório",
        run: close(() => setCheckout(true)),
      },
      {
        id: "add-location",
        title: "Adicionar localização de repositório",
        icon: <MapPin className="size-4" />,
        keywords: "localizacao nova url repositorio cadastrar",
        section: "Repositório",
        run: close(() => {
          setView("repos");
          openRepoDialog("location", null);
        }),
      },
      {
        id: "refresh",
        title: "Recarregar working copies",
        icon: <FolderOpen className="size-4" />,
        keywords: "atualizar detectar reload",
        section: "Repositório",
        run: close(() => refresh()),
      },
      ...(baseDir
        ? [
            {
              id: "close-folder",
              title: "Fechar pasta de trabalho",
              icon: <FolderX className="size-4" />,
              keywords: "sair fechar limpar pasta trabalho sem nenhuma vazia",
              section: "Repositório",
              run: close(() => closeFolder()),
            },
          ]
        : []),
      {
        id: "settings",
        title: "Abrir configurações",
        icon: <Settings className="size-4" />,
        section: "Navegação",
        run: close(() => setView("settings")),
      },
    ];

    if (wc) {
      list.push(
        {
          id: "view-changes",
          title: "Alterações & commit",
          subtitle: wc.name,
          icon: <FileDiff className="size-4" />,
          section: "Projeto atual",
          run: close(() => setView("changes")),
        },
        {
          id: "view-history",
          title: "Histórico (log)",
          subtitle: wc.name,
          icon: <History className="size-4" />,
          section: "Projeto atual",
          run: close(() => setView("history")),
        },
        {
          id: "view-branches",
          title: "Branches do projeto",
          subtitle: wc.name,
          icon: <GitBranch className="size-4" />,
          section: "Projeto atual",
          run: close(() => setView("branches")),
        },
        {
          id: "view-merge",
          title: "Integração (sync / publicar)",
          subtitle: wc.name,
          icon: <GitMerge className="size-4" />,
          section: "Projeto atual",
          run: close(() => setView("merge")),
        },
        {
          id: "update",
          title: "Atualizar (svn update)",
          subtitle: wc.name,
          icon: <ArrowDownToLine className="size-4" />,
          keywords: "pull receber",
          section: "Ações",
          run: close(() => update(wc)),
        },
        {
          id: "commit",
          title: "Commitar alterações",
          subtitle: wc.name,
          icon: <Upload className="size-4" />,
          keywords: "enviar push",
          section: "Ações",
          run: close(() => setView("changes")),
        },
        {
          id: "branch",
          title: "Criar branch a partir desta WC",
          icon: <GitBranch className="size-4" />,
          keywords: "copy nova branch",
          section: "Ações",
          run: close(() => setCreateBranch(true)),
        },
        {
          id: "cleanup",
          title: "Limpar / destravar (cleanup)",
          icon: <Wrench className="size-4" />,
          section: "Ações",
          run: close(() => cleanup(wc)),
        },
        {
          id: "revert",
          title: "Reverter todas as alterações",
          icon: <RotateCcw className="size-4" />,
          keywords: "descartar desfazer",
          section: "Ações",
          run: close(() => revertAll(wc)),
        },
        {
          id: "reveal",
          title: "Abrir pasta no sistema",
          icon: <FolderOpen className="size-4" />,
          section: "Ações",
          run: close(() => tryRun(() => revealInFileManager(wc.path), "Não consegui abrir o gerenciador de arquivos")),
        },
      );

      if (wc.kind !== "trunk" && wc.projectKey) {
        const proj = projects.find((p) => p.key === wc.projectKey);
        if (proj) {
          list.push({
            id: "switch-trunk",
            title: "Voltar para a linha principal (trunk)",
            icon: <TreePine className="size-4" />,
            keywords: "switch trunk main",
            section: "Ações",
            run: close(() => switchTo(wc, proj.url, "trunk")),
          });
        }
      }
    }

    return list;
  }, [wc, baseDir, projects, setPalette, setView, setCheckout, setCreateBranch, openRepoDialog, refresh, update, cleanup, revertAll, switchTo, closeFolder]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.title} ${c.subtitle ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[active]?.run();
    } else if (e.key === "Escape") {
      setPalette(false);
    }
  };

  let lastSection = "";

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[65] flex items-start justify-center p-4 pt-[12vh]">
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPalette(false)}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal
            aria-label="Paleta de comandos"
            onKeyDown={(e) => {
              if (e.key === "Escape") setPalette(false);
            }}
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-panel shadow-pop"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search className="size-4 text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Buscar comando…"
                className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint selectable"
                role="combobox"
                aria-expanded
                aria-controls="palette-list"
                aria-activedescendant={
                  filtered.length > 0 ? `palette-opt-${active}` : undefined
                }
                aria-label="Buscar comando"
              />
              <HelpPopover content={HELP.commandPalette} />
            </div>
            <div id="palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
              {filtered.length === 0 && (
                <div className="py-10 text-center text-sm text-faint">Nenhum comando encontrado</div>
              )}
              {filtered.map((c, i) => {
                const showSection = c.section !== lastSection;
                lastSection = c.section;
                return (
                  <div key={c.id}>
                    {showSection && (
                      <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                        {c.section}
                      </div>
                    )}
                    <button
                      id={`palette-opt-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => c.run()}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                        i === active ? "bg-brand/12" : "hover:bg-panel-2",
                      )}
                    >
                      <span className={cn("text-muted", i === active && "text-brand")}>
                        {c.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {c.title}
                        </span>
                        {c.subtitle && (
                          <span className="block truncate text-[11px] text-faint">{c.subtitle}</span>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
