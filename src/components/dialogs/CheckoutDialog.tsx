import { useEffect, useMemo, useState } from "react";
import { Check, Download, FolderDown, Link2 } from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { reportOutput, tryRun } from "@/lib/op";
import { cn, decodeUrl } from "@/lib/utils";
import { useConfigStore } from "@/store/config";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";

export function CheckoutDialog() {
  const open = useUiStore((s) => s.checkoutOpen);
  const setOpen = useUiStore((s) => s.setCheckout);
  const setView = useUiStore((s) => s.setView);
  const projects = useConfigStore((s) => s.config?.projects ?? []);
  const { baseDir, workingCopies, refresh, select } = useWorkspaceStore();

  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("preset");
      const first = projects[0];
      setPresetKey(first?.key ?? null);
      setName(first?.key ?? "");
      setCustomUrl("");
    }
  }, [open, projects]);

  const url = mode === "preset" ? projects.find((p) => p.key === presetKey)?.url ?? "" : customUrl.trim();
  const dest = `${baseDir.replace(/\/$/, "")}/${name.trim()}`;
  const isDownloaded = (key: string) => workingCopies.some((w) => w.name === key);
  const canSubmit = useMemo(() => !!url && !!name.trim() && !busy, [url, name, busy]);

  const doCheckout = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const out = await tryRun(() => api.checkout(url, dest), "Falha no checkout");
    setBusy(false);
    if (out && reportOutput(out, "Projeto baixado", name)) {
      setOpen(false);
      await refresh();
      select(dest);
      setView("changes");
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && setOpen(false)}
      size="lg"
      locked={busy}
      icon={<Download className="size-5" />}
      title="Baixar projeto (checkout)"
      description="Traz uma cópia de trabalho do servidor para a sua pasta."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={doCheckout} loading={busy} disabled={!canSubmit}>
            {!busy && <FolderDown className="size-4" />}
            Baixar
          </Button>
        </>
      }
    >
      <Segmented
        options={[
          { value: "preset", label: "Meus projetos", icon: <Check className="size-3.5" /> },
          { value: "custom", label: "Outra URL", icon: <Link2 className="size-3.5" /> },
        ]}
        value={mode}
        onChange={setMode}
        className="mb-4"
      />

      {mode === "preset" ? (
        <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
          {projects.map((p) => {
            const downloaded = isDownloaded(p.key);
            const active = presetKey === p.key;
            return (
              <button
                key={p.key}
                onClick={() => {
                  setPresetKey(p.key);
                  setName(p.key);
                }}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  active ? "border-brand/50 bg-brand/10" : "border-line hover:bg-panel-2",
                )}
              >
                <div className="flex w-full items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">{p.name}</span>
                  {downloaded && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-success">
                      <Check className="size-3" /> baixado
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-faint">{p.description}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <Label>
          URL completa (svn+ssh)
          <Input
            value={customUrl}
            onChange={(e) => {
              setCustomUrl(e.target.value);
              if (!name) {
                const leaf = e.target.value.replace(/\/+$/, "").split("/").pop() ?? "";
                setName(leaf);
              }
            }}
            placeholder="svn+ssh://usuario@host/caminho/projeto"
            className="mt-1 font-mono text-[12px]"
            autoFocus
          />
        </Label>
      )}

      <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-3">
        <Label>
          Pasta de destino (nome)
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </Label>
      </div>
      {url && (
        <div className="mt-3 space-y-1 rounded-lg bg-panel-2 px-3 py-2 text-[11px]">
          <div className="flex gap-2">
            <span className="w-12 shrink-0 text-faint">origem</span>
            <span className="truncate font-mono text-muted">{decodeUrl(url)}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-12 shrink-0 text-faint">destino</span>
            <span className="truncate font-mono text-muted">{dest}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
