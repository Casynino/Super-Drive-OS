"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

export type RowField = {
  name: string;
  label: string;
  kind?: "text" | "select" | "checkbox";
  value?: string | boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
};

/**
 * One line of a settings list, with no labels of its own: the list has ONE header above all lines, so the columns line up.
 * `template` is the grid-template-columns of the fields. The same component adds a new line (primary button) or saves an existing one.
 */
export default function ListRow({
  action,
  hidden,
  fields,
  template,
  button,
  primary = false,
  disabled = false,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  hidden?: Record<string, string>;
  fields: RowField[];
  template: string;
  button: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  // a line that was just added is empty again, ready for the next one
  useEffect(() => {
    if (primary && state.ok) form.current?.reset();
  }, [primary, state]);
  const err = state.error ? (state.fieldErrors ? Object.values(state.fieldErrors)[0] ?? state.error : state.error) : null;
  return (
    <form ref={form} action={formAction} noValidate className="min-w-0 flex-1">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="flex items-center gap-3">
        <div className="grid min-w-0 flex-1 items-center gap-3" style={{ gridTemplateColumns: template }}>
          {fields.map((f) =>
            f.kind === "checkbox" ? (
              <label key={f.name} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name={f.name} defaultChecked={Boolean(f.value)} disabled={disabled} className="h-4 w-4 rounded border-slate-300 text-navy-700" aria-label={f.label} />
                <span className="truncate">{f.label}</span>
              </label>
            ) : f.kind === "select" ? (
              <select key={f.name} name={f.name} defaultValue={String(f.value ?? "")} disabled={disabled} className="input h-9 py-0" aria-label={f.label}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input key={f.name} name={f.name} defaultValue={String(f.value ?? "")} placeholder={f.placeholder ?? f.label} disabled={disabled} autoComplete="off" className="input h-9 py-0" aria-label={f.label} />
            ),
          )}
        </div>
        {!disabled && (
          <SubmitButton className={primary ? "btn-primary btn-sm min-w-[4.75rem] justify-center" : "btn-secondary btn-sm min-w-[4.75rem] justify-center"} pendingLabel="…">
            {button}
          </SubmitButton>
        )}
      </div>
      {err && <p className="field-error mt-1">{err}</p>}
      {state.ok && !err && <p className="mt-1 text-xs text-emerald-600">{state.message ?? "Saved."}</p>}
    </form>
  );
}
