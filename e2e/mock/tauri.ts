/**
 * Mock do IPC do Tauri para os testes visuais.
 *
 * `buildFixtures` monta dados realistas (working copies, status, diff, log…).
 * `tauriInit` roda DENTRO do browser (via `page.addInitScript`) e instala um
 * `window.__TAURI_INTERNALS__` que roteia cada comando `invoke(...)` para uma
 * fixture — assim a UI sobe completa sem o backend Rust nem o `svn`.
 *
 * `tauriInit` não pode referenciar nada fora do próprio corpo (é serializada e
 * injetada no browser); todos os dados chegam pelo argumento `fx`.
 */

export type Theme = "dark" | "light";

export interface MockData {
  config: Record<string, unknown>;
  wcs: Record<string, unknown>[];
  status: Record<string, unknown>;
  diff: string;
  log: Record<string, unknown>[];
  branchList: Record<string, unknown>[];
  rootList: Record<string, unknown>[];
}

export function buildFixtures(theme: Theme): MockData {
  const ROOT = "svn+ssh://svn.tjsc.local/usr/svn";

  const config = {
    baseDir: "/home/daniel/projetos",
    host: "svn.tjsc.local",
    repoBase: ROOT + "/",
    repoRoots: [ROOT + "/sna", ROOT + "/getran", ROOT + "/sutil"],
    projects: [
      { key: "sna", name: "SNA", description: "Sistema Nacional de Autos", url: ROOT + "/sna" },
      { key: "getran", name: "GETRAN", description: "Gestão de Trânsito", url: ROOT + "/getran" },
      { key: "getran160", name: "GETRAN 160", description: "GETRAN versão 160", url: ROOT + "/getran160" },
      { key: "trrenavam", name: "TR-RENAVAM", description: "Integração RENAVAM", url: ROOT + "/trrenavam" },
      { key: "sutil", name: "SUTIL", description: "Sistema Único de Trânsito", url: ROOT + "/sutil" },
      { key: "sutil160", name: "SUTIL 160", description: "SUTIL versão 160", url: ROOT + "/sutil160" },
    ],
    sshMode: "auto",
    theme,
    externalDiffTool: "meld",
    verbose: false,
    confirmServerOps: true,
  };

  const mkWc = (o: Record<string, unknown>) => ({
    path: "", name: "", url: "", relativeUrl: "", repoRoot: ROOT, revision: "0",
    lastChangedRev: null, lastChangedAuthor: null, lastChangedDate: null,
    kind: "other", branchLabel: "", isMainline: false, modifiedCount: 0,
    hasConflicts: false, projectKey: null, uuid: "f1e2d3c4-0000", ...o,
  });
  const wcs = [
    mkWc({
      path: "/home/daniel/projetos/sna", name: "sna", url: ROOT + "/sna/trunk",
      relativeUrl: "^/sna/trunk", revision: "4821", lastChangedRev: "4820",
      lastChangedAuthor: "daniel.freitas", lastChangedDate: "2026-06-22T18:30:00.000Z",
      kind: "trunk", branchLabel: "trunk", isMainline: true, modifiedCount: 5,
      hasConflicts: true, projectKey: "sna",
    }),
    mkWc({
      path: "/home/daniel/projetos/getran", name: "getran",
      url: ROOT + "/getran/branches/ISSUES 2026/06 - JUNHO/issue_1234",
      relativeUrl: "^/getran/branches/ISSUES 2026/06 - JUNHO/issue_1234",
      revision: "12044", lastChangedRev: "12044", lastChangedAuthor: "maria.silva",
      lastChangedDate: "2026-06-23T09:15:00.000Z", kind: "branch",
      branchLabel: "issue_1234", isMainline: false, modifiedCount: 2, projectKey: "getran",
    }),
    mkWc({
      path: "/home/daniel/projetos/sutil", name: "sutil", url: ROOT + "/sutil/trunk",
      relativeUrl: "^/sutil/trunk", revision: "2310", lastChangedRev: "2305",
      lastChangedAuthor: "joao.souza", lastChangedDate: "2026-06-20T14:00:00.000Z",
      kind: "trunk", branchLabel: "trunk", isMainline: true, modifiedCount: 0, projectKey: "sutil",
    }),
  ];

  const mkEntry = (o: { relPath: string; item: string } & Record<string, unknown>) => ({
    path: "/home/daniel/projetos/sna/" + o.relPath, props: "none", copied: false,
    wcLocked: false, treeConflicted: false, remoteModified: false, reposItem: null,
    revision: "4821", isDir: false, ...o,
  });
  const status = {
    againstRevision: "4821", incomingCount: 2,
    entries: [
      mkEntry({ relPath: "src/processo/ProcessoService.java", item: "modified" }),
      mkEntry({ relPath: "src/processo/ProcessoDAO.java", item: "modified", props: "modified", remoteModified: true }),
      mkEntry({ relPath: "src/util/Datas.java", item: "added" }),
      mkEntry({ relPath: "docs/CHANGELOG.md", item: "deleted" }),
      mkEntry({ relPath: "config/local.properties", item: "unversioned" }),
      mkEntry({ relPath: "src/merge/Conciliador.java", item: "conflicted" }),
    ],
  };

  const diff = [
    "Index: src/processo/ProcessoService.java",
    "===================================================================",
    "--- src/processo/ProcessoService.java\t(revisão 4820)",
    "+++ src/processo/ProcessoService.java\t(cópia de trabalho)",
    "@@ -40,10 +40,13 @@ public class ProcessoService {",
    " ",
    "   public Processo carregar(Long id) {",
    "-    return repo.findById(id);",
    "+    Processo p = repo.findById(id);",
    "+    if (p == null) {",
    "+      throw new ProcessoNaoEncontrado(id);",
    "+    }",
    "+    return p;",
    "   }",
    " ",
    "   public List<Processo> listar() {",
    "-    return repo.findAll();",
    "+    return repo.findAllAtivos();",
    "   }",
    "",
  ].join("\n");

  const log = [
    { revision: "4820", author: "daniel.freitas", date: "2026-06-22T18:30:00.000Z",
      message: "Corrige cálculo de prazo no ProcessoService",
      paths: [{ action: "M", path: "/sna/trunk/src/processo/ProcessoService.java", kind: "file", copyfromPath: null, copyfromRev: null }] },
    { revision: "4815", author: "maria.silva", date: "2026-06-21T11:05:00.000Z",
      message: "Adiciona índice na tabela de autos\n\nMelhora a consulta por placa.",
      paths: [{ action: "A", path: "/sna/trunk/db/migracao/V42__indice_autos.sql", kind: "file", copyfromPath: null, copyfromRev: null }] },
    { revision: "4809", author: "joao.souza", date: "2026-06-19T16:40:00.000Z",
      message: "Refatora camada de persistência",
      paths: [
        { action: "M", path: "/sna/trunk/src/processo/ProcessoDAO.java", kind: "file", copyfromPath: null, copyfromRev: null },
        { action: "D", path: "/sna/trunk/src/legacy/OldDAO.java", kind: "file", copyfromPath: null, copyfromRev: null },
      ] },
    { revision: "4801", author: "daniel.freitas", date: "2026-06-18T09:12:00.000Z",
      message: "Branch para issue_1234",
      paths: [{ action: "A", path: "/getran/branches/ISSUES 2026/06 - JUNHO/issue_1234", kind: "dir", copyfromPath: "/getran/trunk", copyfromRev: "4790" }] },
    { revision: "4795", author: "ana.costa", date: "2026-06-17T13:25:00.000Z",
      message: "Atualiza dependências do build",
      paths: [{ action: "M", path: "/sna/trunk/pom.xml", kind: "file", copyfromPath: null, copyfromRev: null }] },
    { revision: "4790", author: "maria.silva", date: "2026-06-16T10:00:00.000Z",
      message: "Primeira versão do relatório consolidado",
      paths: [{ action: "A", path: "/sna/trunk/src/relatorio/Consolidado.java", kind: "file", copyfromPath: null, copyfromRev: null }] },
  ];

  const branchList = [
    { name: "issue_1234", kind: "dir", size: null, revision: "12044", author: "maria.silva", date: "2026-06-23T09:15:00.000Z" },
    { name: "issue_1255", kind: "dir", size: null, revision: "12010", author: "daniel.freitas", date: "2026-06-19T17:00:00.000Z" },
    { name: "issue_1198_hotfix", kind: "dir", size: null, revision: "11980", author: "joao.souza", date: "2026-06-12T08:30:00.000Z" },
  ];
  const rootList = [
    { name: "trunk", kind: "dir", size: null, revision: "4821", author: "daniel.freitas", date: "2026-06-22T18:30:00.000Z" },
    { name: "branches", kind: "dir", size: null, revision: "12044", author: "maria.silva", date: "2026-06-23T09:15:00.000Z" },
    { name: "tags", kind: "dir", size: null, revision: "4500", author: "ana.costa", date: "2026-05-30T12:00:00.000Z" },
    { name: "pom.xml", kind: "file", size: 4096, revision: "4795", author: "ana.costa", date: "2026-06-17T13:25:00.000Z" },
    { name: "README.md", kind: "file", size: 6 * 1024 * 1024, revision: "4790", author: "maria.silva", date: "2026-06-16T10:00:00.000Z" },
  ];

  return { config, wcs, status, diff, log, branchList, rootList };
}

