import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Super Drive Oil", template: "%s · Super Drive Oil" },
  description: "Sales, inventory and distribution management for Super Drive Oil.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e3d6e",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark is the default look; a person who switched to light keeps it (remembered in a cookie so there is no flash).
  const dark = (await cookies()).get("sd-theme")?.value !== "light";
  return (
    <html lang="en" className={`${inter.variable}${dark ? " dark" : ""}`} suppressHydrationWarning>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
