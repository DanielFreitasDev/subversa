import { useEffect, useState } from "react";
import { FolderGit2, Server, GitCommitVertical } from "lucide-react";

import { svnVersion } from "@/lib/api";
import { formatRelative } from "@/lib/utils";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { useConfigStore } from "@/store/config";

export function StatusBar() {
  const wc = useSelectedWc();
  const host = useConfigStore((s) => s.config?.host);
  const [version, setVersion] = useState("");

  useEffect(() => {
    svnVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-faint">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-success" />
        <span>SVN {version || "—"}</span>
      </div>
      {host && (
        <div className="flex items-center gap-1.5">
          <Server className="size-3" />
          <span className="max-w-[240px] truncate">{host}</span>
        </div>
      )}
      <div className="flex-1" />
      {wc && (
        <>
          <div className="flex items-center gap-1.5">
            <FolderGit2 className="size-3" />
            <span className="max-w-[420px] truncate" title={wc.path}>
              {wc.path}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <GitCommitVertical className="size-3" />
            <span className="font-mono">r{wc.revision}</span>
            {wc.lastChangedAuthor && (
              <span>
                · {wc.lastChangedAuthor} {formatRelative(wc.lastChangedDate)}
              </span>
            )}
          </div>
        </>
      )}
    </footer>
  );
}
