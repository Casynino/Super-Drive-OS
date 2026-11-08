import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

// The address people share. Link previews (WhatsApp, Facebook, LinkedIn, Telegram, iMessage) need an ABSOLUTE picture address, which is built from this.
const siteUrl = (process.env.APP_URL ?? "https://super-drive-os.vercel.app").replace(/\/$/, "");
const shareText = "Sales, stock and credit in one place. Every sale, payment and stock movement is recorded against the person who made it.";
const shareImage = { url: "/brand/og-share.png", width: 1200, height: 630, alt: "Super Drive Oil: the logo and the products" };

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Super Drive Oil", template: "%s · Super Drive Oil" },
  description: shareText,
  robots: { index: false, follow: false },
  // the card people see when the link is shared (the tab icon is src/app/icon.png)
  openGraph: { type: "website", siteName: "Super Drive Oil", title: "Super Drive Oil", description: shareText, url: "/", images: [shareImage] },
  twitter: { card: "summary_large_image", title: "Super Drive Oil", description: shareText, images: [shareImage.url] },
  // on an iPhone or iPad "Add to Home Screen" opens it full screen, like an app
  appleWebApp: { capable: true, title: "Super Drive", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // use the whole screen, including behind the notch; the pages keep their own safe margins
  themeColor: "#0a1a33",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark is the default look; a person who switched to light keeps it (remembered in a cookie so there is no flash).
  const dark = (await cookies()).get("sd-theme")?.value !== "light";
  return (
    <html lang="en" className={`${geist.variable}${dark ? " dark" : ""}`} suppressHydrationWarning>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
