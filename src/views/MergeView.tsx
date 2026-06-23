import { useState } from "react";
import {
  ArrowDownToLine,
  Eye,
  GitBranch,
  GitMerge,
  Info,
  Loader2,
  TreePine,
  Upload,
} from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { useSelectedWc } from "@/hooks/useSelectedWc";
import { extractRevision, reportOutput, tryRun } from "@/lib/op";
import type { StatusEntry, WorkingCopy } from "@/lib/types";
import { cn, decodeUrl } from "@/lib/utils";
import { confirm } from "@/store/confirm";
import { useConfigStore } from "@/store/config";
import { toast } from "@/store/toast";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";
import { NeedWorkingCopy } from "./_shared";

const DIRTY = ["modified", "added", "deleted", "replaced", "conflicted", "missing"];

/** Item "sujo": mudança de conteúdo, conflito (texto ou árvore) ou só de propriedade. */
function isDirty(e: StatusEntry): boolean {
  return DIRTY.includes(e.item) || e.props === "modified" || e.treeConflicted;
}

function colorForLine(line: string): string {
  const c = line.trim()[0];
  if (c === "U" || c === "G") return "text-info";
  if (c === "A") return "text-add";
  if (c === "D") return "text-del";
  if (c === "C") return "text-conflict font-semibold";
  if (line.startsWith("---") || line.startsWith("Summary")) return "text-faint";
  return "text-muted";
}

function MergeOutput({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[12px] leading-relaxed">
      {text.split("\n").map((l, i) => (
        <div key={i} className={cn("whitespace-pre-wrap selectable", colorForLine(l))}>
          {l || " "}
        </div>
      ))}
    </div>
  );
}

