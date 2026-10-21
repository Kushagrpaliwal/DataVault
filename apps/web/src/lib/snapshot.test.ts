import { describe, expect, test } from "bun:test";
import { snapshotWithPolicy, SNAPSHOT_POLICY } from "./snapshot";

describe("the snapshot in the frame", () => {
  test("the rule comes before everything else in the page", () => {
    const document = snapshotWithPolicy("<!doctype html><html lang=\"en\"><head><title>The page as it was</title></head><body><p>The words.</p></body></html>");
    expect(document.startsWith(SNAPSHOT_POLICY)).toBe(true);
  });

  test("the page cannot reach out to anybody", () => {
    const document = snapshotWithPolicy("<!doctype html><html><body><img src=\"https://example.com/tracker.gif\"></body></html>");
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("img-src data:");
    expect(document).toContain("style-src 'unsafe-inline'");
  });

  test("the doctype is taken away with the rule", () => {
    const document = snapshotWithPolicy("<!doctype html><html lang=\"en\"><head></head><body></body></html>");
    expect(document).not.toContain("<!doctype");
    expect(document).toContain("<html lang=\"en\">");
  });

  test("the words of the page are still there", () => {
    const document = snapshotWithPolicy("<!doctype html><html><body><p>The words of the page.</p></body></html>");
    expect(document).toContain("The words of the page.");
  });
});
