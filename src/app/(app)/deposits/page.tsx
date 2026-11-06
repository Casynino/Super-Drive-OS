import { redirect } from "next/navigation";

/** Bank deposits are part of Closing now (one page for the end of the day). Old links land there. */
export default async function DepositsPage({ searchParams }: { searchParams: Promise<{ recorded?: string }> }) {
  const sp = await searchParams;
  redirect(sp.recorded ? `/closing?banked=${encodeURIComponent(sp.recorded)}` : "/closing");
}
