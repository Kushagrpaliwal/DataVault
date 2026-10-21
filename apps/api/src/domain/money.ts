import Decimal from "decimal.js";
import { AppError } from "../lib/errors";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function money(value: string | number | Decimal): Decimal {
  try { return new Decimal(value); } catch { throw new AppError(400, "INVALID_AMOUNT", "A monetary value is invalid."); }
}

export function moneyString(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(2).toFixed(2);
}

export function calculateNetAmount(input: { amount: string; taxAmount?: string; feeAmount?: string; discountAmount?: string }): string {
  const net = money(input.amount).plus(input.taxAmount ?? 0).plus(input.feeAmount ?? 0).minus(input.discountAmount ?? 0);
  if (net.isNegative()) throw new AppError(400, "INVALID_NET_AMOUNT", "Discount cannot exceed the payment total.");
  return moneyString(net);
}

export function calculateInvoiceLine(input: { quantity: string; rate: string; taxRate: string; discountAmount: string }) {
  const base = money(input.quantity).times(input.rate);
  const discounted = base.minus(input.discountAmount);
  if (discounted.isNegative()) throw new AppError(400, "INVALID_LINE_DISCOUNT", "Line discount cannot exceed the line value.");
  const tax = discounted.times(input.taxRate).dividedBy(100);
  return { base: moneyString(base), tax: moneyString(tax), total: moneyString(discounted.plus(tax)) };
}
