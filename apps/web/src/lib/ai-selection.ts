import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { docToMarkdown, aiBlocksToContent } from "@data-vault/notes";
import type { AiBlock } from "@data-vault/types";

/**
 * What is sent to the model.
 *
 * The selection is sent as Markdown, and the pieces of web pages that are
 * in it are sent beside it, so that a piece can be put back as it was.
 */
export interface SelectionPayload {
  markdown: string;
  clips: { clipId: string; text: string }[];
}

/**
 * The words of a node, without the marks.
 */
function plainText(node: JSONContent): string {
  if (node.type === "text" && typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(plainText).join("");
}

/**
 * The pieces of web pages that are in a part of a doc.
 */
function clipsIn(node: JSONContent, found: { clipId: string; text: string }[]): void {
  if (node.type === "clip") {
    const clipId = typeof node.attrs?.clipId === "string" ? node.attrs.clipId : "";
    if (clipId) {
      const text = plainText(node).trim();
      found.push({ clipId, text: text || (typeof node.attrs?.sourceTitle === "string" ? node.attrs.sourceTitle : "") });
    }
  }
  if (Array.isArray(node.content)) for (const child of node.content) clipsIn(child, found);
}

/**
 * The selection, as it is sent.
 *
 * The text is the selection as Markdown, so that the model sees the words
 * and not the marks of the editor. The pieces are collected beside it, so
 * that a piece the model puts back is the piece that was there.
 */
export function selectionPayload(editor: Editor, from: number, to: number): SelectionPayload {
  const slice = editor.state.doc.slice(from, to);
  const json = slice.toJSON() as JSONContent;
  const clips: { clipId: string; text: string }[] = [];
  clipsIn(json, clips);
  return { markdown: docToMarkdown(json), clips };
}

/**
 * The clips of a part of a doc, as the editor's own nodes.
 *
 * They are put back as they were, so that a piece that was collected keeps
 * its source.
 */
export function clipNodes(editor: Editor, from: number, to: number): Map<string, JSONContent> {
  const slice = editor.state.doc.slice(from, to);
  const found = new Map<string, JSONContent>();
  const walk = (node: JSONContent) => {
    if (node.type === "clip") {
      const clipId = typeof node.attrs?.clipId === "string" ? node.attrs.clipId : "";
      if (clipId) found.set(clipId, node);
    }
    if (Array.isArray(node.content)) for (const child of node.content) walk(child);
  };
  walk(slice.toJSON() as JSONContent);
  return found;
}

/**
 * How many tokens the selection is, roughly.
 *
 * It is a rough count of four characters to a token, which is enough to
 * tell a person whether they are about to send a great deal.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * The answer, as the editor would write it.
 */
export function blocksToContent(blocks: AiBlock[], clips: Map<string, JSONContent>): JSONContent {
  /**
   * The converter is in the shared package, so that the server and the
   * browser make the same doc out of the same answer.
   */
  return aiBlocksToContent(blocks, clips);
}
