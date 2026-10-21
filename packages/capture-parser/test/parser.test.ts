import { describe, expect, test } from "bun:test";
import { RuleBasedExtractor } from "../src";

describe("RuleBasedExtractor", () => {
  const extractor = new RuleBasedExtractor();

  test("extracts an INR UPI expense", async () => {
    const parsed = await extractor.extract({ text: "₹18,500 paid to Rahul Sharma\nUPI\nUTR 8293849283\n06 Sep 2026" });
    expect(parsed).toMatchObject({ recordType: "expense", amount: "18500.00", currency: "INR", party: "Rahul Sharma", utr: "8293849283", paymentMethod: "UPI", date: "2026-09-06" });
  });

  test("extracts slash-formatted bank captures", async () => {
    const parsed = await extractor.extract({ text: "UPI/DR/625043922311/Rahul\nAmount Debited ₹2,499\n05/09/2026\nUTR 625043922311" });
    expect(parsed.amount).toBe("2499.00");
    expect(parsed.party).toBe("Rahul");
    expect(parsed.date).toBe("2026-09-05");
  });

  test("preserves safe fallback behavior", async () => {
    const parsed = await extractor.extract({ text: "Remember this reference later", pageTitle: "Notes" });
    expect(parsed.recordType).toBe("other");
    expect(parsed.title).toBe("Notes");
  });
});
