import type { PAYMENT_STATUSES } from "@data-vault/schemas";
import { AppError } from "../lib/errors";

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const transitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ["completed", "failed", "cancelled", "partially_paid"],
  partially_paid: ["completed", "failed", "cancelled"],
  completed: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  failed: ["pending", "cancelled"],
  cancelled: [],
  refunded: [],
};

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus) {
  if (from === to) return;
  if (!transitions[from].includes(to)) throw new AppError(409, "INVALID_PAYMENT_STATUS_TRANSITION", `Payment status cannot change from ${from} to ${to}.`);
}
