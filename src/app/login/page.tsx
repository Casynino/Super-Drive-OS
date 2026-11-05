import Image from "next/image";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between bg-navy-800 p-12 text-white lg:flex">
        <div className="w-fit rounded-2xl bg-white px-6 py-4 shadow-lg">
          <Image src="/brand/logo-full.png" alt="Super Drive Oil" width={900} height={456} className="brand-logo h-20 w-auto" priority />
        </div>
        <div className="max-w-md">
          <p className="mb-3 h-1 w-12 rounded bg-oil-400" />
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Sales, stock and credit in one place.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-navy-200">
            Every sale, payment and stock movement is recorded against the person who made it.
          </p>
        </div>
        <p className="text-xs text-navy-300">Super Drive Oil · Management System</p>
      </section>

      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Image src="/brand/logo-full.png" alt="Super Drive Oil" width={900} height={456} className="brand-logo mx-auto h-20 w-auto" priority />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use the username your manager gave you.</p>
          <LoginForm />
        </div>
      </section>
    </div>
  );
}
