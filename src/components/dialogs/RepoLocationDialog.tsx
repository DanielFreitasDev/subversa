/**
 * Cadastro/edição de uma localização (raiz de repositório) do navegador. Aceita
 * só o nome (→ `repoBase + nome`) ou a URL completa, valida com `getUrlInfo`
 * antes de salvar e persiste em `repoRoots`.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Database } from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { decodeUrl } from "@/lib/utils";
import { useConfigStore } from "@/store/config";
import { useRepoBrowserStore } from "@/store/repoBrowser";
import { toast } from "@/store/toast";

function joinBase(base: string, name: string) {
  const b = base.endsWith("/") ? base : `${base}/`;
  return `${b}${name.replace(/^\/+/, "")}`;
}

export function RepoLocationDialog() {
  const dialog = useRepoBrowserStore((s) => s.dialog);
  const closeDialog = useRepoBrowserStore((s) => s.closeDialog);
  const setActiveLocation = useRepoBrowserStore((s) => s.setActiveLocation);
  const activeLocation = useRepoBrowserStore((s) => s.activeLocation);
  const config = useConfigStore((s) => s.config);
  const save = useConfigStore((s) => s.save);

  const open = dialog?.kind === "location";
  const editingUrl = dialog?.node?.url ?? null;
  const isEdit = !!editingUrl;

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(editingUrl ? decodeUrl(editingUrl) : "");
      setError(null);
      setBusy(false);
    }
  }, [open, editingUrl]);

  const repoBase = config?.repoBase ?? "";
  const roots = config?.repoRoots ?? [];

  const resolvedUrl = useMemo(() => {
    const v = value.trim();
    if (!v) return "";
    return v.includes("://") ? v : joinBase(repoBase, v);
  }, [value, repoBase]);

  const canSubmit = !!resolvedUrl && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    // Valida que a URL existe/é acessível antes de salvar.
    const info = await api.getUrlInfo(resolvedUrl).catch((e) => {
      setError(String(e));
      return null;
    });
    if (!info) {
      setBusy(false);
      return;
    }
    const duplicate = roots.some((r) => r === resolvedUrl && r !== editingUrl);
    if (duplicate) {
      setError("Essa localização já está cadastrada.");
      setBusy(false);
      return;
    }
    const next = isEdit
      ? roots.map((r) => (r === editingUrl ? resolvedUrl : r))
      : [...roots, resolvedUrl];
    await save({ repoRoots: next });
    if (isEdit && activeLocation === editingUrl) setActiveLocation(resolvedUrl);
    if (!isEdit) setActiveLocation(resolvedUrl);
    setBusy(false);
    closeDialog();
    toast.success(isEdit ? "Localização atualizada" : "Localização adicionada");
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && closeDialog()}
      size="md"
      locked={busy}
      icon={<Database className="size-5" />}
      title={isEdit ? "Editar localização" : "Nova localização"}
      description="Informe o nome do repositório (sob a URL base) ou a URL completa."
      footer={
        <>
          <Button variant="ghost" onClick={() => closeDialog()} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!canSubmit}>
            {!busy && <CheckCircle2 className="size-4" />}
            Validar e salvar
          </Button>
        </>
      }
    >
      <Label hint="Ex.: veiculo  ou  svn+ssh://usuario@host/usr/svn/veiculo">
        Nome ou URL completa
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="veiculo"
          autoFocus
          className="mt-1 font-mono text-[12px]"
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </Label>

      {resolvedUrl && (
        <div className="mt-3 rounded-lg bg-panel-2 px-3 py-2 text-[11px]">
          <span className="text-faint">localização: </span>
          <span className="break-all font-mono text-muted">{decodeUrl(resolvedUrl)}</span>
        </div>
      )}

      {error && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-conflict/30 bg-conflict/10 px-3 py-2 text-[12px] text-conflict">
          {error}
        </div>
      )}
    </Modal>
  );
}
