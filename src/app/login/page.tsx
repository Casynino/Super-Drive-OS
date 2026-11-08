import type { CSSProperties } from "react";
import BrandLogo from "@/components/BrandLogo";
import { redirect } from "next/navigation";
import { Boxes, HandCoins, Wallet } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import LoginForm from "./LoginForm";
import LoginGate from "./LoginGate";
import LoginScene from "./LoginScene";
import "./login.css";

export const metadata = { title: "Log in" };

const delay = (s: number) => ({ "--rd": `${s}s` }) as CSSProperties;

const FEATURES = [
  { icon: Boxes, label: "Live stock" },
  { icon: Wallet, label: "Cash and daily closing" },
  { icon: HandCoins, label: "Credit control" },
];

// the sign-in scene is always dark, so it always gets the logo with light lettering, with no white box behind it
const Logo = ({ className }: { className: string }) => <BrandLogo onDark className={className} priority />;

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-navy-900">
      {/* the animated scene fills the whole page */}
      <LoginScene />

      <div className="relative z-10 grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        {/* Words (wide screens) */}
        <section className="hidden flex-col justify-between p-12 text-white lg:flex">
          <div className="ls-up ls-brand w-fit min-[1360px]:invisible" style={delay(0.05)}>
            <Logo className="h-28 xl:h-36 2xl:h-44" />
          </div>

          <div className="mb-[clamp(190px,32vh,330px)] max-w-lg min-[1360px]:max-w-sm">
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

          <span aria-hidden />
        </section>

        {/* Sign-in card, floating over the scene */}
        <section className="flex flex-col items-center px-5 py-6 max-md:pt-[9vh] lg:justify-center lg:py-10">
          <div className="ls-up ls-brand mb-4 self-center md:mb-6 lg:hidden" style={delay(0.05)}>
            <Logo className="h-28 sm:h-28" />
          </div>
          {/* phones: the scene stays in view, with one small button that opens the form */}
          <p className="ls-up mb-5 mt-[12vh] max-w-[16rem] text-balance text-center text-[15px] leading-snug text-white/85 md:hidden" style={delay(0.25)}>
            Sales, stock and credit in one place
          </p>
          <LoginGate>
            <div className="ls-card ls-up w-full p-7 sm:p-8" style={delay(0.2)}>
              <h1 className="ls-title text-2xl font-semibold tracking-tight text-slate-900">Log in</h1>
              <LoginForm />
            </div>
          </LoginGate>
          <p className="mt-5 text-xs text-white/60 max-md:fixed max-md:inset-x-0 max-md:bottom-[max(1rem,env(safe-area-inset-bottom))] max-md:z-10 max-md:text-center max-md:text-white/50">Super Drive Oil · Management System</p>
        </section>
      </div>
    </div>
  );
}
