"use client";

import { useActionState } from "react";
import { updateProfile } from "@/lib/auth/actions";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

const initial: ActionState = {};

export default function ProfileForm({ name, email, phone }: { name: string; email: string; phone: string }) {
  const [state, action] = useActionState(updateProfile, initial);
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? { name, email, phone };

  return (
    <form action={action} className="mt-5 space-y-4" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && <Alert kind="success">{state.message}</Alert>}
      <Field label="Full name" name="name" error={fe.name} required>
        <input id="name" name="name" defaultValue={v.name} autoComplete="name" className={inputClass(fe.name)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" name="phone" error={fe.phone}>
          <input id="phone" name="phone" type="tel" defaultValue={v.phone} autoComplete="tel" className={inputClass(fe.phone)} />
        </Field>
        <Field label="Email" name="email" error={fe.email}>
          <input id="email" name="email" type="email" defaultValue={v.email} autoComplete="email" className={inputClass(fe.email)} />
        </Field>
      </div>
      <SubmitButton>Save details</SubmitButton>
    </form>
  );
}
