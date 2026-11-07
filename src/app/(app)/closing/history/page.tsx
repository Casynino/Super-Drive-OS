import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import ClosingsSection from "../ClosingsSection";

export const metadata = { title: "Past closings" };

/** The list of closings (and what was sent to the bank) on its own page, so the Closing page stays short. */
export default async function ClosingHistoryPage({ searchParams }: { searchParams: Promise<{ show?: string; shop?: string }> }) {
  const user = await requireUser();
  const canReview = can(user, "closing.approve");
  if (!can(user, "closing.submit") && !canReview) redirect("/forbidden");
  const sp = await searchParams;
  const show = sp.show === "short" || sp.show === "extra" ? sp.show : undefined;
  return (
    <>
      <PageHeader title="Past closings" />
      <ClosingsSection user={user} show={show} shop={sp.shop} basePath="/closing/history" kpis />
    </>
  );
}
