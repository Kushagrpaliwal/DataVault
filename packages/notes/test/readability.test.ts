import { describe, expect, test } from "bun:test";
import { readablePage, tidyPageText, type PageBlock } from "../src/readability";

function block(tag: string, text: string, options: { linkText?: string; marker?: string } = {}): PageBlock {
  return { tag, text, linkText: options.linkText ?? "", marker: options.marker ?? "" };
}

const article = [
  block("h1", "The quiet craft of reading"),
  block("p", "Reading well is a habit, and a habit is built one small choice at a time. The choices are not dramatic."),
  block("p", "A reader who is paying attention will notice that a page is mostly made of things that are not the article: menus, banners, and the list of other things to read."),
  block("p", "The rest is the work, and the work is what a careful reader came for."),
];

describe("the content of a page", () => {
  test("keeps the article and leaves the furniture out", () => {
    const page = readablePage([
      ...article,
      block("nav", "Home About Contact", { marker: "site-navigation" }),
      block("p", "Subscribe to our newsletter for more.", { marker: "newsletter-promo" }),
      block("p", "Read more of our writing on this page.", { linkText: "Read more of our writing on this page.", marker: "related-posts" }),
    ]);
    expect(page.text).toContain("Reading well is a habit");
    expect(page.text).not.toContain("Home About Contact");
    expect(page.text).not.toContain("Subscribe to our newsletter");
    expect(page.text).not.toContain("Read more of our writing");
  });

  test("keeps the blocks in the order they were on the page", () => {
    const page = readablePage(article);
    expect(page.text.indexOf("Reading well is a habit")).toBeLessThan(page.text.indexOf("The rest is the work"));
  });

  test("takes the title from the heading of the article", () => {
    const page = readablePage(article);
    expect(page.title).toBe("The quiet craft of reading");
  });

  test("a block that is mostly a link is not the content", () => {
    const page = readablePage([
      block("p", "A short note.", { linkText: "A short note." }),
      block("p", "The article is here, and it is worth reading on its own.", { marker: "article-body" }),
    ]);
    expect(page.text).toContain("The article is here");
    expect(page.text).not.toContain("A short note.");
  });

  test("a page with nothing that reads like an article is kept whole", () => {
    const page = readablePage([
      block("a", "Sign in", { linkText: "Sign in" }),
      block("a", "Create an account", { linkText: "Create an account" }),
    ]);
    expect(page.text).toContain("Sign in");
    expect(page.text).toContain("Create an account");
  });

  test("the text of a page is tidied up", () => {
    expect(tidyPageText("a   b\r\n\r\n\r\n\r\nc")).toBe("a b\n\nc");
    expect(tidyPageText("x".repeat(200), 50)).toHaveLength(50);
  });
});
