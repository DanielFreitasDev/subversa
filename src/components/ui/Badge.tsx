import { GitBranch, TreePine } from "lucide-react";

import { cn, statusMeta } from "@/lib/utils";
import type { BranchKind } from "@/lib/types";

/** Selo genérico. */
export function Badge({
  children,
  className,
  tone = "neutral",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "neutral" | "brand" | "success" | "warn" | "danger" | "info";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-panel-3 text-muted border-line",
    brand: "bg-brand/12 text-brand border-brand/25",
    success: "bg-success/12 text-success border-success/25",
    warn: "bg-warn/12 text-warn border-warn/25",
    danger: "bg-danger/12 text-danger border-danger/25",
    info: "bg-info/12 text-info border-info/25",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Letra de status (M/A/D/?/C...) em um quadradinho colorido. */
export function StatusLetter({ item, props }: { item: string; props?: string }) {
  const meta = statusMeta(item, props);
  return (
    <span
      title={meta.label}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] border font-mono text-[11px] font-bold",
        meta.text,
        meta.bg,
        meta.border,
      )}
    >
      {meta.letter}
    </span>
  );
}

/** Indicador de linha: trunk (verde) ou branch (roxo). */
export function BranchBadge({
  kind,
  label,
  className,
}: {
  kind: BranchKind;
  label: string;
  className?: string;
}) {
  const isTrunk = kind === "trunk";
  const Icon = isTrunk ? TreePine : GitBranch;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        isTrunk
          ? "bg-trunk/12 text-trunk border-trunk/25"
          : "bg-branch/12 text-branch border-branch/25",
        className,
      )}
      title={label}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{isTrunk ? "linha principal" : label}</span>
    </span>
  );
}
