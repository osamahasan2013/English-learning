import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const inputClasses =
  "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-3 text-base text-foreground placeholder:text-muted focus:border-primary";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block font-semibold">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-muted text-sm">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-danger text-sm font-semibold" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClasses, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputClasses, className)} {...props} />;
}

export function FormMessage({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  return <Alert tone={tone}>{children}</Alert>;
}
