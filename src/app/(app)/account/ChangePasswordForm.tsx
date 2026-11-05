"use client";

import { useActionState } from "react";
import { changePassword } from "@/lib/auth/actions";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

const initial: ActionState = {};

export default function ChangePasswordForm() {
  const [state, action] = useActionState(changePassword, initial);
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="mt-5 space-y-4" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="Current password" name="current" error={fe.current}>
        <input id="current" name="current" type="password" autoComplete="current-password" className={inputClass(fe.current)} />
      </Field>
      <Field label="New password" name="next" error={fe.next} hint="At least 8 characters with a letter and a number.">
        <input id="next" name="next" type="password" autoComplete="new-password" className={inputClass(fe.next)} />
      </Field>
      <Field label="Confirm new password" name="confirm" error={fe.confirm}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={inputClass(fe.confirm)} />
      </Field>
      <SubmitButton>Change password</SubmitButton>
    </form>
  );
}
