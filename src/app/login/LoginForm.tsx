"use client";

import { useActionState } from "react";
import { login } from "@/lib/auth/actions";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

const initial: ActionState = {};

export default function LoginForm() {
  const [state, action] = useActionState(login, initial);
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      {state.error && !state.fieldErrors && <Alert>{state.error}</Alert>}
      <Field label="Username" name="username" error={fe.username}>
        <input id="username" name="username" autoComplete="username" autoCapitalize="none" autoFocus className={inputClass(fe.username)} />
      </Field>
      <Field label="Password" name="password" error={fe.password}>
        <input id="password" name="password" type="password" autoComplete="current-password" className={inputClass(fe.password)} />
      </Field>
      <SubmitButton pendingLabel="Signing in…" className="btn-primary w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}
