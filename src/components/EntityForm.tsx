"use client";

import { useActionState, useId } from "react";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "password" | "email" | "select" | "checkbox" | "textarea";
  value?: string | boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  /** grid column span at md+ (grid layout only) */
  span?: 1 | 2;
};

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  fields: FieldDef[];
  submitLabel: string;
  hidden?: Record<string, string>;
  /** inline = one compact row (settings lists); grid = 2-column form */
  layout?: "inline" | "grid";
  successMessage?: string;
  submitClass?: string;
  disabled?: boolean;
};

const initial: ActionState = {};

export default function EntityForm({ action, fields, submitLabel, hidden, layout = "grid", successMessage, submitClass, disabled }: Props) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className={layout === "inline" ? "space-y-2" : "space-y-4"}>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}

      <div className={cn(layout === "inline" ? "flex flex-wrap items-end gap-3" : "grid gap-4 md:grid-cols-2")}>
        {fields.map((f) => {
          const current = state.values?.[f.name];
          const err = fe[f.name];

          if (f.type === "checkbox") {
            const checked = current !== undefined ? current === "on" : Boolean(f.value);
            return (
              <label key={f.name} className={cn("flex min-h-9 items-center gap-2 text-sm text-slate-700", layout === "grid" && f.span === 2 && "md:col-span-2")}>
                <input type="checkbox" name={f.name} defaultChecked={checked} disabled={f.disabled || disabled} className="h-4 w-4 rounded border-slate-300 text-navy-700" />
                {f.label}
              </label>
            );
          }

          const wrapper = layout === "inline" ? "min-w-[9rem] flex-1" : f.span === 2 ? "md:col-span-2" : undefined;
          const dv = current ?? (typeof f.value === "string" ? f.value : "");

          return (
            <Field key={f.name} label={f.label} name={f.name} id={`${uid}-${f.name}`} error={err} hint={f.hint} required={f.required} className={wrapper}>
              {f.type === "select" ? (
                <select id={`${uid}-${f.name}`} name={f.name} defaultValue={dv} disabled={f.disabled || disabled} className={inputClass(err)}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea id={`${uid}-${f.name}`} name={f.name} rows={2} defaultValue={dv} disabled={f.disabled || disabled} className={inputClass(err)} />
              ) : (
                <input
                  id={`${uid}-${f.name}`}
                  name={f.name}
                  type={f.type ?? "text"}
                  defaultValue={f.type === "password" ? undefined : dv}
                  placeholder={f.placeholder}
                  autoComplete={f.autoComplete}
                  disabled={f.disabled || disabled}
                  className={inputClass(err)}
                />
              )}
            </Field>
          );
        })}
        {!disabled && (
          <div className={layout === "inline" ? "" : "md:col-span-2"}>
            <SubmitButton className={submitClass ?? "btn-primary"}>{submitLabel}</SubmitButton>
          </div>
        )}
      </div>

      {state.error && !state.fieldErrors && <Alert>{state.error}</Alert>}
      {state.error && state.fieldErrors && layout === "inline" && <p className="field-error">{state.error}</p>}
      {state.ok && <Alert kind="success">{state.message ?? successMessage ?? "Saved."}</Alert>}
    </form>
  );
}
