import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm",
  secondary: "bg-surface text-foreground border-2 border-border hover:bg-surface-muted",
  ghost: "text-foreground hover:bg-surface-muted",
  success: "bg-success text-white hover:brightness-110 shadow-sm",
  danger: "bg-danger text-white hover:brightness-110",
} as const;

const sizes = {
  sm: "min-h-9 px-3 text-sm rounded-lg",
  md: "min-h-11 px-4 text-base rounded-xl",
  lg: "min-h-14 px-6 text-lg rounded-2xl",
  // Child-sized: comfortably above the 44px minimum touch target.
  xl: "min-h-20 px-8 text-2xl rounded-3xl",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition select-none disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});

export function buttonClasses(
  variant: keyof typeof variants = "primary",
  size: keyof typeof sizes = "md",
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center gap-2 font-semibold transition select-none",
    variants[variant],
    sizes[size],
    className,
  );
}
