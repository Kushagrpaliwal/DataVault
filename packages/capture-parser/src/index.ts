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

/**
 * How a passage opens.
 *
 * The first line of an article is usually its title, and it is often in
 * sentence case while the page title is not, so the two are compared rather
 * than one replacing the other.
 */
const bylinePatterns: ReadonlyArray<RegExp> = [
  /^[ \t]*(?:by|written by|author(?:ed by)?|words by)[ \t]+([A-Z][\p{L}.'’-]*(?:[ \t]+[A-Z][\p{L}.'’-]*){0,4})[ \t]*$/imu,
  /^[ \t]*([A-Z][\p{L}.'’-]*(?:[ \t]+[A-Z][\p{L}.'’-]*){1,3})[ \t]*[|·•—–][ \t]*([^\n]{4,120})$/mu,
];

const quoteMarkers = /^[“"‘']|^\s*>\s|^\s*[-*]\s+[“"‘']/u;

/**
 * A figure quoted in the passage.
 *
 * Only numbers that carry a unit or a percentage are kept, because a bare
 * number is far more likely to be a date, an ordinal or a reference than a
 * statistic worth citing.
 */
const numberPattern = /(?:\p{Sc}\s?|\b(?:USD|EUR|GBP|JPY|CNY|INR|AUD|CAD)\s?)?\d[\d.,]*\s?(?:%|percent|per\s+(?:cent|thousand|million|billion|day|week|month|year|hour|minute)|billion|million|trillion|thousand|k\b|m\b|bn\b)?/iu;

function extractDate(text: string, referenceDate: Date): string | undefined {
  const candidates: ReadonlyArray<{ pattern: RegExp; formats: string[] }> = [
    { pattern: /\b(\d{4}-\d{2}-\d{2})\b/, formats: ["yyyy-MM-dd"] },
    { pattern: /\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/, formats: ["dd/MM/yyyy", "dd-MM-yyyy", "MM/dd/yyyy"] },
    { pattern: /\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})\b/i, formats: ["d MMM yyyy", "d MMMM yyyy"] },
    { pattern: /\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/i, formats: ["MMMM d, yyyy", "MMM d, yyyy"] },
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

/**
 * Who wrote it.
 *
 * A byline sits near the top of a piece, so only the first few lines are
 * read. The second pattern takes the name from the left of a `Name | Outlet`
 * line, which is how many publishers credit their writers.
 */
function extractAuthor(text: string): string | undefined {
  const head = text.split(/\r?\n/).slice(0, 6).join("\n");
  for (const pattern of bylinePatterns) {
    const match = pattern.exec(head);
    const candidate = (match?.[1] ?? match?.[2])?.trim();
    if (candidate && candidate.length >= 3 && candidate.length <= 120) return candidate;
  }
  return undefined;
}

/**
 * The claim a passage makes.
 *
 * It is the first sentence that actually says something, which is why the
 * leading headline and the byline are skipped first.
 */
function extractClaim(text: string): string | undefined {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const candidate = sentences.find((sentence) => sentence.length >= 40 && sentence.length <= 320);
  if (!candidate) return undefined;
  return candidate.length > 500 ? `${candidate.slice(0, 497)}...` : candidate;
}

function extractNumber(text: string): string | undefined {
  const match = numberPattern.exec(text);
  const candidate = match?.[0]?.trim();
  if (!candidate) return undefined;
  // A bare number is more likely a date or an ordinal than a statistic.
  if (!/[%¤$€£¥]|\b(?:percent|million|billion|trillion|thousand)\b/i.test(candidate)) return undefined;
  return candidate.length > 120 ? candidate.slice(0, 120) : candidate;
}

/**
 * How the passage should be filed.
 *
 * The types describe what the material *is*, so a piece of writing with a
 * byline is an article and a figure on its own is a statistic.
 */
function detectType(text: string, isQuote: boolean, hasAuthor: boolean): ParsedCapture["recordType"] {
  if (/\b(?:definition|defined as|refers to|means that)\b/i.test(text)) return "definition";
  if (/\b(?:statistics?|percent|per cent|survey|according to|rate of|share of)\b/i.test(text) || /%/.test(text)) return "statistic";
  if (/\b(?:announc(?:ed|ement)|launch(?:ed|es)?|unveils|acquires|acquisition|merger|festival|election|anniversary)\b/i.test(text)) return "event";
  if (isQuote) return "quote";
  if (hasAuthor) return "article";
  return "highlight";
}

export class RuleBasedExtractor implements CaptureExtractor {
  readonly id = "rule-based";
  readonly version = "2.0.0";

  async extract(input: CaptureInput): Promise<ParsedCapture> {
    const text = input.text.normalize("NFKC").trim();
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const isQuote = quoteMarkers.test(text);
    const author = extractAuthor(text);
    const publishedAt = extractDate(text, input.capturedAt ?? new Date());
    const claim = extractClaim(text);
    const number = extractNumber(text);
    const headline = lines[0];
    const title = headline && headline.length <= 250 && !quoteMarkers.test(headline)
      ? headline
      : (input.pageTitle?.trim().slice(0, 250) || "Captured clip");
    const recordType = detectType(text, isQuote, Boolean(author));

    const confidence: Record<string, number> = { recordType: recordType === "highlight" ? 0.45 : 0.8 };
    if (author) confidence.author = 0.72;
    if (publishedAt) confidence.publishedAt = 0.85;
    if (claim) confidence.claim = 0.7;
    if (number) confidence.number = 0.8;

    return {
      recordType,
      title,
      ...(author ? { author } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(claim ? { claim } : {}),
      ...(number ? { number } : {}),
      ...(isQuote ? { isQuote } : {}),
      confidence,
    };
  }
}

export const defaultCaptureExtractor: CaptureExtractor = new RuleBasedExtractor();
