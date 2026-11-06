import { CheckCircle2, KeyRound, MessageCircle } from "lucide-react";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { getReminderSettings, planReminders } from "@/lib/credit/auto-reminders";
import { TEMPLATE_BODY_LIMIT, templateBody } from "@/lib/credit/reminders";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { formatDateTime } from "@/lib/utils";
import { saveReminderSettings, sendRemindersNowAction } from "./actions";

export const metadata = { title: "Payment reminders" };

const code = "rounded bg-slate-100 px-1.5 py-0.5 text-xs";

export default async function ReminderSettingsPage() {
  const user = await requirePagePermission("settings.view");
  const canManage = can(user, "settings.manage");
  const [s, profile, currency] = await Promise.all([getReminderSettings(db), getBusinessProfile(), getCurrency()]);
  const [plan, log] = await Promise.all([planReminders(db, { everyDays: s.everyDays }), db.paymentReminder.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { customer: { select: { name: true } } } })]);
  const body = templateBody({ businessName: profile.name, businessPhone: profile.phone, paymentAccounts: profile.paymentAccounts });
  const tooLong = body.length > TEMPLATE_BODY_LIMIT;
  const money = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);

  return (
    <>
      <PageHeader
        title="Payment reminders"
        back={{ href: "/settings", label: "Settings" }}
        description="Customers and winga with a late invoice get a WhatsApp reminder by themselves, in Swahili, with the invoice, the amount and where to pay. It stays off until you switch it on. Staff can still send one by hand from the Credit page."
      />

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="mb-1 text-base font-semibold text-slate-900">When and how often</h2>
          <p className="mb-4 text-sm text-slate-500">Reminders go out every morning at 9:00 (Tanzania time). Nobody is messaged more than once a day.</p>
          <EntityForm
            action={saveReminderSettings}
            submitLabel="Save"
            disabled={!canManage}
            fields={[
              { name: "reminderAutoEnabled", label: "Send reminders automatically every morning", type: "checkbox", value: s.enabled },
              { name: "reminderEveryDays", label: "Repeat every (days)", value: String(s.everyDays), hint: "A customer is not reminded again before this many days have passed since their last reminder, whether it was automatic or sent by hand." },
              { name: "reminderTemplate", label: "WhatsApp template name", value: s.template, hint: "Exactly as it is named in WhatsApp Manager." },
              { name: "reminderLanguage", label: "Template language", value: s.language, hint: "sw for Swahili, en for English." },
            ]}
          />
        </section>

        <section className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
            <KeyRound size={17} /> WhatsApp Business connection
          </h2>
          {s.keysConfigured ? (
            <Alert kind="success">
              <span className="flex items-center gap-2">
                <CheckCircle2 size={16} /> The WhatsApp Business keys are set on the server.
              </span>
            </Alert>
          ) : (
            <Alert kind="info">The keys are not set on the server yet, so nothing can be sent automatically. They are kept as secrets in the server settings and are never shown in the app.</Alert>
          )}
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>
              In <span className="font-medium text-slate-800">Meta Business</span> (developers.facebook.com) create a WhatsApp Business app and add the shop number. A number used here cannot also be used in the normal WhatsApp app, so use a number that is free for this.
            </li>
            <li>
              Create a message template with the text on this page (category <span className="font-medium text-slate-800">Utility</span>, language Swahili, name <code className={code}>{s.template}</code>) and wait for Meta to approve it.
            </li>
            <li>
              Put the permanent access token in <code className={code}>WHATSAPP_CLOUD_TOKEN</code> and the number&apos;s ID in <code className={code}>WHATSAPP_PHONE_NUMBER_ID</code> (server settings).
            </li>
            <li>
              Set <code className={code}>CRON_SECRET</code> (a long random value) so only your scheduler can start the morning run.
            </li>
          </ol>
        </section>
      </div>

      <section className="card mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold text-slate-900">Template text to paste into WhatsApp</h2>
          <span className={tooLong ? "badge-red" : "badge-gray"}>
            {body.length} / {TEMPLATE_BODY_LIMIT} characters
          </span>
        </div>
        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_20rem]">
          <textarea readOnly rows={22} value={body} className="input font-mono text-xs leading-relaxed" aria-label="Template text" />
          <div className="space-y-4 text-sm text-slate-600">
            <div>
              <p className="mb-1.5 font-medium text-slate-900">What each {"{{ }}"} is filled with</p>
              <ul className="space-y-1">
                <li>
                  <code className={code}>{"{{1}}"}</code> customer name
                </li>
                <li>
                  <code className={code}>{"{{2}}"}</code> invoice number(s)
                </li>
                <li>
                  <code className={code}>{"{{3}}"}</code> total owed
                </li>
                <li>
                  <code className={code}>{"{{4}}"}</code> oldest due date
                </li>
                <li>
                  <code className={code}>{"{{5}}"}</code> days late (oldest)
                </li>
              </ul>
            </div>
            <p>The business name and shop number come from Settings → Business, and the payment accounts from Cash & Accounts (the bank and mobile-money accounts that have a number). If you change any of them, submit a new template with the new text.</p>
            {tooLong && <Alert>This text is longer than WhatsApp allows for a template. Close or remove an account you no longer use in Cash & Accounts.</Alert>}
            {profile.paymentAccountsSource === "none" && <Alert kind="info">No payment accounts with a number yet. Add them in Cash & Accounts so customers know where to pay.</Alert>}
            {profile.paymentAccountsSource === "text" && <Alert kind="info">The payment accounts come from the fallback text in Settings → Business. Add the accounts with their numbers in Cash & Accounts to replace it.</Alert>}
          </div>
        </div>
      </section>

      <section className="card mb-5 overflow-hidden">
        <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">Who would get a reminder now</h2>
        {plan.candidates.length === 0 && plan.skipped.length === 0 ? (
          <EmptyState icon={<MessageCircle size={22} />} title="Nobody has a late invoice" description="When an invoice passes its due date, its customer appears here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="text-right">Late invoices</th>
                  <th className="text-right">Owes late</th>
                  <th>What happens</th>
                </tr>
              </thead>
              <tbody>
                {plan.candidates.map((c) => (
                  <tr key={c.customerId}>
                    <td>
                      <span className="font-medium text-slate-900">{c.name}</span>
                      <span className="block text-xs text-slate-500">+{c.phone}</span>
                    </td>
                    <td className="text-right tabular-nums">{c.invoices.length}</td>
                    <td className="text-right font-semibold tabular-nums text-brand-red-dark">{money(c.total)}</td>
                    <td>
                      <span className="badge-green">Gets a reminder</span>
                    </td>
                  </tr>
                ))}
                {plan.skipped.map((c) => (
                  <tr key={c.customerId} className="text-slate-500">
                    <td>{c.name}</td>
                    <td />
                    <td />
                    <td>
                      <span className="badge-gray">Skipped</span> <span className="text-xs">{c.reason}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canManage && plan.candidates.length > 0 && (
          <div className="border-t border-line px-4 py-4 sm:px-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Send these reminders now</h3>
            {s.keysConfigured ? (
              <EntityForm action={sendRemindersNowAction} submitLabel="Send reminders now" fields={[{ name: "confirm", label: `I understand this sends WhatsApp messages to ${plan.candidates.length} real customer${plan.candidates.length === 1 ? "" : "s"} now`, type: "checkbox", value: false }]} />
            ) : (
              <p className="text-sm text-slate-500">Connect WhatsApp Business first (the keys above).</p>
            )}
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">What was sent automatically</h2>
        {log.length === 0 ? (
          <EmptyState icon={<MessageCircle size={22} />} title="Nothing has been sent yet" description="Each automatic reminder appears here with its delivery status." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="text-right">Owed</th>
                  <th className="hidden sm:table-cell">How</th>
                  <th>Status</th>
                  <th className="hidden lg:table-cell">When</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.customer.name}
                      {r.error && <span className="block max-w-[320px] truncate text-xs text-brand-red-dark">{r.error}</span>}
                    </td>
                    <td className="text-right tabular-nums">{money(r.totalOwed)}</td>
                    <td className="hidden sm:table-cell">{r.trigger === "SCHEDULED" ? "Morning run" : "Sent by you"}</td>
                    <td>{r.status === "SENT" ? <span className="badge-green">Sent</span> : r.status === "FAILED" ? <span className="badge-red">Failed</span> : <span className="badge-yellow">Sending</span>}</td>
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
