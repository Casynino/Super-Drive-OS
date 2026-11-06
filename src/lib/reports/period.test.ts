import { describe, expect, it } from "vitest";
import { periodsEndingOn } from "./format";

describe("which reports follow a closed day", () => {
  it("a Sunday sends the week (Monday to Sunday)", () => {
    expect(periodsEndingOn("2020-03-01")).toEqual([{ kind: "WEEKLY", from: "2020-02-24", to: "2020-03-01" }]);
  });
  it("the last day of a month sends the month, leap years included", () => {
    expect(periodsEndingOn("2020-02-29")).toEqual([{ kind: "MONTHLY", from: "2020-02-01", to: "2020-02-29" }]);
    expect(periodsEndingOn("2020-03-31")).toEqual([{ kind: "MONTHLY", from: "2020-03-01", to: "2020-03-31" }]);
  });
  it("a Sunday that ends a month sends both", () => {
    expect(periodsEndingOn("2020-05-31").map((p) => p.kind)).toEqual(["WEEKLY", "MONTHLY"]);
  });
  it("any other day sends only the daily report", () => {
    expect(periodsEndingOn("2020-03-04")).toEqual([]);
  });
});
