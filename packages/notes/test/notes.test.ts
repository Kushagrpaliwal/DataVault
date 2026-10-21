import { describe, expect, test } from "bun:test";
import { htmlToClipContent, textToClipContent, validateDoc } from "../src/html";
import { docToMarkdown, docToPlainText } from "../src/text";
import { emptyDoc, noteExtensions } from "../src/extensions";
import { getSchema } from "@tiptap/core";

describe("htmlToClipContent", () => {
  test("keeps the formatting of a selection", async () => {
    const content = await htmlToClipContent("<h2>Heading</h2><p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>");
    const types = content.map((node) => node.type);
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
