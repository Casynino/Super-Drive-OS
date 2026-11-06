// Pure helpers for the daily report (no database access, so they can be unit-tested on their own).

export const MAX_PART = 1400; // characters per WhatsApp message (kept well under what the service accepts in a URL)

export function longDate(day: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** Packs lines into numbered messages no longer than `max` characters, keeping lines whole (a single over-long line is cut). */
export function splitIntoParts(lines: string[], title: string, max = MAX_PART): string[] {
  const body: string[][] = [[]];
  let size = 0;
  const room = max - (title.length + 40); // space for "PART 10/10" and the date header
  for (const raw of lines) {
    const pieces = raw.length > room ? (raw.match(new RegExp(`.{1,${room}}`, "gs")) ?? [raw]) : [raw];
    for (const line of pieces) {
      if (size + line.length + 1 > room && body[body.length - 1]!.length > 0) {
        body.push([]);
        size = 0;
      }
      body[body.length - 1]!.push(line);
      size += line.length + 1;
    }
  }
  return body.map((b, i) => `${title}\nPART ${i + 1}/${body.length}\n\n${b.join("\n")}`.trimEnd());
}

/** Digits only, no leading +/00, 8-15 digits (international format, e.g. 255712345678). */
export function cleanPhone(raw: string) {
  const d = raw.replace(/[^\d]/g, "").replace(/^00/, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}
export const maskPhone = (p: string) => (p.length > 6 ? `${p.slice(0, 4)}…${p.slice(-3)}` : "…");

export const shiftDay = (ymd: string, days: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** Sunday report day = a week (Mon-Sun); last day of a month = that month. */
export function periodsEndingOn(day: string): { kind: "WEEKLY" | "MONTHLY"; from: string; to: string }[] {
  const out: { kind: "WEEKLY" | "MONTHLY"; from: string; to: string }[] = [];
  const d = new Date(`${day}T12:00:00Z`);
  if (d.getUTCDay() === 0) out.push({ kind: "WEEKLY", from: shiftDay(day, -6), to: day });
  if (shiftDay(day, 1).slice(8) === "01") out.push({ kind: "MONTHLY", from: `${day.slice(0, 8)}01`, to: day });
  return out;
}

