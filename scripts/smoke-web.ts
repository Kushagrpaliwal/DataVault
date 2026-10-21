import { chromium } from "@playwright/test";

const baseUrl = process.env.SMOKE_WEB_URL ?? "http://localhost:5173";
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;

if (!email || !password) throw new Error("Set SMOKE_EMAIL and SMOKE_PASSWORD to a real DataVault account before running the web smoke test.");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const diagnostics: string[] = [];
page.on("console", (message) => diagnostics.push(`console:${message.type()}:${message.text()}`));
page.on("requestfailed", (request) => diagnostics.push(`request:${request.url()}:${request.failure()?.errorText ?? "failed"}`));

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  try {
    await page.waitForURL(`${baseUrl}/`, { timeout: 15_000 });
  } catch (error) {
    await page.screenshot({ path: "test-results/data-vault-login-failure.png", fullPage: true });
    console.error(JSON.stringify({ currentUrl: page.url(), body: (await page.locator("body").innerText()).slice(0, 2_000), diagnostics }));
    throw error;
  }
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await page.getByText("Saved items", { exact: true }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: "test-results/data-vault-dashboard.png", fullPage: true });

  await page.goto(`${baseUrl}/saved`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Saved", exact: true }).waitFor();
  await page.screenshot({ path: "test-results/data-vault-saved.png", fullPage: true });

  await page.goto(`${baseUrl}/organize`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Organize", exact: true }).waitFor();
  await page.screenshot({ path: "test-results/data-vault-organize.png", fullPage: true });

  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();

  // The old paths must still land somewhere useful.
  await page.goto(`${baseUrl}/vault`, { waitUntil: "networkidle" });
  await page.waitForURL(`${baseUrl}/organize`, { timeout: 10_000 });
  await page.goto(`${baseUrl}/saved-data`, { waitUntil: "networkidle" });
  await page.waitForURL(`${baseUrl}/saved`, { timeout: 10_000 });

  /**
   * A page shared from a phone lands in the save form, with what was shared
   * already in it. The share target used to post to a page that redirected,
   * which threw the shared material away.
   */
  const sharedTitle = `Shared from a phone ${Date.now()}`;
  await page.goto(`${baseUrl}/share?title=${encodeURIComponent(sharedTitle)}&text=${encodeURIComponent("A passage worth keeping.")}&url=${encodeURIComponent("https://example.com/shared")}`, { waitUntil: "networkidle" });
  await page.getByLabel("Title", { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Save it", exact: true }).click();
  await page.waitForURL(/\/saved\//, { timeout: 15_000 });
  await page.getByText(sharedTitle, { exact: true }).first().waitFor({ timeout: 15_000 });

  /**
   * Every folder is shown until one is chosen, so nothing is hidden without
   * saying so.
   */
  await page.goto(`${baseUrl}/saved`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "All folders", exact: true }).waitFor({ timeout: 15_000 });
  await page.getByText(sharedTitle, { exact: true }).first().waitFor({ timeout: 15_000 });

  /**
   * A doc can be copied, and the copy is a new doc.
   */
  await page.goto(`${baseUrl}/docs`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New doc", exact: true }).first().click();
  await page.waitForURL(/\/docs\//, { timeout: 15_000 });
  const docUrl = page.url();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await page.waitForURL((url) => url.toString() !== docUrl && /\/docs\//.test(url.toString()), { timeout: 15_000 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export as HTML", exact: true }).click();
  await page.screenshot({ path: "test-results/data-vault-docs.png", fullPage: true });

  console.log(JSON.stringify({
    dashboard: "loaded",
    saved: "opened",
    organize: "opened",
    settings: "opened",
    legacyRedirects: "ok",
    share: "saved",
    allFolders: "shown",
    duplicate: "made",
    finalUrl: page.url(),
  }));
} catch (error) {
  await page.screenshot({ path: "test-results/data-vault-smoke-failure.png", fullPage: true });
  console.error(JSON.stringify({ currentUrl: page.url(), body: (await page.locator("body").innerText()).slice(0, 4_000), diagnostics }));
  throw error;
} finally {
  await browser.close();
}
