import { Extension, Node, mergeAttributes, type Extensions, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";

/**
 * The addresses a doc is allowed to point at.
 *
 * A doc is written from pages that were found on the web, and the address in
 * a link can be anything at all. Only a web address or an email address is
 * kept, so a link cannot carry a script or a call to a local program.
 */
const LINK_PROTOCOLS = ["http:", "https:", "mailto:"] as const;
/** Images are loaded by the browser, so only a web address is kept. */
const IMAGE_PROTOCOLS = ["http:", "https:"] as const;

/**
 * The address, when it is one that is allowed.
 *
 * Anything that cannot be read as an address, or that uses a protocol that
 * is not allowed, gives nothing back. The caller then leaves the attribute
 * out rather than writing something that does not belong.
 */
export function safeUrl(value: unknown, protocols: readonly string[] = LINK_PROTOCOLS): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return protocols.includes(parsed.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * The attributes a clip keeps about where it came from.
 */
export interface ClipAttributes {
  clipId: string;
  hash: string;
  sourceUrl: string;
  sourceTitle: string;
  domain: string;
  capturedAt: string;
}

/**
 * A piece of a web page that was added to a doc.
 *
 * The clip keeps its own attributes rather than relying on the text alone, so
 * the doc can always show where a piece came from and can undo a single clip
 * without touching the rest of the document.
 */
export const Clip = Node.create({
  name: "clip",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      clipId: { default: null, rendered: false },
      hash: { default: null, rendered: false },
      sourceUrl: {
        default: null,
        rendered: false,
        /**
         * The address the piece came from. It is only kept when it is a web
         * address, so a doc cannot carry an address that points somewhere
         * else.
         */
        parseHTML: (element) => safeUrl(element.getAttribute("data-source-url")),
      },
      sourceTitle: { default: null, rendered: false },
      domain: { default: null, rendered: false },
      capturedAt: { default: null, rendered: false },
      /**
       * Only used when a doc is shown.
       *
       * It says the heading above already names the source of this piece, so
       * the piece is shown as plain text instead of a card with the same link
       * in it again. It is never written to a stored doc.
       */
      inline: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [{
      tag: "div[data-clip-id]",
      getAttrs: (element) => {
        const node = element as HTMLElement;
        return {
          clipId: node.getAttribute("data-clip-id"),
          hash: node.getAttribute("data-hash"),
          sourceUrl: node.getAttribute("data-source-url"),
          sourceTitle: node.getAttribute("data-source-title"),
          domain: node.getAttribute("data-domain"),
          capturedAt: node.getAttribute("data-captured-at"),
          inline: node.getAttribute("data-inline") === "true",
        };
      },
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as Record<string, unknown>;
    const inline = attrs.inline === true;
    return ["div", mergeAttributes({
      "data-clip-id": attrs.clipId ?? "",
      "data-hash": attrs.hash ?? "",
      "data-source-url": attrs.sourceUrl ?? "",
      "data-source-title": attrs.sourceTitle ?? "",
      "data-domain": attrs.domain ?? "",
      "data-captured-at": attrs.capturedAt ?? "",
      class: "datavault-clip",
      ...(inline ? { "data-inline": "true" } : {}),
    }, HTMLAttributes), 0];
  },
});

/**
 * The key that says which section a heading belongs to.
 *
 * The key is what the arranger matches on. The heading's text can be edited
 * by the user afterwards without the arranger losing track of it.
 */
export const SectionKey = Extension.create({
  name: "sectionKey",

  addGlobalAttributes() {
    return [{
      types: ["heading"],
      attributes: {
        sectionKey: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-section-key"),
          renderHTML: (attributes) => (attributes.sectionKey ? { "data-section-key": attributes.sectionKey } : {}),
        },
      },
    }];
  },
});

/**
 * Images that came from the web.
 *
 * Only a normal https address is accepted. A pasted image is often a data
 * address, which would make the doc enormous and is not a safe thing to
 * load from a saved page.
 */
const SafeImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        /** Only a web address is loaded, and never a pasted image. */
        parseHTML: (element) => safeUrl(element.getAttribute("src"), IMAGE_PROTOCOLS),
        renderHTML: (attributes) => ({ src: safeUrl(attributes.src, IMAGE_PROTOCOLS) ?? "" }),
      },
    };
  },
}).configure({ allowBase64: false });

/**
 * Links that can only point at a web address or an email address.
 *
 * The address is checked when the doc is read and again when it is written
 * out, so a link cannot carry anything else.
 */
const SafeLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      href: {
        default: null,
        parseHTML: (element) => safeUrl(element.getAttribute("href")),
        renderHTML: (attributes) => ({ href: safeUrl(attributes.href) ?? "" }),
      },
    };
  },
});

/**
 * Every extension a DataVault doc can hold.
 *
 * The website, the server and the extension all use this one list, so a doc
 * means the same thing wherever it is opened.
 */
export function noteExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      /** The link is added below, in its own safe form. */
      link: false,
      codeBlock: { HTMLAttributes: { class: "datavault-code" } },
    }),
    SafeLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      protocols: [...LINK_PROTOCOLS].map((protocol) => protocol.replace(":", "")),
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
    }),
    SectionKey,
    Clip,
    TextStyleKit,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    SafeImage,
  ];
}

/** An empty doc, with one paragraph in it. */
export function emptyDoc(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/**
 * The name of the node that holds a section heading.
 *
 * Sections are level two headings, so they sit below the title of the doc
 * and above anything the user writes inside a section.
 */
export const SECTION_HEADING_LEVEL = 2;
