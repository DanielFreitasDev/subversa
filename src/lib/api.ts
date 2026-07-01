/**
 * Camada de acesso ao backend Rust via `invoke`. Cada função corresponde a um
 * `#[tauri::command]`. Centralizar aqui mantém os componentes desacoplados do
 * Tauri e facilita testes/mocks.
 */

import { invoke } from "@tauri-apps/api/core";

import type {
  AppConfig,
  BackupEntry,
  BlameLine,
  CommandLogEntry,
  CommandOutput,
  ConflictDetails,
  ContentSearchResult,
  HunkRef,
  IncomingResult,
  ListEntry,
  LogEntry,
  Prerequisites,
  StashResult,
  StatusResult,
  TextFile,
  UrlInfo,
  WorkingCopy,
} from "./types";

// --- leitura / detecção ----------------------------------------------------

export const detectWorkingCopies = (base: string) =>
  invoke<WorkingCopy[]>("detect_working_copies", { base });

export const getInfo = (path: string) => invoke<WorkingCopy>("get_info", { path });

export const getStatus = (path: string, remote = false) =>
  invoke<StatusResult>("get_status", { path, remote });

export const getDiff = (path: string, files?: string[]) =>
  invoke<string>("get_diff", { path, files: files ?? null });

/** Diff de uma revisão inteira (target = WC/URL) ou de um arquivo (target = URL). */
export const diffRevision = (target: string, revision: string) =>
  invoke<string>("diff_revision", { target, revision });

export const getLog = (
  target: string,
  limit = 50,
  search?: string,
  revRange?: string,
) =>
  invoke<LogEntry[]>("get_log", {
    target,
    limit,
    search: search ?? null,
    revRange: revRange ?? null,
  });

/** O que chega do servidor ao atualizar a WC (aba Entrada). */
export const incoming = (path: string, limit?: number) =>
  invoke<IncomingResult>("incoming", { path, limit: limit ?? null });

export const listDir = (url: string) => invoke<ListEntry[]>("list_dir", { url });

/** Listagem recursiva (`svn list -R`): toda a subárvore num só comando. */
export const listTree = (url: string) => invoke<ListEntry[]>("list_tree", { url });

/** Busca por conteúdo sob `baseUrl` (`svn cat` por arquivo; emite `op-progress`). */
export const searchContent = (baseUrl: string, query: string) =>
  invoke<ContentSearchResult>("search_content", { baseUrl, query });

/** Cancela uma operação longa em andamento (`id` vindo do evento `op-progress`). */
export const cancelOp = (id: number) => invoke<boolean>("cancel_op", { id });

export const catFile = (target: string, revision?: string) =>
  invoke<string>("cat_file", { target, revision: revision ?? null });

/** Autoria por linha. `target` = URL remota ou caminho local; `revision` opcional. */
export const blame = (target: string, revision?: string) =>
  invoke<BlameLine[]>("blame", { target, revision: revision ?? null });

/** Info de um nó remoto (revisão no breadcrumb; validação de localização). */
export const getUrlInfo = (url: string) => invoke<UrlInfo>("get_url_info", { url });

/** Diff entre duas URLs (Comparar com…); cada URL aceita `URL@REV`. */
export const diffUrls = (oldUrl: string, newUrl: string) =>
  invoke<string>("diff_urls", { oldUrl, newUrl });

// --- escrita / servidor ----------------------------------------------------

export const checkout = (url: string, dest: string) =>
  invoke<CommandOutput>("checkout", { url, dest });

export const update = (path: string) => invoke<CommandOutput>("update", { path });

export const commit = (paths: string[], message: string) =>
  invoke<CommandOutput>("commit", { paths, message });

export const svnAdd = (paths: string[]) => invoke<CommandOutput>("svn_add", { paths });

/** Acrescenta um padrão ao svn:ignore da pasta (mudança local; commit publica). */
export const addToIgnore = (dir: string, pattern: string) =>
  invoke<CommandOutput>("add_to_ignore", { dir, pattern });

