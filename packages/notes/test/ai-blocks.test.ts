import { describe, expect, test } from "bun:test";
import type { JSONContent } from "@tiptap/core";
import { aiBlocksToContent } from "../src/ai-blocks";
import { validateDoc } from "../src/html";

/**
 * A piece of a web page, as the editor holds it.
 */
function clip(clipId: string, text: string): JSONContent {
  return {
    type: "clip",
    attrs: { clipId, sourceUrl: "https://example.com/one", sourceTitle: "One", domain: "example.com" },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

describe("the answer of the AI", () => {
  test("it is a doc that the editor accepts", () => {
    const content = aiBlocksToContent([
      { type: "heading", level: 2, text: "The tides" },
      { type: "paragraph", text: "A piece about the water." },
      { type: "bullets", items: ["The water", "The boats"] },
      { type: "numbered", items: ["First", "Second"] },
      { type: "checklist", items: [{ text: "Do this", done: false }] },
      { type: "table", header: ["Name", "Water"], rows: [["The sea", "Deep"]] },
      { type: "quote", text: "A quotation." },
    ], new Map());
    const checked = validateDoc(content);
    expect(checked.valid).toBe(true);
  });

  test("a piece of a web page is kept, and one that was made up is left out", () => {
    const known = clip("clip-one", "The words of the piece.");
    const content = aiBlocksToContent([
      { type: "clip", clipId: "clip-one" },
      { type: "clip", clipId: "clip-made-up" },
    ], new Map([["clip-one", known]]));
    const text = JSON.stringify(content);
    expect(text).toContain("clip-one");
    expect(text).not.toContain("clip-made-up");
  });

  test("no link and no picture get through", () => {
    const content = aiBlocksToContent([
      { type: "paragraph", text: "A [link](https://evil.example) and ![a picture](https://evil.example/x.png)" },
    ], new Map());
    const text = JSON.stringify(content);
    /**
     * The words are kept as words, because a person may well have written
     * an address. What is not kept is the mark that would make them
     * something to click.
     */
    expect(text).not.toContain('"type":"link"');
    expect(text).not.toContain('"type":"image"');
    expect(text).not.toContain("href");
    expect(text).not.toContain("src");
  });

  test("only bold and italic are kept", () => {
    const content = aiBlocksToContent([
      { type: "paragraph", text: "A **bold** word and an *italic* one." },
    ], new Map());
    const marks = JSON.stringify(content).match(/"type":"(bold|italic|link|strike)"/g) ?? [];
    expect(marks).toContain('"type":"bold"');
    expect(marks).toContain('"type":"italic"');
    expect(marks.length).toBe(2);
  });

  test("the parts the AI added are marked", () => {
    const content = aiBlocksToContent([
      { type: "paragraph", text: "This was here.", added: false },
      { type: "paragraph", text: "This was added.", added: true },
    ], new Map());
    expect(JSON.stringify(content)).toContain("added");
  });

  test("a heading of a level the editor does not have becomes one that it does", () => {
    const content = aiBlocksToContent([
      { type: "heading", level: 4, text: "The tides" },
    ], new Map());
    const heading = (content.content as JSONContent[])[0]!;
    /**
     * The editor has three levels. A fourth one would be drawn as the
     * biggest heading of all, because that is the one it falls back to.
     */
    expect((heading.attrs as { level: number }).level).toBe(3);
  });

  test("a piece that the editor would refuse is not written", () => {
    /**
     * A block of a kind the editor does not know is left out, so the answer
     * is made of blocks that are known. The one that is not known is the
     * kind of thing that the check is for.
     */
    const content = aiBlocksToContent([
      { type: "paragraph", text: "A piece about the water." },
    ], new Map());
    expect(validateDoc(content).valid).toBe(true);
  });
});
