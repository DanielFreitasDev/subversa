import { useMemo } from "react";
import { diffWordsWithSpace } from "diff";
import { FileText, Minus, Plus } from "lucide-react";

import { parseUnifiedDiff, type DiffFile, type DiffHunk, type DiffLine } from "@/lib/diff";
import { cn } from "@/lib/utils";

interface Segment {
  text: string;
  changed: boolean;
}

interface Row {
  line: DiffLine;
  segments: Segment[];
}

/** Constrói as linhas do hunk com realce de palavra nos pares -/+. */
function buildRows(hunk: DiffHunk): Row[] {
  const rows: Row[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];

  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i];
      const a = adds[i];
      if (d && a) {
        const parts = diffWordsWithSpace(d.content, a.content);
        rows.push({
          line: d,
          segments: parts
            .filter((p) => !p.added)
            .map((p) => ({ text: p.value, changed: !!p.removed })),
        });
        rows.push({
          line: a,
          segments: parts
            .filter((p) => !p.removed)
            .map((p) => ({ text: p.value, changed: !!p.added })),
        });
      } else if (d) {
        rows.push({ line: d, segments: [{ text: d.content, changed: false }] });
      } else if (a) {
        rows.push({ line: a, segments: [{ text: a.content, changed: false }] });
      }
    }
    dels = [];
    adds = [];
  };

  for (const line of hunk.lines) {
    if (line.type === "del") dels.push(line);
    else if (line.type === "add") adds.push(line);
    else {
      flush();
      rows.push({ line, segments: [{ text: line.content, changed: false }] });
    }
  }
  flush();
  return rows;
}

function LineRow({ row }: { row: Row }) {
  const { line, segments } = row;
  const bg =
    line.type === "add"
      ? "bg-add/10"
      : line.type === "del"
        ? "bg-del/10"
        : "";
  const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  const signColor =
    line.type === "add" ? "text-add" : line.type === "del" ? "text-del" : "text-faint";

  return (
    <div className={cn("flex font-mono text-[12.5px] leading-[1.55]", bg)}>
      <span className="w-12 shrink-0 select-none border-r border-line/60 px-2 text-right text-faint">
        {line.oldNumber ?? ""}
      </span>
      <span className="w-12 shrink-0 select-none border-r border-line/60 px-2 text-right text-faint">
        {line.newNumber ?? ""}
      </span>
      <span className={cn("w-5 shrink-0 select-none text-center", signColor)}>{sign}</span>
      <code className="selectable whitespace-pre-wrap break-words pr-3">
        {segments.map((s, i) => (
          <span
            key={i}
            className={cn(
              s.changed &&
                (line.type === "add"
                  ? "rounded-sm bg-add/30 text-ink"
                  : "rounded-sm bg-del/30 text-ink"),
            )}
          >
            {s.text}
          </span>
        ))}
      </code>
    </div>
  );
}

function FileBlock({ file }: { file: DiffFile }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-2">
        <FileText className="size-3.5 shrink-0 text-faint" />
        <span className="selectable truncate font-mono text-[12.5px] text-ink">{file.path}</span>
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {file.additions > 0 && (
            <span className="flex items-center gap-0.5 text-add">
              <Plus className="size-3" />
              {file.additions}
            </span>
          )}
          {file.deletions > 0 && (
            <span className="flex items-center gap-0.5 text-del">
              <Minus className="size-3" />
              {file.deletions}
            </span>
          )}
        </div>
      </div>

      {file.binary ? (
        <div className="px-3 py-4 text-[13px] text-muted">Arquivo binário — diff não exibido.</div>
      ) : file.hunks.length === 0 ? (
        <div className="px-3 py-4 text-[13px] text-faint">
          {file.notes.length ? file.notes.join("\n") : "Sem alterações de texto."}
        </div>
      ) : (
        <div className="overflow-x-auto bg-panel">
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              <div className="bg-info/10 px-3 py-1 font-mono text-[11px] text-info">{hunk.header}</div>
              {buildRows(hunk).map((row, ri) => (
                <LineRow key={ri} row={row} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DiffViewer({ text, className }: { text: string; className?: string }) {
  const files = useMemo(() => parseUnifiedDiff(text), [text]);

  if (!text.trim()) {
    return <div className="px-3 py-6 text-center text-sm text-faint">Sem diferenças.</div>;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {files.map((file, i) => (
        <FileBlock key={i} file={file} />
      ))}
    </div>
  );
}
