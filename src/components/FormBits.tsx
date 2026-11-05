"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  className = "btn-primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending && <Loader2 size={16} className="animate-spin" />}
      {pending ? pendingLabel : children}
    </button>
  );
}

export function Field({
  label,
  name,
  id,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  name: string;
  /** DOM id of the input (defaults to name). Pass a unique one when several forms share a page. */
  id?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id ?? name} className="label">
        {label}
        {required && <span className="ml-0.5 text-brand-red">*</span>}
      </label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && (
        <p className="field-error" id={`${id ?? name}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass = (error?: string) => cn("input", error && "input-error");
