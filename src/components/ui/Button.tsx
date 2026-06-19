import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-gradient text-brand-ink shadow-soft hover:brightness-110 active:brightness-95",
  secondary:
    "bg-panel-3 text-ink hover:bg-line-strong/60 border border-line",
  ghost: "text-muted hover:text-ink hover:bg-panel-2",
  outline: "border border-line text-ink hover:bg-panel-2 hover:border-line-strong",
  danger:
    "bg-danger/90 text-white hover:bg-danger shadow-soft active:brightness-95",
  subtle: "bg-brand/12 text-brand hover:bg-brand/20",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-lg justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center font-medium select-none",
        "transition-all duration-150 active:scale-[.98]",
        "disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export interface IconButtonProps extends ButtonProps {
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, variant = "ghost", className, ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size="icon"
      aria-label={label}
      title={label}
      className={className}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";
