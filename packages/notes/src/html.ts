import { generateJSON } from "@tiptap/html/server";
import { getSchema, type JSONContent } from "@tiptap/core";
import { noteExtensions } from "./extensions";

/**
 * Turn the HTML of a selection into doc content.
 *
 * The HTML goes through the same schema the editor uses, so anything the
 * schema does not know about is dropped rather than stored. A page can carry
 * scripts, styles and odd markup, and none of that belongs in a doc.
 */
export async function htmlToClipContent(html: string | null | undefined): Promise<JSONContent[]> {
  const text = (html ?? "").trim();
  if (!text) return [];

  try {
    const json = generateJSON(text, noteExtensions());
    const content = Array.isArray(json.content) ? json.content : [];
    return content.length ? content : [{ type: "paragraph" }];
  } catch {
    /**
     * The HTML could not be read at all. The plain text is still worth
     * keeping, so it is added as a paragraph.
     */
    return [{ type: "paragraph" }];
  }
}

/**
 * Turn plain text into doc content.
 *
 * Lines that look like a heading or a list item are kept as they are, so a
 * note written in plain text still reads well.
 */
export function textToClipContent(text: string | null | undefined): JSONContent[] {
  const value = (text ?? "").trim();
  if (!value) return [];
  return value.split(/\n{2,}/).map((block) => ({ type: "paragraph", content: [{ type: "text", text: block }] }));
}

/**
 * Check that a doc really is a doc.
 *
 * The content comes from the browser, so it is read back through the schema.
 * Anything the schema does not accept is refused rather than stored.
 */
export function validateDoc(content: unknown): { valid: true; doc: JSONContent } | { valid: false; message: string } {
  if (!content || typeof content !== "object") return { valid: false, message: "The document is missing." };
  const schema = getSchema(noteExtensions());
  try {
    const node = schema.nodeFromJSON(content as JSONContent);
    node.check();
    return { valid: true, doc: node.toJSON() as JSONContent };
  } catch (error) {
    return { valid: false, message: error instanceof Error ? error.message : "The document could not be read." };
  }
}
