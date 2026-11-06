"use client";

import { useActionState, useId, useState } from "react";
import { Check, KeyRound, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
export type RoleChoice = { id: string; name: string; description: string; full: boolean; modules: string[] };
const initial: ActionState = {};

/** A readable temporary password: letters and numbers, no look-alike characters. */
function makePassword() {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const pick = (set: string, n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => set[x % set.length]).join("");
  return `${pick(letters, 4)}${pick(digits, 3)}${pick(letters, 3)}`;
}

/** Add a person: who they are, the role they hold (with what it allows), and a temporary password the owner can read out. */
export default function EmployeeForm({ action, roles }: { action: Action; roles: RoleChoice[] }) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const [name, setName] = useState(v.name ?? "");
  const [username, setUsername] = useState(v.username ?? "");
  const [touched, setTouched] = useState(Boolean(v.username));
  const [roleId, setRoleId] = useState(v.roleId ?? "");
  const [password, setPassword] = useState(v.password ?? "");

  return (
    <form action={formAction} noValidate className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {state.error && !Object.keys(fe).length && (
        <div className="lg:col-span-2">
          <Alert>{state.error}</Alert>
        </div>
      )}

      <div className="card card-pad space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-slate-900">Who is this?</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Full name" name="name" id={id("name")} error={fe.name} required>
              <input
                id={id("name")}
                name="name"
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!touched) setUsername(e.target.value.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "");
                }}
                className={cn(inputClass(fe.name), "h-11")}
              />
            </Field>
            <Field label="Username" name="username" id={id("user")} error={fe.username} required hint="What they type to sign in.">
              <input
                id={id("user")}
                name="username"
                autoComplete="off"
                value={username}
                onChange={(e) => {
                  setTouched(true);
                  setUsername(e.target.value.toLowerCase().replace(/\s/g, ""));
                }}
                className={cn(inputClass(fe.username), "h-11")}
              />
            </Field>
            <Field label="Phone" name="phone" id={id("phone")} error={fe.phone} hint="Optional.">
              <input id={id("phone")} name="phone" autoComplete="off" defaultValue={v.phone ?? ""} className={cn(inputClass(fe.phone), "h-11")} />
            </Field>
            <Field label="Email" name="email" id={id("email")} error={fe.email} hint="Optional.">
              <input id={id("email")} name="email" type="email" autoComplete="off" defaultValue={v.email ?? ""} className={cn(inputClass(fe.email), "h-11")} />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-900">First sign-in</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Temporary password" name="password" id={id("pw")} error={fe.password} required hint="At least 8 characters, with a letter and a number. They change it at first sign-in.">
              <input id={id("pw")} name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={cn(inputClass(fe.password), "h-11 font-mono tracking-wide")} />
            </Field>
            <button type="button" onClick={() => setPassword(makePassword())} className="btn-secondary mb-6 h-11 sm:mb-[1.65rem]">
              <KeyRound size={16} /> Make one
            </button>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <SubmitButton pendingLabel="Creating…" disabled={!name.trim() || !username || !roleId || password.length < 8}>
            Create employee
          </SubmitButton>
          <span className="text-xs text-slate-500">Then tell them the username and the temporary password.</span>
        </div>
      </div>

      <section className="card card-pad">
        <h2 className="text-sm font-semibold text-slate-900">
          Role <span className="text-brand-red">*</span>
        </h2>
        <p className="text-xs text-slate-500">The role decides what they can see and do.</p>
        <div className="mt-3 space-y-3">
          {roles.map((r) => {
            const on = roleId === r.id;
            return (
              <label key={r.id} className={cn("relative flex cursor-pointer gap-3 rounded-xl border px-4 py-3.5 transition", on ? "border-navy-600 bg-navy-50 ring-1 ring-navy-600/40" : "border-line bg-white hover:border-navy-200")}>
                <input type="radio" name="roleId" value={r.id} checked={on} onChange={() => setRoleId(r.id)} className="sr-only" />
                <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg", on ? "bg-navy-700 text-white" : "bg-slate-100 text-slate-500")}>{on ? <Check size={17} /> : <ShieldCheck size={17} />}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{r.name}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{r.description}</span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {r.full ? (
                      <span className="badge-yellow">Full access</span>
                    ) : (
                      r.modules.map((m) => (
                        <span key={m} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {m}
                        </span>
                      ))
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {fe.roleId && <p className="field-error mt-2">{fe.roleId}</p>}
      </section>
    </form>
  );
}
