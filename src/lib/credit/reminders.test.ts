import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { buildReminder, remindedText, reminderLink, waNumber } from "./reminders";

const D = Prisma.Decimal;
const currency = { code: "TZS", symbol: "TSh", decimals: 0 };

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

describe("the reminder message", () => {
  const invoices = [
    { id: "1", saleNo: "INV-2026-000010", dueDate: new Date("2026-10-01T00:00:00Z"), days: 36, owed: new D(120000) },
    { id: "2", saleNo: "INV-2026-000012", dueDate: new Date("2026-10-20T00:00:00Z"), days: 17, owed: new D(30000) },
  ];
  const text = buildReminder({ businessName: "Super Drive Oil", businessPhone: "+255 750 496 756", customerName: "Hamisi", invoices, currency });

  it("is polite, in Swahili then English, lists every late invoice and the total", () => {
    expect(text).toContain("Habari Hamisi");
    expect(text).toContain("Hello Hamisi");
    expect(text).toContain("INV-2026-000010");
    expect(text).toContain("INV-2026-000012");
    expect(text).toContain("150,000"); // 120,000 + 30,000
    expect(text).toContain("+255 750 496 756");
    expect(text).toContain("36 days late");
  });
  it("never lists more than a handful of invoices but says how many more there are", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), saleNo: `INV-${i}`, dueDate: new Date("2026-10-01T00:00:00Z"), days: 5, owed: new D(1000) }));
    const t = buildReminder({ businessName: "X", businessPhone: "", customerName: "A", invoices: many, currency });
    expect(t).toContain("and 3 more invoices");
    expect(t).not.toContain("INV-8");
    expect(t).not.toContain("Call or WhatsApp"); // no phone set, so no phone line
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
