import type { JSONContent } from "@tiptap/core";
import { sourceKeysForClip } from "./sources";

/**
 * The plain text of a doc.
 *
 * This is what is searched through and what is shown as the short summary of
 * a doc in a list.
 */
export function docToPlainText(doc: JSONContent | null | undefined): string {
  if (!doc) return "";
  const parts: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "text" && typeof node.text === "string") {
      parts.push(node.text);
      return;
    }
    if (node.type === "clip") {
      const title = typeof node.attrs?.sourceTitle === "string" ? node.attrs.sourceTitle : "";
      if (title) parts.push(title);
    }
    if (Array.isArray(node.content)) for (const child of node.content) walk(child);
    if (["paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableCell", "tableHeader", "clip"].includes(node.type ?? "")) {
      parts.push("\n");
    }
  };
  walk(doc);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/** The first few words of a doc, for a short summary in a list. */
export function docExcerpt(doc: JSONContent | null | undefined, length = 160): string {
  const text = docToPlainText(doc).replace(/\s+/g, " ").trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length).trimEnd()}…`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

function marksOf(node: JSONContent): string[] {
  return Array.isArray(node.marks) ? node.marks.map((mark) => mark.type) : [];
}

function renderText(node: JSONContent): string {
  let text = node.text ?? "";
  const marks = marksOf(node);
  if (marks.includes("code")) return `\`${text}\``;
  if (marks.includes("bold")) text = `**${text}**`;
  if (marks.includes("italic")) text = `_${text}_`;
  if (marks.includes("strike")) text = `~~${text}~~`;
  if (marks.includes("underline")) text = `<u>${text}</u>`;
  if (marks.includes("highlight")) text = `==${text}==`;
  const link = node.marks?.find((mark) => mark.type === "link");
  if (link?.attrs?.href) text = `[${text}](${String(link.attrs.href)})`;
  return text;
}

function renderBlocks(nodes: JSONContent[] | undefined, depth = 0, context: { sectionKey: string | null } = { sectionKey: null }): string {
  if (!nodes?.length) return "";
  const out: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph": {
        const text = (node.content ?? []).map(renderText).join("");
        out.push(text);
        break;
      }
      case "heading": {
        const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
        const text = (node.content ?? []).map(renderText).join("");
        /**
         * The heading names the source of the pieces under it, so the pieces
         * do not have to write it out again.
         */
        const key = node.attrs?.sectionKey;
        context.sectionKey = typeof key === "string" && key ? key : null;
        out.push(`${"#".repeat(Math.min(6, Math.max(1, level)))} ${text}`);
        break;
      }
      case "bulletList": {
        const items = (node.content ?? []).map((item) => `- ${renderBlocks(item.content, depth + 1, context).trim()}`);
        out.push(items.join("\n"));
        break;
      }
      case "orderedList": {
        const items = (node.content ?? []).map((item, index) => `${index + 1}. ${renderBlocks(item.content, depth + 1, context).trim()}`);
        out.push(items.join("\n"));
        break;
      }
      case "taskList": {
        const items = (node.content ?? []).map((item) => {
          const checked = item.attrs?.checked ? "x" : " ";
          const text = (item.content ?? []).map(renderText).join("");
          return `- [${checked}] ${text}`;
        });
        out.push(items.join("\n"));
        break;
      }
      case "taskItem": {
        const checked = node.attrs?.checked ? "x" : " ";
        const text = (node.content ?? []).map(renderText).join("");
        out.push(`- [${checked}] ${text}`);
        break;
      }
      case "listItem": {
        const text = (node.content ?? []).map((child) => renderBlocks([child], depth + 1, context).trim()).join("\n");
        out.push(text);
        break;
      }
      case "blockquote": {
        const text = renderBlocks(node.content, depth, context).trim();
        out.push(text.split("\n").map((line) => `> ${line}`).join("\n"));
        break;
      }
      case "codeBlock": {
        const text = (node.content ?? []).map((child) => child.text ?? "").join("");
        const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
        out.push(["```", language, text, "```"].join("\n"));
        break;
      }
      case "horizontalRule": {
        out.push("---");
        break;
      }
      case "hardBreak": {
        out.push("");
        break;
      }
      case "image": {
        const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        out.push(`![${alt}](${src})`);
        break;
      }
      case "table": {
        const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map(renderText).join("").replace(/\|/g, "\\|")));
        if (rows.length) {
          const header = rows[0] ?? [];
          out.push(`| ${header.join(" | ")} |`);
          out.push(`| ${header.map(() => "---").join(" | ")} |`);
          for (const row of rows.slice(1)) out.push(`| ${row.join(" | ")} |`);
        }
        break;
      }
      case "clip": {
        const title = typeof node.attrs?.sourceTitle === "string" ? node.attrs.sourceTitle : "";
        const url = typeof node.attrs?.sourceUrl === "string" ? node.attrs.sourceUrl : "";
        const domain = typeof node.attrs?.domain === "string" ? node.attrs.domain : "";
        const body = renderBlocks(node.content, depth, context).trim();
        const footer = [title, domain].filter(Boolean).join(" · ");
        /**
         * When the heading above already names the source, the link is not
         * written again. It is written once, at the heading.
         */
        const namedAbove = context.sectionKey
          ? sourceKeysForClip({ sourceUrl: url, domain }).includes(context.sectionKey)
          : false;
        if (namedAbove) {
          out.push(body);
          break;
        }
        out.push([body, url ? `_From ${footer || url}_` : `_${footer}_`].filter(Boolean).join("\n\n"));
        break;
      }
      default: {
        if (Array.isArray(node.content)) out.push(renderBlocks(node.content, depth, context));
        break;
      }
    }
  }
  return out.filter((block) => block !== "").join("\n\n");
}

/**
 * A doc as Markdown.
 *
 * This is what the export button produces, and what is copied to the
 * clipboard when the user asks for the doc as Markdown.
 */
export function docToMarkdown(doc: JSONContent | null | undefined): string {
  if (!doc) return "";
  return renderBlocks(doc.content).trim();
}

export { escapeMarkdown };
