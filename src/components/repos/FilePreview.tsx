/**
 * Pré-visualização read-only de um arquivo remoto: conteúdo (`svn cat`, com
 * realce via lowlight, o mesmo do diff) e, opcionalmente, autoria (`svn blame`).
 */

import { useEffect, useMemo, useState } from "react";
import { Eye, FileText, ServerCrash, Users } from "lucide-react";

import * as api from "@/lib/api";
import { tokenizeText, type Span } from "@/components/diff/highlight";
import { Empty } from "@/components/ui/Empty";
import { Segmented } from "@/components/ui/Segmented";
import { Loading } from "@/components/ui/Spinner";
import type { BlameLine } from "@/lib/types";
import { decodeUrlSafe } from "@/lib/utils";
import type { RepoNode } from "@/store/repoBrowser";

/** Acima disto não realça/rola tudo (evita travar a UI com arquivos enormes). */
const MAX_LINES = 4000;

type Tab = "content" | "blame";

function SpanRow({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => (
        <span key={i} className={s.className}>
          {s.text}
        </span>
      ))}
    </>
  );
}

export function FilePreview({ node }: { node: RepoNode }) {
  const [tab, setTab] = useState<Tab>("content");
  const [text, setText] = useState<string | null>(null);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reseta ao trocar de arquivo.
  useEffect(() => {
    setTab("content");
  }, [node.url]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (tab === "content") {
          const t = await api.catFile(node.url);
          if (alive) setText(t);
        } else {
          const b = await api.blame(node.url);
          if (alive) setBlame(b);
        }
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [node.url, tab]);

  const lines = useMemo(() => (text != null ? text.split("\n") : []), [text]);
  // Realça o arquivo inteiro de uma vez (preserva strings/comentários
  // multi-linha) em vez de linha a linha; `null` cai para texto puro.
  const highlighted = useMemo(
    () => (text != null ? tokenizeText(text, node.name) : null),
    [text, node.name],
  );
  const truncated = tab === "content" ? lines.length > MAX_LINES : (blame?.length ?? 0) > MAX_LINES;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-faint" />
          <span className="truncate text-[13px] font-medium text-ink" title={decodeUrlSafe(node.url)}>
            {decodeUrlSafe(node.name)}
          </span>
        </div>
        <Segmented<Tab>
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "content", label: "Conteúdo", icon: <Eye className="size-3.5" /> },
            { value: "blame", label: "Autoria", icon: <Users className="size-3.5" /> },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <Loading label={tab === "content" ? "Lendo arquivo…" : "Carregando autoria…"} />
        ) : error ? (
          <Empty icon={<ServerCrash className="size-7" />} title="Não consegui ler o arquivo" description={error} />
        ) : tab === "content" ? (
          <pre className="selectable min-w-full px-0 py-2 font-mono text-[12px] leading-relaxed">
            {lines.slice(0, MAX_LINES).map((ln, i) => (
              <div key={i} className="flex hover:bg-panel-2/50">
                <span className="select-none px-3 text-right text-faint/60" style={{ minWidth: 56 }}>
                  {i + 1}
                </span>
                <code className="whitespace-pre px-2 text-ink">
                  {highlighted ? <SpanRow spans={highlighted[i] ?? []} /> : ln}
                </code>
              </div>
            ))}
          </pre>
        ) : (
          <div className="py-2 font-mono text-[12px] leading-relaxed">
            {(blame ?? []).slice(0, MAX_LINES).map((b) => (
              <div key={b.lineNumber} className="flex hover:bg-panel-2/50">
                <span className="select-none px-2 text-right text-faint/60" style={{ minWidth: 48 }}>
                  {b.lineNumber}
                </span>
                <span
                  className="select-none truncate px-2 text-right text-brand"
                  style={{ minWidth: 56 }}
                  title={b.author ?? ""}
                >
                  r{b.revision ?? "?"}
                </span>
                <span
                  className="select-none truncate px-2 text-faint"
                  style={{ minWidth: 110 }}
                  title={b.author ?? ""}
                >
                  {b.author ?? "—"}
                </span>
                <code className="whitespace-pre px-2 text-ink">{b.content}</code>
              </div>
            ))}
          </div>
        )}
        {truncated && (
          <div className="border-t border-line px-4 py-2 text-center text-[11px] text-faint">
            Mostrando as primeiras {MAX_LINES.toLocaleString("pt-BR")} linhas.
          </div>
        )}
      </div>
    </div>
  );
}
