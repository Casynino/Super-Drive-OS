"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { saveRolePermissions } from "../actions";

type Group = { module: string; permissions: { key: string; label: string }[] };

const initial: ActionState = {};

export default function PermissionMatrix({ roleId, groups, granted, lockedKeys }: { roleId: string; groups: Group[]; granted: string[]; lockedKeys: string[] }) {
  const [state, action] = useActionState(saveRolePermissions, initial);
  const on = new Set(granted);
  const locked = new Set(lockedKeys);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="roleId" value={roleId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message ?? "Saved."}</Alert>}

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <fieldset key={g.module} className="card card-pad">
            <legend className="sr-only">{g.module}</legend>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">{g.module}</h3>
            <div className="space-y-2.5">
              {g.permissions.map((p) => (
                <label key={p.key} className="flex items-start gap-2.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="perm"
                    value={p.key}
                    defaultChecked={on.has(p.key)}
                    disabled={locked.has(p.key)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-navy-700"
                  />
                  <span>
                    {p.label}
                    {locked.has(p.key) && <span className="ml-1 text-xs text-slate-400">(you do not have this yourself)</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <SubmitButton>Save permissions</SubmitButton>
      </div>
    </form>
  );
}
