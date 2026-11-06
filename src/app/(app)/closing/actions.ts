"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { fail, formString, formValues, guarded, isUniqueViolation, type ActionState } from "@/lib/action";
import { ImageError, processDocumentImage, saveAttachment } from "@/lib/cash/attachments";
import { submitClosing } from "@/lib/cash/closing";
import { postDeposit } from "@/lib/cash/deposits";
import { CashError, defaultLocationId } from "@/lib/cash/ledger";
import { formatMoney } from "@/lib/money";
import { notifyPermission } from "@/lib/notifications";
import { getCurrency } from "@/lib/settings";

const refresh = () => {
  for (const p of ["/closing", "/dashboard", "/cash", "/deposits", "/approvals"]) revalidatePath(p);
};

async function readSlip(fd: FormData): Promise<{ buffer: Buffer | null; error?: ActionState }> {
  const file = fd.get("slip");
  if (!(file instanceof File) || file.size === 0) return { buffer: null };
  try {
    return { buffer: await processDocumentImage(Buffer.from(await file.arrayBuffer())) };
  } catch (e) {
    if (e instanceof ImageError) return { buffer: null, error: fail(e.message, { slip: e.message }, formValues(fd)) };
    throw e;
  }
}

// ───────────── Submit the day's closing (the attendant) ─────────────

export async function submitClosingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("closing.submit", async (user) => {
    const currency = await getCurrency();
    const submissionKey = formString(fd, "submissionKey");
    if (submissionKey.length < 16) return fail("The form could not be read. Reload the page and try again.", undefined, values);
    const depositAmount = formString(fd, "depositAmount");
    const wantsDeposit = depositAmount !== "";
    if (wantsDeposit && !can(user, "deposits.record")) return fail("You are not allowed to record bank deposits.", undefined, values);
    const slip = wantsDeposit ? await readSlip(fd) : { buffer: null };
    if ("error" in slip && slip.error) return slip.error;

    try {
      const out = await db.$transaction(
        async (tx) => {
          const locationId = await defaultLocationId(tx);
          const att = slip.buffer ? await saveAttachment(tx, { kind: "DEPOSIT_SLIP", data: slip.buffer, userId: user.id }) : null;
          const r = await submitClosing(tx, {
            user, locationId, day: formString(fd, "day"), countedCash: formString(fd, "countedCash"), notes: formString(fd, "notes") || null,
            deposit: wantsDeposit ? { amount: depositAmount, bankReference: formString(fd, "bankReference"), notes: formString(fd, "depositNotes") || null, slipId: att?.id ?? null, bankAccountId: formString(fd, "bankAccountId") || null } : null,
            submissionKey, currencyDecimals: currency.decimals,
          });
          await writeAudit(tx, {
            user, action: "closing.submitted", entityType: "DailyClosing", entityId: r.closing.id, reference: r.closing.closingNo,
            after: { day: formString(fd, "day"), expected: r.closing.expectedCash.toString(), counted: r.closing.countedCash.toString(), difference: r.difference.toString(), deposited: r.closing.depositedNow.toString(), status: r.status },
          });
          const diff = r.difference.isZero() ? "no difference" : `${r.difference.gt(0) ? "surplus" : "shortage"} of ${formatMoney(r.difference.abs(), currency)}`;
          await notifyPermission(tx, "closing.approve", {
            type: "closing.submitted",
            title: `Day closed: ${r.closing.closingNo}`,
            body: `${user.name} counted ${formatMoney(r.closing.countedCash, currency)} - ${diff}.`,
            link: `/closing/${r.closing.id}`,
          }, user.id);
          return r.closing.id;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      refresh();
      return { ok: true, message: out };
    } catch (e) {
      if (e instanceof CashError) return fail(e.message, e.fieldErrors, values);
      if (isUniqueViolation(e)) {
        const existing = await db.dailyClosing.findUnique({ where: { submissionKey }, select: { id: true } });
        if (existing) return { ok: true, message: existing.id };
        return fail("This day has already been closed.", undefined, values);
      }
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/closing/${result.message}?done=1`);
  return result;
}

// ───────────── A bank deposit on its own (not part of a closing) ─────────────

export async function recordDepositAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("deposits.record", async (user) => {
    const currency = await getCurrency();
    const submissionKey = formString(fd, "submissionKey");
    if (submissionKey.length < 16) return fail("The form could not be read. Reload the page and try again.", undefined, values);
    const slip = await readSlip(fd);
    if (slip.error) return slip.error;
    try {
      const dep = await db.$transaction(
        async (tx) => {
          const locationId = await defaultLocationId(tx);
          const att = slip.buffer ? await saveAttachment(tx, { kind: "DEPOSIT_SLIP", data: slip.buffer, userId: user.id }) : null;
          const d = await postDeposit(tx, { user, locationId, amount: formString(fd, "depositAmount"), bankReference: formString(fd, "bankReference"), notes: formString(fd, "notes") || null, slipId: att?.id ?? null, bankAccountId: formString(fd, "bankAccountId") || null, submissionKey, currencyDecimals: currency.decimals });
          await writeAudit(tx, { user, action: "deposit.recorded", entityType: "BankDeposit", entityId: d.id, reference: d.depositNo, after: { amount: d.amount.toString(), bankReference: d.bankReference } });
          await notifyPermission(tx, "cash.view", { type: "deposit.recorded", title: `Bank deposit ${d.depositNo}: ${formatMoney(d.amount, currency)}`, body: `${user.name} · ref ${d.bankReference}`, link: "/closing" }, user.id);
          return d;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      refresh();
      return { ok: true, message: dep.depositNo };
    } catch (e) {
      if (e instanceof CashError) return fail(e.message, e.fieldErrors, values);
      if (isUniqueViolation(e)) {
        const existing = await db.bankDeposit.findUnique({ where: { submissionKey }, select: { depositNo: true } });
        if (existing) return { ok: true, message: existing.depositNo };
      }
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/closing?banked=${encodeURIComponent(result.message)}`);
  return result;
}
