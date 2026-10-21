import type { JSONContent } from "@tiptap/core";
import { type AiBlock } from "@data-vault/schemas";
import { validateDoc } from "./html";

/**
 * The answer of the AI, as the editor's own shape.
 *
 * The answer arrives as a list of blocks, never as markup, because a model
 * can write a link that goes somewhere it should not. The blocks are turned
 * into the shape the editor knows, and the result goes through the same
 * check that every other piece of a doc goes through.
 */

/**
 * The blocks that are asked for.
 *
 * The list is written out here rather than taken from the schema, because
 * the model is asked for this shape and the schema is the shape the answer
 * is read with.
 */
export const AI_BLOCKS_JSON_SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["heading", "paragraph", "bullets", "numbered", "checklist", "table", "quote", "clip"] },
          level: { type: "integer" },
          text: { type: "string" },
          items: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                { type: "object", properties: { text: { type: "string" }, done: { type: "boolean" } }, required: ["text"] },
              ],
            },
          },
          header: { type: "array", items: { type: "string" } },
          rows: { type: "array", items: { type: "array", items: { type: "string" } } },
          clipId: { type: "string" },
          added: { type: "boolean" },
        },
        required: ["type"],
      },
    },
  },
  required: ["blocks"],
} as const;

/**
 * The words of a block, with the two marks that are allowed.
 *
 * The text may be in bold and in italic, and nothing else. A link is not
 * written, and a picture is not written, because the model does not get to
 * decide what a reader of the doc may click.
 */
function textNodes(text: string): JSONContent[] {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(pattern).filter((part) => part !== "");
  return parts.map((part) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return { type: "text", text: part.slice(2, -2), marks: [{ type: "bold" }] };
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return { type: "text", text: part.slice(1, -1), marks: [{ type: "italic" }] };
    }
    return { type: "text", text: part };
  });
}

function paragraphOf(text: string): JSONContent {
  return { type: "paragraph", content: textNodes(text) };
}

/**
 * Turn the blocks of an answer into the content of a doc.
 *
 * The pieces of web pages that were in the selection are put back as they
 * were, so that a piece that was collected keeps its source. A piece that
 * the model named and that is not in the selection is left out, because a
 * made-up id must not remove a piece.
 *
 * The result is checked with the same check that every other piece of a
 * doc goes through, so that nothing that the editor would refuse is ever
 * handed to it.
 */
export function aiBlocksToContent(blocks: AiBlock[], clipsById: Map<string, JSONContent>): JSONContent {
  const content: JSONContent[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "heading": {
        const level = Math.min(4, Math.max(1, block.level || 2));
        content.push({ type: "heading", attrs: { level, sectionKey: null }, content: textNodes(block.text ?? "") });
        break;
      }
      case "paragraph": {
        content.push(paragraphOf(block.text ?? ""));
        break;
      }
      case "bullets": {
        const items = block.items ?? [];
        if (!items.length) break;
        content.push({ type: "bulletList", content: items.map((item) => ({ type: "listItem", content: [paragraphOf(item)] })) });
        break;
      }
      case "numbered": {
        const items = block.items ?? [];
        if (!items.length) break;
        content.push({ type: "orderedList", content: items.map((item) => ({ type: "listItem", content: [paragraphOf(item)] })) });
        break;
      }
      case "checklist": {
        const items = block.items ?? [];
        if (!items.length) break;
        content.push({
          type: "taskList",
          content: items.map((item) => ({
            type: "taskItem",
            attrs: { checked: Boolean(item.done) },
            content: [paragraphOf(item.text ?? "")],
          })),
        });
        break;
      }
      case "table": {
        const header = block.header ?? [];
        const rows = block.rows ?? [];
        if (!header.length && !rows.length) break;
        content.push({
          type: "table",
          content: [
            { type: "tableRow", content: header.map((cell) => ({ type: "tableHeader", content: [paragraphOf(cell)] })) },
            ...rows.map((row) => ({ type: "tableRow", content: row.map((cell) => ({ type: "tableCell", content: [paragraphOf(cell)] })) })),
          ],
        });
        break;
      }
      case "quote": {
        content.push({ type: "blockquote", content: [paragraphOf(block.text ?? "")] });
        break;
      }
      case "clip": {
        /**
         * A piece is only put back when it is really in the selection. A
         * made-up id is left out.
         */
        const clip = clipsById.get(block.clipId);
        if (clip) content.push(clip);
        break;
      }
      default:
        break;
    }
  }
  const doc = { type: "doc", content };
  const checked = validateDoc(doc);
  return checked.valid ? checked.doc : doc;
}
