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

export interface Project {
  key: string;
  name: string;
  description: string;
  url: string;
}

export interface AppConfig {
  baseDir: string;
  host: string;
  repoRoots: string[];
  projects: Project[];
  sshMode: SshMode;
  theme: "dark" | "light" | "system";
  externalDiffTool: string;
  verbose: boolean;
  confirmServerOps: boolean;
}
