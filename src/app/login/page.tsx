import type { CSSProperties } from "react";
import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Boxes, HandCoins, Wallet } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import LoginForm from "./LoginForm";
import LoginGate from "./LoginGate";
import LoginScene from "./LoginScene";
import "./login.css";

export const metadata = { title: "Log in" };
// the sign-in scene is always dark navy, so the phone's top bar is too (in either look)
export const viewport = { themeColor: "#061a33" };

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
    <div data-login-scene className="relative isolate min-h-dvh overflow-hidden bg-[#061a33]">
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
        <section className="flex flex-col items-center py-6 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] max-md:pt-[max(9svh,calc(env(safe-area-inset-top)+1rem))] lg:justify-center lg:py-10">
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
        </section>
      </div>
      {/* Foot of the page: ONE quiet centred line, "Sales Inventory System by Nino", linking to Nino's page and work (Nino 2026-11-09; the words follow Hao Stock's "The Distribution Chain by Nino", not "Developed by"). */}
      <footer className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0 pb-[max(0.125rem,calc(env(safe-area-inset-bottom)_-_0.9rem))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-1 text-[11px] text-white/70 [text-shadow:0_1px_6px_rgba(3,8,18,0.95)] sm:bg-gradient-to-t sm:from-[#061a33]/85 sm:via-[#061a33]/45 sm:to-transparent sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pt-8 sm:text-xs sm:text-white/60 sm:[text-shadow:none]">
        <span>Sales Inventory System</span>
        <Link href="/nino" aria-label="Sales Inventory System by Nino: see his work" className="group inline-flex min-h-8 items-center gap-1 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oil-400 sm:min-h-10">
          by <span className="font-semibold text-white/85 transition-colors group-hover:text-oil-400 sm:text-white/80">Nino</span>
          <ArrowUpRight size={13} className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </Link>
      </footer>
    </div>
  );
}
