/**
 * Árvore remota lazy do navegador de repositórios. Cada pasta carrega seus
 * filhos via `listDir` só quando expandida (cacheado no store). Botão direito
 * abre o menu de contexto com as ações aplicáveis ao nó.
 */

import {
  ChevronRight,
  File as FileIcon,
  Folder,
  Loader2,
  ServerCrash,
} from "lucide-react";

import { Empty } from "@/components/ui/Empty";
import type { ListEntry } from "@/lib/types";
import { cn, decodeUrl, formatRelative } from "@/lib/utils";
import {
  nodeKind,
  useRepoBrowserStore,
  type RepoNode,
} from "@/store/repoBrowser";

type OnContext = (node: RepoNode, e: React.MouseEvent) => void;

const INDENT = 14;

function Message({ depth, children, tone }: { depth: number; children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      className={cn("flex items-center gap-2 py-1.5 text-[12px]", tone === "error" ? "text-conflict" : "text-faint")}
      style={{ paddingLeft: depth * INDENT + 30 }}
    >
      {children}
    </div>
  );
}

function NodeRow({
  entry,
  parentUrl,
  depth,
  onContext,
}: {
  entry: ListEntry;
  parentUrl: string;
  depth: number;
  onContext: OnContext;
}) {
  const url = `${parentUrl}/${entry.name}`;
  const isDir = entry.kind === "dir";
  const node: RepoNode = { url, name: entry.name, kind: nodeKind(entry.kind) };

  const expanded = useRepoBrowserStore((s) => s.expanded.has(url));
  const selected = useRepoBrowserStore((s) => s.selected?.url === url);
  const toggle = useRepoBrowserStore((s) => s.toggle);
  const select = useRepoBrowserStore((s) => s.select);

  return (
    <>
      <div
        onClick={() => {
          select(node);
          if (isDir && !expanded) toggle(url);
        }}
        onContextMenu={(e) => {
          select(node);
          onContext(node, e);
        }}
        className={cn(
          "group flex cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 transition-colors",
          selected ? "bg-panel-3" : "hover:bg-panel-2",
        )}
        style={{ paddingLeft: depth * INDENT + 6 }}
      >
        {isDir ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggle(url);
            }}
            className="flex size-4 shrink-0 items-center justify-center rounded text-faint hover:text-ink"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        {isDir ? (
          <Folder className="size-4 shrink-0 text-info" />
        ) : (
          <FileIcon className="size-4 shrink-0 text-faint" />
        )}
        <span className="truncate text-[13px] text-ink">{decodeUrl(entry.name)}</span>
        {entry.revision && (
          <span className="shrink-0 font-mono text-[10px] text-faint">r{entry.revision}</span>
        )}
        {entry.author && (
          <span className="ml-auto hidden shrink-0 text-[11px] text-faint group-hover:inline md:inline">
            {entry.author} · {formatRelative(entry.date)}
          </span>
        )}
      </div>
      {isDir && expanded && <Level parentUrl={url} depth={depth + 1} onContext={onContext} />}
    </>
  );
}

function Level({ parentUrl, depth, onContext }: { parentUrl: string; depth: number; onContext: OnContext }) {
  const entries = useRepoBrowserStore((s) => s.tree.get(parentUrl));
  const loading = useRepoBrowserStore((s) => s.loadingUrls.has(parentUrl));
  const error = useRepoBrowserStore((s) => s.errors.get(parentUrl));

  if (loading && !entries) {
    return (
      <Message depth={depth}>
        <Loader2 className="size-3.5 animate-spin" />
        Carregando…
      </Message>
    );
  }
  if (error) {
    return (
      <Message depth={depth} tone="error">
        <ServerCrash className="size-3.5" />
        <span className="truncate" title={error}>
          {error}
        </span>
      </Message>
    );
  }
  if (entries && entries.length === 0) {
    return <Message depth={depth}>pasta vazia</Message>;
  }
  return (
    <>
      {entries?.map((e) => (
        <NodeRow key={e.name} entry={e} parentUrl={parentUrl} depth={depth} onContext={onContext} />
      ))}
    </>
  );
}

export function RepoTree({ onContext }: { onContext: OnContext }) {
  const location = useRepoBrowserStore((s) => s.activeLocation);

  if (!location) {
    return (
      <Empty
        icon={<Folder className="size-7" />}
        title="Selecione uma localização"
        description="Escolha um repositório à esquerda para navegar a árvore remota."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
      <Level parentUrl={location} depth={0} onContext={onContext} />
    </div>
  );
}
