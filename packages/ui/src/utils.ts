import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAmount(value: string | number, currency = "INR", locale = "en-IN") {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value));
}
