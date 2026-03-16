import { type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: `bg-cyan-dim border border-cyan/30 text-cyan
             hover:bg-cyan-mid
             active:scale-[0.98]`,
  ghost:   `bg-transparent text-text-muted
             hover:text-text-subtle hover:bg-surface2
             active:scale-[0.98]`,
  outline: `bg-surface2 border border-border text-text-subtle
             hover:border-border-hi hover:text-text-base
             active:scale-[0.98]`,
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs rounded",
  md: "px-4 py-2 text-sm rounded",
  lg: "px-5 py-2.5 text-sm rounded-lg",
};

export function Button({
  variant = "outline",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`
        inline-flex items-center justify-center gap-2
        font-semibold transition-all duration-[220ms] cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]} ${sizes[size]} ${className}
      `}
    >
      {children}
    </button>
  );
}
