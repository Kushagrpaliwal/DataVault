import { describe, expect, test } from "bun:test";
import { savedRecordListQuerySchema } from "@data-vault/schemas";
import { AppError } from "../src/lib/errors";
import { calculateInvoiceLine, calculateNetAmount } from "../src/domain/money";
import { assertPaymentTransition } from "../src/domain/payment-status";

describe("financial rules", () => {
  test("uses decimal-safe backend calculations", () => {
    expect(calculateNetAmount({ amount: "12500.10", taxAmount: "2250.02", feeAmount: "5.50", discountAmount: "100.01" })).toBe("14655.61");
    expect(calculateInvoiceLine({ quantity: "2.5", rate: "100.10", taxRate: "18", discountAmount: "0.25" })).toEqual({ base: "250.25", tax: "45.00", total: "295.00" });
  });

  test("rejects invalid payment state transitions", () => {
    expect(() => assertPaymentTransition("pending", "completed")).not.toThrow();
    expect(() => assertPaymentTransition("completed", "pending")).toThrow(AppError);
    expect(() => assertPaymentTransition("refunded", "completed")).toThrow("Payment status cannot change");
  });

  test("parses archived query flags without treating false as truthy", () => {
    expect(savedRecordListQuerySchema.parse({ archived: "false" }).archived).toBe(false);
    expect(savedRecordListQuerySchema.parse({ archived: "true" }).archived).toBe(true);
    expect(savedRecordListQuerySchema.parse({}).archived).toBe(false);
  });
});
