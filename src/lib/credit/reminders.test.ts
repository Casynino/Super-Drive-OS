import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { TEMPLATE_BODY_LIMIT, buildReminder, remindedText, reminderLink, swahiliDate, templateBody, templateParams, waNumber } from "./reminders";

const D = Prisma.Decimal;
const currency = { code: "TZS", symbol: "TSh", decimals: 0 };
const accounts = "CRDB BANK\nJina: ABEL JACOB KIJYOMBO\nAkaunti: 0152841983800\n\nNMB BANK\nJina: ABEL JACOB KIJYOMBO\nAkaunti: 20410052450\n\nM-PESA\nJina: Abely Jacob\nNamba: 37453908";
const base = { businessName: "Super Drive Oil", businessPhone: "+255 750 496 756", paymentAccounts: accounts, currency };
const one = [{ id: "1", saleNo: "INV-2026-000027", dueDate: new Date("2026-10-02T00:00:00Z"), days: 35, owed: new D(1057000) }];
const two = [...one, { id: "2", saleNo: "INV-2026-000048", dueDate: new Date("2026-10-12T00:00:00Z"), days: 25, owed: new D(648000) }];

describe("WhatsApp numbers", () => {
  it("turns local and international Tanzanian numbers into wa.me digits", () => {
    expect(waNumber("0712 345 678")).toBe("255712345678");
    expect(waNumber("+255 750 496 756")).toBe("255750496756");
    expect(waNumber("255750496756")).toBe("255750496756");
    expect(waNumber("00255 750 496 756")).toBe("255750496756");
    expect(waNumber("712345678")).toBe("255712345678");
  });
  it("gives no link for a missing or impossible number", () => {
    expect(waNumber("")).toBeNull();
    expect(waNumber(null)).toBeNull();
    expect(waNumber("12345")).toBeNull();
    expect(reminderLink("abc", "hi")).toBeNull();
    expect(reminderLink("0712345678", "a b")).toBe("https://wa.me/255712345678?text=a%20b");
  });
});

describe("the reminder message (Nino's Swahili template)", () => {
  it("writes the dates in Swahili", () => {
    expect(swahiliDate(new Date("2026-10-02T00:00:00Z"))).toBe("2 Oktoba 2026");
    expect(swahiliDate(new Date("2026-03-15T00:00:00Z"))).toBe("15 Machi 2026");
  });

  it("matches the template for one invoice, word for word", () => {
    const text = buildReminder({ ...base, customerName: "Pwani Auto Spares", invoices: one });
    expect(text).toBe(
      [
        "Habari Pwani Auto Spares,",
        "Tunatumaini unaendelea vizuri.",
        "Tunapenda kukukumbusha kuhusu malipo ya mzigo wako kutoka Super Drive Oil ambayo bado hayajakamilika.",
        "TAARIFA ZA MALIPO\n• Ankara: INV-2026-000027\n• Kiasi kinachodaiwa: TSh 1,057,000\n• Tarehe ya mwisho ya malipo: 2 Oktoba 2026\n• Muda uliopita: Siku 35",
        `TAARIFA ZA AKAUNTI ZA MALIPO\n\n${accounts}`,
        "Baada ya kufanya malipo, tafadhali tutumie uthibitisho wa muamala ili tuweze kusasisha kumbukumbu za akaunti yako.",
        "Kwa msaada au maelezo zaidi, tupigie simu au WhatsApp kupitia +255 750 496 756.",
        "Asante kwa kuendelea kushirikiana na Super Drive Oil. Tunathamini sana biashara yako!",
      ].join("\n\n"),
    );
  });

  it("lists every late invoice and the total when there are several", () => {
    const text = buildReminder({ ...base, customerName: "Hamisi", invoices: two });
    expect(text).toContain("INV-2026-000027");
    expect(text).toContain("INV-2026-000048");
    expect(text).toContain("Muda uliopita: Siku 25");
    expect(text).toContain("Jumla inayodaiwa: TSh 1,705,000");
  });

  it("never lists more than six invoices but says how many more there are, and leaves out empty parts", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), saleNo: `INV-${i}`, dueDate: new Date("2026-10-01T00:00:00Z"), days: 5, owed: new D(1000) }));
    const t = buildReminder({ businessName: "X", businessPhone: "", paymentAccounts: "", customerName: "A", invoices: many, currency });
    expect(t).toContain("na ankara 3 nyingine");
    expect(t).not.toContain("INV-8");
    expect(t).not.toContain("TAARIFA ZA AKAUNTI"); // no accounts set
    expect(t).not.toContain("tupigie simu"); // no phone set
  });
});

describe("the WhatsApp Business template", () => {
  const body = templateBody({ businessName: "Super Drive Oil", businessPhone: "+255 750 496 756", paymentAccounts: accounts });
  it("is the same wording with five variables, and fits WhatsApp's limit", () => {
    for (const v of ["{{1}}", "{{2}}", "{{3}}", "{{4}}", "{{5}}"]) expect(body).toContain(v);
    expect(body.startsWith("Habari {{1}},")).toBe(true);
    expect(body).toContain("CRDB BANK");
    expect(body.length).toBeLessThanOrEqual(TEMPLATE_BODY_LIMIT);
  });
  it("fills the variables from the late invoices, on one line each", () => {
    const p = templateParams({ customerName: "Pwani\nAuto   Spares", invoices: two, currency });
    expect(p).toEqual(["Pwani Auto Spares", "INV-2026-000027, INV-2026-000048", "TSh 1,705,000", "2 Oktoba 2026", "35"]);
    for (const v of p) expect(v).not.toMatch(/[\n\t]/);
  });
});

describe("last reminded text", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("says today, yesterday or how many days ago", () => {
    expect(remindedText(undefined, now)).toBeNull();
    expect(remindedText(new Date("2026-11-06T08:00:00Z"), now)).toBe("Reminded today");
    expect(remindedText(new Date("2026-11-05T08:00:00Z"), now)).toBe("Reminded yesterday");
    expect(remindedText(new Date("2026-11-01T08:00:00Z"), now)).toBe("Reminded 5 days ago");
  });
});
