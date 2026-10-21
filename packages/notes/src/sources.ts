import type { JSONContent } from "@tiptap/core";

/**
 * Where the source of a piece of text is named.
 *
 * A doc groups the pieces it holds under headings. The heading carries a key
 * that says what the section is about: the page the pieces came from, the
 * website they came from, or the day they were captured.
 *
 * These helpers work out whether the heading above a piece already names its
 * source. When it does, the piece is shown as plain text and the source is
 * not repeated under it.
 */

export interface ClipSource {
  clipId?: string | null;
  sourceUrl?: string | null;
  domain?: string | null;
}

/**
 * The address of the page a piece came from, without its query or its anchor.
 *
 * Two pieces from the same page share this address, which is what makes it
 * possible to say "this piece is already under its own heading".
 */
export function clipPageKey(sourceUrl: string | null | undefined): string | null {
  const value = (sourceUrl ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return `page:${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * The keys of the sections that would name this piece's source.
 */
export function sourceKeysForClip(clip: ClipSource): string[] {
  const keys: string[] = [];
  const domain = (clip.domain ?? "").trim();
  if (domain) keys.push(`site:${domain}`);
  const page = clipPageKey(clip.sourceUrl);
  if (page) keys.push(page);
  return keys;
}

/**
 * The address the section key points at.
 *
 * A section that was made for a page knows the page. A section that was made
 * for a website only knows the website, so the link goes to the front page.
 */
export function sourceUrlForSectionKey(key: string | null | undefined): string | null {
  const value = (key ?? "").trim();
  if (!value) return null;
  if (value.startsWith("page:")) {
    const url = value.slice("page:".length);
    return /^https?:\/\//i.test(url) ? url : null;
  }
  if (value.startsWith("site:")) {
    const domain = value.slice("site:".length).trim();
    return domain ? `https://${domain}` : null;
  }
  return null;
}

/**
 * The key of the section a piece sits in.
 *
 * The section is the last heading above the piece that carries a key. Headings
 * the user wrote themselves do not carry one, so they do not end a section.
 */
export function sectionKeyForClipId(doc: JSONContent | null | undefined, clipId: string | null | undefined): string | null {
  if (!doc || !clipId) return null;
  let current: string | null = null;
  let found: string | null = null;
  let done = false;

  const walk = (node: JSONContent) => {
    if (done) return;
    if (node.type === "heading") {
      const key = node.attrs?.sectionKey;
      if (typeof key === "string" && key) current = key;
      return;
    }
    if (node.type === "clip") {
      if (String(node.attrs?.clipId ?? "") === clipId) {
        found = current;
        done = true;
      }
      return;
    }
    if (Array.isArray(node.content)) for (const child of node.content) walk(child);
  };

  if (doc.type === "doc" || Array.isArray(doc.content)) walk(doc);
  return found;
}

/**
 * True when the heading above the piece already says where it came from.
 *
 * This is the case the reader notices: the same link repeated under every
 * box, when the heading at the top of the group already names it.
 */
export function clipSourceNamedAbove(doc: JSONContent | null | undefined, clip: ClipSource): boolean {
  const sectionKey = sectionKeyForClipId(doc, clip.clipId);
  if (!sectionKey) return false;
  return sourceKeysForClip(clip).includes(sectionKey);
}

/**
 * A copy of the doc where the pieces that repeat their heading are marked.
 *
 * The mark is only used when a doc is shown, never when it is stored. The
 * pieces stay in the doc, so the server still knows what has been saved.
 */export function markInlineClips(doc: JSONContent | null | undefined): JSONContent {
  if (!doc) return { type: "doc", content: [] };
  const marked = new Set<string>();
  /**
   * The section carries on to the pieces that follow the heading, so it is
   * kept for the whole run of siblings rather than for one branch.
   */
  const collect = (nodes: JSONContent[], sectionKey: string | null): string | null => {
    let current = sectionKey;
    for (const node of nodes) {
      if (node.type === "heading") {
        const key = node.attrs?.sectionKey;
        if (typeof key === "string" && key) current = key;
        continue;
      }
      if (node.type === "clip") {
        const clipId = String(node.attrs?.clipId ?? "");
        if (clipId && current) {
          const keys = sourceKeysForClip({
            sourceUrl: typeof node.attrs?.sourceUrl === "string" ? node.attrs.sourceUrl : "",
            domain: typeof node.attrs?.domain === "string" ? node.attrs.domain : "",
          });
          if (keys.includes(current)) marked.add(clipId);
        }
        continue;
      }
      if (Array.isArray(node.content)) current = collect(node.content, current);
    }
    return current;
  };
  collect(doc.content ?? [], null);

  if (!marked.size) return doc;

  const copy = (node: JSONContent): JSONContent => {
    if (node.type === "clip") {
      const clipId = String(node.attrs?.clipId ?? "");
      if (!marked.has(clipId)) return node;
      return { ...node, attrs: { ...(node.attrs ?? {}), inline: true } };
    }
    if (!Array.isArray(node.content)) return node;
    return { ...node, content: node.content.map(copy) };
  };

  return { ...doc, content: (doc.content ?? []).map(copy) };
}

/**
 * The pieces of a live document whose source the heading above already names.
 *
 * The editor asks for this on every change, so the answer is kept for as long
 * as the document stays the same. A new version of the document is a new
 * object, so the answer is worked out again.
 */
const inlineIdsCache = new WeakMap<object, Set<string>>();

/**
 * The part of a document node this file needs.
 *
 * It is written out here so the package does not have to know which editor
 * the document came from.
 */
interface DocumentNode {
  type: { name: string };
  attrs: Record<string, unknown>;
  forEach: (visit: (child: DocumentNode) => void) => void;
}

export function inlineClipIds(doc: DocumentNode): Set<string> {
  const cached = inlineIdsCache.get(doc);
  if (cached) return cached;

  const ids = new Set<string>();
  const walk = (node: DocumentNode, sectionKey: string | null) => {
    /**
     * The section carries on to the pieces that follow the heading, so it is
     * kept here rather than passed down to one branch of the tree.
     */
    let current = sectionKey;
    node.forEach((child) => {
      if (child.type.name === "heading") {
        const key = child.attrs.sectionKey;
        current = typeof key === "string" && key ? key : current;
        return;
      }
      if (child.type.name === "clip") {
        const clipId = String(child.attrs.clipId ?? "");
        if (!clipId || !current) return;
        const keys = sourceKeysForClip({
          sourceUrl: typeof child.attrs.sourceUrl === "string" ? child.attrs.sourceUrl : "",
          domain: typeof child.attrs.domain === "string" ? child.attrs.domain : "",
        });
        if (keys.includes(current)) ids.add(clipId);
        return;
      }
      walk(child, current);
    });
  };
  walk(doc, null);

  inlineIdsCache.set(doc, ids);
  return ids;
}
