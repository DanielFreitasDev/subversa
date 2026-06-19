import { cn, colorFromString, initials } from "@/lib/utils";

export function Avatar({
  name,
  size = 28,
  className,
}: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const label = name ?? "?";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white/95 ring-1 ring-white/10",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(135deg, ${colorFromString(label)}, ${colorFromString(
          label + "x",
        )})`,
      }}
      title={label}
    >
      {initials(label)}
    </span>
  );
}
