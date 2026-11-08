import type { MetadataRoute } from "next";

/**
 * Lets the app be added to the home screen of a phone or tablet (or installed from the browser on a computer) and open full screen,
 * like an app, with its own icon and no browser bar.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Super Drive Oil",
    short_name: "Super Drive",
    description: "Sales, inventory and distribution management for Super Drive Oil.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    categories: ["business", "productivity"],
    lang: "en",
    orientation: "any",
    background_color: "#0a1a33",
    theme_color: "#0a1a33",
    icons: [
      { src: "/brand/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/app-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
