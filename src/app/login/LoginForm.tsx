"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { login } from "@/lib/auth/actions";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/action";

const initial: ActionState = {};

export default function LoginForm() {
  const [state, action] = useActionState(login, initial);
  const [show, setShow] = useState(false);
  const fe = state.fieldErrors ?? {};
  const user = useRef<HTMLInputElement>(null);
  // on a computer the cursor is ready in the email box; on a phone or tablet it is not (the keyboard and the password-manager popup would cover the page)
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) user.current?.focus();
  }, []);

  return (
    <form action={action} className="mt-7 space-y-4" noValidate>
      {state.error && !state.fieldErrors && <Alert>{state.error}</Alert>}
      <Field label="Email address" name="email" error={fe.email}>
        <div className="relative">
          <Mail size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input ref={user} id="email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" defaultValue={state.values?.email ?? ""} className={cn(inputClass(fe.email), "h-11 pl-10")} />
        </div>
      </Field>
      <Field label="Password" name="password" error={fe.password}>
        <div className="relative">
          <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" enterKeyHint="go" className={cn(inputClass(fe.password), "h-11 pl-10 pr-11")} />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </Field>
      <SubmitButton pendingLabel="Logging in…" className="btn-primary h-11 w-full text-[15px]">
        <span className="inline-flex items-center gap-2">
          Log in
          <ArrowRight size={16} />
        </span>
      </SubmitButton>
      <p className="text-center text-xs text-slate-500">Forgot your password? Ask the Director to reset it for you.</p>
    </form>
  );
}
