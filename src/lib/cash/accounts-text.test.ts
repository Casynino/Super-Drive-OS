import { describe, expect, it } from "vitest";
import { paymentAccountsText, type TextAccount } from "./accounts-text";

const acc = (over: Partial<TextAccount>): TextAccount => ({ method: "BANK", name: "CRDB Bank", accountNumber: "0152841983800", holderName: "ABEL JACOB KIJYOMBO", isDefault: false, status: "ACTIVE", ...over });

describe("the where-to-pay block of a reminder", () => {
  it("lists banks first, then mobile money, in the shop's own layout", () => {
    const text = paymentAccountsText([
      acc({ method: "MOBILE_MONEY", name: "M-PESA", accountNumber: "37453908", holderName: "Abely Jacob", isDefault: true }),
      acc({ isDefault: true }),
      acc({ name: "NMB Bank", accountNumber: "20410052450" }),
    ]);
    expect(text).toBe("CRDB BANK\nJina: ABEL JACOB KIJYOMBO\nAkaunti: 0152841983800\n\nNMB BANK\nJina: ABEL JACOB KIJYOMBO\nAkaunti: 20410052450\n\nM-PESA\nJina: Abely Jacob\nNamba: 37453908");
  });

  it("leaves out the till, closed accounts and accounts without a number, and the holder line when there is no holder", () => {
    const text = paymentAccountsText([
      acc({ method: "CASH", name: "Cash", accountNumber: null, holderName: null, isDefault: true }),
      acc({ name: "Old Bank", status: "INACTIVE" }),
      acc({ name: "Lipa Number", method: "MOBILE_MONEY", accountNumber: null }),
      acc({ method: "MOBILE_MONEY", name: "Airtel Money", accountNumber: " 0788 000 111 ", holderName: null }),
    ]);
    expect(text).toBe("AIRTEL MONEY\nNamba: 0788 000 111");
  });

  it("gives an empty text when nothing can be paid into", () => {
    expect(paymentAccountsText([])).toBe("");
    expect(paymentAccountsText([acc({ accountNumber: null })])).toBe("");
  });
});
