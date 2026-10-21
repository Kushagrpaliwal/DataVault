import { browser } from "wxt/browser";
import { readablePage, type PageBlock } from "@data-vault/notes";

/**
 * The blocks of the page that is open.
 *
 * This runs in the page itself, because that is where the document is. It
 * has to stand on its own, because the browser sends it there as text.
 */
export function collectPageBlocks() {
  const wanted = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th, figcaption, dd, dt";
  const elements = Array.from(document.body?.querySelectorAll(wanted) ?? []);
  const blocks: (PageBlock & { html: string })[] = [];
  for (const element of elements) {
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    let linkText = "";
    for (const link of Array.from(element.querySelectorAll("a"))) linkText += `${link.textContent ?? ""} `;
    const marker = `${element.getAttribute("class") ?? ""} ${element.getAttribute("id") ?? ""}`.toLowerCase();
    blocks.push({
      tag: element.tagName.toLowerCase(),
      text,
      linkText: linkText.replace(/\s+/g, " ").trim(),
      marker,
      html: element.outerHTML.slice(0, 40_000),
    });
    if (blocks.length >= 800) break;
  }
  return { title: document.title, blocks };
}

export interface PageContent {
  /** The title of the page. */
  title: string;
  /** The text of the page, without the furniture. */
  text: string;
  /**
   * The page as it was, as the markup of the parts that were kept.
   *
   * It is kept so that the page can be read again later, even after the
   * page itself has changed.
   */
  html: string;
}

/**
 * Read the page that is open.
 *
 * The text that is kept is the part of the page that reads like an
 * article, so the menus and the banners and the list of other things to
 * read are left out.
 */
export async function readPageContent(tabId: number): Promise<PageContent> {
  const result = await browser.scripting.executeScript({
    target: { tabId },
    func: collectPageBlocks,
  });
  const collected = result[0]?.result as { title?: string; blocks?: (PageBlock & { html?: string })[] } | undefined;
  const blocks = collected?.blocks ?? [];
  const readable = readablePage(blocks);
  return {
    title: collected?.title ?? "",
    text: readable.text,
    html: readable.blocks.map((block) => (block as { html?: string }).html ?? "").join("\n").slice(0, 400_000),
  };
}
