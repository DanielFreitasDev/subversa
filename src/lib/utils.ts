/** Utilidades compartilhadas: classes, formatação e metadados de status. */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Junta classes condicionais resolvendo conflitos do Tailwind. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Decodifica `%20` → espaço (URLs do SVN). */
export function decodeUrl(s: string): string {
  return s.replace(/%20/g, " ");
}

/**
 * Decodifica uma URL apenas para EXIBIÇÃO — além de `%20`, resolve acentos
 * percent-encodados (`%C3%87`→`Ç`). Usa `decodeURIComponent` com fallback seguro
 * (string com `%` solto/escape inválido não quebra). **Nunca** use o resultado
 * para construir URLs reais — só para mostrar ao usuário; as URLs são montadas a
 * partir dos nomes literais do `svn list`.
 */
export function decodeUrlSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/%20/g, " ");
  }
}

/** Remove o prefixo `^/` da URL relativa do SVN. */
export function stripCaret(s: string): string {
  return s.replace(/^\^\//, "");
}

/** Formata bytes em unidade legível. */
export function formatBytes(bytes?: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
const abs = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Data relativa amigável ("há 2 dias"); cai para absoluta se muito antiga. */
export function formatRelative(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = (d.getTime() - Date.now()) / 1000;
  const a = Math.abs(diff);
  if (a < 60) return rtf.format(Math.round(diff), "second");
  if (a < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return abs.format(d);
}

/** Data absoluta completa (para tooltips). */
export function formatAbsolute(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return abs.format(d);
}

/** Iniciais de um autor para avatares. */
export function initials(name?: string | null): string {
  if (!name) return "?";
  const clean = name.replace(/[._-]/g, " ").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Cor estável (HSL) derivada de uma string — usada em avatares. */
export function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 55%)`;
}

// ---------------------------------------------------------------------------
// Metadados de status do `svn status`
// ---------------------------------------------------------------------------

export interface StatusMeta {
  /** Letra exibida (M, A, D, ?, !, C...). */
  letter: string;
  /** Rótulo legível. */
  label: string;
  /** Classe de cor do texto. */
  text: string;
  /** Classe de cor de fundo suave. */
  bg: string;
  /** Classe de cor da borda. */
  border: string;
}

const STATUS_MAP: Record<string, StatusMeta> = {
  modified: { letter: "M", label: "Modificado", text: "text-mod", bg: "bg-mod/12", border: "border-mod/30" },
  added: { letter: "A", label: "Adicionado", text: "text-add", bg: "bg-add/12", border: "border-add/30" },
  deleted: { letter: "D", label: "Removido", text: "text-del", bg: "bg-del/12", border: "border-del/30" },
  replaced: { letter: "R", label: "Substituído", text: "text-info", bg: "bg-info/12", border: "border-info/30" },
  unversioned: { letter: "?", label: "Fora do SVN", text: "text-new", bg: "bg-new/12", border: "border-new/30" },
  missing: { letter: "!", label: "Sumiu do disco", text: "text-conflict", bg: "bg-conflict/12", border: "border-conflict/30" },
  conflicted: { letter: "C", label: "Conflito", text: "text-conflict", bg: "bg-conflict/15", border: "border-conflict/40" },
  obstructed: { letter: "~", label: "Obstruído", text: "text-conflict", bg: "bg-conflict/12", border: "border-conflict/30" },
  ignored: { letter: "I", label: "Ignorado", text: "text-faint", bg: "bg-faint/10", border: "border-line" },
  external: { letter: "X", label: "Externo", text: "text-info", bg: "bg-info/10", border: "border-info/20" },
  incomplete: { letter: "!", label: "Incompleto", text: "text-warn", bg: "bg-warn/12", border: "border-warn/30" },
  normal: { letter: " ", label: "Normal", text: "text-muted", bg: "bg-transparent", border: "border-line" },
  none: { letter: " ", label: "—", text: "text-muted", bg: "bg-transparent", border: "border-line" },
};

export function statusMeta(item: string, props?: string): StatusMeta {
  const base = STATUS_MAP[item] ?? STATUS_MAP.none;
  // Quando só as propriedades mudaram, refletimos como modificação.
  if ((item === "normal" || item === "none") && (props === "modified" || props === "conflicted")) {
    return STATUS_MAP.modified;
  }
  return base;
}

/** Ação do `svn log -v`/merge (A/M/D/R/U/G/C) → metadados. */
const ACTION_MAP: Record<string, StatusMeta> = {
  A: STATUS_MAP.added,
  M: STATUS_MAP.modified,
  D: STATUS_MAP.deleted,
  R: STATUS_MAP.replaced,
  U: { letter: "U", label: "Atualizado", text: "text-info", bg: "bg-info/12", border: "border-info/30" },
  G: { letter: "G", label: "Mesclado", text: "text-info", bg: "bg-info/12", border: "border-info/30" },
  C: STATUS_MAP.conflicted,
};

export function actionMeta(action: string): StatusMeta {
  return ACTION_MAP[action.toUpperCase()] ?? STATUS_MAP.none;
}

/** Extensão de arquivo (para ícones/realce). */
export function fileExt(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Nome do arquivo (último segmento do caminho). */
export function baseName(path: string): string {
  const p = path.replace(/\/+$/, "");
  return p.split("/").pop() ?? p;
}

/** Diretório pai (para exibir caminho + nome separados). */
export function dirName(path: string): string {
  const p = path.replace(/\/+$/, "");
  const idx = p.lastIndexOf("/");
  return idx > 0 ? p.slice(0, idx) : "";
}

/** Pausa por `ms` (para pequenas transições). */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
