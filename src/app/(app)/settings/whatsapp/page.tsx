import { randomUUID } from "node:crypto";
import { CheckCircle2, KeyRound, MessageCircle } from "lucide-react";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import SendReportForm from "@/components/reports/SendReportForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { can } from "@/lib/auth/can";
import { businessDay } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { getReportSettings } from "@/lib/reports/whatsapp";
import { formatDate, formatDateTime } from "@/lib/utils";
import { saveReportSettings, sendReportNowAction } from "./actions";

export const metadata = { title: "WhatsApp reports" };

export default async function WhatsAppSettingsPage() {
  const user = await requirePagePermission("settings.view");
  const canManage = can(user, "settings.manage");
  const [s, log] = await Promise.all([getReportSettings(db), db.whatsAppReport.findMany({ orderBy: { createdAt: "desc" }, take: 40 })]);
  void randomUUID;

  return (
    <>
      <PageHeader title="WhatsApp daily report" back={{ href: "/settings", label: "Settings" }} description="Every evening the system sends you the day's summary and a detailed report on WhatsApp, so you do not have to open the app. It is sent only after the shop has closed the day; if the day is not closed you get a notice instead." />

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="mb-1 text-base font-semibold text-slate-900">Where and when</h2>
          <p className="mb-4 text-sm text-slate-500">Tanzania time. If the shop closes after this time, the report is sent as soon as the closing is submitted.</p>
          <EntityForm
            action={saveReportSettings}
            submitLabel="Save"
            disabled={!canManage}
            fields={[
              { name: "reportPhone", label: "Your WhatsApp number", value: s.phone, placeholder: "255712345678", hint: "International format, digits only. Leave empty to switch reports off." },
              { name: "reportTime", label: "Send at (24-hour)", value: s.time, placeholder: "20:00" },
              { name: "reportEnabled", label: "Send the report every day", type: "checkbox", value: s.enabled },
            ]}
          />
        </section>

        <section className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
            <KeyRound size={17} /> CallMeBot connection
          </h2>
          {s.keyConfigured ? (
            <Alert kind="success">
              <span className="flex items-center gap-2">
                <CheckCircle2 size={16} /> The CallMeBot key is set on the server.
              </span>
            </Alert>
          ) : (
            <Alert kind="info">The CallMeBot API key is not set on the server yet. It is kept as a secret in the server settings (CALLMEBOT_API_KEY) and is never shown in the app.</Alert>
          )}
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>
              Follow the steps at <span className="font-medium text-slate-800">callmebot.com</span> (&ldquo;Free API WhatsApp messages&rdquo;) to link your WhatsApp number and get your API key.
            </li>
            <li>Put the key in the server setting <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">CALLMEBOT_API_KEY</code>.</li>
            <li>For the automatic daily send, set <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">CRON_SECRET</code> (a long random value) so only your scheduler can start it.</li>
          </ol>
          {canManage && (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Send a report now</h3>
              <SendReportForm action={sendReportNowAction} today={businessDay()} disabled={!s.phone || !s.keyConfigured} />
              {(!s.phone || !s.keyConfigured) && <p className="mt-2 text-xs text-slate-500">Set your number and the server key first.</p>}
            </div>
          )}
        </section>
      </div>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">What was sent</h2>
        {log.length === 0 ? (
          <EmptyState icon={<MessageCircle size={22} />} title="Nothing has been sent yet" description="Each message the system sends appears here with its delivery status." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Message</th>
                  <th className="hidden sm:table-cell">How</th>
                  <th>Status</th>
                  <th className="hidden md:table-cell">Tries</th>
                  <th className="hidden lg:table-cell">When</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{formatDate(r.businessDate)}</td>
                    <td>
                      {r.kind === "SUMMARY" ? "Summary" : r.kind === "EXCEPTION" ? "Closing pending notice" : `Detailed report ${r.part}/${r.parts}`}
                      {r.error && <span className="block max-w-[260px] truncate text-xs text-brand-red-dark">{r.error}</span>}
                    </td>
                    <td className="hidden sm:table-cell">{r.trigger === "SCHEDULED" ? "Scheduled" : "Sent by you"}</td>
                    <td>{r.status === "SENT" ? <span className="badge-green">Sent</span> : r.status === "FAILED" ? <span className="badge-red">Failed</span> : <span className="badge-yellow">{r.status === "SENDING" ? "Sending" : "Waiting"}</span>}</td>
                    <td className="hidden md:table-cell">{r.attempts}</td>
                    <td className="hidden whitespace-nowrap text-slate-600 lg:table-cell">{formatDateTime(r.sentAt ?? r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
