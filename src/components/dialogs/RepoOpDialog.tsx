/**
 * Diálogo único, parametrizado por `dialog.kind`, para as 5 operações do
 * navegador que compartilham o esqueleto "campo(s) + (msg de commit) → confirma
 * → run → toast → refresh": `mkdir`, `move`, `branchTag`, `import`, `export`.
 *
 * As 4 primeiras escrevem no servidor (pedem mensagem de commit); `export` grava
 * só em disco (sem mensagem).
 */

import { useEffect, useMemo, useState } from "react";
import { open as openFolder } from "@tauri-apps/plugin-dialog";
import {
  FolderDown,
  FolderInput,
  FolderPlus,
  GitBranch,
  HardDriveDownload,
  Tag,
} from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Label, Switch, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { REPO_OP_HELP } from "@/lib/help";
import { extractRevision, reportOutput, tryRun } from "@/lib/op";
import { baseName, decodeUrl, decodeUrlSafe } from "@/lib/utils";
import { useRepoBrowserStore } from "@/store/repoBrowser";

const MONTHS = [
  "JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO",
];

const OP_KINDS = ["mkdir", "move", "branchTag", "import", "export"] as const;
type OpKind = (typeof OP_KINDS)[number];

const META: Record<OpKind, { title: string; icon: React.ReactNode; submit: string }> = {
  mkdir: { title: "Nova pasta remota", icon: <FolderPlus className="size-5" />, submit: "Criar pasta" },
  move: { title: "Mover ou Renomear", icon: <FolderInput className="size-5" />, submit: "Mover" },
  branchTag: { title: "Criar Branch ou Tag", icon: <GitBranch className="size-5" />, submit: "Criar" },
  import: { title: "Importar pasta", icon: <FolderDown className="size-5" />, submit: "Importar" },
  export: { title: "Exportar", icon: <HardDriveDownload className="size-5" />, submit: "Exportar" },
};

function parentOf(url: string) {
  const i = url.lastIndexOf("/");
  return i > 0 ? url.slice(0, i) : url;
}

