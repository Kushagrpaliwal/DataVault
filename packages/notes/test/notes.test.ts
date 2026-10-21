import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { docToHtml, textToClipContent, validateDoc } from "../src/html";
import { htmlToClipContent } from "../src/html-server";
import { docToMarkdown, docToPlainText } from "../src/text";
import { emptyDoc, noteExtensions, safeUrl } from "../src/extensions";
import { getSchema } from "@tiptap/core";

/**
 * Writing HTML out needs a document to write it into. The website has one,
 * and the test borrows one.
 */
if (!globalThis.document) {
  const window = new Window({ url: "https://example.com" });
  (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
  (globalThis as unknown as { window: Window }).window = window as unknown as Window;
}

describe("htmlToClipContent", () => {
  test("keeps the formatting of a selection", async () => {
    const content = await htmlToClipContent("<h2>Heading</h2><p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>");
    const types = content.map((node: { type?: string }) => node.type);
    expect(types).toContain("heading");
    expect(types).toContain("paragraph");
    expect(types).toContain("bulletList");
  });

  test("drops scripts and styles", async () => {
    const content = await htmlToClipContent('<p>Keep <script>alert(1)</script><style>p{}</style>this</p>');
    expect(JSON.stringify(content)).not.toContain("script");
    expect(JSON.stringify(content)).not.toContain("style");
  });

  test("an empty selection gives nothing", async () => {
    expect(await htmlToClipContent("")).toEqual([]);
    expect(await htmlToClipContent(null)).toEqual([]);
  });
});

describe("textToClipContent", () => {
  test("plain text becomes paragraphs", () => {
    const content = textToClipContent("First line\n\nSecond line");
    expect(content).toHaveLength(2);
    expect(content[0]?.type).toBe("paragraph");
  });
});

describe("docToHtml", () => {
  test("keeps the links, the images and the tables", () => {
    const html = docToHtml({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A source", marks: [{ type: "link", attrs: { href: "https://example.com/article" } }] }] },
        { type: "image", attrs: { src: "https://example.com/figure.png" } },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A figure" }] }] }] },
          ],
        },
      ],
    } as never);
    expect(html).toContain("https://example.com/article");
    expect(html).toContain("https://example.com/figure.png");
    expect(html).toContain("A figure");
  });

  test("a link that is not a web address is left out", () => {
    const html = docToHtml({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A source", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }],
    } as never);
    expect(html).not.toContain("javascript:");
  });
});

describe("safeUrl", () => {
  test("a web address and an email address are kept", () => {
    expect(safeUrl("https://example.com/page")).toBe("https://example.com/page");
    expect(safeUrl("mailto:someone@example.com")).toBe("mailto:someone@example.com");
  });

  test("anything else is refused", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html;base64,abc")).toBeNull();
    expect(safeUrl("file:///etc/passwd")).toBeNull();
    expect(safeUrl("not an address")).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });

  test("an image may only be a web address", () => {
    expect(safeUrl("mailto:someone@example.com", ["http:", "https:"])).toBeNull();
  });
});

describe("validateDoc", () => {
  test("a real doc is accepted", () => {
    const result = validateDoc(emptyDoc());
    expect(result.valid).toBe(true);
  });

  test("a doc with an unknown node is refused", () => {
    const result = validateDoc({ type: "doc", content: [{ type: "notARealNode" }] });
    expect(result.valid).toBe(false);
  });

  test("something that is not a doc is refused", () => {
    expect(validateDoc(null).valid).toBe(false);
    expect(validateDoc("hello").valid).toBe(false);
  });
});

describe("the shared schema", () => {
  test("it holds the blocks a doc needs", () => {
    const schema = getSchema(noteExtensions());
    for (const name of ["doc", "paragraph", "heading", "bulletList", "orderedList", "taskList", "table", "clip", "blockquote", "codeBlock", "horizontalRule", "image"]) {
      expect(schema.nodes[name]).toBeDefined();
    }
    for (const name of ["bold", "italic", "underline", "strike", "code", "link", "highlight", "textStyle"]) {
      expect(schema.marks[name]).toBeDefined();
    }
    /**
     * In Tiptap v3 the colour, font and size live on the text style mark
     * rather than on marks of their own.
     */
    for (const name of ["color", "backgroundColor", "fontFamily", "fontSize"]) {
      expect(schema.marks.textStyle?.spec.attrs?.[name]).toBeDefined();
    }
  });
});

describe("docToPlainText", () => {
  test("it reads the words out of a doc", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body text" }] },
      ],
    };
    expect(docToPlainText(doc)).toContain("Title");
    expect(docToPlainText(doc)).toContain("Body text");
  });
});

describe("docToMarkdown", () => {
  test("it turns a doc into markdown", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
        { type: "paragraph", content: [{ type: "text", text: "Plain", marks: [{ type: "bold" }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Point" }] }] }] },
      ],
    };
    const markdown = docToMarkdown(doc);
    expect(markdown).toContain("## Section");
    expect(markdown).toContain("**Plain**");
    expect(markdown).toContain("- Point");
  });
});
