import { BannerBell, bannerDate } from "@/components/BannerBell";
import BannerTheme from "@/components/BannerTheme";

/**
 * The banner at the top of a person's home (the shop person's POS and the warehouse attendant's Today): his first name big in spaced
 * capitals between two thin yellow lines, his position small in yellow under it, then the date; the bell and the night / light icon
 * sit small at the left side, in the middle (a phone has them in its own top bar and menu). Like the Target Express banner, and the
 * same look on a phone.
 */
export default function HomeBanner({ user }: { user: { id: string; name: string; roleName: string } }) {
  return (
    <section className="relative mb-5 overflow-hidden rounded-2xl bg-[#0a1a33] text-white shadow-[0_10px_30px_-14px_rgba(5,22,39,0.7)] ring-1 ring-white/10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_220px_at_88%_55%,rgba(47,111,208,0.42),transparent_62%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(520px_170px_at_50%_0%,rgba(253,196,0,0.10),transparent_72%)]" aria-hidden />
      {/* the shop's real products: a faint picture on a phone, full size from a computer */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/banner-products.webp" alt="" aria-hidden className="pointer-events-none absolute bottom-0 right-0 block h-full w-auto max-w-[70%] select-none object-contain object-right-bottom opacity-25 lg:max-w-[32%] lg:opacity-100" />
      <div className="absolute left-6 top-1/2 z-10 flex -translate-y-1/2 items-center gap-2">
        <BannerBell userId={user.id} className="relative h-8 w-8" />
        <BannerTheme className="h-8 w-8" />
      </div>
      <div className="relative flex min-h-[7.5rem] flex-col items-center justify-center px-5 py-5 text-center">
        <h1 className="flex max-w-full items-center gap-4 text-3xl font-semibold uppercase tracking-[0.35em] text-white sm:text-4xl">
          <span className="hidden h-px w-10 shrink-0 bg-oil-400/60 sm:block" aria-hidden />
          <span className="min-w-0 truncate pl-[0.35em]">{user.name.trim().split(/\s+/)[0]}</span>
          <span className="hidden h-px w-10 shrink-0 bg-oil-400/60 sm:block" aria-hidden />
        </h1>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-oil-400">{user.roleName}</p>
        <p className="mt-1.5 text-sm text-white/65" suppressHydrationWarning>
          {bannerDate()}
        </p>
      </div>
    </section>
  );
}