export function RepoOpDialog() {
  const dialog = useRepoBrowserStore((s) => s.dialog);
  const closeDialog = useRepoBrowserStore((s) => s.closeDialog);
  const refresh = useRepoBrowserStore((s) => s.refresh);
  const select = useRepoBrowserStore((s) => s.select);
  const activeLocation = useRepoBrowserStore((s) => s.activeLocation);

  const kind = dialog?.kind as OpKind | undefined;
  const node = dialog?.node ?? null;
  const open = !!kind && (OP_KINDS as readonly string[]).includes(kind) && !!node;

  // Campos (todos resetados ao abrir).
  const [text, setText] = useState(""); // mkdir: nome · branchTag: descrição · import: nome alvo
  const [url, setUrl] = useState(""); // move: URL destino · branchTag: URL manual
  const [message, setMessage] = useState("");
  const [tagMode, setTagMode] = useState<"branch" | "tag">("branch");
  const [editUrl, setEditUrl] = useState(false);
  const [localPath, setLocalPath] = useState(""); // import: pasta local
  const [dest, setDest] = useState(""); // export: pasta destino escolhida
  const [force, setForce] = useState(false);
  const [revision, setRevision] = useState("");
  const [busy, setBusy] = useState(false);

  const leaf = node ? decodeUrl(baseName(node.url)) : "";
  const locDecoded = decodeUrl(activeLocation ?? "");

  // Sugestão de URL para branch/tag (convenção do repositório).
  const suggestion = useMemo(() => {
    if (kind !== "branchTag" || !node) return "";
    const desc = text.trim() || "minha_issue";
    if (tagMode === "tag") return `${locDecoded}/tags/${desc}`;
    const now = new Date();
    const year = now.getFullYear();
    const nn = String(now.getMonth() + 1).padStart(2, "0");
    const mes = MONTHS[now.getMonth()];
    return `${locDecoded}/branches/ISSUES ${year}/${nn} - ${mes}/${desc}/${leaf}`;
  }, [kind, node, text, tagMode, locDecoded, leaf]);

  useEffect(() => {
    if (!open) return;
    setText("");
    setMessage("");
    setTagMode("branch");
    setEditUrl(false);
    setLocalPath("");
    setDest("");
    setForce(false);
    setRevision("");
    setBusy(false);
    setUrl(kind === "move" && node ? decodeUrl(node.url) : "");
  }, [open, kind, node]);

  // Mantém o campo de URL do branch/tag em dia com a sugestão (até editar à mão).
  useEffect(() => {
    if (kind === "branchTag" && !editUrl) setUrl(suggestion);
  }, [kind, suggestion, editUrl]);

  if (!open || !node || !kind) return null;

  const meta = META[kind];

  // Valores derivados e validação por tipo.
  const mkdirUrl = `${node.url}/${text.trim()}`;
  const importTargetUrl = `${node.url}/${text.trim()}`;
  const exportDest = dest ? `${dest}/${leaf}` : "";
  const needsMessage = kind !== "export";
  // No move, o destino deve ficar na mesma localização — comparado por fronteira
  // de segmento e com encoding normalizado (evita bloquear destino válido e
  // evita liberar repo de prefixo parecido, ex.: veiculo × veiculo2).
  const sameRepo =
    kind !== "move" ||
    (!!activeLocation &&
      (() => {
        const dest = decodeUrlSafe(url.trim());
        const root = decodeUrlSafe(activeLocation);
        const prefix = root.endsWith("/") ? root : `${root}/`;
        return dest === root || dest.startsWith(prefix);
      })());

  const canSubmit = (() => {
    if (busy) return false;
    if (needsMessage && !message.trim()) return false;
    switch (kind) {
      case "mkdir":
        return !!text.trim();
      case "move":
        return !!url.trim() && url.trim() !== decodeUrl(node.url) && sameRepo;
      case "branchTag":
        return !!text.trim() && !!url.trim();
      case "import":
        return !!localPath && !!text.trim();
      case "export":
        return !!dest;
    }
  })();

  const pickFolder = async (forImport: boolean) => {
    const dir = await openFolder({ directory: true });
    if (typeof dir !== "string") return;
    if (forImport) {
      setLocalPath(dir);
      if (!text.trim()) setText(dir.replace(/\/+$/, "").split("/").pop() ?? "");
    } else {
      setDest(dir);
    }
  };

  const run = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      let out = null;
      let okTitle = "";
      switch (kind) {
        case "mkdir":
          out = await tryRun(() => api.makeDir(mkdirUrl, message.trim()), "Falha ao criar pasta");
          okTitle = "Pasta criada";
          break;
        case "move":
          out = await tryRun(
            () => api.moveRemote(node.url, url.trim(), message.trim()),
            "Falha ao mover",
          );
          okTitle = "Movido";
          break;
        case "branchTag":
          out = await tryRun(
            () => api.createBranch(node.url, url.trim(), message.trim()),
            "Falha ao criar",
          );
          okTitle = tagMode === "tag" ? "Tag criada" : "Branch criada";
          break;
        case "import":
          out = await tryRun(
            () => api.importPath(localPath, importTargetUrl, message.trim()),
            "Falha ao importar",
          );
          okTitle = "Importado";
          break;
        case "export":
          out = await tryRun(
            () => api.exportPath(node.url, exportDest, force, revision.trim() || undefined),
            "Falha ao exportar",
          );
          okTitle = "Exportado";
          break;
      }
      if (!out) return;
      const rev = extractRevision(out.stdout);
      if (!reportOutput(out, okTitle, rev ? `r${rev}` : undefined)) return;

      // Refresh + seleção conforme a operação.
      if (kind === "mkdir" || kind === "import") {
        await refresh(node.url);
      } else if (kind === "move") {
        await refresh(parentOf(node.url));
        const dstParent = parentOf(url.trim());
        if (dstParent !== parentOf(node.url)) await refresh(dstParent);
        select({ url: url.trim(), name: baseName(url.trim()), kind: node.kind });
      } else if (kind === "branchTag") {
        // Recarrega o pai real do nó criado e o seleciona (o destino pode estar
        // vários níveis abaixo de branches/tags).
        const created = url.trim();
        await refresh(parentOf(created));
        select({ url: created, name: baseName(created), kind: "dir" });
      }
      closeDialog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && closeDialog()}
      size="lg"
      locked={busy}
      icon={meta.icon}
      title={meta.title}
      description={`${node.kind === "dir" ? "Pasta" : "Arquivo"}: ${leaf}`}
      help={REPO_OP_HELP[kind]}
      footer={
        <>
          <Button variant="ghost" onClick={() => closeDialog()} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={run} loading={busy} disabled={!canSubmit}>
            {meta.submit}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {kind === "mkdir" && (
          <>
            <Label hint="Cria sob a pasta atual (use / para subpastas; --parents).">
              Nome da nova pasta
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    run();
                  }
                }}
                placeholder="nova_pasta"
                autoFocus
                className="mt-1"
              />
            </Label>
            {text.trim() && (
              <div className="break-all rounded-lg bg-panel-2 px-3 py-2 font-mono text-[11px] text-muted">
                {decodeUrlSafe(mkdirUrl)}
              </div>
            )}
          </>
        )}

        {kind === "move" && (
          <>
            <Label hint="Edite a URL de destino (renomear = mudar só o final).">
              URL de destino
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    run();
                  }
                }}
                autoFocus
                className="mt-1 font-mono text-[12px]"
              />
            </Label>
            {!sameRepo && (
              <div className="rounded-lg border border-conflict/30 bg-conflict/10 px-3 py-2 text-[12px] text-conflict">
                O destino precisa ficar na mesma localização/repositório.
              </div>
            )}
          </>
        )}

        {kind === "branchTag" && (
          <>
            <Segmented
              value={tagMode}
              onChange={setTagMode}
              options={[
                { value: "branch", label: "Branch", icon: <GitBranch className="size-3.5" /> },
                { value: "tag", label: "Tag", icon: <Tag className="size-3.5" /> },
              ]}
            />
            <Label hint={tagMode === "tag" ? "Vira tags/<descrição>." : "Vira branches/ISSUES …/<descrição>/<projeto>."}>
              Descrição
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    run();
                  }
                }}
                placeholder="issue_1234"
                autoFocus
                className="mt-1"
              />
            </Label>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">URL de destino</span>
                <button
                  onClick={() => setEditUrl((v) => !v)}
                  className="text-[11px] text-brand hover:underline"
                >
                  {editUrl ? "usar sugestão" : "editar manualmente"}
                </button>
              </div>
              {editUrl ? (
                <Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-[12px]" />
              ) : (
                <div className="break-all rounded-lg bg-panel-2 px-3 py-2 font-mono text-[12px] text-muted">
                  {url}
                </div>
              )}
            </div>
          </>
        )}

        {kind === "import" && (
          <>
            <div>
              <span className="text-xs font-medium text-muted">Pasta local a importar</span>
              <div className="mt-1 flex items-center gap-2">
                <Input value={localPath} readOnly placeholder="escolha uma pasta…" className="flex-1 font-mono text-[12px]" />
                <Button variant="outline" size="sm" onClick={() => pickFolder(true)}>
                  Escolher
                </Button>
              </div>
            </div>
            <Label hint="Nome do item criado no servidor (sob a pasta atual).">
              Nome no servidor
              <Input value={text} onChange={(e) => setText(e.target.value)} className="mt-1" />
            </Label>
            {text.trim() && (
              <div className="break-all rounded-lg bg-panel-2 px-3 py-2 font-mono text-[11px] text-muted">
                {decodeUrlSafe(importTargetUrl)}
              </div>
            )}
          </>
        )}

        {kind === "export" && (
          <>
            <div>
              <span className="text-xs font-medium text-muted">Pasta de destino</span>
              <div className="mt-1 flex items-center gap-2">
                <Input value={dest} readOnly placeholder="escolha uma pasta…" className="flex-1 font-mono text-[12px]" />
                <Button variant="outline" size="sm" onClick={() => pickFolder(false)}>
                  Escolher
                </Button>
              </div>
              {exportDest && (
                <div className="mt-2 break-all rounded-lg bg-panel-2 px-3 py-2 font-mono text-[11px] text-muted">
                  {exportDest}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Label hint="Vazio = HEAD.">
                Revisão (opcional)
                <Input value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="HEAD" className="mt-1 font-mono text-[12px]" />
              </Label>
              <div className="flex items-end justify-between rounded-lg border border-line px-3 py-2.5">
                <div>
                  <div className="text-[13px] font-medium text-ink">Forçar (--force)</div>
                  <div className="text-[11px] text-faint">Sobrescreve pasta não-vazia.</div>
                </div>
                <Switch checked={force} onChange={setForce} />
              </div>
            </div>
          </>
        )}

        {needsMessage && (
          <Label hint="Vira a mensagem do commit no servidor.">
            Mensagem
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="descreva a alteração…"
              className="mt-1"
            />
          </Label>
        )}
      </div>
    </Modal>
  );
}
