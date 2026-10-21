import type { JSONContent } from "@tiptap/core";
import { SECTION_HEADING_LEVEL } from "./extensions";

/**
 * How clips are sorted inside a doc.
 *
 * - `page` puts every clip from the same web page under its own heading.
 * - `site` puts every clip from the same website under one heading.
 * - `day` puts the clips of one day under one heading.
 * - `none` adds nothing to the end of the doc.
 */
export type ArrangeMode = "page" | "site" | "day" | "none";

export const ARRANGE_MODES: ArrangeMode[] = ["page", "site", "day", "none"];

export interface ClipContent {
  /** A unique id for this clip, used to undo it later. */
  clipId: string;
  /** A fingerprint of the clipped text, used to spot the same clip twice. */
  hash: string;
  sourceUrl: string;
  sourceTitle: string;
  domain: string;
  capturedAt: string;
  /** The blocks that make up the clipped text. */
  content: JSONContent[];
}

export interface ArrangeResult {
  doc: JSONContent;
  /** The heading the clip was placed under, or an empty string. */
  sectionTitle: string;
  /** True when the very same clip was already in the doc. */
  duplicate: boolean;
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * The key of the section a clip belongs to.
 *
 * The key is stable even when the heading text is edited, so the arranger
 * always finds the same section again.
 */
export function sectionKeyFor(mode: ArrangeMode, clip: { sourceUrl: string; domain: string }, capturedAt: string, timeZone?: string): string | null {
  if (mode === "none") return null;
  if (mode === "site") return `site:${clip.domain || "unknown"}`;
  if (mode === "day") return `day:${localDay(capturedAt, timeZone)}`;
  const url = safeUrl(clip.sourceUrl);
  if (!url) return `site:${clip.domain || "unknown"}`;
  return `page:${url.origin}${url.pathname}`;
}

/**
 * The day a clip was captured on, in the reader's own time zone.
 */
export function localDay(capturedAt: string, timeZone?: string): string {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return "unknown";
  try {
    if (timeZone) {
      const formatted = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      return formatted;
    }
    return date.toISOString().slice(0, 10);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * The heading a section gets.
 */
export function sectionTitleFor(mode: ArrangeMode, clip: { sourceUrl: string; sourceTitle: string; domain: string }, capturedAt: string, timeZone?: string): string {
  if (mode === "site") return clip.domain || "Unknown website";
  if (mode === "day") return dayHeading(capturedAt, timeZone);
  return clip.sourceTitle?.trim() || clip.domain || "Untitled page";
}

function dayHeading(capturedAt: string, timeZone?: string): string {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return "Unknown day";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return date.toDateString();
  }
}

function headingNode(title: string, sectionKey: string | null): JSONContent {
  return {
    type: "heading",
    attrs: { level: SECTION_HEADING_LEVEL, sectionKey },
    content: [{ type: "text", text: title }],
  };
}

function clipNode(clip: ClipContent): JSONContent {
  return {
    type: "clip",
    attrs: {
      clipId: clip.clipId,
      hash: clip.hash,
      sourceUrl: clip.sourceUrl,
      sourceTitle: clip.sourceTitle,
      domain: clip.domain,
      capturedAt: clip.capturedAt,
    },
    content: clip.content.length ? clip.content : [{ type: "paragraph" }],
  };
}

function isHeading(node: JSONContent | undefined): boolean {
  return node?.type === "heading";
}

function headingLevel(node: JSONContent | undefined): number {
  const level = node?.attrs?.level;
  return typeof level === "number" ? level : 1;
}

function headingKey(node: JSONContent | undefined): string | null {
  const key = node?.attrs?.sectionKey;
  return typeof key === "string" ? key : null;
}

/**
 * Look for a clip that is already in the doc.
 */
export function findClipByHash(doc: JSONContent, hash: string): JSONContent | null {
  if (!hash) return null;
  const stack: JSONContent[] = [doc];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "clip" && node.attrs?.hash === hash) return node;
    if (Array.isArray(node.content)) stack.push(...node.content);
  }
  return null;
}

/**
 * Find a clip by its id.
 */