export function tauriInit(fx: MockData) {
  const ok = (command: string) => ({
    success: true, code: 0,
    stdout: "Comando concluído.\nRevisão 4821 enviada.", stderr: "", hint: null, command,
  });

  const reply = (cmd: string, args: Record<string, unknown> | undefined): unknown => {
    if (cmd === "plugin:app|version") return "0.3.0";
    if (cmd.indexOf("plugin:dialog|") === 0) return null; // diálogo nativo cancelado
    if (cmd.indexOf("plugin:event|") === 0) return 0;
    if (cmd.indexOf("plugin:") === 0) return null;

    switch (cmd) {
      case "load_config":
      case "preset_config":
        return fx.config;
      case "save_config":
        return null;
      case "suggested_base_dir":
        return fx.config.baseDir;
      case "detect_working_copies":
        return fx.wcs;
      case "get_info":
        return fx.wcs.find((w) => w.path === (args && args.path)) || fx.wcs[0];
      case "get_status":
        return { ...fx.status, incomingCount: args && args.remote ? 2 : 0 };
      case "get_diff":
      case "diff_revision":
      case "diff_urls":
        return fx.diff;
      case "get_log":
        return fx.log;
      case "list_dir": {
        const url = String((args && args.url) || "");
        if (url.indexOf("/getran") >= 0) {
          throw "leitura remota bloqueada: URL fora das localizações configuradas. Cadastre a raiz em Configurações antes de usar esta URL.";
        }
        return /branches/i.test(url) ? fx.branchList : fx.rootList;
      }
      case "cat_file":
        return "package br.tjsc.sna.processo;\n\npublic class ProcessoService {\n  // ...\n}\n";
      case "blame":
        return [];
      case "get_url_info":
        return {
          url: (args && args.url) || fx.config.repoBase, repoRoot: "svn+ssh://svn.tjsc.local/usr/svn",
          relativeUrl: "^/sna", revision: "4821", kind: "dir",
          lastChangedRev: "4820", lastChangedAuthor: "daniel.freitas", lastChangedDate: "2026-06-22T18:30:00.000Z",
        };
      case "svn_version":
        return "svn, version 1.14.3 (r1924134)\n   compiled Apr 1 2026";
      case "check_prerequisites":
        return { svnOk: true, sshpassOk: true, sshpassNeeded: false };
      case "test_connection":
        return ok("svn info " + fx.config.repoBase);
      case "reveal_in_file_manager":
      case "open_external_diff":
        return null;
      case "checkout": case "update": case "commit": case "svn_add": case "revert":
      case "remove": case "create_branch": case "switch_wc": case "merge": case "resolve":
      case "cleanup": case "delete_remote": case "export_path": case "import_path":
      case "make_dir": case "move_remote":
        return ok("svn " + cmd);
      default:
        (window as unknown as { __UNMOCKED: string[] }).__UNMOCKED.push(cmd);
        return null;
    }
  };

  const w = window as unknown as Record<string, unknown>;
  w.__UNMOCKED = [];
  w.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown> | undefined) => {
      try {
        return Promise.resolve(reply(cmd, args));
      } catch (e) {
        return Promise.reject(String(e));
      }
    },
    transformCallback: (cb: unknown) => {
      const id = Math.floor(Math.random() * 1e9);
      w["__cb" + id] = cb;
      return id;
    },
    convertFileSrc: (p: string) => p,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    plugins: {},
  };
}
