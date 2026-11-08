import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist } from "next/font/google";
import { THEME_COLOR } from "@/lib/theme-client";
import RegisterSW from "@/components/RegisterSW";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

// The address people share. Link previews (WhatsApp, Facebook, LinkedIn, Telegram, iMessage) need an ABSOLUTE picture address, which is built from this.
const siteUrl = (process.env.APP_URL ?? "https://super-drive-os.vercel.app").replace(/\/$/, "");
const shareText = "Sales, stock and credit in one place. Every sale, payment and stock movement is recorded against the person who made it.";
const shareImage = { url: "/brand/og-share.png", width: 1200, height: 630, alt: "Super Drive Oil: the logo and the products" };

// iPhone screen sizes (CSS points wide, high, pixel ratio) that have a launch picture in public/brand/splash
const SPLASH = [
  [440, 956, 3], [430, 932, 3], [428, 926, 3], [420, 912, 3], [414, 896, 3], [414, 896, 2], [414, 736, 3],
  [402, 874, 3], [393, 852, 3], [390, 844, 3], [375, 812, 3], [375, 667, 2], [320, 568, 2],
] as const;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Super Drive Oil", template: "%s · Super Drive Oil" },
  description: shareText,
  robots: { index: false, follow: false },
  // the card people see when the link is shared (the tab icon is src/app/icon.png)
  openGraph: { type: "website", siteName: "Super Drive Oil", title: "Super Drive Oil", description: shareText, url: "/", images: [shareImage] },
  twitter: { card: "summary_large_image", title: "Super Drive Oil", description: shareText, images: [shareImage.url] },
  // on an iPhone or iPad "Add to Home Screen" opens it full screen, like an app: the page runs under the status bar (black-translucent), and
  // the launch screen is navy with the logo instead of a white flash (pictures made by scripts/make-brand-images.mjs, one per iPhone size)
  appleWebApp: {
    capable: true,
    title: "Super Drive",
    statusBarStyle: "black-translucent",
    startupImage: SPLASH.map(([w, h, r]) => ({ url: `/brand/splash/${w}x${h}@${r}.png`, media: `screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)` })),
  },
  other: { "apple-mobile-web-app-capable": "yes" },
  formatDetection: { telephone: false },
};

// The phone paints its own top bar (the browser bar, or the status bar of the installed app) in this colour, so it follows the look the person chose.
export async function generateViewport(): Promise<Viewport> {
  const dark = (await cookies()).get("sd-theme")?.value !== "light";
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover", // use the whole screen, including behind the notch; the pages keep their own safe margins
    themeColor: dark ? THEME_COLOR.dark : THEME_COLOR.light,
    colorScheme: dark ? "dark" : "light", // tells Chrome, Samsung and Huawei browsers the page has its own dark look, so their "force dark mode" does not invert it
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark is the default look; a person who switched to light keeps it (remembered in a cookie so there is no flash).
  const dark = (await cookies()).get("sd-theme")?.value !== "light";
  return (
    <html lang="en" className={`${geist.variable}${dark ? " dark" : ""}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        {/* The installed app runs under the phone's status bar (clock, battery). This strip is that bar's own colour so the clock stays readable
            in both looks; it has no height in a browser tab, where the browser draws its own bar. */}
        <div aria-hidden className="status-strip" />
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
