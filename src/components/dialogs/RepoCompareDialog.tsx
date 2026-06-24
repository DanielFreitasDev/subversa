/**
 * "Comparar com…": diff entre o nó selecionado e outra URL (ou `URL@REV`), via
 * `diffUrls`, renderizado pelo `DiffViewer` (reuso direto, com o mesmo modo
 * unificado/lado-a-lado das demais telas).
 */

import { useEffect, useState } from "react";
import { GitCompareArrows, Search } from "lucide-react";

import * as api from "@/lib/api";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Loading } from "@/components/ui/Spinner";
import { HELP } from "@/lib/help";
import { decodeUrl } from "@/lib/utils";
import { useRepoBrowserStore } from "@/store/repoBrowser";

export function RepoCompareDialog() {
  const dialog = useRepoBrowserStore((s) => s.dialog);
  const closeDialog = useRepoBrowserStore((s) => s.closeDialog);

  const open = dialog?.kind === "compare";
  const node = dialog?.node ?? null;
  const base = node?.url ?? "";

  const [other, setOther] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ignoreWs, setIgnoreWs] = useState(false);

  useEffect(() => {
    if (open) {
      setOther(decodeUrl(base));
      setApplied(null);
      setDiff("");
      setError(null);
      setIgnoreWs(false);
    }
  }, [open, base]);

  useEffect(() => {
    if (!applied) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .diffUrls(base, applied, ignoreWs)
      .then((d) => alive && setDiff(d))
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [applied, ignoreWs, base]);

  if (!open || !node) return null;

  return (
    <Modal
      open={open}
      onClose={closeDialog}
      size="xl"
      icon={<GitCompareArrows className="size-5" />}
      title="Comparar com…"
      description={`Base: ${decodeUrl(base)}`}
      help={HELP.compare}
      className="max-w-6xl"
    >
      <div className="flex h-[72vh] flex-col">
        <div className="flex items-center gap-2 pb-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && other.trim() && setApplied(other.trim())}
              placeholder="outra URL ou URL@REV"
              className="h-9 pl-8 font-mono text-[12px]"
              autoFocus
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => other.trim() && setApplied(other.trim())}
            disabled={!other.trim()}
          >
            Comparar
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-canvas/40 p-3">
          {!applied ? (
            <div className="flex h-full items-center justify-center text-sm text-faint">
              Informe a outra URL e clique em Comparar.
            </div>
          ) : loading ? (
            <Loading label="Gerando diff…" />
          ) : error ? (
            <div className="whitespace-pre-wrap p-4 text-[13px] text-conflict">{error}</div>
          ) : (
            <DiffViewer text={diff} ignoreWs={ignoreWs} onToggleIgnoreWs={setIgnoreWs} />
          )}
        </div>
      </div>
    </Modal>
  );
}
