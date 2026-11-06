import { randomUUID } from "node:crypto";
import { CheckCircle2, KeyRound, MessageCircle } from "lucide-react";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import SendReportForm from "@/components/reports/SendReportForm";
import SendPeriodForm from "@/components/reports/SendPeriodForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { can } from "@/lib/auth/can";
import { businessDay } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { getReportSettings } from "@/lib/reports/whatsapp";
import { formatDate, formatDateTime } from "@/lib/utils";
import { saveReportSettings, sendPeriodNowAction, sendReportNowAction } from "./actions";

export const metadata = { title: "WhatsApp reports" };

export default async function WhatsAppSettingsPage() {
  const user = await requirePagePermission("settings.view");
  const canManage = can(user, "settings.manage");
  const [s, log] = await Promise.all([getReportSettings(db), db.whatsAppReport.findMany({ orderBy: { createdAt: "desc" }, take: 40 })]);
  void randomUUID;

  return (
    <>
      <PageHeader title="WhatsApp reports" back={{ href: "/settings", label: "Settings" }} description="The reports come to your WhatsApp by themselves, so you do not have to open the app." />

      <section className="card mb-5 grid divide-y divide-line overflow-hidden md:grid-cols-3 md:divide-x md:divide-y-0" aria-label="What you receive">
        {[
          { title: "Every day", when: "As soon as the shop closes the day", what: "The day's summary and a detailed report, with a link to the full report. If the day is still not closed in the evening, you get a notice instead." },
          { title: "Every week", when: "Sunday at 09:00", what: "The business report of the seven days up to Saturday: sales and growth, money, expenses, best sellers and the cash count.", kind: "WEEKLY" as const, button: "Send last week's now" },
          { title: "Every month", when: "The 1st at 09:00", what: "The business report of the whole month before, in the same way.", kind: "MONTHLY" as const, button: "Send last month's now" },
        ].map((r) => (
          <div key={r.title} className="px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{r.title}</p>
            <p className="mt-1 text-base font-semibold text-slate-900">{r.when}</p>
            <p className="mt-1 text-sm text-slate-600">{r.what}</p>
            {r.kind && canManage && (
              <div className="mt-3">
                <SendPeriodForm action={sendPeriodNowAction} kind={r.kind} label={r.button} disabled={!s.phone || !s.keyConfigured} />
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="mb-1 text-base font-semibold text-slate-900">Where and when</h2>
          <p className="mb-4 text-sm text-slate-500">Tanzania time. The day's report is sent as soon as the shop closes the day. If the day is still not closed at the time below, you get a notice instead.</p>
          <EntityForm
            action={saveReportSettings}
            submitLabel="Save"
            disabled={!canManage}
            fields={[
              { name: "reportPhone", label: "Your WhatsApp number", value: s.phone, placeholder: "255712345678", hint: "International format, digits only. Leave empty to switch reports off." },
              { name: "reportTime", label: "Closing reminder at (24-hour)", value: s.time, placeholder: "20:00" },
              { name: "reportEnabled", label: "Send the reports (daily, weekly and monthly)", type: "checkbox", value: s.enabled },
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
            <li>For the automatic weekly and monthly send, and the evening notice, set <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">CRON_SECRET</code> (a long random value) so only your scheduler can start them.</li>
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
                      {r.kind === "SUMMARY" ? "Day summary" : r.kind === "EXCEPTION" ? "Closing pending notice" : r.kind === "WEEKLY" ? "Weekly report" : r.kind === "MONTHLY" ? "Monthly report" : `Detailed report ${r.part}/${r.parts}`}
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
