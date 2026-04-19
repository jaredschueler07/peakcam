import { type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "accent" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

// pc-btn base: pill radius, ink border, white bg, stamp shadow, hover lifts, active presses
const base = `
  inline-flex items-center justify-center gap-2
  font-semibold tracking-wide
  rounded-full border-[1.5px] border-ink
  transition-transform duration-100 ease-out
  disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
  hover:-translate-x-[1px] hover:-translate-y-[1px]
  active:translate-x-[2px] active:translate-y-[2px]
`;

const variants: Record<Variant, string> = {
  // Primary: forest green with cream text
  primary: `bg-forest text-cream-50 shadow-stamp hover:shadow-stamp-hover active:shadow-stamp-sm`,
  // Accent: alpenglow persimmon with cream text
  accent:  `bg-alpen text-cream-50 shadow-stamp hover:shadow-stamp-hover active:shadow-stamp-sm`,
  // Outline: white paper bg, ink border, ink text (the default pc-btn)
  outline: `bg-snow text-ink shadow-stamp hover:shadow-stamp-hover active:shadow-stamp-sm`,
  // Ghost: transparent, no shadow, no lift
  ghost:   `bg-transparent border-transparent text-ink shadow-none
              hover:translate-x-0 hover:translate-y-0 hover:bg-ink/5
              active:translate-x-0 active:translate-y-0`,
};

const sizes: Record<Size, string> = {
  sm: "px-3.5 py-[7px] text-[13px]",
  md: "px-5 py-3 text-[15px]",
  lg: "px-6 py-3.5 text-base",
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
        ${base}
        ${variants[variant]}
        ${sizes[size]}
        ${className}
      `}
    >
      {children}
    </button>
  );
}
