import { expect, test } from "@playwright/test";

const authority = "https://issuer.example";
const clientId = "browser-test";
const userStorageKey = `oidc.user:${authority}:${clientId}`;
const millisecondsPerSecond = 1000;
const testSessionLifetimeSeconds = 3600;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, user }) => {
      window.sessionStorage.setItem(key, JSON.stringify(user));
    },
    {
      key: userStorageKey,
      user: {
        access_token: "test-token",
        expires_at:
          Math.ceil(Date.now() / millisecondsPerSecond) +
          testSessionLifetimeSeconds,
        profile: { sub: "test-user" },
        scope: "openid",
        token_type: "Bearer",
      },
    },
  );
  await page.route("**/upload-intents", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        uploads: [
          {
            name: "flyer.png",
            url: "https://uploads.example/flyer.png",
            headers: { "Content-Type": "image/png", "If-None-Match": "*" },
          },
        ],
      }),
    });
  });
  await page.route("https://uploads.example/**", async (route) => {
    await route.fulfill({ status: 200 });
  });
});

test("uploads a file through the native picker", async ({ page }) => {
  await page.goto("/inbox/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(window.localStorage).filter((key) =>
          key.startsWith("oidc.user:"),
        ),
      ),
    )
    .toEqual([]);
  await page.locator('input[type="file"]').setInputFiles({
    name: "flyer.png",
    mimeType: "image/png",
    buffer: Buffer.from("source"),
  });

  await expect(page.getByText("Uploaded flyer.png")).toBeVisible();
});