export function findClipById(doc: JSONContent, clipId: string): JSONContent | null {
  const stack: JSONContent[] = [doc];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "clip" && node.attrs?.clipId === clipId) return node;
    if (Array.isArray(node.content)) stack.push(...node.content);
  }
  return null;
}

/**
 * Remove a clip from a doc.
 */
export function removeClip(doc: JSONContent, clipId: string): JSONContent {
  const strip = (node: JSONContent): JSONContent => {
    if (!Array.isArray(node.content)) return node;
    const content = node.content
      .filter((child) => !(child.type === "clip" && child.attrs?.clipId === clipId))
      .map((child) => strip(child));
    return { ...node, content };
  };
  return strip(doc);
}

/**
 * Add the pieces the server has and the editor does not.
 *
 * A piece added from the browser while the doc was open is put back into the
 * editor's own copy, in the section it belongs to. The user's writing is
 * never thrown away.
 */
export function mergeMissingClips(local: JSONContent, server: JSONContent, mode: ArrangeMode): { doc: JSONContent; merged: number } {
  const known = new Set<string>();
  const collect = (node: JSONContent) => {
    if (node.type === "clip") {
      const hash = String(node.attrs?.hash ?? "");
      if (hash) known.add(hash);
      return;
    }
    if (Array.isArray(node.content)) for (const child of node.content) collect(child);
  };
  collect(local);

  const missing: ClipContent[] = [];
  const gather = (node: JSONContent) => {
    if (node.type === "clip") {
      const hash = String(node.attrs?.hash ?? "");
      if (hash && !known.has(hash)) {
        missing.push({
          clipId: String(node.attrs?.clipId ?? crypto.randomUUID()),
          hash,
          sourceUrl: String(node.attrs?.sourceUrl ?? ""),
          sourceTitle: String(node.attrs?.sourceTitle ?? ""),
          domain: String(node.attrs?.domain ?? ""),
          capturedAt: String(node.attrs?.capturedAt ?? new Date().toISOString()),
          content: node.content ?? [],
        });
      }
      return;
    }
    if (Array.isArray(node.content)) for (const child of node.content) gather(child);
  };
  gather(server);

  let doc = local;
  for (const clip of missing) {
    const result = appendClip(doc, clip, mode);
    if (!result.duplicate) doc = result.doc;
  }
  return { doc, merged: missing.length };
}

/**
 * Add a clip to a doc, under the right heading.
 *
 * The heading is found by its key, so it survives the user editing its text.
 * A clip that goes into a section is placed at the end of that section, so
 * the clips of one page stay together.
 */
export function appendClip(doc: JSONContent, clip: ClipContent, mode: ArrangeMode, timeZone?: string): ArrangeResult {
  const content = Array.isArray(doc.content) ? [...doc.content] : [];

  if (findClipByHash(doc, clip.hash)) {
    return { doc, sectionTitle: "", duplicate: true };
  }

  const key = sectionKeyFor(mode, clip, clip.capturedAt, timeZone);

  // Nothing to arrange under. The clip simply goes on the end.
  if (!key) {
    return {
      doc: { ...doc, content: [...content, clipNode(clip)] },
      sectionTitle: "",
      duplicate: false,
    };
  }

  const title = sectionTitleFor(mode, clip, clip.capturedAt, timeZone);
  const headingIndex = content.findIndex((node) => isHeading(node) && headingLevel(node) === SECTION_HEADING_LEVEL && headingKey(node) === key);

  if (headingIndex === -1) {
    return {
      doc: { ...doc, content: [...content, headingNode(title, key), clipNode(clip)] },
      sectionTitle: title,
      duplicate: false,
    };
  }

  /**
   * The end of the section is the last node before the next heading that is
   * at the same level or higher.
   */
  let end = content.length;
  for (let index = headingIndex + 1; index < content.length; index += 1) {
    const node = content[index];
    if (isHeading(node) && headingLevel(node) <= SECTION_HEADING_LEVEL) {
      end = index;
      break;
    }
  }

  const next = [...content.slice(0, end), clipNode(clip), ...content.slice(end)];
  return { doc: { ...doc, content: next }, sectionTitle: title, duplicate: false };
}
