import { format, isValid, parse } from "date-fns";
import type { ParsedCapture } from "@data-vault/types";

export interface CaptureInput {
  text: string;
  pageTitle?: string | undefined;
  /** Missing when the browser would not tell the extension the page address. */
  pageUrl?: string | undefined;
  capturedAt?: Date | undefined;
}

export interface CaptureExtractor {
  readonly id: string;
  readonly version: string;
  extract(input: CaptureInput): Promise<ParsedCapture>;
}

const currencyPatterns: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: "INR", pattern: /(?:₹|\bINR\b|\bRs\.?\s*)\s*([\d,]+(?:\.\d{1,2})?)/i },
  { code: "USD", pattern: /(?:\$|\bUSD\b)\s*([\d,]+(?:\.\d{1,2})?)/i },
  { code: "EUR", pattern: /(?:€|\bEUR\b)\s*([\d,]+(?:\.\d{1,2})?)/i },
  { code: "GBP", pattern: /(?:£|\bGBP\b)\s*([\d,]+(?:\.\d{1,2})?)/i },
];

const methodPatterns: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: "UPI", pattern: /\bUPI\b/i },
  { method: "NEFT", pattern: /\bNEFT\b/i },
  { method: "RTGS", pattern: /\bRTGS\b/i },
  { method: "IMPS", pattern: /\bIMPS\b/i },
  { method: "Card", pattern: /\b(?:credit|debit)?\s*card\b/i },
  { method: "Cash", pattern: /\bcash\b/i },
];

function normalizeAmount(raw: string): string {
  const [whole = "0", decimal = ""] = raw.replaceAll(",", "").split(".");
  return `${whole}.${decimal.padEnd(2, "0").slice(0, 2)}`;
}

function extractAmount(text: string): { amount: string; currency: string } | undefined {
  for (const { code, pattern } of currencyPatterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return { amount: normalizeAmount(match[1]), currency: code };
  }
  const labelled = /\bamount(?:\s+(?:paid|debited|credited))?\s*[:-]?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  return labelled?.[1] ? { amount: normalizeAmount(labelled[1]), currency: "INR" } : undefined;
}

function extractDate(text: string, referenceDate: Date): string | undefined {
  const candidates: ReadonlyArray<{ pattern: RegExp; formats: string[] }> = [
    { pattern: /\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/, formats: ["dd/MM/yyyy", "dd-MM-yyyy"] },
    { pattern: /\b(\d{4}-\d{2}-\d{2})\b/, formats: ["yyyy-MM-dd"] },
    { pattern: /\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})\b/i, formats: ["d MMM yyyy", "d MMMM yyyy"] },
  ];
  for (const candidate of candidates) {
    const match = candidate.pattern.exec(text);
    if (!match?.[1]) continue;
    for (const dateFormat of candidate.formats) {
      const parsed = parse(match[1], dateFormat, referenceDate);
      if (isValid(parsed)) return format(parsed, "yyyy-MM-dd");
    }
  }
  return undefined;
}

function extractReference(text: string, label: RegExp): string | undefined {
  return label.exec(text)?.[1]?.trim();
}

function extractParty(text: string): string | undefined {
  const labelled = /\b(?:paid\s+to|payee|beneficiary|merchant|vendor|from)\s*[:-]?\s*([A-Za-z][A-Za-z0-9 &.'-]{1,80})/i.exec(text)?.[1];
  if (labelled) return labelled.split(/\r?\n|\b(?:via|using|on|upi|neft|rtgs|imps|utr|ref(?:erence)?)\b/i)[0]?.trim();
  const upi = /\bUPI(?:\/DR|\/CR)?\/\d+\/([A-Za-z][A-Za-z .'-]{1,60})/i.exec(text)?.[1];
  return upi?.trim();
}

function detectType(text: string): ParsedCapture["recordType"] {
  if (/\b(?:refund|refunded)\b/i.test(text)) return "refund";
  if (/\b(?:invoice|bill no|invoice no)\b/i.test(text)) return "invoice";
  if (/\b(?:subscription|renews|recurring)\b/i.test(text)) return "subscription";
  if (/\b(?:debited|spent|purchase|paid to|expense)\b/i.test(text)) return "expense";
  if (/\b(?:credited|received from|income)\b/i.test(text)) return "income";
  if (/\b(?:paid|payment|upi|neft|rtgs|imps|utr)\b/i.test(text)) return "payment";
  return "other";
}

export class RuleBasedExtractor implements CaptureExtractor {
  readonly id = "rule-based";
  readonly version = "1.0.0";

  async extract(input: CaptureInput): Promise<ParsedCapture> {
    const text = input.text.normalize("NFKC").trim();
    const amount = extractAmount(text);
    const party = extractParty(text);
    const utr = extractReference(text, /\bUTR(?:\s*(?:NO|NUMBER))?\s*[:#-]?\s*([A-Z0-9-]{6,40})/i);
    const transactionReference = extractReference(text, /\b(?:transaction|bank)\s*(?:id|reference|ref)\s*[:#-]?\s*([A-Z0-9-]{6,60})/i);
    const method = methodPatterns.find(({ pattern }) => pattern.test(text))?.method;
    const date = extractDate(text, input.capturedAt ?? new Date());
    const recordType = detectType(text);
    const title = party ? `${recordType === "income" ? "Received from" : "Payment to"} ${party}` : input.pageTitle?.slice(0, 250) ?? "Captured record";
    const confidence: Record<string, number> = { recordType: recordType === "other" ? 0.35 : 0.85 };
    if (amount) confidence.amount = 0.99;
    if (party) confidence.party = 0.74;
    if (utr) confidence.utr = 0.98;
    if (transactionReference) confidence.transactionReference = 0.95;
    if (method) confidence.paymentMethod = 0.96;
    if (date) confidence.date = 0.92;

    return {
      recordType,
      title,
      ...(amount ?? {}),
      ...(party ? { party } : {}),
      ...(utr ? { utr } : {}),
      ...(transactionReference ? { transactionReference } : {}),
      ...(method ? { paymentMethod: method } : {}),
      ...(date ? { date } : {}),
      confidence,
    };
  }
}

export const defaultCaptureExtractor: CaptureExtractor = new RuleBasedExtractor();
