import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted", className)} />;
}

/** Bloco de carregamento centralizado com legenda opcional. */
export function Loading({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-16 text-muted", className)}>
      <Loader2 className="size-6 animate-spin text-brand" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}
