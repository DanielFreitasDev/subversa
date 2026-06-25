/**
 * Tipos TypeScript que espelham os tipos públicos do backend Rust
 * (`src-tauri/src/svn/types.rs`). Mantenha os dois lados em sincronia.
 */

export type BranchKind = "trunk" | "branch" | "tag" | "other";
export type SshMode = "auto" | "key" | "password";

export interface CommandOutput {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  hint: string | null;
  command: string;
}

/**
 * Operações de transferência cujo progresso é transmitido pelo evento
 * `op-progress`. Commit/import ficam de fora: imprimem o progresso em português
 * e contá-los exigiria parsear texto traduzido (contra a convenção do projeto).
 */
export type TransferOp =
  | "checkout"
  | "update"
  | "switch"
  | "merge"
  | "export"
  | "backup"
  | "restore";

/**
 * Progresso de uma operação de transferência em andamento (evento `op-progress`).
 * SVN não informa o total de arquivos de antemão, então a UI mostra contador +
 * caminho atual em vez de porcentagem.
 */
export interface OpProgress {
  /** Identificador único desta execução (distingue operações simultâneas). */
  id: number;
  /** Qual operação está em andamento. */
  op: TransferOp;
  /** Quantos arquivos/diretórios já foram processados. */
  count: number;
  /** Caminho mais recente processado (vazio no início e no evento final). */
  path: string;
  /** `true` no evento final (sucesso ou erro) — a UI usa para remover o cartão. */
  done: boolean;
}

/**
 * Um ponto de restauração (backup) de uma working copy: cópia completa da pasta
 * (com o `.svn`) feita antes de uma operação destrutiva, para poder voltar ao
 * estado exato anterior. Espelha `BackupEntry` do Rust.
 */
export interface BackupEntry {
  id: string;
  wcPath: string;
  wcName: string;
  /** Operação que motivou o backup (ex.: `merge`, `update`, `switch`). */
  op: string;
  url: string;
  branchLabel: string;
  revision: string;
  /** Momento da criação, em epoch milissegundos (UTC). */
  createdMs: number;
  sizeBytes: number;
  fileCount: number;
}

/** Uma entrada do registro de comandos (auditoria do que o app rodou no `svn`). */
export interface CommandLogEntry {
  /** Sequência monotônica desde o início da sessão (id estável). */
  seq: number;
  /** Momento do término, em epoch milissegundos (UTC). */
  timestampMs: number;
  /** Linha do comando exibida (ex.: `svn commit -m "..."`). Nunca contém senha. */
  command: string;
  success: boolean;
  /** Código de saída do processo (null se nem rodou, ou timeout). */
  code: number | null;
  /** Duração total da execução, em milissegundos. */
  durationMs: number;
}

export interface WorkingCopy {
  path: string;
  name: string;
  url: string;
  relativeUrl: string;
  repoRoot: string;
  revision: string;
  lastChangedRev: string | null;
  lastChangedAuthor: string | null;
  lastChangedDate: string | null;
  kind: BranchKind;
  branchLabel: string;
  isMainline: boolean;
  modifiedCount: number;
  hasConflicts: boolean;
  projectKey: string | null;
  uuid: string | null;
}

/** Códigos de estado de item do `svn status`. */
export type ItemStatus =
  | "modified"
  | "added"
  | "deleted"
  | "replaced"
  | "unversioned"
  | "missing"
  | "conflicted"
  | "normal"
  | "ignored"
  | "external"
  | "incomplete"
  | "obstructed"
  | "none";

export interface StatusEntry {
  path: string;
  relPath: string;
  item: ItemStatus | string;
  props: string;
  copied: boolean;
  wcLocked: boolean;
  treeConflicted: boolean;
  remoteModified: boolean;
  reposItem: string | null;
  revision: string | null;
  isDir: boolean;
}

export interface StatusResult {
  entries: StatusEntry[];
  againstRevision: string | null;
  incomingCount: number;
}

/**
 * Detalhes de um conflito para o editor de mesclagem em 3 painéis.
 * `kind`: "text" abre o editor visual; "tree"/"property"/"none" caem nas opções
 * rápidas. Para texto, `base`/`mine`/`theirs` trazem as três versões (ancestral
 * comum, minha local, do servidor); vêm `null` se binário, grande demais ou ilegível.
 */
export interface ConflictDetails {
  path: string;
  kind: "text" | "tree" | "property" | "none" | string;
  binary: boolean;
  base: string | null;
  mine: string | null;
  theirs: string | null;
  baseLabel: string;
  theirsLabel: string;
  hasTreeConflict: boolean;
  hasPropertyConflict: boolean;
}

export interface LogPath {
  action: string;
  path: string;
  kind: string | null;
  copyfromPath: string | null;
  copyfromRev: string | null;
}

export interface LogEntry {
  revision: string;
  author: string | null;
  date: string | null;
  message: string;
  paths: LogPath[];
}

/** Resultado da aba "Entrada": o que chega do servidor ao atualizar a WC. */
export interface IncomingResult {
  /** Revisão atual da working copy (BASE). */
  baseRevision: string;
  /** Revisão HEAD do servidor (null se não foi possível consultar). */
  headRevision: string | null;
  /** Revisões a receber (mais recente → mais antiga); exclui a BASE. */
  entries: LogEntry[];
}

export interface ListEntry {
  name: string;
  kind: "file" | "dir" | string;
  size: number | null;
  revision: string | null;
  author: string | null;
  date: string | null;
}

export interface BlameLine {
  lineNumber: number;
  revision: string | null;
  author: string | null;
  date: string | null;
  content: string;
}

/** Info de um nó remoto (`svn info URL`) — navegador de repositórios. */
export interface UrlInfo {
  url: string;
  repoRoot: string;
  relativeUrl: string;
  revision: string;
  kind: "dir" | "file" | string;
  lastChangedRev: string | null;
  lastChangedAuthor: string | null;
  lastChangedDate: string | null;
}

export interface Project {
  key: string;
  name: string;
  description: string;
  url: string;
}

/** Disponibilidade dos binários externos exigidos em runtime (espelha o Rust). */
export interface Prerequisites {
  svnOk: boolean;
  sshpassOk: boolean;
  sshpassNeeded: boolean;
}

export interface AppConfig {
  baseDir: string;
  host: string;
  /** URL base do servidor (ex.: `svn+ssh://{host}/usr/svn/`). */
  repoBase: string;
  repoRoots: string[];
  projects: Project[];
  sshMode: SshMode;
  theme: "dark" | "light" | "system";
  externalDiffTool: string;
  verbose: boolean;
  confirmServerOps: boolean;
  /**
   * Como oferecer um backup antes de operações destrutivas: `ask` (pergunta a
   * cada vez), `always` (faz sempre, sem perguntar) ou `off` (nunca oferece).
   */
  backupMode: "ask" | "always" | "off";
  /** Quantos backups manter por working copy (0 = ilimitado). */
  backupKeep: number;
  /** Pasta-base dos backups. Vazio = `~/.cache/subversa/backups`. */
  backupDir: string;
}