export const revert = (paths: string[], recursive = false) =>
  invoke<CommandOutput>("revert", { paths, recursive });

/** Reverte um único trecho (change-block): o backend remonta o patch mínimo a
 *  partir do `svn diff` bruto do arquivo (fiel à codificação) e o aplica em
 *  reverso via `svn patch --reverse-diff`. `hunk` identifica o trecho. */
export const revertHunk = (wcPath: string, target: string, hunk: HunkRef) =>
  invoke<CommandOutput>("revert_hunk", { wcPath, target, hunk });

/** Captura o estado atual dos arquivos antes de uma reversão, para um Ctrl+Z
 *  depois. Devolve um `id` (0 = nada a desfazer). Ver `undoRevert`. */
export const stashRevert = (wcPath: string, paths: string[], label: string) =>
  invoke<StashResult>("stash_revert", { wcPath, paths, label });

/** Desfaz uma reversão: restaura o conteúdo e o agendamento svn capturados. */
export const undoRevert = (id: number) =>
  invoke<CommandOutput>("undo_revert", { id });

export const remove = (paths: string[], keepLocal = false, force = false) =>
  invoke<CommandOutput>("remove", { paths, keepLocal, force });

export const createBranch = (sourceUrl: string, branchUrl: string, message: string) =>
  invoke<CommandOutput>("create_branch", { sourceUrl, branchUrl, message });

export const switchWc = (path: string, url: string) =>
  invoke<CommandOutput>("switch_wc", { path, url });

export const merge = (
  path: string,
  sourceUrl: string,
  dryRun = false,
  recordOnly = false,
) => invoke<CommandOutput>("merge", { path, sourceUrl, dryRun, recordOnly });

/** Reverte as mudanças de uma revisão na cópia local (merge reverso). */
export const reverseMerge = (path: string, revision: string) =>
  invoke<CommandOutput>("reverse_merge", { path, revision });

/** Edita o comentário (mensagem) de uma revisão no servidor (svn:log revprop). */
export const setRevpropMessage = (path: string, revision: string, message: string) =>
  invoke<CommandOutput>("set_revprop_message", { path, revision, message });

export const resolve = (path: string, accept: string) =>
  invoke<CommandOutput>("resolve", { path, accept });

/** Reúne base/mine/theirs de um conflito para o editor de mesclagem em 3 painéis. */
export const conflictDetails = (path: string) =>
  invoke<ConflictDetails>("conflict_details", { path });

/** Grava o conteúdo mesclado e marca o conflito como resolvido (accept=working). */
export const resolveWithContent = (path: string, content: string) =>
  invoke<CommandOutput>("resolve_with_content", { path, content });

export const cleanup = (path: string) => invoke<CommandOutput>("cleanup", { path });

export const deleteRemote = (url: string, message: string) =>
  invoke<CommandOutput>("delete_remote", { url, message });

/** Exporta uma URL para uma pasta local (`svn export`). */
export const exportPath = (
  url: string,
  dest: string,
  force = false,
  revision?: string,
) =>
  invoke<CommandOutput>("export_path", {
    url,
    dest,
    force,
    revision: revision ?? null,
  });

/** Importa uma pasta local para uma URL do repositório (`svn import`). */
export const importPath = (localPath: string, url: string, message: string) =>
  invoke<CommandOutput>("import_path", { localPath, url, message });

/** Cria uma pasta no repositório (`svn mkdir --parents`). */
export const makeDir = (url: string, message: string) =>
  invoke<CommandOutput>("make_dir", { url, message });

/** Move/renomeia um nó no repositório (`svn move --parents`). */
export const moveRemote = (srcUrl: string, dstUrl: string, message: string) =>
  invoke<CommandOutput>("move_remote", { srcUrl, dstUrl, message });

// --- backups (pontos de restauração) ---------------------------------------

