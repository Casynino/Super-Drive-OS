"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * "Back" like in an app: it returns to the page you really came from (with its filters and scroll as you left them), not to a fixed
 * parent. When you came from a form (new, edit, pay...) or opened the page directly, it goes to the page given as `href` instead,
 * so Back never drops you into a form you already filled in.
 */
const FORM_PAGE = /\/(new|edit|pay|issue|sold|return|receive|move)(\/|$)/;

export default function BackLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        try {
          const prev = sessionStorage.getItem("sdoPrev");
          const here = sessionStorage.getItem("sdoCur");
          if (prev && prev !== here && !FORM_PAGE.test(prev) && window.history.length > 1) {
            e.preventDefault();
            router.back();
          }
        } catch {
          /* no storage: the plain link works */
        }
      }}
    >
      {children}
    </Link>
  );
}
