import type { JSONContent } from "@tiptap/core";
import { aiBlockSchema, aiBlocksSchema, type AiBlock } from "@data-vault/schemas";
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
        /**
         * The editor has three levels of heading. A fourth one would be
         * drawn as the biggest heading of all, because that is the one the
         * editor falls back to.
         */
        const level = Math.min(3, Math.max(1, block.level || 2));
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
  /**
   * A doc that the editor would refuse is not written into the editor.
   *
   * The unchecked version used to be used instead, which put something into
   * the doc that the editor had already said it would not accept.
   */
  if (!checked.valid) throw new Error("The answer was not a shape the editor accepts.");
  return checked.doc;
}

/**
 * Clean markdown code fences and <think>...</think> blocks from raw AI text output.
 */
export function cleanRawJsonText(raw: string): string {
  let cleaned = raw.trim();
  // Remove <think>...</think> reasoning blocks from reasoning models (DeepSeek-R1, Qwen, etc.)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Extract from markdown code fence ```json ... ``` or ``` ... ```
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(cleaned);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleaned = codeBlockMatch[1].trim();
  }

  return cleaned;
}

/**
 * Parse arbitrary markdown or text into structured AI blocks.
 */
export function textToAiBlocks(rawText: string): AiBlock[] {
  const cleaned = cleanRawJsonText(rawText);
  // Try if cleaned text itself is JSON
  try {
    const json = JSON.parse(cleaned);
    const fromJson = normalizeToAiBlocks(json);
    if (fromJson.blocks.length) return fromJson.blocks;
  } catch {
    // Not JSON; fall through to the line-based reader.
  }

  const lines = cleaned.split("\n");
  const blocks: AiBlock[] = [];
  let currentBullets: string[] = [];
  let currentNumbered: string[] = [];
  let currentChecklist: { text: string; done: boolean }[] = [];
  let currentParagraph: string[] = [];

  const flushList = () => {
    if (currentBullets.length) {
      blocks.push({ type: "bullets", items: [...currentBullets] });
      currentBullets = [];
    }
    if (currentNumbered.length) {
      blocks.push({ type: "numbered", items: [...currentNumbered] });
      currentNumbered = [];
    }
    if (currentChecklist.length) {
      blocks.push({ type: "checklist", items: [...currentChecklist] });
      currentChecklist = [];
    }
    if (currentParagraph.length) {
      const text = currentParagraph.join(" ").trim();
      if (text) blocks.push({ type: "paragraph", text });
      currentParagraph = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    // Heading: #, ##, ###
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      flushList();
      const level = Math.min(3, Math.max(1, headingMatch[1].length)) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: headingMatch[2].trim() });
      continue;
    }

    // Checklist: - [ ] or - [x]
    const checkMatch = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(trimmed);
    if (checkMatch && checkMatch[1] && checkMatch[2]) {
      if (currentParagraph.length) flushList();
      currentChecklist.push({ text: checkMatch[2].trim(), done: checkMatch[1].toLowerCase() === "x" });
      continue;
    }

    // Bullets: - or *
    const bulletMatch = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bulletMatch && bulletMatch[1]) {
      if (currentParagraph.length) flushList();
      currentBullets.push(bulletMatch[1].trim());
      continue;
    }

    // Numbered: 1. or 2)
    const numMatch = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numMatch && numMatch[1]) {
      if (currentParagraph.length) flushList();
      currentNumbered.push(numMatch[1].trim());
      continue;
    }

    // Quote: >
    const quoteMatch = /^>\s*(.*)$/.exec(trimmed);
    if (quoteMatch && quoteMatch[1]) {
      flushList();
      blocks.push({ type: "quote", text: quoteMatch[1].trim() });
      continue;
    }

    // Regular text line
    if (currentBullets.length || currentNumbered.length || currentChecklist.length) {
      flushList();
    }
    currentParagraph.push(trimmed);
  }

  flushList();

  if (!blocks.length && cleaned.trim()) {
    blocks.push({ type: "paragraph", text: cleaned.trim() });
  }

  return blocks;
}

/**
 * Convert any model response into a valid { blocks: AiBlock[] } object,
 * forgiving models that return strings, markdown, { text: ... }, or direct arrays.
 */
export function normalizeToAiBlocks(data: unknown): { blocks: AiBlock[] } {
  const direct = aiBlocksSchema.safeParse(data);
  if (direct.success && direct.data.blocks.length > 0) {
    return direct.data;
  }

  if (typeof data === "string" && data.trim()) {
    const blocks = textToAiBlocks(data);
    if (blocks.length) return { blocks };
  }

  if (data && typeof data === "object") {
    if (Array.isArray(data)) {
      const blocks = normalizeBlockArray(data);
      if (blocks.length) return { blocks };
    }

    const record = data as Record<string, unknown>;
    if (Array.isArray(record.blocks)) {
      const blocks = normalizeBlockArray(record.blocks);
      if (blocks.length) return { blocks };
    }

    for (const key of ["text", "message", "response", "answer", "content", "reply"]) {
      const val = record[key];
      if (typeof val === "string" && val.trim()) {
        const blocks = textToAiBlocks(val);
        if (blocks.length) return { blocks };
      }
    }
  }

  return { blocks: [] };
}

function normalizeBlockArray(arr: unknown[]): AiBlock[] {
  const blocks: AiBlock[] = [];
  for (const item of arr) {
    const valid = aiBlockSchema.safeParse(item);
    if (valid.success) {
      blocks.push(valid.data);
    } else if (item && typeof item === "object") {
      const it = item as Record<string, unknown>;
      const text = typeof it.text === "string" ? it.text : typeof it.content === "string" ? it.content : "";
      if (text) {
        blocks.push({ type: "paragraph", text });
      }
    } else if (typeof item === "string" && item.trim()) {
      blocks.push({ type: "paragraph", text: item.trim() });
    }
  }
  return blocks;
}
