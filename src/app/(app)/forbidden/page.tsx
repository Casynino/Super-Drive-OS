import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "No access" };

export default function ForbiddenPage() {
  return (
    <div className="card mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={<ShieldAlert size={22} />}
        title="You do not have access to this page"
        description="Your role does not include this permission. Ask the business owner if you need it."
        action={
          <Link href="/dashboard" className="btn-primary">
            Back to dashboard
          </Link>
        }
      />
    </div>
  );
}
