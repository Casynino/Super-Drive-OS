// The newest version the server is running (the id baked into this build, see next.config.ts). Public on purpose: it is only a commit id, and the
// "New update" notice in the app compares it with the one its own page was built from. Never cached, or the notice would never see a new version.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ id: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
