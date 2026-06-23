/**
 * Camada de acesso ao backend Rust via `invoke`. Cada função corresponde a um
 * `#[tauri::command]`. Centralizar aqui mantém os componentes desacoplados do
 * Tauri e facilita testes/mocks.
 */

import { invoke } from "@tauri-apps/api/core";

import type {
  AppConfig,
  BlameLine,
  CommandOutput,
  ListEntry,
  LogEntry,
  StatusResult,
  UrlInfo,
  WorkingCopy,
} from "./types";

// --- leitura / detecção ----------------------------------------------------

export const detectWorkingCopies = (base: string) =>
  invoke<WorkingCopy[]>("detect_working_copies", { base });

export const getInfo = (path: string) => invoke<WorkingCopy>("get_info", { path });

export const getStatus = (path: string, remote = false) =>
  invoke<StatusResult>("get_status", { path, remote });

export const getDiff = (path: string, files?: string[], ignoreWs = false) =>
  invoke<string>("get_diff", { path, files: files ?? null, ignoreWs });

/** Diff de uma revisão inteira (target = WC/URL) ou de um arquivo (target = URL). */
export const diffRevision = (target: string, revision: string, ignoreWs = false) =>
  invoke<string>("diff_revision", { target, revision, ignoreWs });

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

export const listDir = (url: string) => invoke<ListEntry[]>("list_dir", { url });

export const catFile = (target: string, revision?: string) =>
  invoke<string>("cat_file", { target, revision: revision ?? null });

export const blame = (target: string) => invoke<BlameLine[]>("blame", { target });

/** Info de um nó remoto (revisão no breadcrumb; validação de localização). */
export const getUrlInfo = (url: string) => invoke<UrlInfo>("get_url_info", { url });

/** Diff entre duas URLs (Comparar com…); cada URL aceita `URL@REV`. */
export const diffUrls = (oldUrl: string, newUrl: string, ignoreWs = false) =>
  invoke<string>("diff_urls", { oldUrl, newUrl, ignoreWs });

// --- escrita / servidor ----------------------------------------------------

export const checkout = (url: string, dest: string) =>
  invoke<CommandOutput>("checkout", { url, dest });

export const update = (path: string) => invoke<CommandOutput>("update", { path });

export const commit = (paths: string[], message: string) =>
  invoke<CommandOutput>("commit", { paths, message });

export const svnAdd = (paths: string[]) => invoke<CommandOutput>("svn_add", { paths });

export const revert = (paths: string[], recursive = false) =>
  invoke<CommandOutput>("revert", { paths, recursive });

export const remove = (paths: string[], keepLocal = false) =>
  invoke<CommandOutput>("remove", { paths, keepLocal });

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

export const resolve = (path: string, accept: string) =>
  invoke<CommandOutput>("resolve", { path, accept });

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

// --- config + utilidades ---------------------------------------------------

export const loadConfig = () => invoke<AppConfig>("load_config");

export const saveConfig = (config: AppConfig) =>
  invoke<void>("save_config", { config });

/** Config-modelo semeada a partir de um host (tela de primeira execução). */
export const presetConfig = (host: string) =>
  invoke<AppConfig>("preset_config", { host });

export const svnVersion = () => invoke<string>("svn_version");

export const testConnection = (url: string) =>
  invoke<CommandOutput>("test_connection", { url });

export const revealInFileManager = (path: string) =>
  invoke<void>("reveal_in_file_manager", { path });

export const openExternalDiff = (target: string, tool?: string) =>
  invoke<void>("open_external_diff", { target, tool: tool ?? null });

export const suggestedBaseDir = () => invoke<string>("suggested_base_dir");
