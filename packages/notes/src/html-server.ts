import { generateJSON } from "@tiptap/html/server";
import type { JSONContent } from "@tiptap/core";
import { noteExtensions } from "./extensions";

/**
 * Turn the HTML of a selection into doc content.
 *
 * The HTML goes through the same schema the editor uses, so anything the
 * schema does not know about is dropped rather than stored. A page can carry
 * scripts, styles and odd markup, and none of that belongs in a doc.
 *
 * This lives apart from the rest of the HTML helpers on purpose. The
 * server-side reader brings a whole DOM with it, which a browser does not
 * need and cannot run, so the website must not pull it in.
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
