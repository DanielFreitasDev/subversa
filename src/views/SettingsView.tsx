import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import {
  Database,
  FolderOpen,
  Info,
  Monitor,
  Moon,
  Plug,
  Plus,
  Server,
  Sun,
  Trash2,
} from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Switch } from "@/components/ui/Field";
import { Logo } from "@/components/ui/Logo";
import { Segmented } from "@/components/ui/Segmented";
import { reportOutput, tryRun } from "@/lib/op";
import type { Project } from "@/lib/types";
import { decodeUrl } from "@/lib/utils";
import { useConfigStore } from "@/store/config";
import { toast } from "@/store/toast";
import { useWorkspaceStore } from "@/store/workspace";

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-brand/12 text-brand">
          {icon}
        </div>
        <div>
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          {description && <p className="text-[11px] text-faint">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line/60 py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {hint && <div className="text-[11px] leading-snug text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsView() {
  const config = useConfigStore((s) => s.config);
  const save = useConfigStore((s) => s.save);
  const { baseDir, setBaseDir, refresh } = useWorkspaceStore();

  const [host, setHost] = useState(config?.host ?? "");
  const [tool, setTool] = useState(config?.externalDiffTool ?? "meld");
  const [projects, setProjects] = useState<Project[]>(config?.projects ?? []);
  const [repoBase, setRepoBase] = useState(config?.repoBase ?? "");
  const [newRoot, setNewRoot] = useState("");
  const [testing, setTesting] = useState(false);
  const [version, setVersion] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [projectsDirty, setProjectsDirty] = useState(false);

  useEffect(() => {
    if (config) {
      setHost(config.host);
      setTool(config.externalDiffTool);
      setRepoBase(config.repoBase);
      // Não sobrescreve edições de projetos ainda não salvas (ex.: ao salvar o
      // tema, o config muda e este efeito dispararia, descartando-as).
      if (!projectsDirty) setProjects(config.projects);
    }
  }, [config, projectsDirty]);

  useEffect(() => {
    api.svnVersion().then(setVersion).catch(() => setVersion(""));
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, []);

  if (!config) return null;

  const chooseFolder = async () => {
    const dir = await openDialog({ directory: true, defaultPath: baseDir || undefined });
    if (typeof dir === "string") {
      setBaseDir(dir);
      await save({ baseDir: dir });
      refresh(dir);
    }
  };

  const testConn = async () => {
    const target = config.repoRoots[0];
    if (!target) return toast.warn("Nenhum repositório configurado");
    setTesting(true);
    const out = await tryRun(() => api.testConnection(target), "Falha na conexão");
    setTesting(false);
    if (out) reportOutput(out, "Conexão OK", "O servidor respondeu.");
  };

  const updateProject = (i: number, patch: Partial<Project>) => {
    setProjectsDirty(true);
    setProjects((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };

  const removeProject = (i: number) => {
    setProjectsDirty(true);
    setProjects((ps) => ps.filter((_, j) => j !== i));
  };

  const addProject = () => {
    setProjectsDirty(true);
    setProjects((ps) => [
      ...ps,
      { key: "novo", name: "Novo projeto", description: "", url: config.repoRoots[0] ?? "" },
    ]);
  };

  const saveProjects = async () => {
    const bad = projects.find(
      (p) => p.url.trim() && !/^(svn\+ssh|https?|svn|file):\/\//.test(p.url.trim()),
    );
    if (bad) {
      toast.warn("URL de projeto inválida", `"${bad.name || bad.key}" precisa de um esquema (svn+ssh://…).`);
      return;
    }
    await save({ projects });
    setProjectsDirty(false);
    toast.success("Projetos salvos");
  };

  const roots = config.repoRoots;

  const addRoot = async () => {
    const v = newRoot.trim();
    if (!v) return;
    if (!v.includes("://") && !repoBase.trim()) {
      toast.warn("Defina a URL base primeiro", "Ou informe a URL completa (svn+ssh://…).");
      return;
    }
    const base = repoBase.endsWith("/") ? repoBase : `${repoBase}/`;
    const url = v.includes("://") ? v : `${base}${v.replace(/^\/+/, "")}`;
    if (!/^(svn\+ssh|https?|svn|file):\/\//.test(url)) {
      toast.warn("URL inválida", "Use um esquema como svn+ssh://, https:// ou file://.");
      return;
    }
    if (roots.includes(url)) {
      toast.warn("Localização já cadastrada");
      return;
    }
    await save({ repoRoots: [...roots, url] });
    setNewRoot("");
    toast.success("Localização adicionada");
  };

  const removeRoot = async (url: string) => {
    await save({ repoRoots: roots.filter((r) => r !== url) });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold text-ink">Configurações</h1>
          <p className="text-[12px] text-faint">Servidor, projetos e preferências</p>
        </div>

        {/* Aparência */}
        <Section icon={<Sun className="size-4" />} title="Aparência">
          <Row label="Tema" hint="Claro, escuro ou conforme o sistema">
            <Segmented
              value={config.theme}
              onChange={(v) => save({ theme: v })}
              options={[
                { value: "dark", label: "Escuro", icon: <Moon className="size-3.5" /> },
                { value: "light", label: "Claro", icon: <Sun className="size-3.5" /> },
                { value: "system", label: "Sistema", icon: <Monitor className="size-3.5" /> },
              ]}
            />
          </Row>
        </Section>

        {/* Servidor & autenticação */}
        <Section
          icon={<Server className="size-4" />}
          title="Servidor & autenticação"
          description="Conexão svn+ssh com o repositório"
        >
          <Row label="Host SSH" hint="usuario@servidor">
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onBlur={() => {
                const h = host.trim();
                if (h && h !== config.host) save({ host: h });
                else if (!h) setHost(config.host);
              }}
              className="w-64 font-mono text-[12px]"
            />
          </Row>
          <Row
            label="Autenticação"
            hint="Auto usa a chave SSH e cai para a senha ($SSHPASS) se preciso"
          >
            <Segmented
              value={config.sshMode}
              onChange={(v) => save({ sshMode: v })}
              options={[
                { value: "auto", label: "Auto" },
                { value: "key", label: "Chave" },
                { value: "password", label: "Senha" },
              ]}
              size="sm"
            />
          </Row>
          <Row label="Testar conexão" hint="Consulta o primeiro repositório configurado">
            <Button variant="outline" size="sm" onClick={testConn} loading={testing}>
              {!testing && <Plug className="size-4" />}
              Testar
            </Button>
          </Row>
        </Section>

        {/* Localizações de repositório */}
        <Section
          icon={<Database className="size-4" />}
          title="Localizações de repositório"
          description="Raízes navegáveis no Navegador de Repositórios"
        >
          <Row label="URL base" hint="Expande nomes curtos — ex.: svn+ssh://host/usr/svn/">
            <Input
              value={repoBase}
              onChange={(e) => setRepoBase(e.target.value)}
              onBlur={() => repoBase !== config.repoBase && save({ repoBase })}
              className="w-72 font-mono text-[11px]"
            />
          </Row>
          <div className="space-y-1.5 pt-3">
            {roots.map((url) => (
              <div key={url} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <Database className="size-3.5 shrink-0 text-faint" />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted"
                  title={decodeUrl(url)}
                >
                  {decodeUrl(url)}
                </span>
                <button
                  onClick={() => removeRoot(url)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-conflict/15 hover:text-conflict"
                  title="Remover localização"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {roots.length === 0 && (
              <div className="px-1 py-2 text-[12px] text-faint">Nenhuma localização cadastrada.</div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Input
              value={newRoot}
              onChange={(e) => setNewRoot(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRoot()}
              placeholder="nome (ex.: veiculo) ou URL completa"
              className="h-9 flex-1 font-mono text-[12px]"
            />
            <Button variant="outline" size="sm" onClick={addRoot}>
              <Plus className="size-4" />
              Adicionar
            </Button>
          </div>
        </Section>

        {/* Pasta de trabalho */}
        <Section icon={<FolderOpen className="size-4" />} title="Pasta de trabalho">
          <Row label="Local das working copies" hint={baseDir}>
            <Button variant="outline" size="sm" onClick={chooseFolder}>
              <FolderOpen className="size-4" />
              Trocar
            </Button>
          </Row>
        </Section>

        {/* Projetos preset */}
        <Section
          icon={<Server className="size-4" />}
          title="Meus projetos"
          description="Atalhos de checkout e detecção da linha principal"
        >
          <div className="space-y-2">
            {projects.map((p, i) => (
              <div key={i} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={p.key}
                    onChange={(e) => updateProject(i, { key: e.target.value })}
                    placeholder="id"
                    className="h-8 w-28 text-[12px]"
                  />
                  <Input
                    value={p.name}
                    onChange={(e) => updateProject(i, { name: e.target.value })}
                    placeholder="nome"
                    className="h-8 flex-1 text-[12px]"
                  />
                  <button
                    onClick={() => removeProject(i)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-faint hover:bg-conflict/15 hover:text-conflict"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <Input
                  value={p.description}
                  onChange={(e) => updateProject(i, { description: e.target.value })}
                  placeholder="descrição"
                  className="mt-2 h-8 text-[12px]"
                />
                <Input
                  value={p.url}
                  onChange={(e) => updateProject(i, { url: e.target.value })}
                  placeholder="svn+ssh://…"
                  className="mt-2 h-8 font-mono text-[11px]"
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={addProject}
            >
              <Plus className="size-4" />
              Adicionar
            </Button>
            <Button variant="primary" size="sm" onClick={saveProjects}>
              Salvar projetos
            </Button>
          </div>
        </Section>

        {/* Preferências */}
        <Section icon={<Info className="size-4" />} title="Preferências">
          <Row label="Confirmar operações no servidor" hint="Pede confirmação antes de commit, merge, switch…">
            <Switch
              checked={config.confirmServerOps}
              onChange={(v) => save({ confirmServerOps: v })}
            />
          </Row>
          <Row label="Modo verboso" hint="Mostra o comando svn equivalente">
            <Switch checked={config.verbose} onChange={(v) => save({ verbose: v })} />
          </Row>
          <Row label="Ferramenta de diff externa" hint="ex.: meld, kdiff3">
            <Input
              value={tool}
              onChange={(e) => setTool(e.target.value)}
              onBlur={() => tool !== config.externalDiffTool && save({ externalDiffTool: tool })}
              className="w-40 text-[12px]"
            />
          </Row>
        </Section>

        {/* Sobre */}
        <div className="flex items-center gap-3 rounded-xl border border-line bg-panel p-4">
          <Logo size={44} className="shrink-0 rounded-[22%] shadow-soft" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[14px] font-semibold text-ink">Subversa</span>
              {appVersion && <span className="font-mono text-[11px] text-faint">{appVersion}</span>}
            </div>
            <div className="text-[11px] text-faint">Cliente SVN moderno{version && ` · svn ${version}`}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
