import { expect, test } from "@playwright/test";

test("P0 tooling smoke: app boots and serves a page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
});