/** Cria um ponto de restauração da working copy antes de uma operação destrutiva. */
export const createBackup = (
  path: string,
  op: string,
  name: string,
  url: string,
  revision: string,
  branchLabel: string,
) =>
  invoke<BackupEntry>("create_backup", {
    req: { path, op, name, url, revision, branchLabel },
  });

/** Lista todos os pontos de restauração (mais recentes primeiro). */
export const listBackups = () => invoke<BackupEntry[]>("list_backups");

/** Restaura um backup: reescreve a working copy com a cópia salva. */
export const restoreBackup = (id: string) =>
  invoke<CommandOutput>("restore_backup", { id });

export const deleteBackup = (id: string) => invoke<void>("delete_backup", { id });

/** Caminho da pasta de backups (para abrir no gerenciador de arquivos). */
export const backupsDir = () => invoke<string>("backups_dir");

// --- config + utilidades ---------------------------------------------------

export const loadConfig = () => invoke<AppConfig>("load_config");

export const saveConfig = (config: AppConfig) =>
  invoke<void>("save_config", { config });

/** Config-modelo semeada a partir de um host (tela de primeira execução). */
export const presetConfig = (host: string) =>
  invoke<AppConfig>("preset_config", { host });

export const svnVersion = () => invoke<string>("svn_version");

export const checkPrerequisites = () => invoke<Prerequisites>("check_prerequisites");

export const testConnection = (url: string) =>
  invoke<CommandOutput>("test_connection", { url });

export const revealInFileManager = (path: string) =>
  invoke<void>("reveal_in_file_manager", { path });

export const openExternalDiff = (target: string, tool?: string) =>
  invoke<void>("open_external_diff", { target, tool: tool ?? null });

// --- edição de arquivos da cópia de trabalho -------------------------------

/**
 * Lê um arquivo da cópia de trabalho (do disco) para o editor embutido, com a
 * codificação detectada (UTF-8 ou ISO-8859-1). Passe o `encoding` de volta em
 * `writeTextFile` para regravar na codificação original.
 */
export const readTextFile = (path: string) => invoke<TextFile>("read_text_file", { path });

/** Grava o conteúdo editado de volta no arquivo (gravação atômica, na codificação `encoding`). */
export const writeTextFile = (path: string, content: string, encoding: string) =>
  invoke<void>("write_text_file", { path, content, encoding });

/**
 * Detecta a codificação de um arquivo local para o badge da UI (sem carregar o
 * conteúdo). Retorna `"utf-8"`, `"iso-8859-1"`, `"binary"` ou `"unknown"` (inclui
 * caminhos não-locais, como as URLs do diff de histórico). Nunca rejeita.
 */
export const detectEncoding = (path: string) => invoke<string>("detect_encoding", { path });

/**
 * Detecta a codificação de um arquivo do repositório numa revisão (via `svn cat`),
 * para o badge no Histórico — onde o conteúdo é do servidor, não do disco. Custa
 * uma ida ao servidor; use só sob demanda (arquivo selecionado). Nunca rejeita.
 */
export const detectEncodingUrl = (url: string, revision?: string) =>
  invoke<string>("detect_encoding_url", { url, revision: revision ?? null });

/** Abre um arquivo no editor de código externo (ou no app padrão do sistema). */
export const openInEditor = (path: string, editor?: string) =>
  invoke<void>("open_in_editor", { path, editor: editor ?? null });

export const suggestedBaseDir = () => invoke<string>("suggested_base_dir");

// --- registro de comandos (auditoria) --------------------------------------

/** Histórico de comandos svn desta sessão (mais antigo → mais recente). */
export const getCommandLog = () => invoke<CommandLogEntry[]>("get_command_log");

/** Limpa o histórico em memória (o arquivo de log permanece). */
export const clearCommandLog = () => invoke<void>("clear_command_log");

/** Caminho do arquivo de log persistente. */
export const commandLogPath = () => invoke<string>("command_log_path");
