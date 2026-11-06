// The web address of the app, for links inside WhatsApp reports. Set APP_URL (e.g. https://shop.example.com); on Vercel the
// production address is used when APP_URL is not set. With neither, reports are sent without a link (never a made-up one).
export function appBaseUrl(): string | null {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}
