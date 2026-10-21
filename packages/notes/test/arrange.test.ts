import { describe, expect, test } from "bun:test";
import type { JSONContent } from "@tiptap/core";
import { appendClip, findClipByHash, mergeMissingClips, removeClip, sectionKeyFor, type ClipContent } from "../src/arrange";

function clip(overrides: Partial<ClipContent> = {}): ClipContent {
  return {
    clipId: overrides.clipId ?? "clip-1",
    hash: overrides.hash ?? "hash-1",
    sourceUrl: overrides.sourceUrl ?? "https://example.com/notes",
    sourceTitle: overrides.sourceTitle ?? "Example page",
    domain: overrides.domain ?? "example.com",
    capturedAt: overrides.capturedAt ?? "2026-10-20T09:00:00.000Z",
    content: overrides.content ?? [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  };
}

function doc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

function types(node: JSONContent): string[] {
  return (node.content ?? []).map((child) => String(child.type));
}

describe("sectionKeyFor", () => {
  test("by page uses the address without the query", () => {
    expect(sectionKeyFor("page", { sourceUrl: "https://example.com/a?x=1", domain: "example.com" }, "2026-10-20T09:00:00.000Z"))
      .toBe("page:https://example.com/a");
  });

  test("by site uses the website", () => {
    expect(sectionKeyFor("site", { sourceUrl: "https://example.com/a", domain: "example.com" }, "2026-10-20T09:00:00.000Z"))
      .toBe("site:example.com");
  });

  test("by day uses the local day", () => {
    expect(sectionKeyFor("day", { sourceUrl: "https://example.com/a", domain: "example.com" }, "2026-10-20T23:30:00.000Z", "UTC"))
      .toBe("day:2026-10-20");
  });

  test("no arrangement has no section", () => {
    expect(sectionKeyFor("none", { sourceUrl: "https://example.com/a", domain: "example.com" }, "2026-10-20T09:00:00.000Z"))
      .toBeNull();
  });
});

describe("appendClip", () => {
  test("adds a heading and a clip when the doc is empty", () => {
    const result = appendClip(doc(), clip(), "page");
    expect(types(result.doc)).toEqual(["heading", "clip"]);
    expect(result.sectionTitle).toBe("Example page");
    expect(result.duplicate).toBe(false);
  });

  test("the heading carries the section key", () => {
    const result = appendClip(doc(), clip(), "page");
    expect(result.doc.content?.[0]?.attrs?.sectionKey).toBe("page:https://example.com/notes");
  });

  test("a second clip from the same page joins the same section", () => {
    const first = appendClip(doc(), clip({ clipId: "a", hash: "hash-a" }), "page");
    const second = appendClip(first.doc, clip({ clipId: "b", hash: "hash-b" }), "page");
    expect(types(second.doc)).toEqual(["heading", "clip", "clip"]);
    expect(second.sectionTitle).toBe("Example page");
  });

  test("a clip from another page gets its own section at the end", () => {
    const first = appendClip(doc(), clip({ clipId: "a", hash: "hash-a" }), "page");
    const second = appendClip(first.doc, clip({ clipId: "b", hash: "hash-b", sourceUrl: "https://other.com/x", sourceTitle: "Other page", domain: "other.com" }), "page");
    expect(types(second.doc)).toEqual(["heading", "clip", "heading", "clip"]);
    expect(second.doc.content?.[2]?.attrs?.sectionKey).toBe("page:https://other.com/x");
  });

  test("a clip from an earlier page goes back into that page's section", () => {
    const first = appendClip(doc(), clip({ clipId: "a", hash: "hash-a" }), "page");
    const second = appendClip(first.doc, clip({ clipId: "b", hash: "hash-b", sourceUrl: "https://other.com/x", sourceTitle: "Other page", domain: "other.com" }), "page");
    const third = appendClip(second.doc, clip({ clipId: "c", hash: "hash-c" }), "page");
    expect(types(third.doc)).toEqual(["heading", "clip", "clip", "heading", "clip"]);
    expect(third.doc.content?.[2]?.attrs?.clipId).toBe("c");
  });

  test("by website, two pages share one section", () => {
    const first = appendClip(doc(), clip({ clipId: "a", hash: "hash-a" }), "site");
    const second = appendClip(first.doc, clip({ clipId: "b", hash: "hash-b", sourceUrl: "https://example.com/other" }), "site");
    expect(types(second.doc)).toEqual(["heading", "clip", "clip"]);
    expect(second.sectionTitle).toBe("example.com");
  });

  test("by day, clips from the same day share one section", () => {
    const first = appendClip(doc(), clip({ clipId: "a", hash: "hash-a" }), "day", "UTC");
    const second = appendClip(first.doc, clip({ clipId: "b", hash: "hash-b", sourceUrl: "https://other.com/x" }), "day", "UTC");
    expect(types(second.doc)).toEqual(["heading", "clip", "clip"]);
  });

  test("by day, a later day gets a new section", () => {
    const first = appendClip(doc(), clip({ clipId: "a", hash: "hash-a" }), "day", "UTC");
    const second = appendClip(first.doc, clip({ clipId: "b", hash: "hash-b", capturedAt: "2026-10-21T09:00:00.000Z" }), "day", "UTC");
    expect(types(second.doc)).toEqual(["heading", "clip", "heading", "clip"]);
  });

  test("no arrangement adds nothing but the clip", () => {
    const result = appendClip(doc(), clip(), "none");
    expect(types(result.doc)).toEqual(["clip"]);
    expect(result.sectionTitle).toBe("");
  });

  test("the same clip twice is reported as a duplicate", () => {
    const first = appendClip(doc(), clip(), "page");
    const second = appendClip(first.doc, clip(), "page");
    expect(second.duplicate).toBe(true);
    expect(second.doc).toBe(first.doc);
  });

  test("a section ends before the next heading of the same level", () => {
    const withHeading = doc(
      { type: "heading", attrs: { level: 2, sectionKey: "page:https://example.com/notes" }, content: [{ type: "text", text: "Example page" }] },
      { type: "paragraph", content: [{ type: "text", text: "Some writing" }] },
      { type: "heading", attrs: { level: 2, sectionKey: "page:https://other.com/x" }, content: [{ type: "text", text: "Other page" }] },
    );
    const result = appendClip(withHeading, clip(), "page");
    expect(types(result.doc)).toEqual(["heading", "paragraph", "clip", "heading"]);
  });
});

describe("clips in a doc", () => {
  test("a clip can be found by its hash", () => {
    const result = appendClip(doc(), clip(), "page");
    expect(findClipByHash(result.doc, "hash-1")?.attrs?.clipId).toBe("clip-1");
    expect(findClipByHash(result.doc, "nope")).toBeNull();
  });

  test("a clip can be removed again", () => {
    const result = appendClip(doc(), clip(), "page");
    const removed = removeClip(result.doc, "clip-1");
    expect(findClipByHash(removed, "hash-1")).toBeNull();
    expect(types(removed)).toEqual(["heading"]);
  });
});

describe("mergeMissingClips", () => {
  test("a piece added elsewhere is put back into the editor's copy", () => {
    const local = appendClip(doc(), clip({ clipId: "a", hash: "hash-a" }), "page").doc;
    const server = appendClip(local, clip({ clipId: "b", hash: "hash-b" }), "page").doc;
    const merged = mergeMissingClips(local, server, "page");
    expect(merged.merged).toBe(1);
    expect(findClipByHash(merged.doc, "hash-b")).not.toBeNull();
    expect(findClipByHash(merged.doc, "hash-a")).not.toBeNull();
  });

  test("nothing is added when both copies already agree", () => {
    const local = appendClip(doc(), clip(), "page").doc;
    const merged = mergeMissingClips(local, local, "page");
    expect(merged.merged).toBe(0);
    expect(merged.doc).toBe(local);
  });

  test("the writing of the editor is kept", () => {
    const local = doc(
      { type: "paragraph", content: [{ type: "text", text: "My own words" }] },
    );
    const server = appendClip(local, clip(), "page").doc;
    const merged = mergeMissingClips(local, server, "page");
    const text = JSON.stringify(merged.doc);
    expect(text).toContain("My own words");
    expect(merged.merged).toBe(1);
  });
});