function Card({
  icon,
  title,
  description,
  accent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: "trunk" | "branch" | "neutral";
  children: React.ReactNode;
}) {
  const ring =
    accent === "trunk"
      ? "border-trunk/25"
      : accent === "branch"
        ? "border-branch/25"
        : "border-line";
  return (
    <div className={cn("rounded-xl border bg-panel p-5", ring)}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            accent === "trunk"
              ? "bg-trunk/12 text-trunk"
              : accent === "branch"
                ? "bg-branch/12 text-branch"
                : "bg-brand/12 text-brand",
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Merge({ wc }: { wc: WorkingCopy }) {
  const projects = useConfigStore((s) => s.config?.projects ?? []);
  const confirmServerOps = useConfigStore((s) => s.config?.confirmServerOps ?? true);
  const mainlineUrl = wc.projectKey
    ? projects.find((p) => p.key === wc.projectKey)?.url ?? null
    : null;
  const refreshOne = useWorkspaceStore((s) => s.refreshOne);
  const setView = useUiStore((s) => s.setView);

  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [branchUrl, setBranchUrl] = useState(wc.isMainline ? "" : wc.url);

  const ensureClean = async (): Promise<boolean> => {
    const st = await tryRun(() => api.getStatus(wc.path, false), "Falha ao ler o status");
    if (!st) return false;
    if (st.entries.some(isDirty)) {
      toast.error("Working copy com alterações locais", "Commite ou reverta antes do merge.");
      return false;
    }
    return true;
  };

  // --- Sync: trunk → branch -------------------------------------------------
  const previewSync = async () => {
    if (!mainlineUrl) return;
    setBusy("preview");
    setOutput("");
    const o = await tryRun(() => api.merge(wc.path, mainlineUrl, true, false), "Falha na pré-visualização");
    setBusy(null);
    if (o) {
      setOutput(o.stdout || o.stderr || "Nada para receber — já está em dia.");
      if (!o.success) reportOutput(o, "");
    }
  };

  const runSync = async () => {
    if (busy) return;
    if (!mainlineUrl) return;
    if (confirmServerOps) {
      const ok = await confirm({
        title: "Receber a linha principal?",
        message: `Traz o trunk para a sua branch e commita o merge.\n\nDe: ${decodeUrl(mainlineUrl)}`,
        confirmLabel: "Receber e commitar",
      });
      if (!ok) return;
    }
    if (!(await ensureClean())) return;
    setBusy("sync");
    setOutput("");
    try {
      let o = await api.update(wc.path);
      if (!o.success) return reportOutput(o, "");
      o = await api.merge(wc.path, mainlineUrl, false, false);
      setOutput(o.stdout + (o.stderr ? "\n" + o.stderr : ""));
      if (!o.success) return reportOutput(o, "");

      const st = await tryRun(() => api.getStatus(wc.path, false), "Falha ao ler o status");
      if (!st) return;
      if (st.entries.some((e) => e.item === "conflicted")) {
        toast.warn("O merge gerou conflitos", "Resolva na aba Alterações e commite.");
        await refreshOne(wc.path);
        setView("changes");
        return;
      }
      const changed = st.entries.filter((e) => e.item !== "unversioned");
      if (!changed.length) {
        toast.success("Já estava em dia", "Nada para sincronizar.");
        return;
      }
      const c = await api.commit([wc.path], "sync: trunk → branch");
      if (c.success) {
        const rev = extractRevision(c.stdout);
        toast.success("Branch sincronizada", rev ? `r${rev}` : undefined);
        await refreshOne(wc.path);
      } else reportOutput(c, "");
    } finally {
      setBusy(null);
    }
  };

  // --- Publicar / reintegrar: branch → trunk --------------------------------
  const runPublish = async () => {
    if (busy) return;
    if (!mainlineUrl) {
      toast.error("Projeto não reconhecido", "Não sei qual é a linha principal deste projeto.");
      return;
    }
    const ok = await confirm({
      title: "Publicar na linha principal?",
      message:
        "A working copy será trocada para o trunk, atualizada e a sua branch será mesclada nela. " +
        "Em seguida você revisa e commita na aba Alterações (esse commit publica).",
      confirmLabel: "Iniciar publicação",
    });
    if (!ok) return;
    if (!(await ensureClean())) return;

    const branch = wc.url;
    setBusy("publish");
    setOutput("");
    try {
      let o = await api.switchWc(wc.path, mainlineUrl);
      setOutput(o.stdout + (o.stderr ? "\n" + o.stderr : ""));
      if (!o.success) {
        reportOutput(o, "");
        await refreshOne(wc.path);
        return;
      }
      o = await api.update(wc.path);
      if (!o.success) return reportOutput(o, "");
      o = await api.merge(wc.path, branch, false, false);
      setOutput((p) => p + "\n" + o.stdout + (o.stderr ? "\n" + o.stderr : ""));
      await refreshOne(wc.path);
      if (!o.success) {
        // O switch já foi aplicado: a WC está no trunk, ainda que o merge falhe.
        setOutput(
          (p) =>
            p +
            "\n\n⚠️ O switch para a linha principal foi aplicado, mas o merge falhou — " +
            "a sua working copy está agora no trunk. Corrija o problema acima e tente publicar " +
            "novamente, ou troque de volta para a sua branch.",
        );
        return reportOutput(o, "");
      }

      const st = await tryRun(() => api.getStatus(wc.path, false));
      if (st?.entries.some((e) => e.item === "conflicted")) {
        toast.warn("Conflitos na reintegração", "Resolva na aba Alterações e commite.");
      } else {
        toast.success("Branch mesclada no trunk", "Revise e commite na aba Alterações.");
      }
      setView("changes");
    } finally {
      setBusy(null);
    }
  };

  // --- Reintegrar uma branch (estando no trunk) -----------------------------
  const runReintegrateFrom = async (dry: boolean) => {
    if (busy) return;
    const url = branchUrl.trim();
    if (!url) return toast.warn("Informe a URL da branch a reintegrar");
    setBusy(dry ? "preview" : "reintegrate");
    setOutput("");
    try {
      if (!dry) {
        if (!(await ensureClean())) return;
        const o0 = await api.update(wc.path);
        if (!o0.success) return reportOutput(o0, "");
      }
      const o = await api.merge(wc.path, url, dry, false);
      setOutput(o.stdout + (o.stderr ? "\n" + o.stderr : ""));
      if (!o.success) return reportOutput(o, "");
      if (!dry) {
        const st = await tryRun(() => api.getStatus(wc.path, false));
        if (st?.entries.some((e) => e.item === "conflicted"))
          toast.warn("Conflitos na reintegração", "Resolva na aba Alterações e commite.");
        else toast.success("Branch mesclada", "Revise e commite na aba Alterações.");
        setView("changes");
      }
    } finally {
      setBusy(null);
      // Após uma execução real, ressincroniza a WC mesmo em falha — o update/merge
      // pode ter tocado arquivos (espelha o comportamento do runPublish).
      if (!dry) await refreshOne(wc.path);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        {!wc.isMainline ? (
          <>
            <Card
              icon={<ArrowDownToLine className="size-5" />}
              title="Receber a linha principal (sync)"
              description="Traz para a sua branch o que andou no trunk e commita o merge. Faça isso antes de publicar."
              accent="branch"
            >
              {!mainlineUrl && (
                <div className="mb-3 flex items-center gap-2 rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">
                  <Info className="size-4" /> Projeto não reconhecido — defina a URL do trunk nas
                  Configurações.
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={previewSync} loading={busy === "preview"} disabled={!mainlineUrl || !!busy}>
                  {busy !== "preview" && <Eye className="size-4" />}
                  Pré-visualizar
                </Button>
                <Button variant="primary" onClick={runSync} loading={busy === "sync"} disabled={!mainlineUrl || !!busy}>
                  {busy !== "sync" && <ArrowDownToLine className="size-4" />}
                  Receber e commitar
                </Button>
              </div>
            </Card>

            <Card
              icon={<Upload className="size-5" />}
              title="Publicar na linha principal (reintegrar)"
              description="Troca a WC para o trunk, atualiza e mescla a sua branch. Depois você revisa e commita — esse commit é a publicação."
              accent="trunk"
            >
              <Button variant="primary" onClick={runPublish} loading={busy === "publish"} disabled={!mainlineUrl || !!busy}>
                {busy !== "publish" && <GitMerge className="size-4" />}
                Publicar branch no trunk
              </Button>
            </Card>
          </>
        ) : (
          <Card
            icon={<GitMerge className="size-5" />}
            title="Reintegrar uma branch no trunk"
            description="Sua WC está na linha principal. Informe a branch a mesclar; depois revise e commite na aba Alterações."
            accent="trunk"
          >
            <Input
              value={branchUrl}
              onChange={(e) => setBranchUrl(e.target.value)}
              placeholder="svn+ssh://…/branches/…/projeto"
              className="mb-3 font-mono text-[12px]"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => runReintegrateFrom(true)} loading={busy === "preview"} disabled={!!busy}>
                {busy !== "preview" && <Eye className="size-4" />}
                Pré-visualizar
              </Button>
              <Button variant="primary" onClick={() => runReintegrateFrom(false)} loading={busy === "reintegrate"} disabled={!!busy}>
                {busy !== "reintegrate" && <GitMerge className="size-4" />}
                Mesclar branch
              </Button>
            </div>
          </Card>
        )}

        {/* contexto atual */}
        <div className="flex items-center gap-2 px-1 text-[12px] text-faint">
          {wc.kind === "trunk" ? (
            <TreePine className="size-3.5 text-trunk" />
          ) : (
            <GitBranch className="size-3.5 text-branch" />
          )}
          <span>
            WC atual: <span className="text-muted">{wc.kind === "trunk" ? "trunk" : wc.branchLabel}</span>
          </span>
          {busy && <Loader2 className="ml-1 size-3.5 animate-spin text-brand" />}
        </div>

        <MergeOutput text={output} />
      </div>
    </div>
  );
}

export function MergeView() {
  const wc = useSelectedWc();
  if (!wc) return <NeedWorkingCopy />;
  return <Merge key={wc.path} wc={wc} />;
}
