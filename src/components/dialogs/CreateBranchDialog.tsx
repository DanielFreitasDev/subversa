import { useEffect, useMemo, useState } from "react";
import { GitBranch, Pencil } from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Label, Switch } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { extractRevision, reportOutput, tryRun } from "@/lib/op";
import { baseName, decodeUrl } from "@/lib/utils";
import { toast } from "@/store/toast";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";

const MONTHS = [
  "JANEIRO",
  "FEVEREIRO",
  "MARCO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
];

export function CreateBranchDialog() {
  const open = useUiStore((s) => s.createBranchOpen);
  const setOpen = useUiStore((s) => s.setCreateBranch);
  const wc = useSelectedWc();
  const refreshOne = useWorkspaceStore((s) => s.refreshOne);

  const [desc, setDesc] = useState("");
  const [editUrl, setEditUrl] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [switchAfter, setSwitchAfter] = useState(true);
  const [busy, setBusy] = useState(false);

  const source = wc ? decodeUrl(wc.url) : "";
  const leaf = baseName(source);

  const suggestion = useMemo(() => {
    if (!wc) return "";
    const now = new Date();
    const year = now.getFullYear();
    const nn = String(now.getMonth() + 1).padStart(2, "0");
    const mes = MONTHS[now.getMonth()];
    const d = desc.trim() || "minha_issue";
    return `${decodeUrl(wc.repoRoot)}/branches/ISSUES ${year}/${nn} - ${mes}/${d}/${leaf}`;
  }, [wc, desc, leaf]);

  useEffect(() => {
    if (open) {
      setDesc("");
      setEditUrl(false);
      setManualUrl("");
      setSwitchAfter(true);
    }
  }, [open]);

  useEffect(() => {
    if (!editUrl) setManualUrl(suggestion);
  }, [suggestion, editUrl]);

  if (!wc) return null;
  const branchUrl = editUrl ? manualUrl.trim() : suggestion;
  const canSubmit = !!desc.trim() && !!branchUrl && !busy;

  const create = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const msg = `criando branch '${desc.trim()}' a partir de ${leaf}`;
      const out = await tryRun(() => api.createBranch(source, branchUrl, msg), "Falha ao criar branch");
      if (!out) return;
      if (!reportOutput(out, "Branch criada", extractRevision(out.stdout) ? `r${extractRevision(out.stdout)}` : undefined)) {
        return;
      }
      if (switchAfter) {
        const sw = await api.switchWc(wc.path, branchUrl);
        if (sw.success) {
          toast.success("Working copy na nova branch", "Os commits agora vão para ela.");
          await refreshOne(wc.path);
        } else {
          reportOutput(sw, "");
        }
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && setOpen(false)}
      size="lg"
      locked={busy}
      icon={<GitBranch className="size-5" />}
      title="Criar branch"
      description={`A partir de ${wc.name} (${wc.kind === "trunk" ? "trunk" : wc.branchLabel})`}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={create} loading={busy} disabled={!canSubmit}>
            {!busy && <GitBranch className="size-4" />}
            Criar branch
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Label hint="Vira uma pasta sob branches/ — ex.: issue_1234">
          Descrição / issue
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                create();
              }
            }}
            placeholder="issue_1234"
            autoFocus
            className="mt-1"
          />
        </Label>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">URL da branch (convenção do repo)</span>
            <button
              onClick={() => setEditUrl((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-brand hover:underline"
            >
              <Pencil className="size-3" />
              {editUrl ? "usar sugestão" : "editar manualmente"}
            </button>
          </div>
          {editUrl ? (
            <Input
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              className="font-mono text-[12px]"
            />
          ) : (
            <div className="break-all rounded-lg bg-panel-2 px-3 py-2 font-mono text-[12px] text-muted">
              {suggestion}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
          <div>
            <div className="text-[13px] font-medium text-ink">Trocar para a branch (switch)</div>
            <div className="text-[11px] text-faint">A WC passa a trabalhar na nova branch.</div>
          </div>
          <Switch checked={switchAfter} onChange={setSwitchAfter} />
        </div>
      </div>
    </Modal>
  );
}
