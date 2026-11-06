import type { CSSProperties } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Boxes, HandCoins, ShieldCheck, Wallet } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import LoginForm from "./LoginForm";
import LoginScene from "./LoginScene";
import "./login.css";

export const metadata = { title: "Sign in" };

const delay = (s: number) => ({ "--rd": `${s}s` }) as CSSProperties;

const FEATURES = [
  { icon: Boxes, label: "Live stock" },
  { icon: Wallet, label: "Cash and daily closing" },
  { icon: HandCoins, label: "Credit control" },
];

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Desktop: full animated scene */}
      <section className="relative hidden min-h-dvh overflow-hidden text-white lg:block">
        <LoginScene />
        <div className="relative z-10 flex min-h-dvh flex-col justify-between p-12">
          <div className="ls-up w-fit rounded-2xl bg-white px-6 py-4 shadow-lg" style={delay(0.05)}>
            <Image src="/brand/logo-full.png" alt="Super Drive Oil" width={900} height={456} className="brand-logo h-16 w-auto" priority />
          </div>

          <div className="mb-[clamp(190px,32vh,330px)] max-w-lg">
            <p className="ls-up mb-4 h-1 w-12 rounded bg-oil-400" style={delay(0.15)} />
            <h2 className="ls-up text-balance text-4xl font-semibold leading-[1.1] tracking-tight" style={delay(0.25)}>
              Sales, stock and credit <span className="text-oil-400">in one place.</span>
            </h2>
            <p className="ls-up mt-4 max-w-md text-[15px] leading-relaxed text-white/70" style={delay(0.4)}>
              Every sale, payment and stock movement is recorded against the person who made it.
            </p>
            <ul className="ls-up mt-6 flex flex-wrap gap-2" style={delay(0.55)}>
              {FEATURES.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-1.5 text-[13px] text-white/90">
                  <Icon size={15} className="text-oil-400" />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/55">Super Drive Oil · Management System</p>
        </div>
      </section>

      <section className="flex min-h-dvh flex-col">
        {/* Phone and tablet: compact version of the scene above the form */}
        <div className="relative h-56 shrink-0 overflow-hidden lg:hidden">
          <LoginScene variant="compact" />
          <div className="absolute left-4 top-4 z-10 rounded-xl bg-white px-3.5 py-2 shadow-lg">
            <Image src="/brand/logo-full.png" alt="Super Drive Oil" width={900} height={456} className="brand-logo h-10 w-auto" priority />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-10">
          <div className="ls-up w-full max-w-sm" style={delay(0.2)}>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Welcome back</h1>
            <p className="mt-1.5 text-sm text-slate-500">Sign in with the username your manager gave you.</p>
            <LoginForm />
            <p className="mt-8 flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck size={14} className="shrink-0 text-emerald-600" />
              Private system. Everything you do is recorded with your name.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
