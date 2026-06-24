import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { Check, Download, FolderDown, FolderOpen, Link2 } from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { reportOutput, tryRun } from "@/lib/op";
import { HELP } from "@/lib/help";
import { TransferProgress } from "@/components/feedback/TransferProgress";
import type { OpProgress } from "@/lib/types";
import { cn, decodeUrl } from "@/lib/utils";
import { useConfigStore } from "@/store/config";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";

export function CheckoutDialog() {
  const open = useUiStore((s) => s.checkoutOpen);
  const checkoutUrl = useUiStore((s) => s.checkoutUrl);
  const setOpen = useUiStore((s) => s.setCheckout);
  const setView = useUiStore((s) => s.setView);
  const projects = useConfigStore((s) => s.config?.projects ?? []);
  const saveConfig = useConfigStore((s) => s.save);
  const { baseDir, workingCopies, refresh, select, setBaseDir } = useWorkspaceStore();

  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OpProgress | null>(null);

  useEffect(() => {
    if (open) {
      setProgress(null);
      if (checkoutUrl) {
        // Veio do navegador de repositórios: pré-preenche modo "Outra URL".
        const decoded = decodeUrl(checkoutUrl);
        setMode("custom");
        setCustomUrl(decoded);
        setName(decoded.replace(/\/+$/, "").split("/").pop() ?? "");
      } else {
        setMode("preset");
        const first = projects[0];
        setPresetKey(first?.key ?? null);
        setName(first?.key ?? "");
        setCustomUrl("");
      }
    }
  }, [open, projects, checkoutUrl]);

  const url = mode === "preset" ? projects.find((p) => p.key === presetKey)?.url ?? "" : customUrl.trim();
  const dest = `${baseDir.replace(/\/$/, "")}/${name.trim()}`;
  const isDownloaded = (key: string) => workingCopies.some((w) => w.name === key);
  // Sem pasta de trabalho (ex.: após fechá-la) é preciso escolher o destino
  // primeiro — senão o checkout iria para "/nome" na raiz.
  const canSubmit = useMemo(
    () => !!url && !!name.trim() && !!baseDir && !busy,
    [url, name, baseDir, busy],
  );

  // Deixa o usuário navegar pelo sistema e escolher onde baixar. A pasta
  // escolhida vira a pasta de trabalho (igual ao seletor da barra lateral),
  // então o projeto recém-baixado aparece na lista de projetos.
  const chooseDestFolder = async () => {
    const dir = await openDialog({ directory: true, defaultPath: baseDir || undefined });
    if (typeof dir === "string") {
      setBaseDir(dir);
      await saveConfig({ baseDir: dir });
      refresh(dir);
    }
  };

  const doCheckout = async () => {
    if (!canSubmit) return;
    setBusy(true);
    // Mostra a barra imediatamente; o backend emite `op-progress` por arquivo
    // baixado (sem total conhecido — contador + caminho atual). Filtra pela
    // operação de checkout e ignora o evento final `done` (limpamos ao resolver).
    setProgress({ id: -1, op: "checkout", count: 0, path: "", done: false });
    const unlisten = await listen<OpProgress>("op-progress", (e) => {
      if (e.payload.op === "checkout" && !e.payload.done) setProgress(e.payload);
    });
    const out = await tryRun(() => api.checkout(url, dest), "Falha no checkout");
    unlisten();
    setBusy(false);
    setProgress(null);
    if (out && reportOutput(out, "Projeto baixado", name)) {
      setOpen(false);
      await refresh();
      // Seleciona a WC recém-baixada lendo a lista já atualizada. Casa por path
      // exato e, se a normalização do backend divergir (barra final/symlink),
      // por nome do destino ou prefixo do caminho — evita cair numa tela vazia.
      const leaf = name.trim();
      const wcs = useWorkspaceStore.getState().workingCopies;
      const match =
        wcs.find((w) => w.path === dest) ??
        wcs.find((w) => w.name === leaf) ??
        wcs.find((w) => w.path.startsWith(dest));
      if (match) select(match.path);
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
      help={HELP.checkout}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={doCheckout} loading={busy} disabled={!canSubmit}>
            {!busy && <FolderDown className="size-4" />}
            {busy ? "Baixando…" : "Baixar"}
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                doCheckout();
              }
            }}
            placeholder="svn+ssh://usuario@host/caminho/projeto"
            className="mt-1 font-mono text-[12px]"
            autoFocus
          />
        </Label>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <span className="text-xs font-medium text-muted">Baixar em</span>
          <button
            type="button"
            onClick={chooseDestFolder}
            disabled={busy}
            title={baseDir}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-panel-3 disabled:pointer-events-none disabled:opacity-50"
          >
            <FolderOpen className="size-4 shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
              {baseDir || "escolher pasta…"}
            </span>
            <span className="shrink-0 text-[11px] text-faint">Procurar…</span>
          </button>
        </div>
        <Label>
          Nome da pasta
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                doCheckout();
              }
            }}
            className="mt-1"
          />
        </Label>
      </div>
      {busy && progress ? (
        <TransferProgress
          label="Baixando"
          count={progress.count}
          path={progress.path}
          base={dest}
          className="mt-4 rounded-lg border border-line bg-panel-2 px-3 py-3"
        />
      ) : (
        url && (
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
        )
      )}
    </Modal>
  );
}
