/**
 * The main content of a page.
 *
 * A page is mostly furniture: menus, banners, footers, the pieces that ask
 * for a subscription, and the list of other things to read. The content is
 * the part that reads like an article.
 *
 * The blocks are worked out in the page itself, where the document is, and
 * the choice of what to keep is made here, so the same choice is made
 * wherever a page is read.
 */

/**
 * One block of a page.
 *
 * A block is a piece of text that stands on its own: a paragraph, a
 * heading, a list item, a quotation.
 */
export interface PageBlock {
  /** The tag of the element the text came from, in lower case. */
  tag: string;
  /** The text of the block. */
  text: string;
  /** The part of the text that is inside a link. */
  linkText: string;
  /** The class names and the id of the element, in lower case. */
  marker: string;
}

/**
 * The words of a block.
 */
function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * The tags that hold the furniture of a page.
 */
const furnitureTags = new Set(["nav", "header", "footer", "aside", "form", "button", "select", "option", "svg", "script", "style", "noscript", "iframe"]);

/**
 * The words that give a block away as furniture.
 *
 * A block whose name says it is a menu or a banner is not the content of
 * the page, whatever it holds.
 */
const furnitureWords = ["comment", "share", "related", "recommend", "cookie", "consent", "banner", "menu", "nav", "footer", "header", "promo", "advert", "sidebar", "social", "subscribe", "newsletter", "popup", "modal", "breadcrumb", "pagination", "skip", "toolbar", "widget", "login", "signup", "sign up", "sign in", "search"];

/**
 * How much of a block is a link.
 *
 * A paragraph of an article is mostly words. A menu is mostly links, and a
 * list of other articles is entirely links.
 */
function linkDensity(block: PageBlock): number {
  const total = words(block.text);
  if (!total) return 1;
  return words(block.linkText) / total;
}

/**
 * How much a block scores as the content of the page.
 *
 * A long block of writing scores well, and so does a block that reads like
 * an article: it has commas, and its name says so. A block that is mostly a
 * link scores badly, because a menu is mostly links and a list of other
 * articles is entirely links.
 */
function score(block: PageBlock): number {
  const text = block.text;
  const commas = (text.match(/[,，、]/g) ?? []).length;
  const length = words(text);
  const marker = block.marker;
  let value = 1 + Math.min(commas, 10) + Math.min(Math.floor(length / 100), 3);
  if (/article|body|content|entry|post|main|story|text|prose|markdown/.test(marker)) value += 25;
  if (block.tag === "p" || block.tag === "blockquote" || block.tag === "pre" || block.tag === "li" || block.tag === "td") value += 3;
  if (block.tag === "h1" || block.tag === "h2" || block.tag === "h3" || block.tag === "h4" || block.tag === "h5" || block.tag === "h6") value += 2;
  value -= linkDensity(block) * 8;
  return value;
}

/**
 * The text of a page that reads like an article.
 *
 * The blocks that hold furniture are left out, and so are the blocks that
 * are mostly links. The rest is kept in the order it was on the page,
 * because the order is part of what an article says.
 */
export function readablePage(blocks: PageBlock[]): { title: string; text: string; blocks: PageBlock[] } {
  const usable = blocks.filter((block) => {
    if (furnitureTags.has(block.tag)) return false;
    const text = block.text.trim();
    if (!text) return false;
    if (furnitureWords.some((word) => block.marker.includes(word))) return false;
    return true;
  });
  const kept = usable.filter((block) => score(block) >= 2);
  /**
   * A page that is nothing but links has no article in it, so all of it is
   * kept rather than none of it.
   */
  const chosen = kept.length ? kept : usable;
  const text = chosen.map((block) => block.text.trim()).filter(Boolean).join("\n\n");
  const title = chosen.find((block) => block.tag === "h1")?.text.trim() ?? "";
  return { title, text, blocks: chosen };
}

/**
 * The text of a page, with the empty lines tidied up.
 */
export function tidyPageText(text: string, limit = 100_000): string {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, limit);
}
