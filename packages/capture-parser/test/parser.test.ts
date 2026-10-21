import { describe, expect, test } from "bun:test";
import { RuleBasedExtractor } from "../src";

describe("RuleBasedExtractor", () => {
  const extractor = new RuleBasedExtractor();

  test("reads an article byline and publication date", async () => {
    const parsed = await extractor.extract({
      text: "Coastal cities are warming twice as fast as the interior, a new study finds.\n\nBy Priya Raman\n12 March 2026\n\nThe researchers compared thirty years of satellite readings.",
    });
    expect(parsed.recordType).toBe("article");
    expect(parsed.author).toBe("Priya Raman");
    expect(parsed.publishedAt).toBe("2026-03-12");
    expect(parsed.claim).toContain("Coastal cities");
  });

  test("keeps a figure that carries a unit", async () => {
    const parsed = await extractor.extract({ text: "About 42% of respondents said they would switch providers. The rest were undecided." });
    expect(parsed.number).toBe("42%");
  });

  test("ignores a bare number that is not a statistic", async () => {
    const parsed = await extractor.extract({ text: "See chapter 4 for the full method and the raw figures." });
    expect(parsed.number).toBeUndefined();
  });

  test("marks a short quotation as a quote", async () => {
    const parsed = await extractor.extract({ text: "“The model is not ready for the field,” the lead author said." });
    expect(parsed.isQuote).toBe(true);
    expect(parsed.recordType).toBe("quote");
  });

  test("preserves safe fallback behavior", async () => {
    const parsed = await extractor.extract({ text: "Remember this reference later", pageTitle: "Notes" });
    expect(parsed.recordType).toBe("highlight");
    expect(parsed.title).toBe("Remember this reference later");
  });
});
