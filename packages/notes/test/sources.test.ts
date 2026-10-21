import { describe, expect, test } from "bun:test";
import type { JSONContent } from "@tiptap/core";
import { appendClip, type ClipContent } from "../src/arrange";
import {
  clipSourceNamedAbove, markInlineClips, sectionKeyForClipId, sourceUrlForSectionKey,
} from "../src/sources";
import { docToMarkdown } from "../src/text";

function clip(overrides: Partial<ClipContent> = {}): ClipContent {
  return {
    clipId: overrides.clipId ?? "clip-1",
    hash: overrides.hash ?? "hash-1",
    sourceUrl: overrides.sourceUrl ?? "https://commons.wikimedia.org/wiki/Special:Special_pages",
    sourceTitle: overrides.sourceTitle ?? "Special pages - Wikimedia Commons",
    domain: overrides.domain ?? "commons.wikimedia.org",
    capturedAt: overrides.capturedAt ?? "2026-10-20T09:00:00.000Z",
    content: overrides.content ?? [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  };
}

describe("sectionKeyForClipId", () => {
  test("finds the section a piece sits in", () => {
    const doc = appendClip({ type: "doc", content: [] }, clip(), "page").doc;
    expect(sectionKeyForClipId(doc, "clip-1")).toBe("page:https://commons.wikimedia.org/wiki/Special:Special_pages");
  });

  test("a heading without a key does not end the section", () => {
    const doc = appendClip({ type: "doc", content: [] }, clip(), "page").doc;
    const withHeading: JSONContent = {
      ...doc,
      content: [...(doc.content ?? []), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "My notes" }] }],
    };
    expect(sectionKeyForClipId(withHeading, "clip-1")).toBe("page:https://commons.wikimedia.org/wiki/Special:Special_pages");
  });
});

describe("clipSourceNamedAbove", () => {
  test("true when the heading names the website of the piece", () => {
    const doc = appendClip({ type: "doc", content: [] }, clip(), "site").doc;
    expect(clipSourceNamedAbove(doc, { clipId: "clip-1", sourceUrl: clip().sourceUrl, domain: "commons.wikimedia.org" })).toBe(true);
  });

  test("true when the heading names the page of the piece", () => {
    const doc = appendClip({ type: "doc", content: [] }, clip(), "page").doc;
    expect(clipSourceNamedAbove(doc, { clipId: "clip-1", sourceUrl: clip().sourceUrl, domain: "commons.wikimedia.org" })).toBe(true);
  });

  test("false when the heading is about another website", () => {
    const doc = appendClip({ type: "doc", content: [] }, clip(), "site").doc;
    expect(clipSourceNamedAbove(doc, { clipId: "clip-1", sourceUrl: "https://example.com/a", domain: "example.com" })).toBe(false);
  });

  test("false when there is no heading at all", () => {
    const doc: JSONContent = { type: "doc", content: [{ type: "clip", attrs: { clipId: "clip-1", sourceUrl: clip().sourceUrl, domain: "commons.wikimedia.org" }, content: [] }] };
    expect(clipSourceNamedAbove(doc, { clipId: "clip-1", sourceUrl: clip().sourceUrl, domain: "commons.wikimedia.org" })).toBe(false);
  });
});

describe("markInlineClips", () => {
  test("marks the pieces whose source the heading names", () => {
    const doc = appendClip({ type: "doc", content: [] }, clip(), "site").doc;
    const marked = markInlineClips(doc);
    const node = marked.content?.find((child) => child.type === "clip");
    expect(node?.attrs?.inline).toBe(true);
  });

  test("leaves a piece that the heading does not name alone", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, sectionKey: "site:example.com" }, content: [{ type: "text", text: "example.com" }] },
        { type: "clip", attrs: { clipId: "clip-1", sourceUrl: clip().sourceUrl, domain: "commons.wikimedia.org" }, content: [] },
      ],
    };
    const marked = markInlineClips(doc);
    expect(marked.content?.find((child) => child.type === "clip")?.attrs?.inline).toBeUndefined();
  });
});

describe("sourceUrlForSectionKey", () => {
  test("a page section knows its page", () => {
    expect(sourceUrlForSectionKey("page:https://example.com/a")).toBe("https://example.com/a");
  });

  test("a website section knows its website", () => {
    expect(sourceUrlForSectionKey("site:example.com")).toBe("https://example.com");
  });

  test("a day section has no page", () => {
    expect(sourceUrlForSectionKey("day:2026-10-20")).toBeNull();
  });
});

describe("docToMarkdown", () => {
  test("writes the source once, at the heading", () => {
    const doc = appendClip({ type: "doc", content: [] }, clip(), "site").doc;
    const markdown = docToMarkdown(doc);
    expect(markdown).toContain("## commons.wikimedia.org");
    expect(markdown).not.toContain("_From");
  });

  test("still writes the source when the heading is about something else", () => {
    const doc = appendClip({ type: "doc", content: [] }, clip(), "day").doc;
    expect(docToMarkdown(doc)).toContain("_From Special pages - Wikimedia Commons · commons.wikimedia.org_");
  });
});
